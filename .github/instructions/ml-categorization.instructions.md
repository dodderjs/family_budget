---
name: "ML & Transaction Categorization"
description: "Use when: improving ML predictions, retraining models, modifying categorization logic, or adjusting transaction processing. Covers sklearn pipeline and ML service."
applyTo: "backend/app/services/ml_service.py,backend/app/services/normalization.py"
---

# ML & Categorization Development Guide

## Overview

The categorization system uses:
- **Algorithm**: TF-IDF vectorization + Logistic Regression
- **Categories**: 7 (groceries, rent, salary, utilities, transport, entertainment, other)
- **Training Data**: Seed data + user corrections (TrainingData table)
- **Persistence**: Joblib pickle files in `backend/app/ml/models/`

---

## Architecture

```python
# User downloads CSV
# ↓
# POST /upload (preview)
# ↓
# POST /transactions/normalize
# ↓
# TransactionService.create_transaction()
#   ↓
#   predictor.predict(description)  ← ML HERE
#   ↓
#   Returns (category, confidence)
# ↓
# Stored in DB: category_predicted, category_confidence
# ↓
# User reviews & corrects
# ↓
# PATCH /transactions/{id} (saves to training_data table)
# ↓
# POST /ml/retrain
#   ↓
#   Collect all corrections from training_data
#   ↓
#   predictor.retrain(data)
#   ↓
#   Model pickled to disk
```

---

## The CategoryPredictor Class

### Location
`backend/app/services/ml_service.py`

### Key Methods

**`__init__()`** - Load or create model
```python
def __init__(self):
    self.vectorizer = None
    self.model = None
    self.load_model()  # Load from disk or create baseline
```

**`load_model()`** - Initialize from pickle or create baseline
```python
def load_model(self):
    vectorizer_path = MODEL_DIR / "vectorizer.pkl"
    model_path = MODEL_DIR / "model.pkl"
    
    if vectorizer_path.exists() and model_path.exists():
        self.vectorizer = joblib.load(vectorizer_path)
        self.model = joblib.load(model_path)
    else:
        self._create_baseline()
```

**`predict(description: str) -> (str, float)`** - Predict category
```python
def predict(self, description: str) -> tuple[str, float]:
    """Return (category, confidence)"""
    X = self.vectorizer.transform([description.lower()])
    probabilities = self.model.predict_proba(X)[0]
    predicted_idx = np.argmax(probabilities)
    confidence = probabilities[predicted_idx]
    category = CATEGORIES[predicted_idx]
    
    return category, float(confidence)
```

**`retrain(training_data)`** - Fit new model
```python
def retrain(self, training_data: list[tuple[str, str]]):
    """training_data is list of (description, corrected_label)"""
    texts = [desc for desc, _ in training_data]
    labels = [cat for _, cat in training_data]
    
    self.vectorizer = TfidfVectorizer(...)
    X = self.vectorizer.fit_transform(texts)
    
    self.model = LogisticRegression(...)
    self.model.fit(X, y)
    
    self.save_model()  # Persist to disk
```

---

## Current Categories

```python
CATEGORIES = [
    "groceries",        # Supermarkets, food markets
    "rent",             # Housing payments
    "salary",           # Income deposits
    "utilities",        # Bills (electric, water, gas, internet)
    "transport",        # Taxi, Metro, Gas, Parking
    "entertainment",    # Movies, concerts, restaurants
    "other"             # Catchall
]
```

### Seed Data Examples
Each category has 3-4 examples used to bootstrap the model:

```python
seed_data = [
    ("Whole Foods Market", "groceries"),
    ("Supermarket", "groceries"),
    ("Monthly Rent Payment", "rent"),
    ("Salary Deposit", "salary"),
    ("Electric Company", "utilities"),
    ("Uber", "transport"),
    ("Cinema", "entertainment"),
    # ... more examples
]
```

---

## Workflow: User Correction → Model Improvement

### 1. User Makes Correction
```
Frontend: PATCH /api/v1/transactions/{id}
  {
    "category_final": "groceries"  ← User corrected prediction
  }
```

### 2. Backend Logs Training Data
```python
# In transaction_service.py::update_transaction_category()

if transaction.category_predicted != category:
    training = TrainingData(
        transaction_id=transaction_id,
        original_label=transaction.category_predicted or "unknown",
        corrected_label=category  ← Store the correction
    )
    db.add(training)

transaction.category_final = category
db.commit()
```

