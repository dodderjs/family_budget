# Family Budget API Reference

## Base URL
```
http://localhost:8000/api/v1
```

## Authentication
Currently no authentication required (development mode).

## Response Format
All responses are JSON.

---

## Accounts

### Create Account
```http
POST /accounts
Content-Type: application/json

{
  "name": "My Checking Account",
  "account_number": "****1234"
}
```

**Response 200:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "My Checking Account",
  "account_number": "****1234",
  "created_at": "2024-01-15T10:30:00"
}
```

### List Accounts
```http
GET /accounts
```

**Response 200:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My Checking Account",
    "account_number": "****1234",
    "created_at": "2024-01-15T10:30:00"
  }
]
```

---

## Upload & Normalize

### Upload CSV (Preview)
Endpoint to parse and preview CSV file. Auto-detects bank format.

```http
POST /upload
Content-Type: multipart/form-data

file: <binary CSV file>
```

**Response 200:**
```json
{
  "status": "preview_ready",
  "row_count": 25,
  "detected_format": "revolut",
  "suggested_mapping": {
    "dateField": "Started Date",
    "amountField": "Amount",
    "descriptionFields": ["Description"],
    "merchantFields": ["Description"],
    "currencyField": "Currency"
  },
  "sample_row": {
    "Type": "Card Payment",
    "Started Date": "2024-12-31 10:10:20",
    "Description": "Lidl",
    "Amount": "-17224.00",
    "Currency": "HUF",
    "State": "COMPLETED"
  }
}
```

### Normalize & Ingest Transactions
Process CSV data and store in database with ML predictions. `data` is the
full set of parsed rows (not a preview slice) — the frontend sends every row
from the uploaded file here.

```http
POST /transactions/normalize
Content-Type: application/json

{
  "account_id": "550e8400-e29b-41d4-a716-446655440000",
  "bank_format": "revolut",
  "data": [
    {
      "Type": "Card Payment",
      "Started Date": "2024-12-31 10:10:20",
      "Description": "Lidl",
      "Amount": "-17224.00",
      "Currency": "HUF",
      "State": "COMPLETED"
    }
  ]
}
```

**Response 200:**
```json
{
  "created": 23,
  "duplicates": 2,
  "skipped": 1,
  "errors": [],
  "status": "success"
}
```
`skipped` counts rows excluded by format-specific rules (e.g. Revolut
`PENDING`/`REVERTED` transactions) rather than ingested or rejected.

---

## Transactions

### List All Transactions
```http
GET /transactions?account_id=<id>&limit=100&offset=0
```

**Query Parameters:**
- `account_id` (optional) - Filter by account
- `limit` (optional, default: 100) - Max results
- `offset` (optional, default: 0) - Pagination offset

**Response 200:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "account_id": "550e8400-e29b-41d4-a716-446655440000",
    "date": "2024-01-05",
    "amount": 150.00,
    "currency": "USD",
    "description": "Whole Foods Market",
    "merchant": "Grocery Store",
    "hash_fingerprint": "a1b2c3d4e5f6...",
    "category_predicted": "groceries",
    "category_confidence": 0.92,
    "category_final": null,
    "is_transfer": false,
    "transfer_match_id": null,
    "created_at": "2024-01-15T10:30:00",
    "updated_at": "2024-01-15T10:30:00"
  }
]
```

### Get Transactions for Review
Get transactions without final category assigned (pending review).

```http
GET /transactions/review?limit=50
```

**Query Parameters:**
- `limit` (optional, default: 50) - Number of transactions

**Response 200:**
```json
[
  {
    "id": "...",
    "account_id": "...",
    "date": "2024-01-05",
    "amount": 150.00,
    "currency": "USD",
    "description": "Whole Foods Market",
    "merchant": "Grocery Store",
    "hash_fingerprint": "...",
    "category_predicted": "groceries",
    "category_confidence": 0.92,
    "category_final": null,
    "is_transfer": false,
    "transfer_match_id": null,
    "created_at": "2024-01-15T10:30:00",
    "updated_at": "2024-01-15T10:30:00"
  }
]
```

### Update Transaction
Update transaction category and/or merchant.

```http
PATCH /transactions/{transaction_id}
Content-Type: application/json

{
  "category_final": "groceries",
  "merchant": "Whole Foods"
}
```

**Response 200:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "account_id": "550e8400-e29b-41d4-a716-446655440000",
  "date": "2024-01-05",
  "amount": 150.00,
  "currency": "USD",
  "description": "Whole Foods Market",
  "merchant": "Whole Foods",
  "hash_fingerprint": "a1b2c3d4e5f6...",
  "category_predicted": "groceries",
  "category_confidence": 0.92,
  "category_final": "groceries",
  "is_transfer": false,
  "transfer_match_id": null,
  "created_at": "2024-01-15T10:30:00",
  "updated_at": "2024-01-15T10:35:00"
}
```

---

## Analytics

### Get Summary Statistics
```http
GET /analytics/summary?account_id=<id>
```

**Query Parameters:**
- `account_id` (optional) - Filter by account

**Response 200:**
```json
{
  "total_transactions": 42,
  "total_income": 7000.00,
  "total_expenses": 3500.00,
  "average_transaction": 83.33,
  "categories_used": [
    "groceries",
    "rent",
    "salary",
    "utilities",
    "transport",
    "entertainment"
  ]
}
```

