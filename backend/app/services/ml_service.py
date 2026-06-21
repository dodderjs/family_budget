import joblib
import os
import re
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
import numpy as np
from pathlib import Path
from typing import Optional

MODEL_DIR = Path(__file__).parent.parent / "ml" / "models"
MODEL_DIR.mkdir(exist_ok=True)

CATEGORIES = [
    "groceries",
    "rent",
    "salary",
    "bills",
    "transport",
    "entertainment",
    "other",
    # Appended rather than inserted alphabetically - CATEGORY_TO_INDEX below
    # is positional, and a persisted model.pkl from before these existed
    # still expects "other" at index 6. New categories must always go after
    # the existing ones, never reordered.
    "shopping",
    "eating_out",
    "travel",
    "health",
    # Transfer-type categories - money moving between the user's own
    # accounts rather than being spent. Each requires a transfer pairing
    # (Transaction.transfer_match_id) to be finalized as this category - see
    # TRANSFER_CATEGORIES/update_transaction_category in transaction_service.py.
    "topup",
    "credit_payback",
    "saving",
    "transfer",
]
# Fixed category->index mapping, shared by every fit() and predict() call, so
# the integer label a model is trained on always means the same category.
CATEGORY_TO_INDEX = {category: index for index, category in enumerate(CATEGORIES)}

# Trivial rule layer on top of the ML model: a category tied to one
# transaction direction can never be predicted for the other direction (e.g.
# "salary" is income-only, so a negative/expense amount should never be
# classified as salary, no matter what the model's raw probabilities say).
# None means unconstrained (works for either sign).
CATEGORY_SIGN = {
    "groceries": "negative",
    "rent": "negative",
    "salary": "positive",
    "utilities": "negative",
    "transport": "negative",
    "entertainment": "negative",
    "other": None,
    "shopping": "negative",
    "eating_out": "negative",
    "travel": "negative",
    "health": "negative",
    # Each transfer category can land on either leg of the pair (e.g.
    # "topup" is an outflow on the source account, an inflow on the prepaid
    # card) - unconstrained, like "other".
    "topup": None,
    "credit_payback": None,
    "saving": None,
    "transfer": None,
}


# High-precision deterministic overrides, checked before the ML model -
# unambiguous brand/keyword matches that should never depend on a small
# model's fuzzy text similarity. Keys are whole-word matches (regex \b on
# both sides) against the lowercased description, derived from real merchant
# strings across the example/ exports - not guessed. Keywords with a known
# collision against an unrelated common word are deliberately left out (e.g.
# bare "bolt" also means "shop" in Hungarian - "Mezőgazdasági Bolt" isn't the
# Bolt ride-hailing app - so "bolt.eu" is used instead).
KNOWN_MERCHANT_CATEGORIES = {
    "groceries": ["lidl", "tesco", "aldi", "auchan", "spar", "cba", "penny"],
    "health": ["patika", "gyogyszertar", "gyógyszertár", "rossmann"],
    "eating_out": ["etterem", "étterem", "pizza", "burger", "cafe", "kavezo", "kávézó", "bisztro"],
    "entertainment": ["cinema", "netflix", "hbo", "spotify"],
    "travel": ["hotel", "booking.com", "wizz air", "wizzair", "ryanair"],
    "transport": ["mol", "shell", "omv", "bkk", "mav", "taxi", "bolt.eu"],
    "bills": ["mvm", "nkm", "dmrv", "telekom"],
    "shopping": ["alza", "amazon", "aliexpress", "decathlon", "ikea", "obi", "c&a"],
}


def _match_known_merchant(text: str) -> Optional[str]:
    lowered = text.lower()
    for category, keywords in KNOWN_MERCHANT_CATEGORIES.items():
        for keyword in keywords:
            if re.search(r"\b" + re.escape(keyword) + r"\b", lowered):
                return category
    return None


def _label_to_index(label: str) -> int:
    return CATEGORY_TO_INDEX.get(label, CATEGORY_TO_INDEX["other"])


