---
name: "Copilot Instructions Summary"
description: "Overview of all Copilot instruction files for the Family Budget project. Explains what each file covers and when to use it."
---

# Copilot Instructions - Complete Guide

## 📋 Overview

This document summarizes all Copilot instruction files created for the Family Budget project. These instructions help Copilot (and you) understand the project structure, standards, API design, and best practices.

---

## 📁 Files & Their Purpose

### 1. **copilot-instructions.md** (ROOT)
**Scope**: Overall project context and architecture

**Use When**:
- Starting any new task in the project
- Need to understand project structure
- Want to know the tech stack
- Need API endpoint reference
- Looking for common gotchas

**Key Sections**:
- Project overview & problem statement
- Complete folder structure
- All 11 API endpoints
- Key services explained (ML, normalization, transactions)
- Data model fields
- Docker setup
- Coding standards
- Common development tasks
- Testing tips

**Location**: `/mnt/f/wwwLinux/family_budget/copilot-instructions.md`

---

### 2. **backend-api.instructions.md**
**Scope**: FastAPI endpoint development (Python backend)

**Use When**:
- Adding or modifying REST endpoints
- Working with route handlers
- Implementing business logic in services
- Writing validation schemas
- Debugging API issues

**Key Sections**:
- Quick rules for backend code
- File structure (api/ vs services/ vs models/)
- Step-by-step endpoint creation
- Query parameters & path parameters
- SQLAlchemy query patterns
- Error handling
- Transaction management
- Testing with TestClient

**Location**: `/.github/instructions/backend-api.instructions.md`

**Auto-Applied To**: `backend/app/**/*.py`

---

### 3. **frontend-react.instructions.md**
**Scope**: React component development (TypeScript frontend)

**Use When**:
- Building new React components
- Connecting to API services
- Managing state with Zustand
- Creating forms & tables
- Working with Mantine UI components
- Adding charts with Recharts

**Key Sections**:
- Quick rules (TypeScript, hooks, Zustand, error handling)
- Component template structure
- Zustand store definition & usage
- API integration patterns
- Mantine component examples
- AG Grid table setup
- Recharts chart examples
- File upload handling
- Common UI patterns
- Responsive design with Mantine
- TypeScript tips
- Testing strategies

**Location**: `/.github/instructions/frontend-react.instructions.md`

**Auto-Applied To**: `frontend/src/**/*.tsx`

---

### 4. **ml-categorization.instructions.md**
**Scope**: ML pipeline and transaction categorization (Python)

**Use When**:
- Working on ML predictions
- Improving category accuracy
- Retraining the model
- Understanding how predictions work
- Processing training data
- Debugging ML issues

**Key Sections**:
- Architecture flow (CSV → normalize → predict → store)
- CategoryPredictor class details
- All 7 categories
- Seed data examples
- User correction workflow
- How to improve predictions
- Testing ML predictions
- Advanced features (custom preprocessing, rules)
- Different algorithms
- Monitoring & debugging
- Query patterns for checking model performance
- Common ML issues

**Location**: `/.github/instructions/ml-categorization.instructions.md`

**Auto-Applied To**: `backend/app/services/ml_service.py`, `backend/app/services/normalization.py`

---

### 5. **database-schema.instructions.md**
**Scope**: Database design and migrations (MariaDB + SQLAlchemy + Alembic)

**Use When**:
- Adding database columns
- Creating new tables
- Running migrations
- Optimizing queries
- Backing up/restoring database
- Debugging database issues

**Key Sections**:
- Quick rules (models inherit from Base, migrations workflow)
- Current schema (all 4 tables & fields)
- Step-by-step: adding columns
- Step-by-step: adding tables
- Query patterns (filtering, aggregation, pagination, updates)
- Database connection setup
- Performance optimization (indexes, query optimization)
- Backup & restore procedures
- Debugging queries (SQL printing, slow query log)
- Testing with database
- Common issues & solutions

**Location**: `/.github/instructions/database-schema.instructions.md`

**Auto-Applied To**: `backend/app/models/transaction.py`, `backend/app/db/**/*.py`, `backend/alembic/**/*.py`

---

## 🎯 How Copilot Uses These Instructions

### Automatic Loading
- **Workspace Instructions** (`copilot-instructions.md`): Always loaded
- **File Instructions** (`.instructions.md` files): Auto-loaded based on `applyTo` patterns

### Example Scenarios

**Scenario 1**: You ask "Add a new endpoint to list categories"
```
Copilot will:
1. Load copilot-instructions.md (general context)
2. Load backend-api.instructions.md (since you're editing .py file)
3. Show you the endpoint template
4. Remind you about validation schemas & error handling
```