### Get Category Breakdown
```http
GET /analytics/breakdown?account_id=<id>
```

**Query Parameters:**
- `account_id` (optional) - Filter by account

**Response 200:**
```json
{
  "groceries": {
    "count": 8,
    "total": 680.00
  },
  "rent": {
    "count": 3,
    "total": 3600.00
  },
  "salary": {
    "count": 3,
    "total": 10500.00
  },
  "utilities": {
    "count": 4,
    "total": 220.50
  },
  "transport": {
    "count": 5,
    "total": 350.75
  },
  "entertainment": {
    "count": 6,
    "total": 440.00
  }
}
```

### Get Monthly Trends
```http
GET /analytics/trends?account_id=<id>
```

**Query Parameters:**
- `account_id` (optional) - Filter by account

**Response 200:**
```json
{
  "2024-01": {
    "income": 3500.00,
    "expenses": 1850.25
  },
  "2024-02": {
    "income": 3500.00,
    "expenses": 2100.50
  },
  "2024-03": {
    "income": 0.00,
    "expenses": 1200.00
  }
}
```

---

## ML Model

### Retrain Model
Retrain the ML model using corrections made by users.

```http
POST /ml/retrain
```

**Response 200:**
```json
{
  "status": "retrained",
  "samples": 15
}
```

---

## Error Responses

### 400 Bad Request
```json
{
  "detail": "Empty CSV file"
}
```

### 404 Not Found
```json
{
  "detail": "Transaction not found"
}
```

### 500 Internal Server Error
```json
{
  "detail": "Internal server error"
}
```

---

## Sample Workflows

### Workflow 1: Upload and Categorize

```bash
# 1. Create account
curl -X POST http://localhost:8000/api/v1/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Chase","bank_name":"Chase Bank"}'

# Returns: account_id = "550e8400-e29b-41d4-a716-446655440000"

# 2. Upload CSV file
curl -X POST http://localhost:8000/api/v1/upload \
  -F "file=@bank_a_transactions.csv"

# Returns: detected_format = "bank_a"

# 3. Normalize transactions
curl -X POST http://localhost:8000/api/v1/transactions/normalize \
  -H "Content-Type: application/json" \
  -d '{
    "account_id":"550e8400-e29b-41d4-a716-446655440000",
    "bank_format":"bank_a",
    "data":[...]
  }'

# 4. Get transactions for review
curl -X GET http://localhost:8000/api/v1/transactions/review

# 5. Update category
curl -X PATCH http://localhost:8000/api/v1/transactions/{transaction_id} \
  -H "Content-Type: application/json" \
  -d '{"category_final":"groceries"}'

# 6. Retrain model
curl -X POST http://localhost:8000/api/v1/ml/retrain

# 7. View analytics
curl -X GET http://localhost:8000/api/v1/analytics/summary
```

---

## Category Reference

Standard categories used in the system:

| Category | Examples |
|----------|----------|
| `groceries` | Whole Foods, Supermarket, Food Market |
| `rent` | Monthly Rent, Landlord Payment, Property Management |
| `salary` | Paycheck, Direct Deposit, Salary Income |
| `utilities` | Electric, Water, Gas, Internet |
| `transport` | Uber, Taxi, Metro, Gas Station |
| `entertainment` | Cinema, Movies, Concerts, Restaurants |
| `other` | Miscellaneous transactions |

---

## Bank Format Detection

The system auto-detects the CSV delimiter (`,` / `;` / tab) and bank format
from the header row. Supported formats, derived from real exports in `example/`:

### Revolut (`revolut`)
Comma-delimited. `PENDING`/`REVERTED` rows are skipped on import.
```
Type | Product | Started Date | Completed Date | Description | Amount | Fee | Currency | State | Balance
```

### Curve (`curve`)
Comma-delimited. Amounts are always reported positive in the file; the
importer negates them (expense) unless `Type` is `REFUNDED`.
```
Export Format | Date (YYYY-MM-DD as UTC) | Time (HH:MM:SS) | Merchant | Txn Amount (Funding Card) | Txn Currency (Funding Card) | ... | Type | Category | Notes
```

### MBH Bank — debit and credit card exports (`mbh`)
Semicolon-delimited, Hungarian headers/locale (`1 165,00` style amounts,
`YYYY.MM.DD.` dates). The same mapping covers both the debit-account and
credit-card export files; use the account's `type` field to distinguish them.
```
Számla | Megbízás típusa | Összeg | Devizanem | ... | Tranzakció dátuma | ... | Tranzakció helye | Könyvelési dátum
```

### K&H Bank — account history export (`kh`)
Tab-delimited, Hungarian headers/locale. Amounts have no thousands separator
or decimals (plain signed integers).
```
könyvelés dátuma | tranzakció azonosító | típus | könyvelési számla | ... | partner elnevezése | összeg | összeg devizaneme | közlemény | ...
```

### Generic (`generic`)
Fallback for unrecognized headers; expects `date | amount | description` with
plain ISO/US-style values. Used as the format whenever no known signature matches.

Auto-detection happens in the `/upload` endpoint. Format can be manually specified in `/transactions/normalize`.

---

Last Updated: June 2026
Version: 1.1.0
