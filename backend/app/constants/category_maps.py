# Curve tags every transaction with its own category in the export. Keys are
# Curve's actual raw category text, lowercased (matches _map_category's
# raw_category.strip().lower() lookup) - e.g. real exports say "Eating Out",
# which lowercases to "eating out" with a space, not "eating_out". Values are
# our internal leaf category keys, used as a trusted default instead of an ML
# guess (see normalize_transaction's categoryField/categoryMap usage). Curve
# doesn't sub-categorize fees/interest/loans itself, so its blunt "Finance"
# tag maps to the generic "general_finance" leaf rather than one of the more
# specific finance leaves MBH/K&H's transaction-type columns can identify.
CURVE_CATEGORY_MAP = {
    "bills": "bills",
    "business services": "business_services",
    "eating out": "eating_out",
    "entertainment": "entertainment",
    "finance": "general_finance",
    "general": "general",
    "groceries": "groceries",
    "health": "health",
    "shopping": "shopping",
    "transport": "transport",
    "travel": "travel",
}

MBH_CATEGORY_MAP = {
    "hitel (tőke) alapkamata": "loan_interest",
    "éves kártyadíj": "bank_fees",
    "tőketörlesztés": "loan_principal",
    "forgalmi jutalék": "bank_fees",
    "számlavezetés havi költsége": "bank_fees",
    "kamat": "interest",
    "kártya tranzakció díja": "bank_fees",
    "atm felvét": "cash_withdrawal",
}

KH_CATEGORY_MAP = {
    "tranzakciós költség": "bank_fees",
    "tranzakciós költség - készpénz": "bank_fees",
    "csomagdíj": "bank_fees",
    "csomagdíj visszatérítés": "bank_fees",
    "kamat": "interest",
    "mobilinfo üzenetdíj": "bank_fees",
    "prémium számlavezetési díj": "bank_fees",
    "hitel törlesztés": "loan_principal",
    "hitelkamat törlesztés": "loan_interest",
    "törlesztési biztosítási díj": "bank_fees",
    "végtörlesztési díj": "bank_fees",
    "konverziós átvezetés": "transfer",
    "készpénzfelvét k&h atm-ből": "cash_withdrawal",
    "készpénzfelvét belföldi atm-ből": "cash_withdrawal",
    "kp. felvét tranzakciós jutalék": "bank_fees",
}