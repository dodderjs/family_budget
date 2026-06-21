---
name: "ML & Transaction Categorization"
description: "Use when: improving ML predictions, retraining models, or modifying backend/app/services/ml_service.py or normalization.py."
applyTo: "backend/app/services/ml_service.py,backend/app/services/normalization.py"
---

# ML & Categorization

TF-IDF (`TfidfVectorizer`) + `LogisticRegression` over transaction descriptions. 7 categories: `groceries, rent, salary, utilities, transport, entertainment, other` (`CATEGORIES` in `ml_service.py`).

## The encoding contract (read before touching this file)

`CATEGORY_TO_INDEX` is the *only* category↔integer mapping. Never derive one from `set(labels)` (iteration order is hash-seed-randomized — same category gets a different int every process restart) or treat `predicted_idx` from `np.argmax(predict_proba(...))` as a `CATEGORIES` index directly (it's a position in `model.classes_`, which has gaps whenever a category — e.g. `"other"` — wasn't in the training set that run). Always decode via `category = CATEGORIES[self.model.classes_[predicted_idx]]`.

## Retraining

`retrain(training_data)` merges `SEED_DATA + training_data` before fitting — never fit on corrections alone. Reasons: `LogisticRegression.fit()` needs ≥2 classes (a user who has only corrected one category would crash it), and dropping the baseline makes the model forget every category the user hasn't corrected yet (corrections only get logged when the model is *wrong*, so a category it already gets right may have zero correction rows forever).

`_fit(texts, labels)` is the shared fit/save path; it returns `False` and leaves the existing model untouched if given fewer than 2 distinct classes — a safety net, not the primary mechanism (the seed merge is).

## Adding seed examples

Append to `SEED_DATA` (list of `(description, category)` tuples) in `ml_service.py`. More/better examples per category improves baseline accuracy before any real corrections exist.

## Testing

`backend/tests/test_ml_service.py` trains into a `tmp_path` (via `monkeypatch.setattr(ml_service, "MODEL_DIR", tmp_path)`) so tests never touch the real `backend/app/ml/models/*.pkl`. Run: `docker exec family-budget-api python -m pytest tests/test_ml_service.py -v`.
