import joblib
import os
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
import numpy as np
from pathlib import Path

MODEL_DIR = Path(__file__).parent.parent / "ml" / "models"
MODEL_DIR.mkdir(exist_ok=True)

CATEGORIES = [
    "groceries",
    "rent",
    "salary",
    "utilities",
    "transport",
    "entertainment",
    "other"
]

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
        seed_data = [
            ("Grocery Store", "groceries"),
            ("Supermarket", "groceries"),
            ("Food Market", "groceries"),
            ("Whole Foods", "groceries"),
            ("Monthly Rent Payment", "rent"),
            ("Rent Deposit", "rent"),
            ("Landlord Payment", "rent"),
            ("Salary Deposit", "salary"),
            ("Paycheck", "salary"),
            ("Income Deposit", "salary"),
            ("Electric Company", "utilities"),
            ("Water Bill", "utilities"),
            ("Internet Service", "utilities"),
            ("Gas Company", "utilities"),
            ("Uber", "transport"),
            ("Taxi", "transport"),
            ("Metro Card", "transport"),
            ("Gas Station", "transport"),
            ("Cinema", "entertainment"),
            ("Movie Theater", "entertainment"),
            ("Concert", "entertainment"),
            ("Restaurant", "entertainment"),
        ]
        
        texts = [desc for desc, _ in seed_data]
        labels = [cat for _, cat in seed_data]
        
        self.vectorizer = TfidfVectorizer(lowercase=True, stop_words='english')
        X = self.vectorizer.fit_transform(texts)
        
        self.model = LogisticRegression(multi_class='multinomial', max_iter=1000)
        label_to_idx = {cat: i for i, cat in enumerate(set(labels))}
        y = np.array([label_to_idx[label] for label in labels])
        
        self.model.fit(X, y)
        self.save_model()
    
    def predict(self, description: str) -> tuple[str, float]:
        """Predict category and confidence for a transaction description"""
        if not self.model or not self.vectorizer:
            self.load_model()
        
        try:
            X = self.vectorizer.transform([description.lower()])
            probabilities = self.model.predict_proba(X)[0]
            predicted_idx = np.argmax(probabilities)
            confidence = probabilities[predicted_idx]
            
            class_names = self.model.classes_
            category = CATEGORIES[predicted_idx] if predicted_idx < len(CATEGORIES) else "other"
            
            return category, float(confidence)
        except Exception as e:
            return "other", 0.0
    
    def save_model(self):
        """Save model to disk"""
        if self.vectorizer and self.model:
            joblib.dump(self.vectorizer, MODEL_DIR / "vectorizer.pkl")
            joblib.dump(self.model, MODEL_DIR / "model.pkl")
    
    def retrain(self, training_data: list[tuple[str, str]]):
        """Retrain model with corrected labels"""
        if not training_data:
            return
        
        texts = [desc for desc, _ in training_data]
        labels = [cat for _, cat in training_data]
        
        # Refit vectorizer with combined data
        self.vectorizer = TfidfVectorizer(lowercase=True, stop_words='english')
        X = self.vectorizer.fit_transform(texts)
        
        self.model = LogisticRegression(multi_class='multinomial', max_iter=1000)
        label_to_idx = {cat: i for i, cat in enumerate(set(labels))}
        y = np.array([label_to_idx[label] for label in labels])
        
        self.model.fit(X, y)
        self.save_model()

# Global instance
predictor = CategoryPredictor()
