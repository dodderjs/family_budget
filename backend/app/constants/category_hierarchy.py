# (main_key, main_label, leaf_key, leaf_label, sign, ml_index) - ml_index 0-14
# are pinned to the exact position those categories held in the old static
# CATEGORIES list, so the already-trained model.pkl keeps meaning the same
# thing. Only 15+ are new. See the plan doc for the full rationale.
SEED_HIERARCHY = [
    ("groceries", "Groceries", "groceries", "Groceries", "negative", 0),
    ("rent", "Rent", "rent", "Rent", "negative", 1),
    ("salary", "Salary", "salary", "Salary", "positive", 2),
    ("bills", "Bills", "bills", "Bills", "negative", 3),
    ("transport", "Transport", "transport", "Transport", "negative", 4),
    ("entertainment", "Entertainment", "entertainment", "Entertainment", "negative", 5),
    ("other", "Other", "other", "Other", None, 6),
    ("shopping", "Shopping", "shopping", "Shopping", "negative", 7),
    ("eating_out", "Eating Out", "eating_out", "Eating Out", "negative", 8),
    ("travel", "Travel", "travel", "Travel", "negative", 9),
    ("health", "Health", "health", "Health", "negative", 10),
    ("transfers", "Transfers", "topup", "Top-Up", None, 11),
    ("transfers", "Transfers", "credit_payback", "Credit Payback", None, 12),
    ("transfers", "Transfers", "saving", "Saving", None, 13),
    ("transfers", "Transfers", "transfer", "Transfer", None, 14),
    ("business_services", "Business Services", "business_services", "Business Services", "negative", 15),
    ("general", "General", "general", "General", None, 16),
    ("finance", "Finance", "general_finance", "General Finance", "negative", 17),
    ("finance", "Finance", "bank_fees", "Bank Fees", "negative", 18),
    ("finance", "Finance", "interest", "Interest", "positive", 19),
    ("finance", "Finance", "loan_interest", "Loan Interest", "negative", 20),
    ("finance", "Finance", "loan_principal", "Loan Principal", "negative", 21),
    ("finance", "Finance", "cash_withdrawal", "Cash Withdrawal", "negative", 22),
]