### 3. User Triggers Retrain (Optional)
```
Frontend: POST /api/v1/ml/retrain
```

### 4. Backend Collects Data & Retrains
```python
# In api/transactions.py::retrain_model()

training_data = db.query(TrainingData).all()  # Get all user corrections

data = []
for td in training_data:
    tx = db.query(Transaction).filter(
        Transaction.id == td.transaction_id
    ).first()
    if tx:
        data.append((tx.description, td.corrected_label))

predictor.retrain(data)  # ← Refit model
```

---

## How to Improve Predictions

### 1. **Add More Seed Data**
Edit seed data in `_create_baseline()`:
```python
def _create_baseline(self):
    seed_data = [
        ("Farmer's Market", "groceries"),        # NEW
        ("Costco", "groceries"),                  # NEW
        ("Metro Card Reload", "transport"),       # NEW
        # ... existing data
    ]
```

More examples = better baseline performance.

### 2. **Collect User Corrections**
Users naturally improve the model by correcting misclassifications.
Every correction is logged and available for retraining.

### 3. **Retrain When Needed**
Call `POST /ml/retrain` after collecting enough corrections:
```python
predictor.retrain(training_data)  # Fit new model based on corrections
```

### 4. **Monitor Confidence Scores**
- High confidence (>0.8) = Trust the prediction
- Low confidence (<0.5) = Likely needs review

```sql
-- Query low-confidence predictions
SELECT id, description, category_predicted, category_confidence
FROM transactions
WHERE category_confidence < 0.5
AND category_final IS NULL
ORDER BY category_confidence ASC;
```

---

## Testing ML

### Manual Testing
```bash
# Start app
docker-compose up

# Upload sample CSV
curl -X POST http://localhost:8000/api/v1/upload \
  -F "file=@data/bank_a_transactions.csv"

# Process transactions
curl -X POST http://localhost:8000/api/v1/transactions/normalize \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": "...",
    "bank_format": "bank_a",
    "data": [...]
  }'

# Check predictions
curl http://localhost:8000/api/v1/transactions

# Retrain
curl -X POST http://localhost:8000/api/v1/ml/retrain
```

### Prediction Test Script
```python
from app.services.ml_service import predictor

# Test predictions
test_descriptions = [
    "Whole Foods Market",
    "Monthly Rent Payment",
    "Salary Deposit",
    "Unknown Description",
]

for desc in test_descriptions:
    category, confidence = predictor.predict(desc)
    print(f"{desc} → {category} ({confidence:.2%})")
```

### Checking Trained Model
```python
# View model internals
print(predictor.model.classes_)  # Class labels
print(predictor.vectorizer.get_feature_names_out()[:20])  # Top features
```

---

## Advanced: Custom Features

### Add Description Preprocessing
```python
def preprocess_description(desc: str) -> str:
    """Clean description before vectorization."""
    desc = desc.lower()
    desc = re.sub(r'[^\w\s]', '', desc)  # Remove special chars
    desc = re.sub(r'\d+', '', desc)      # Remove numbers
    return desc.strip()
```

Then use in predict:
```python
def predict(self, description: str) -> tuple[str, float]:
    processed = preprocess_description(description)
    X = self.vectorizer.transform([processed])
    # ... rest of logic
```

### Add Merchant Rules (Before ML)
```python
def predict(self, description: str, merchant: str = None) -> tuple[str, float]:
    # Rule-based overrides
    if merchant and "rent" in merchant.lower():
        return "rent", 1.0
    
    if "salary" in description.lower():
        return "salary", 0.99
    
    # Fall back to ML
    X = self.vectorizer.transform([description.lower()])
    # ... ML logic
```

### Different Algorithms
Replace LogisticRegression with:
```python
from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import SVC

# Random Forest (more complex)
self.model = RandomForestClassifier(n_estimators=100, max_depth=10)

# SVM (different decision boundary)
self.model = SVC(probability=True, kernel='rbf')
```

---

## Monitoring & Debugging