**Scenario 2**: You ask "Create a new Review component for categories"
```
Copilot will:
1. Load copilot-instructions.md (general context)
2. Load frontend-react.instructions.md (since you're editing .tsx file)
3. Show you the React component template
4. Help with Mantine UI & Zustand state
```

**Scenario 3**: You ask "How does the categorization work?"
```
Copilot will:
1. Load copilot-instructions.md (for context)
2. Load ml-categorization.instructions.md (ML-specific)
3. Explain the CategoryPredictor class
4. Show workflow: description → vectorizer → logistic regression → category
```

**Scenario 4**: You ask "Add a reconciliation flag to transactions"
```
Copilot will:
1. Load copilot-instructions.md (for context)
2. Load database-schema.instructions.md (DB modifications)
3. Show step-by-step: update model → generate migration → apply
4. Help with backward compatibility
```

---

## 📚 Reference by Task Type

### I want to... → Use these files

| Task | Primary | Secondary |
|------|---------|-----------|
| Add REST endpoint | backend-api.instructions.md | copilot-instructions.md |
| Create React component | frontend-react.instructions.md | copilot-instructions.md |
| Improve ML predictions | ml-categorization.instructions.md | copilot-instructions.md |
| Modify database schema | database-schema.instructions.md | backend-api.instructions.md |
| Understand architecture | copilot-instructions.md | (all others) |
| Fix API bug | backend-api.instructions.md | copilot-instructions.md |
| Fix UI bug | frontend-react.instructions.md | copilot-instructions.md |
| Optimize queries | database-schema.instructions.md | backend-api.instructions.md |
| Write tests | backend-api.instructions.md | frontend-react.instructions.md |
| Deploy changes | copilot-instructions.md | database-schema.instructions.md |

---

## 🔄 Workflow Examples

### Example 1: Adding a New Analytics Endpoint

**Steps**:
1. Open `backend/app/api/transactions.py`
2. Ask Copilot: "Add endpoint GET /analytics/top-merchants"
3. **Copilot loads**: backend-api.instructions.md + copilot-instructions.md
4. Copilot shows you:
   - Endpoint template from backend-api.instructions.md
   - Error handling pattern
   - Where to put service logic
   - API endpoint reference format
5. You implement following the patterns
6. Test via `/docs`

**Files Modified**:
- `backend/app/api/transactions.py` (route)
- `backend/app/services/transaction_service.py` (logic)
- `backend/app/models/schemas.py` (response schema)

---

### Example 2: Adding a Bulk Category Update UI

**Steps**:
1. Open `frontend/src/pages/`
2. Ask Copilot: "Create bulk categorization component"
3. **Copilot loads**: frontend-react.instructions.md + copilot-instructions.md
4. Copilot shows you:
   - Component template from frontend-react.instructions.md
   - Zustand store integration
   - Mantine UI components
   - API integration pattern (transactionService)
   - AG Grid table setup
5. You build following the patterns
6. Test in browser

**Files Modified**:
- `frontend/src/pages/BulkCategorizeModal.tsx` (new component)
- `frontend/src/store/transactionStore.ts` (new actions)
- `frontend/src/services/transactionService.ts` (new API calls)

---

### Example 3: Retraining ML Model

**Steps**:
1. Open `backend/app/services/ml_service.py`
2. Ask Copilot: "How do I improve the rent category predictions?"
3. **Copilot loads**: ml-categorization.instructions.md + copilot-instructions.md
4. Copilot shows you:
   - CategoryPredictor architecture
   - How corrections flow to training_data table
   - How retrain() works
   - How to add seed data
   - Query patterns to check prediction accuracy
5. You implement improvements

**Files Modified**:
- `backend/app/services/ml_service.py` (seed data, algorithm)
- Database queries (via Copilot hints)

---

### Example 4: Adding Reconciliation Feature

**Steps**:
1. Open `backend/app/models/transaction.py`
2. Ask Copilot: "Add reconciliation tracking to transactions"
3. **Copilot loads**: database-schema.instructions.md + backend-api.instructions.md + copilot-instructions.md
4. Copilot shows you:
   - How to add model fields
   - How to generate migration
   - Frontend component pattern
   - Endpoint template
   - Query patterns for reconciled vs. pending
5. You implement step-by-step

**Files Modified**:
- `backend/app/models/transaction.py` (new fields)
- `alembic/versions/` (new migration)
- `backend/app/api/transactions.py` (endpoints)
- `backend/app/services/transaction_service.py` (logic)
- Frontend components

---

## 💡 Best Practices

### 1. **Provide Context**
```
GOOD: "In ReviewPage.tsx, I need to add a filter dropdown for categories"
LESS GOOD: "Add a dropdown"
```

The first tells Copilot which file to look at, so it loads the right instructions.