def _is_credit_account(account_type: str = None) -> bool:
    return bool(account_type) and "credit" in account_type.lower()


def _category_allowed(category: str, amount: float, account_type: str = None) -> bool:
    sign = CATEGORY_SIGN.get(category)
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


# Always included when (re)training, so the model never loses categories the
# user hasn't happened to correct yet, and never ends up with fewer than 2
# classes (which LogisticRegression.fit() can't handle). (text, label, amount)
# - amount is a representative magnitude (HUF, signed per CATEGORY_SIGN) so
# the model also learns that category from typical transaction size, not
# just text. Real Hungarian merchant names are pulled from example/ exports
# (the same evidence KNOWN_MERCHANT_CATEGORIES above is grounded in) so the
# model has real vocabulary to fall back on for near-misses the deterministic
# lookup doesn't catch (different store number, city, branch suffix, etc.)
# rather than only the original English placeholder phrases.
SEED_DATA = [
    ("Grocery Store", "groceries", -3500.0),
    ("Supermarket", "groceries", -3500.0),
    ("Whole Foods", "groceries", -3500.0),
    ("Lidl", "groceries", -3500.0),
    ("Tesco", "groceries", -3500.0),
    ("Aldi", "groceries", -3500.0),
    ("Auchan Budaors", "groceries", -3500.0),
    ("Spar Magyarorszag", "groceries", -3500.0),
    ("Cba Elelmiszer", "groceries", -3500.0),
    ("Penny Market", "groceries", -3500.0),
    ("Monthly Rent Payment", "rent", -150000.0),
    ("Rent Deposit", "rent", -150000.0),
    ("Landlord Payment", "rent", -150000.0),
    ("Lakber", "rent", -150000.0),
    ("Berleti dij", "rent", -150000.0),
    ("Salary Deposit", "salary", 350000.0),
    ("Paycheck", "salary", 350000.0),
    ("Income Deposit", "salary", 350000.0),
    ("Munkaber", "salary", 350000.0),
    ("Fizetes", "salary", 350000.0),
    ("Electric Company", "bills", -15000.0),
    ("Water Bill", "bills", -15000.0),
    ("Internet Service", "bills", -15000.0),
    ("Mvm Next Energiak", "bills", -15000.0),
    ("Nkm Energia Zrt", "bills", -15000.0),
    ("Dmrv Zrt", "bills", -15000.0),
    ("Telekomszaml", "bills", -15000.0),
    ("Uber", "transport", -2000.0),
    ("Taxi", "transport", -2000.0),
    ("Metro Card", "transport", -2000.0),
    ("Gas Station", "transport", -2000.0),
    ("Mol", "transport", -2000.0),
    ("Shell", "transport", -2000.0),
    ("Omv", "transport", -2000.0),
    ("Bkk Automata", "transport", -2000.0),
    ("Mav", "transport", -2000.0),
    ("Cinema", "entertainment", -6000.0),
    ("Movie Theater", "entertainment", -6000.0),
    ("Concert", "entertainment", -6000.0),
    ("Cinema City", "entertainment", -6000.0),
    ("Netflix", "entertainment", -6000.0),
    ("Hbo Max", "entertainment", -6000.0),
    ("Spotify", "entertainment", -6000.0),
    ("Clothing Store", "shopping", -8000.0),
    ("Department Store", "shopping", -8000.0),
    ("Online Shopping", "shopping", -8000.0),
    ("Shopping Mall", "shopping", -8000.0),
    ("C&A", "shopping", -8000.0),
    ("Alza", "shopping", -8000.0),
    ("Amazon", "shopping", -8000.0),
    ("Aliexpress", "shopping", -8000.0),
    ("Decathlon", "shopping", -8000.0),
    ("Ikea", "shopping", -8000.0),
    ("Obi", "shopping", -8000.0),
    ("Restaurant", "eating_out", -4000.0),
    ("Cafe", "eating_out", -4000.0),
    ("Coffee Shop", "eating_out", -4000.0),
    ("Food Delivery", "eating_out", -4000.0),
    ("Burger King", "eating_out", -4000.0),
    ("Bettolino Pizza", "eating_out", -4000.0),
    ("Cafe Rabacal", "eating_out", -4000.0),
    ("Hotel Booking", "travel", -40000.0),
    ("Airline Ticket", "travel", -40000.0),
    ("Flight Booking", "travel", -40000.0),
    ("Travel Agency", "travel", -40000.0),
    ("Booking.com", "travel", -40000.0),
    ("Wizz Air", "travel", -40000.0),
    ("Ryanair", "travel", -40000.0),
    ("Pharmacy", "health", -5000.0),
    ("Doctor Visit", "health", -5000.0),
    ("Hospital", "health", -5000.0),
    ("Health Insurance", "health", -5000.0),
    ("Rossmann", "health", -5000.0),
    ("Danubius Patika", "health", -5000.0),
    ("Revolut Top-Up", "topup", -20000.0),
    ("Revolut Feltoltes", "topup", -20000.0),
    ("Top-Up Card", "topup", -20000.0),
    ("Credit Card Payment", "credit_payback", -50000.0),
    ("Credit Payback", "credit_payback", -50000.0),
    ("Hitelkartya Torlesztes", "credit_payback", -50000.0),
    ("Transfer To Savings", "saving", -100000.0),
    ("Savings Deposit", "saving", -100000.0),
    ("Megtakaritasi Atutalas", "saving", -100000.0),
    ("Bank Transfer", "transfer", -50000.0),
    ("Internal Transfer", "transfer", -50000.0),
    ("Atutalas Bankon Belul", "transfer", -50000.0),
]


