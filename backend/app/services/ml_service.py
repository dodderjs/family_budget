import joblib
import re
import unicodedata
from datetime import datetime
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
import numpy as np
from typing import Optional
from sqlalchemy.orm import Session
from app.config import settings
from app.constants.seed_data import KNOWN_MERCHANT_CATEGORIES, SEED_DATA
from app.models.transaction import TrainingData
from app.services.category_service import CategoryService

MODEL_DIR = settings.ML_MODEL_DIR
MODEL_DIR.mkdir(parents=True, exist_ok=True)

try:
    from app.constants.user_seed import USER_SEED_DATA
except ImportError:
    USER_SEED_DATA = []

ALL_SEED_DATA = [*SEED_DATA, *USER_SEED_DATA]


def _match_known_merchant(text: str) -> Optional[str]:
    lowered = text.lower()
    for category, keywords in KNOWN_MERCHANT_CATEGORIES.items():
        for keyword in keywords:
            if re.search(r"\b" + re.escape(keyword) + r"\b", lowered):
                return category
    return None


# Descriptions that carry no merchant identity - never used as a memory key, so
# every uncategorizable row doesn't collapse onto one shared key and start
# answering for the others. "Unknown transaction" is normalization.py's
# placeholder for a row with no description at all.
_NON_MERCHANT_DESCRIPTIONS = {"", "unknown transaction"}


def _merchant_key(text: str) -> str:
    """Conservative normalized key for the per-user merchant-memory lookup.

    Accent-folds (NFKD, same as category_service.slugify so 'kártyadíj' and an
    ascii-typed variant agree), lowercases, drops digits (store/terminal/card
    numbers vary per visit) and collapses every other non-alphanumeric run to a
    single space. Deliberately *exact* after this - it does no fuzzy matching,
    so memory only fires on a genuinely identical merchant string and never
    mislabels a near-neighbour; the char-ngram model is what generalizes across
    variants. Returns "" for descriptions with no merchant identity (see
    _NON_MERCHANT_DESCRIPTIONS), which the caller treats as "don't store/look up"."""
    if not text:
        return ""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    key = re.sub(r"[0-9]+", " ", ascii_text.lower())
    key = re.sub(r"[^a-z]+", " ", key).strip()
    if key in _NON_MERCHANT_DESCRIPTIONS:
        return ""
    return key


def _label_to_index(db: Session, label: str) -> int:
    index_map = CategoryService.get_ml_index_map(db)
    return index_map.get(label, index_map.get("other", 0))


def _index_to_label(db: Session, index: int) -> str:
    index_map = CategoryService.get_ml_index_map(db)
    reverse = {v: k for k, v in index_map.items()}
    return reverse.get(index, "other")


def _is_credit_account(account_type: str = None) -> bool:
    return bool(account_type) and "credit" in account_type.lower()


def _category_allowed(db: Session, category: str, amount: float, account_type: str = None) -> bool:
    sign = CategoryService.get_sign(db, category)
    if sign == "positive":
        if amount <= 0:
            return False
        # On a credit account, a positive amount is the cardholder paying
        # down their balance (or a refund), not genuine income - "salary"
        # and any other income-only category would otherwise be a plausible
        # but wrong guess for a deposit-sized payback.
        if _is_credit_account(account_type):
            return False
        return True
    if sign == "negative":
        return amount < 0
    return True


# Caps the log1p(abs(amount)) feature at roughly log1p(3_000_000), so it sits
# in a comparable [0, ~1] range to TF-IDF's normalized weights instead of
# dwarfing them - a plain unscaled HUF amount would otherwise swamp the text
# signal in the logistic regression.
_AMOUNT_LOG_SCALE = settings.ML_AMOUNT_LOG_SCALE


def _scaled_amount(amount: float) -> float:
    return min(np.log1p(abs(amount)) / _AMOUNT_LOG_SCALE, 1.0)


