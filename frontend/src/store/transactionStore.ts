import { create } from 'zustand';
import { Account, Transaction } from '../services/transactionService';

interface TransactionStore {
  transactions: Transaction[];
  accounts: Account[];
  selectedAccount: Account | null;
  loading: boolean;
  error: string | null;
  
  setTransactions: (transactions: Transaction[]) => void;
  setAccounts: (accounts: Account[]) => void;
  setSelectedAccount: (account: Account | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  addTransaction: (transaction: Transaction) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
}

export const useTransactionStore = create<TransactionStore>((set) => ({
  transactions: [],
  accounts: [],
  selectedAccount: null,
  loading: false,
  error: null,
  
  setTransactions: (transactions) => set({ transactions }),
  setAccounts: (accounts) => set({ accounts }),
  setSelectedAccount: (account) => set({ selectedAccount: account }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  addTransaction: (transaction) => set((state) => ({
    transactions: [...state.transactions, transaction]
  })),
  updateTransaction: (id, updates) => set((state) => ({
    transactions: state.transactions.map(t => 
      t.id === id ? { ...t, ...updates } : t
    )
  })),
}));