# Caps the log1p(abs(amount)) feature at roughly log1p(3_000_000), so it sits
# in a comparable [0, ~1] range to TF-IDF's normalized weights instead of
# dwarfing them - a plain unscaled HUF amount would otherwise swamp the text
# signal in the logistic regression.
_AMOUNT_LOG_SCALE = 15.0


def _scaled_amount(amount: float) -> float:
    return min(np.log1p(abs(amount)) / _AMOUNT_LOG_SCALE, 1.0)


# What to feed the amount feature when amount is unknown (predict() called
# without one). 0.0 would be a real value far outside the training range -
# every SEED_DATA amount lands around 0.5-0.85 once scaled (HUF transaction
# sizes are never near zero) - so an unknown amount used 0.0 as a strong,
# wrong "tiny purchase" signal instead of a neutral one. The mean of the seed
# set's own scaled amounts is a self-consistent neutral midpoint instead of a
# hand-picked constant that would drift out of sync if SEED_DATA changes.
_NEUTRAL_AMOUNT_FEATURE = sum(_scaled_amount(amt) for _, _, amt in SEED_DATA) / len(SEED_DATA)


def _amount_feature(amount: float = None) -> float:
    if amount is None:
        return _NEUTRAL_AMOUNT_FEATURE
    return _scaled_amount(amount)