# What to feed the amount feature when amount is unknown (predict() called
# without one). 0.0 would be a real value far outside the training range -
# every SEED_DATA amount lands around 0.5-0.85 once scaled (HUF transaction
# sizes are never near zero) - so an unknown amount used 0.0 as a strong,
# wrong "tiny purchase" signal instead of a neutral one. The mean of the seed
# set's own scaled amounts is a self-consistent neutral midpoint instead of a
# hand-picked constant that would drift out of sync if SEED_DATA changes.
_NEUTRAL_AMOUNT_FEATURE = sum(_scaled_amount(amt) for _, _, amt in ALL_SEED_DATA) / len(ALL_SEED_DATA)


def _amount_feature(amount: float = None) -> float:
    if amount is None:
        return _NEUTRAL_AMOUNT_FEATURE
    return _scaled_amount(amount)


# Number of dense temporal columns appended after the amount feature: a sin/cos
# pair each for day-of-month and day-of-week (see _temporal_features). Used both
# to build the feature matrix and as the load_model() shape check.
_N_TEMPORAL_FEATURES = 4


def _parse_date_parts(date: str = None) -> tuple[Optional[int], Optional[int]]:
    """Split an ISO 'YYYY-MM-DD' string into (day_of_month 1-31, day_of_week
    0=Mon..6=Sun). Returns (None, None) for a missing/unparseable date so the
    temporal features fall back to neutral - same tolerance as the amount
    feature's None handling."""
    if not date:
        return None, None
    try:
        parsed = datetime.strptime(date, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None, None
    return parsed.day, parsed.weekday()


def _cyclical(value: Optional[int], period: int, base: int) -> tuple[float, float]:
    """Encode a periodic integer as a (sin, cos) pair so a linear model can use
    its position on the cycle without treating the wrap-around (e.g. day 31 ->
    day 1) as a large jump. value=None -> (0, 0): a zero-magnitude vector that
    carries no positional signal, the natural neutral for an unknown date."""
    if value is None:
        return 0.0, 0.0
    angle = 2.0 * np.pi * (value - base) / period
    return float(np.sin(angle)), float(np.cos(angle))


def _temporal_features(day_of_month: Optional[int], day_of_week: Optional[int]) -> list[float]:
    return [*_cyclical(day_of_month, 31, 1), *_cyclical(day_of_week, 7, 0)]


class CategoryPredictor:
    def __init__(self):
        self.vectorizer = None
        self.model = None
        self.load_model()

    def load_model(self):
        """Load a persisted model from disk if one exists. If not, leaves
        self.model/vectorizer unset - building the baseline needs a db
        session (category metadata now lives there), which isn't available
        at construction time (the global `predictor` below is built at
        import time). predict()/retrain() lazily build it on first real use
        instead, once they have a db session to pass in."""
        vectorizer_path = MODEL_DIR / "vectorizer.pkl"
        model_path = MODEL_DIR / "model.pkl"

        if vectorizer_path.exists() and model_path.exists():
            vectorizer = joblib.load(vectorizer_path)
            model = joblib.load(model_path)
            # Discard a persisted model whose feature width doesn't match what
            # _build_features now produces (text vocab + amount + temporal). An
            # older pickle predates the temporal columns, so feeding it the new
            # wider matrix would raise inside predict() and be silently swallowed
            # into ("other", 0.0) forever. Dropping it here makes the next
            # predict()/retrain() rebuild the baseline at the current shape.
            expected = len(vectorizer.vocabulary_) + 1 + _N_TEMPORAL_FEATURES
            if getattr(model, "n_features_in_", expected) != expected:
                return
            self.vectorizer = vectorizer
            self.model = model

    def _create_baseline(self, db: Session):
        """Create baseline model with seed data. Seeds carry no date, so their
        temporal features are left neutral (see _fit's None defaults)."""
        texts = [desc for desc, _, _ in ALL_SEED_DATA]
        labels = [cat for _, cat, _ in ALL_SEED_DATA]
        amounts = [amt for _, _, amt in ALL_SEED_DATA]
        self._fit(db, texts, labels, amounts)

    def _dense_features(self, amounts, days_of_month=None, days_of_week=None):
        """The dense per-row block appended to the TF-IDF text features:
        [scaled_amount, day_of_month sin/cos, day_of_week sin/cos]. A None day
        list (e.g. seed data, which carries no date) means every row's temporal
        features fall back to neutral."""
        if days_of_month is None:
            days_of_month = [None] * len(amounts)
        if days_of_week is None:
            days_of_week = [None] * len(amounts)
        return csr_matrix([
            [_amount_feature(a), *_temporal_features(dom, dow)]
            for a, dom, dow in zip(amounts, days_of_month, days_of_week)
        ])

    def _build_features(self, texts: list[str], amounts: list[float], days_of_month=None, days_of_week=None):
        """Combine TF-IDF text features with the dense amount+temporal block
        into one sparse matrix. analyzer='char_wb' (character n-grams)
        generalizes far better than word-level matching for morphologically
        rich, accented text (Hungarian merchant names) and for near-duplicate
        strings that only differ in a store number or city suffix - e.g.
        "Lidl HU 334 Debrecen" vs "Lidl HU 220 Budapest" share plenty of 3-5
        char substrings even though no whole word matches."""
        text_features = self.vectorizer.transform([t.lower() for t in texts])
        return hstack([text_features, self._dense_features(amounts, days_of_month, days_of_week)]).tocsr()

    def _fit(self, db: Session, texts: list[str], labels: list[str], amounts: list[float] = None,
             days_of_month: list = None, days_of_week: list = None) -> bool:
        """Fit the vectorizer+model on (text, label, amount, date-parts) data
        and persist it. Returns False without touching the existing model if
        there are fewer than 2 distinct labels, since LogisticRegression can't
        fit on a single class."""
        if len({_label_to_index(db, label) for label in labels}) < 2:
            return False
        if amounts is None:
            amounts = [None] * len(texts)
        if days_of_month is None:
            days_of_month = [None] * len(texts)
        if days_of_week is None:
            days_of_week = [None] * len(texts)

        vectorizer = TfidfVectorizer(lowercase=True, analyzer='char_wb', ngram_range=(3, 5))
        text_features = vectorizer.fit_transform([t.lower() for t in texts])
        X = hstack([text_features, self._dense_features(amounts, days_of_month, days_of_week)]).tocsr()

        model = LogisticRegression(multi_class='multinomial', max_iter=1000)
        y = np.array([_label_to_index(db, label) for label in labels])
        model.fit(X, y)

        self.vectorizer = vectorizer
        self.model = model
        self.save_model()
        return True

    def _merchant_memory(self, db: Session, description: str, amount: float = None,
                         account_type: str = None) -> Optional[tuple[str, float]]:
        """Per-user merchant recall: if the user has previously corrected (or a
        bank hint has labelled) a transaction whose description normalizes to
        the same merchant key, return that label directly. The most recent
        correction wins, so a later re-categorization supersedes an earlier one.
        Still passes through _category_allowed so a remembered label that
        contradicts this row's amount sign/account is skipped rather than
        forced. Returns None (fall through to the model) when there's no key or
        no allowed match."""
        key = _merchant_key(description)
        if not key:
            return None
        row = (db.query(TrainingData)
               .filter(TrainingData.merchant_key == key)
               .order_by(TrainingData.created_at.desc())
               .first())
        if row and (amount is None or _category_allowed(db, row.corrected_label, amount, account_type)):
            return row.corrected_label, 1.0
        return None

    def predict(self, db: Session, description: str, amount: float = None, account_type: str = None,
                date: str = None) -> tuple[str, float]:
        """Predict category and confidence for a transaction description.
        If `amount` is given, only considers categories whose sign (see
        Category.sign) matches its direction - the model's raw ranking is
        otherwise unconstrained. `account_type` adds a further veto: a
        positive amount on a credit account is a balance payback, not
        income, regardless of what sign alone allows. `date` (ISO YYYY-MM-DD)
        feeds the model's day-of-month/day-of-week features.

        Two high-precision layers are checked before the model, each returned
        immediately at full confidence if allowed for this amount/account:
        first the user's own merchant memory (a previously corrected/hinted
        label for the same merchant), then the hardcoded KNOWN_MERCHANT_CATEGORIES.
        Memory wins over the hardcoded list so an explicit user correction
        overrides a global default."""
        remembered = self._merchant_memory(db, description, amount, account_type)
        if remembered:
            return remembered

        known = _match_known_merchant(description)
        if known and (amount is None or _category_allowed(db, known, amount, account_type)):
            return known, 1.0

        if not self.model or not self.vectorizer:
            self._create_baseline(db)

        try:
            day_of_month, day_of_week = _parse_date_parts(date)
            X = self._build_features([description], [amount], [day_of_month], [day_of_week])
            probabilities = self.model.predict_proba(X)[0]
            # Rank by probability, descending, then walk down until we hit a
            # category the amount's sign actually allows.
            ranked_indices = np.argsort(probabilities)[::-1]

            for idx in ranked_indices:
                # idx is a position in `probabilities`/`classes_`, not the
                # encoded label itself - those only coincide when classes_ has
                # no gaps, which isn't guaranteed (e.g. "other" is never a
                # seed label).
                class_value = self.model.classes_[idx]
                category = _index_to_label(db, class_value)
                if amount is None or _category_allowed(db, category, amount, account_type):
                    return category, float(probabilities[idx])

            return "other", 0.0
        except Exception as e:
            return "other", 0.0

    def save_model(self):
        """Save model to disk"""
        if self.vectorizer and self.model:
            joblib.dump(self.vectorizer, MODEL_DIR / "vectorizer.pkl")
            joblib.dump(self.model, MODEL_DIR / "model.pkl")

    def reset_to_baseline(self, db: Session):
        """Discard any learned corrections and retrain on just the seed data."""
        vectorizer_path = MODEL_DIR / "vectorizer.pkl"
        model_path = MODEL_DIR / "model.pkl"
        if vectorizer_path.exists():
            vectorizer_path.unlink()
        if model_path.exists():
            model_path.unlink()
        self._create_baseline(db)

    def retrain(self, db: Session, training_data: list[tuple[str, str, float, str]]):
        """
        Retrain on the seed baseline plus all accumulated user corrections.
        The baseline is always included so retraining never drops a category
        the user hasn't happened to correct yet (and never ends up with the
        single-class data LogisticRegression can't fit on). Each correction is
        (description, corrected_label, amount, date); amount/date may be None
        for corrections recorded before they were tracked - both fall back to
        the same neutral features predict() uses for unknown values.
        """
        if not training_data:
            return

        # Seeds (text, label, amount) carry no date, corrections add an ISO date
        # parsed into day-of-month + day-of-week, so build the parallel feature
        # lists rather than concatenating mismatched-width tuples. Seeds get a
        # neutral (None) temporal signal; the temporal features are learned from
        # the dated corrections only.
        texts = [desc for desc, _, _ in ALL_SEED_DATA] + [desc for desc, _, _, _ in training_data]
        labels = [cat for _, cat, _ in ALL_SEED_DATA] + [cat for _, cat, _, _ in training_data]
        amounts = [amt for _, _, amt in ALL_SEED_DATA] + [amt for _, _, amt, _ in training_data]

        days_of_month = [None] * len(ALL_SEED_DATA)
        days_of_week = [None] * len(ALL_SEED_DATA)
        for _, _, _, date in training_data:
            dom, dow = _parse_date_parts(date)
            days_of_month.append(dom)
            days_of_week.append(dow)

        self._fit(db, texts, labels, amounts, days_of_month, days_of_week)

# Global instance
predictor = CategoryPredictor()