### Query Model Performance
```sql
-- Accuracy on categorized transactions
SELECT 
    SUM(CASE WHEN category_predicted = category_final 
             THEN 1 ELSE 0 END) / COUNT(*) as accuracy
FROM transactions
WHERE category_final IS NOT NULL;

-- Confidence distribution
SELECT 
    CASE 
        WHEN category_confidence >= 0.9 THEN '90-100%'
        WHEN category_confidence >= 0.8 THEN '80-90%'
        WHEN category_confidence >= 0.7 THEN '70-80%'
        ELSE '<70%'
    END as confidence_bucket,
    COUNT(*) as count
FROM transactions
GROUP BY confidence_bucket;

-- Errors by category
SELECT 
    category_predicted,
    category_final,
    COUNT(*) as count
FROM transactions
WHERE category_predicted IS NOT NULL
AND category_final IS NOT NULL
AND category_predicted != category_final
GROUP BY category_predicted, category_final;
```

### Retraining Stats
```python
from app.models.transaction import TrainingData

# Check how much training data we have
training_count = db.query(TrainingData).count()
print(f"Training samples: {training_count}")

# Group by corrected category
from sqlalchemy import func
by_category = db.query(
    TrainingData.corrected_label,
    func.count(TrainingData.id).label('count')
).group_by(TrainingData.corrected_label).all()

for label, count in by_category:
    print(f"{label}: {count} corrections")
```

---

---

## Model Evaluation Metrics

### Key Metrics to Track

```python
from sklearn.metrics import precision_score, recall_score, f1_score, confusion_matrix
from sklearn.model_selection import cross_val_score

# After retraining, evaluate model
X = vectorizer.transform(descriptions)
y_true = corrected_labels
y_pred = model.predict(X)

# Overall metrics
accuracy = (y_pred == y_true).mean()
precision = precision_score(y_true, y_pred, average='weighted')
recall = recall_score(y_true, y_pred, average='weighted')
f1 = f1_score(y_true, y_pred, average='weighted')

print(f"Accuracy:  {accuracy:.3f}")
print(f"Precision: {precision:.3f}")
print(f"Recall:    {recall:.3f}")
print(f"F1 Score:  {f1:.3f}")

# Per-category metrics
for category in CATEGORIES:
    cat_precision = precision_score(
        y_true, y_pred, 
        labels=[category],
        average='micro'
    )
    cat_recall = recall_score(
        y_true, y_pred,
        labels=[category],
        average='micro'
    )
    print(f"{category}: P={cat_precision:.3f} R={cat_recall:.3f}")
```

### Performance Thresholds

| Metric | Threshold | Action |
|--------|-----------|--------|
| **Overall Accuracy** | > 0.70 | Ready for production |
| **Precision (any category)** | < 0.50 | Investigate category |
| **Recall (any category)** | < 0.50 | Add seed data for that category |
| **F1 Score** | < 0.50 | Category needs work |
| **Prediction Confidence** | < 0.65 | Flag for manual review |

### Confusion Matrix
```python
from sklearn.metrics import confusion_matrix
import numpy as np

cm = confusion_matrix(y_true, y_pred, labels=CATEGORIES)

# Print as table
print("\nConfusion Matrix:")
print("              " + "  ".join(CATEGORIES[:4]))
for i, category in enumerate(CATEGORIES):
    print(f"{category:12} {cm[i]}")
```

---

## Production Checklist: ML Model Deployment

- [ ] **Accuracy > 70%** on test set
- [ ] **No category** with precision < 0.5
- [ ] **Confidence thresholds** implemented (flag < 0.65 for review)
- [ ] **Retraining strategy** documented (manual or scheduled)
- [ ] **Monitoring dashboard** shows model metrics
- [ ] **Fallback logic** if model fails (default to "other")
- [ ] **Version control** for model artifacts (track model.pkl, vectorizer.pkl)
- [ ] **A/B testing setup** to compare old vs. new model

---

## Monitoring & Production Best Practices

### 1. Track Prediction Confidence Over Time

```python
# Log confidence metrics regularly
import logging
from datetime import datetime

def log_prediction_stats(db):
    """Log model performance stats hourly."""
    stats = db.query(
        func.avg(Transaction.category_confidence).label('avg_conf'),
        func.min(Transaction.category_confidence).label('min_conf'),
        func.max(Transaction.category_confidence).label('max_conf'),
        func.count(Transaction.id).label('count')
    ).filter(
        Transaction.created_at > datetime.utcnow() - timedelta(hours=1)
    ).first()
    
    logging.info(f"Predictions (last hour): avg={stats.avg_conf:.3f}, "
                 f"min={stats.min_conf:.3f}, count={stats.count}")
```