class CategoryPredictor:
    def __init__(self):
        self.vectorizer = None
        self.model = None
        self.load_model()

    def load_model(self):
        """Load model from disk or create new one"""
        vectorizer_path = MODEL_DIR / "vectorizer.pkl"
        model_path = MODEL_DIR / "model.pkl"

        if vectorizer_path.exists() and model_path.exists():
            self.vectorizer = joblib.load(vectorizer_path)
            self.model = joblib.load(model_path)
        else:
            # Create baseline model
            self._create_baseline()

    def _create_baseline(self):
        """Create baseline model with seed data"""
        texts = [desc for desc, _, _ in SEED_DATA]
        labels = [cat for _, cat, _ in SEED_DATA]
        amounts = [amt for _, _, amt in SEED_DATA]
        self._fit(texts, labels, amounts)

    def _build_features(self, texts: list[str], amounts: list[float]):
        """Combine TF-IDF text features with a single scaled amount-magnitude
        feature into one sparse matrix. analyzer='char_wb' (character
        n-grams) generalizes far better than word-level matching for
        morphologically rich, accented text (Hungarian merchant names) and
        for near-duplicate strings that only differ in a store number or
        city suffix - e.g. "Lidl HU 334 Debrecen" vs "Lidl HU 220 Budapest"
        share plenty of 3-5 char substrings even though no whole word matches."""
        text_features = self.vectorizer.transform([t.lower() for t in texts])
        amount_features = csr_matrix([[_amount_feature(a)] for a in amounts])
        return hstack([text_features, amount_features]).tocsr()

    def _fit(self, texts: list[str], labels: list[str], amounts: list[float] = None) -> bool:
        """Fit the vectorizer+model on (text, label, amount) data and persist
        it. Returns False without touching the existing model if there are
        fewer than 2 distinct labels, since LogisticRegression can't fit on a
        single class."""
        if len({_label_to_index(label) for label in labels}) < 2:
            return False
        if amounts is None:
            amounts = [None] * len(texts)

        vectorizer = TfidfVectorizer(lowercase=True, analyzer='char_wb', ngram_range=(3, 5))
        text_features = vectorizer.fit_transform([t.lower() for t in texts])
        amount_features = csr_matrix([[_amount_feature(a)] for a in amounts])
        X = hstack([text_features, amount_features]).tocsr()

        model = LogisticRegression(multi_class='multinomial', max_iter=1000)
        y = np.array([_label_to_index(label) for label in labels])
        model.fit(X, y)

        self.vectorizer = vectorizer
        self.model = model
        self.save_model()
        return True

    def predict(self, description: str, amount: float = None, account_type: str = None) -> tuple[str, float]:
        """Predict category and confidence for a transaction description.
        If `amount` is given, only considers categories whose CATEGORY_SIGN
        rule matches its direction (see module docstring above) - the
        model's raw ranking is otherwise unconstrained. `account_type` adds a
        further veto: a positive amount on a credit account is a balance
        payback, not income, regardless of what CATEGORY_SIGN alone allows.

        A known-merchant match (see KNOWN_MERCHANT_CATEGORIES) is checked
        first and, if allowed for this amount/account, returned immediately
        at full confidence - no point asking a small text model to guess at
        something already unambiguous."""
        known = _match_known_merchant(description)
        if known and (amount is None or _category_allowed(known, amount, account_type)):
            return known, 1.0

        if not self.model or not self.vectorizer:
            self.load_model()

        try:
            X = self._build_features([description], [amount])
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
                category = CATEGORIES[class_value] if class_value < len(CATEGORIES) else "other"
                if amount is None or _category_allowed(category, amount, account_type):
                    return category, float(probabilities[idx])

            return "other", 0.0
        except Exception as e:
            return "other", 0.0

    def save_model(self):
        """Save model to disk"""
        if self.vectorizer and self.model:
            joblib.dump(self.vectorizer, MODEL_DIR / "vectorizer.pkl")
            joblib.dump(self.model, MODEL_DIR / "model.pkl")

    def reset_to_baseline(self):
        """Discard any learned corrections and retrain on just the seed data."""
        vectorizer_path = MODEL_DIR / "vectorizer.pkl"
        model_path = MODEL_DIR / "model.pkl"
        if vectorizer_path.exists():
            vectorizer_path.unlink()
        if model_path.exists():
            model_path.unlink()
        self._create_baseline()

    def retrain(self, training_data: list[tuple[str, str, float]]):
        """
        Retrain on the seed baseline plus all accumulated user corrections.
        The baseline is always included so retraining never drops a category
        the user hasn't happened to correct yet (and never ends up with the
        single-class data LogisticRegression can't fit on). Each correction
        is (description, corrected_label, amount); amount may be None for
        corrections recorded before that was tracked - treated as 0 for the
        feature, same as predict()'s default.
        """
        if not training_data:
            return

        combined = SEED_DATA + training_data
        texts = [desc for desc, _, _ in combined]
        labels = [cat for _, cat, _ in combined]
        amounts = [amt for _, _, amt in combined]
        self._fit(texts, labels, amounts)

# Global instance
predictor = CategoryPredictor()