### 2. **Ask for Specific Guidance**
```
GOOD: "Show me the pattern for adding a bulk update endpoint"
LESS GOOD: "How do I add an endpoint?"
```

### 3. **Reference Key Files**
```
GOOD: "Follow the pattern in ReviewPage.tsx but for accounts"
LESS GOOD: "Make a new component"
```

Helps Copilot find existing patterns to replicate.

### 4. **When Errors Occur**
```
GOOD: "Error: IntegrityError in update_transaction(). Why?"
Include: Stack trace, what you were trying to do
```

Copilot can reference database-schema.instructions.md for common causes.

---

## 🔗 Cross-References

### From backend-api.instructions.md
- References: copilot-instructions.md (API endpoints)
- Referenced by: frontend-react.instructions.md (API calls)
- Uses concepts from: database-schema.instructions.md (queries)

### From frontend-react.instructions.md
- References: copilot-instructions.md (API endpoints)
- Uses: backend-api.instructions.md (response schemas)
- Calls: transactionService created per backend-api.instructions.md

### From ml-categorization.instructions.md
- References: copilot-instructions.md (ML categories)
- Uses: backend-api.instructions.md (for `/ml/retrain` endpoint)
- Uses: database-schema.instructions.md (training_data queries)

### From database-schema.instructions.md
- References: copilot-instructions.md (schema overview)
- Used by: backend-api.instructions.md (query examples)
- Used by: ml-categorization.instructions.md (training data storage)

---

## 🎓 Learning Path

**For New Team Members**:
1. Read `copilot-instructions.md` → Understand project
2. Choose your focus area:
   - **Backend**: Read backend-api.instructions.md
   - **Frontend**: Read frontend-react.instructions.md
   - **ML**: Read ml-categorization.instructions.md
   - **Database**: Read database-schema.instructions.md
3. Try the examples in the chosen file
4. Use Copilot for guidance on specific tasks

**For Feature Development**:
1. Identify which area(s) need changes
2. Load relevant instructions via Copilot
3. Follow the step-by-step templates
4. Test as you go

---

## 🚀 Enabling These Instructions

**For Workspace** (automatic in VSCode):
- `copilot-instructions.md` - Root level, always loaded
- `.github/instructions/*.instructions.md` - Auto-loaded per file type

**For Individual Files**:
When editing `backend/app/api/transactions.py`:
Copilot automatically loads `backend-api.instructions.md` due to `applyTo` pattern.

**For User Profile** (optional):
Copy any `.instructions.md` files to `~/.vscode/User/prompts/` to make them available across all workspaces.

---

## 📝 Maintaining Instructions

### When Code Changes
- Update relevant `.instructions.md`
- Keep examples in sync
- document new patterns

### When Adding Features
- Add examples to correct instruction file
- Update reference sections
- Ensure cross-references are accurate

### When Removing Features
- Remove outdated examples
- Update reference sections
- Clean up gotchas section

---

## 🔧 Quick Command Reference

### For Backend Work
```bash
# Check what Copilot sees
cat backend/app/api/transactions.py | head -5  # File type recognition

# Run tests
docker-compose exec backend pytest

# View API docs
curl http://localhost:8000/docs
```

### For Frontend Work
```bash
# Check TypeScript compilation
cd frontend && npm run build

# View component list
ls frontend/src/pages/
```

### For ML Work
```bash
# Check model files
ls backend/app/ml/models/

# Query training data
docker-compose exec mariadb mysql -u budget_user -p \
  -e "SELECT COUNT(*) FROM training_data;"
```

### For Database Work
```bash
# Check schema
docker-compose exec mariadb \
  mysql -u budget_user -p -e "DESCRIBE transactions;"

# View migrations
ls backend/alembic/versions/
```

---

## 📞 Getting Help

**In VSCode**:
1. Open Command Palette (Ctrl+Shift+P or Cmd+Shift+P)
2. Type "Copilot Chat"
3. Ask your question - Copilot will load relevant instructions

**Example Questions**:
- "How do I add a new endpoint?" → backend-api.instructions.md
- "Show me how to use Zustand" → frontend-react.instructions.md  
- "How does the ML categorization work?" → ml-categorization.instructions.md
- "What columns should a new table have?" → database-schema.instructions.md

---

## ✅ Checklist for New Development

- [ ] Identified which area(s) need changes (backend/frontend/ml/db)
- [ ] Read relevant `.instructions.md` file(s)
- [ ] Followed the step-by-step templates
- [ ] Used correct patterns and error handling
- [ ] Tested changes locally
- [ ] Updated API documentation if needed
- [ ] Verified all tests pass

---

**Created**: May 17, 2024
**Project**: Family Budget v1.0.0
**Status**: Ready for team use