### 2. Flag Low-Confidence Predictions for Review

```python
# Add to ReviewPage frontend or admin panel
LOW_CONFIDENCE_THRESHOLD = 0.65

unreviewed_low_confidence = db.query(Transaction).filter(
    and_(
        Transaction.category_final.is_(None),
        Transaction.category_confidence < LOW_CONFIDENCE_THRESHOLD
    )
).order_by(Transaction.category_confidence).all()

# Users review these first
```

### 3. Retraining Strategy

**Option A: Manual Retraining**
- User/admin calls `POST /ml/retrain` via UI
- Best for: Small datasets, frequent manual review

**Option B: Scheduled Retraining**
```python
# In backend startup or scheduled task
from apscheduler.schedulers.background import BackgroundScheduler

scheduler = BackgroundScheduler()

@scheduler.scheduled_job('interval', hours=24)
def retrain_nightly():
    """Retrain model with user corrections daily."""
    db = SessionLocal()
    training_data = db.query(TrainingData).all()
    
    if len(training_data) > 20:  # Only retrain if enough data
        predictor.retrain(training_data)
        logging.info(f"Model retrained with {len(training_data)} samples")
    
    db.close()

scheduler.start()
```

**Option C: A/B Testing**
```python
# Test new model on subset of traffic
import random

def predict_with_ab_test(description):
    if random.random() < 0.1:  # 10% of users
        # Use new model
        return new_predictor.predict(description)
    else:
        # Use current model
        return current_predictor.predict(description)

# Track metrics separately to compare
```

### 4. Handle Model Failures Gracefully

```python
def predict_safe(description: str) -> tuple[str, float]:
    """Predict with fallback to 'other'."""
    try:
        return predictor.predict(description)
    except Exception as e:
        logging.error(f"Prediction failed for '{description}': {e}")
        return "other", 0.0  # Fallback to catch-all
```

### 5. Monitor Model Drift

```sql
-- Compare predictions over time
SELECT 
    DATE(created_at) as date,
    category_predicted,
    COUNT(*) as count,
    SUM(CASE WHEN category_final IS NOT NULL 
             AND category_predicted != category_final 
             THEN 1 ELSE 0 END) as corrections
FROM transactions
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at), category_predicted
ORDER BY date DESC;
```

If corrections increase or accuracy drops, trigger retraining.

---

## Common Issues

### Issue: Low Confidence Scores
**Symptoms**: Most predictions < 0.6

**Causes**:
- Seed data too small
- Model hasn't been retrained with corrections
- Descriptions too diverse/ambiguous

**Solutions**:
1. Add more seed data examples
2. Collect user corrections and retrain
3. Ensure data quality (no corrupted descriptions)

### Issue: Wrong Category Predictions
**Symptoms**: Systematic misclassification (e.g., treats "Uber" as entertainment)

**Causes**:
- Insufficient or conflicting seed data
- Ambiguous descriptions
- Missing merchant information

**Solutions**:
1. Add specific examples for problem category
2. Implement merchant-based rules first
3. Use descriptions + merchant info together

### Issue: Model Doesn't Update After Retrain
**Symptoms**: Predictions still the same after `POST /ml/retrain`

**Causes**:
- Model not saved to disk
- Cached instance not reloaded
- No training data in table

**Solutions**:
1. Check `backend/app/ml/models/` files exist
2. Restart backend to reload model
3. Verify training data in DB: `SELECT * FROM training_data`

---

## File Locations

- **Model**: `backend/app/services/ml_service.py`
- **Normalization**: `backend/app/services/normalization.py`
- **Model Artifacts**: `backend/app/ml/models/` (vectorizer.pkl, model.pkl)
- **Training Data Table**: `training_data` in MariaDB
- **Seed Data**: In `_create_baseline()` method

---

## Next Steps for Production

- [ ] Add more diverse seed data
- [ ] Implement confidence thresholds for manual review
- [ ] Log prediction confidence for monitoring
- [ ] A/B test different algorithms
- [ ] Add merchant/category rules as preprocessing
- [ ] Implement batch retraining schedule
- [ ] Create retraining monitoring dashboard

