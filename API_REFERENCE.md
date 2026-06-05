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
  "detected_format": "bank_a",
  "suggested_mapping": {
    "dateField": "Transaction Date",
    "amountField": "Amount",
    "descriptionField": "Description",
    "merchantField": "Merchant",
    "currencyField": "Currency"
  },
  "sample_row": {
    "Transaction Date": "2024-01-05",
    "Amount": "150.00",
    "Description": "Whole Foods Market",
    "Merchant": "Grocery Store",
    "Currency": "USD"
  }
}
```

### Normalize & Ingest Transactions
Process CSV data and store in database with ML predictions.

```http
POST /transactions/normalize
Content-Type: application/json

{
  "account_id": "550e8400-e29b-41d4-a716-446655440000",
  "bank_format": "bank_a",
  "data": [
    {
      "Transaction Date": "2024-01-05",
      "Amount": "150.00",
      "Description": "Whole Foods Market",
      "Merchant": "Grocery Store",
      "Currency": "USD"
    }
  ]
}
```

**Response 200:**
```json
{
  "created": 23,
  "duplicates": 2,
  "errors": [],
  "status": "success"
}
```

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

The system supports two main bank formats and a generic one:

### Bank A
```
Transaction Date | Amount | Description | Merchant | Currency
```

### Bank B
```
Date | Debit/Credit | Transaction | Vendor
```

### Generic
```
date | amount | description
```

Auto-detection happens in the `/upload` endpoint. Format can be manually specified in `/transactions/normalize`.

---

Last Updated: May 2024
Version: 1.0.0
