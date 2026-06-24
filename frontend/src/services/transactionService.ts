import api from './api';

export interface Transaction {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  currency: string;
  description: string;
  merchant: string | null;
  hash_fingerprint: string;
  category_predicted: string | null;
  category_confidence: number | null;
  category_final: string | null;
  is_transfer: boolean;
  transfer_match_id: string | null;
  transfer_match_account_id: string | null;
  card_hint: string | null;
  is_duplicate: boolean;
  duplicate_of_id: string | null;
  created_at: string;
  updated_at: string;
}

/** The Review page's grid drives its own pager/sort instead of loading
 * everything and paging client-side - limit/offset/sort_by/sort_dir are sent
 * straight through to GET /transactions/review on every page or sort change.
 * sort_by must be one of the backend's whitelisted columns (see
 * _REVIEW_SORTABLE_COLUMNS in transaction_service.py) - anything else falls
 * back to the default lowest-confidence-first ordering. */
export interface ReviewTransactionsParams {
  limit?: number;
  offset?: number;
  account_id?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  include_finalized?: boolean;
  sort_by?: string | null;
  sort_dir?: 'asc' | 'desc';
  // AG Grid's per-column filterModel, JSON-stringified - it's a nested object
  // (keyed by colId) so it can't be a flat query param. The backend whitelists
  // which colIds it honors (see _REVIEW_FILTERABLE_COLUMNS in
  // transaction_service.py) and ignores a malformed value.
  filter_model?: string | null;
}

export interface TransactionListResponse {
  items: Transaction[];
  total: number;
}

export interface Card {
  id: string;
  account_id: string;
  card_number: string;
  created_at: string;
}

export interface Account {
  id: string;
  name: string;
  account_number: string;
  type: string | null;
  created_at: string;
  cards: Card[];
}

export interface AnalyticsSummary {
  total_transactions: number;
  total_income: number;
  total_expenses: number;
  average_transaction: number;
  categories_used: string[];
  total_transferred: number;
}

export interface BreakdownEntry {
  count: number;
  total: number;
}

export type CategoryBreakdown = Record<string, BreakdownEntry>;

export interface MonthlyTrendEntry {
  income: number;
  expenses: number;
}

export type MonthlyTrends = Record<string, MonthlyTrendEntry>;

export type BreakdownGroupBy = 'category' | 'merchant' | 'account';

/** A raw parsed CSV row - column names vary per bank format, so this stays a string map. */
export type CsvRow = Record<string, string>;

export interface NormalizeResult {
  created: number;
  duplicates: number;
  skipped: number;
  transfers_detected: number;
  curve_duplicates_detected: number;
  errors: string[];
  status: string;
  date_from: string | null;
  date_to: string | null;
}

export type CoverageMonthStatus = 'covered' | 'gap' | 'missing' | 'dismissed';

export interface CoverageMonthEntry {
  month: string;
  transaction_count: number;
  status: CoverageMonthStatus;
}

export interface AccountCoverage {
  account_id: string;
  first_date: string | null;
  last_date: string | null;
  months: CoverageMonthEntry[];
}

/** A main (group) category has parent_id null; a leaf's parent_id points at
 * a main. Only leaves are ever assigned to a transaction. */
export interface CategoryNode {
  id: string;
  key: string;
  label: string;
  parent_id: string | null;
  sign: 'positive' | 'negative' | null;
  requires_transfer_account: boolean;
  ml_index: number | null;
  // How many transactions currently have category_final set to this leaf
  // (0 for mains - never assigned to a transaction directly).
  transaction_count: number;
  created_at: string;
}

export const transactionService = {
  createAccount: (name: string, account_number: string, type?: string) =>
    api.post<Account>('/accounts', { name, account_number, type }),

  listAccounts: () =>
    api.get<Account[]>('/accounts'),

  updateAccount: (id: string, updates: { name?: string; account_number?: string; type?: string | null }) =>
    api.patch<Account>(`/accounts/${id}`, updates),

  deleteAccount: (id: string, force = false) =>
    api.delete<{ status: string; transactions_deleted: number }>(`/accounts/${id}`, { params: { force } }),

  addCard: (account_id: string, card_number: string) =>
    api.post<Card>(`/accounts/${account_id}/cards`, { card_number }),

  removeCard: (account_id: string, card_id: string) =>
    api.delete<{ status: string }>(`/accounts/${account_id}/cards/${card_id}`),

  uploadCSV: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  normalizeTransactions: (account_id: string, bank_format: string, data: CsvRow[]) =>
    api.post<NormalizeResult>('/transactions/normalize', { account_id, bank_format, data }),

  listTransactions: (account_id?: string, limit = 100, offset = 0) =>
    api.get<Transaction[]>('/transactions', { params: { account_id, limit, offset } }),

  getTransaction: (id: string) =>
    api.get<Transaction>(`/transactions/${id}`),

  getReviewTransactions: (params: ReviewTransactionsParams) =>
    api.get<TransactionListResponse>('/transactions/review', { params }),

  updateTransaction: (id: string, category_final?: string, merchant?: string) =>
    api.patch<Transaction>(`/transactions/${id}`, { category_final, merchant }),

  setTransferPair: (id: string, account_id: string | null) =>
    api.patch<Transaction>(`/transactions/${id}/transfer`, { account_id }),

  getAnalyticsSummary: (account_id?: string | null, date_from?: string | null, date_to?: string | null) =>
    api.get<AnalyticsSummary>('/analytics/summary', { params: { account_id, date_from, date_to } }),

  getCategoryBreakdown: (
    account_id?: string | null,
    date_from?: string | null,
    date_to?: string | null,
    group_by: BreakdownGroupBy = 'category'
  ) =>
    api.get<CategoryBreakdown>('/analytics/breakdown', { params: { account_id, date_from, date_to, group_by } }),

  getMonthlyTrends: (account_id?: string | null, date_from?: string | null, date_to?: string | null) =>
    api.get<MonthlyTrends>('/analytics/trends', { params: { account_id, date_from, date_to } }),

  retrainModel: () =>
    api.post('/ml/retrain'),

  getAccountCoverage: (accountId: string) =>
    api.get<AccountCoverage>(`/accounts/${accountId}/coverage`),

  setCoverageMonthStatus: (accountId: string, month: string, status: 'missing' | 'dismissed' | 'gap') =>
    api.put<{ status: string }>(`/accounts/${accountId}/coverage/${month}`, { status }),

  listCategories: () =>
    api.get<CategoryNode[]>('/categories'),

  createMainCategory: (label: string) =>
    api.post<CategoryNode>('/categories', { label }),

  createLeafCategory: (label: string, parentId: string) =>
    api.post<CategoryNode>('/categories', { label, parent_id: parentId }),
};
