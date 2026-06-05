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
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  name: string;
  account_number: string;
  created_at: string;
}

export const transactionService = {
  createAccount: (name: string, account_number: string) => 
    api.post('/accounts', { name, account_number }),

  listAccounts: () => 
    api.get('/accounts'),

  uploadCSV: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  normalizeTransactions: (account_id: string, bank_format: string, data: any[]) =>
    api.post('/transactions/normalize', { account_id, bank_format, data }),

  listTransactions: (account_id?: string, limit = 100, offset = 0) =>
    api.get('/transactions', { params: { account_id, limit, offset } }),

  getReviewTransactions: (limit = 50) =>
    api.get('/transactions/review', { params: { limit } }),

  updateTransaction: (id: string, category_final?: string, merchant?: string) =>
    api.patch(`/transactions/${id}`, { category_final, merchant }),

  getAnalyticsSummary: (account_id?: string) =>
    api.get('/analytics/summary', { params: { account_id } }),

  getCategoryBreakdown: (account_id?: string) =>
    api.get('/analytics/breakdown', { params: { account_id } }),

  getMonthlyTrends: (account_id?: string) =>
    api.get('/analytics/trends', { params: { account_id } }),

  retrainModel: () =>
    api.post('/ml/retrain'),
};
