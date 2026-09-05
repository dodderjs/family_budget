import { create } from 'zustand';
import { Account, CategoryNode, transactionService } from '../services/transactionService';
import { DateRangePreset, ResolvedDateRange, resolveDateRange } from '../utils/dateRange';


interface TransactionStore {
  accounts: Account[];
  accountsLoading: boolean;
  categories: CategoryNode[];
  categoriesLoading: boolean;
  /** Multi-select account filter shared by Review/Analytics. Empty = all accounts. */
  selectedAccountIds: string[];
  datePreset: DateRangePreset;
  customDateFrom: string | null;
  customDateTo: string | null;
  error: string | null;

  loadAccounts: () => Promise<void>;
  loadCategories: () => Promise<void>;
  setSelectedAccountIds: (ids: string[]) => void;
  setDatePreset: (preset: DateRangePreset) => void;
  setCustomDateRange: (from: string | null, to: string | null) => void;
  setError: (error: string | null) => void;
}

export const useTransactionStore = create<TransactionStore>((set) => ({
  accounts: [],
  accountsLoading: false,
  categories: [],
  categoriesLoading: false,
  selectedAccountIds: [],
  datePreset: 'this_year',
  customDateFrom: null,
  customDateTo: null,
  error: null,

  loadAccounts: async () => {
    set({ accountsLoading: true });
    try {
      const response = await transactionService.listAccounts();
      set({ accounts: response.data, accountsLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to load accounts', accountsLoading: false });
    }
  },
  loadCategories: async () => {
    set({ categoriesLoading: true });
    try {
      const response = await transactionService.listCategories();
      set({ categories: response.data, categoriesLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to load categories', categoriesLoading: false });
    }
  },
  setSelectedAccountIds: (ids) => set({ selectedAccountIds: ids }),
  setDatePreset: (preset) => set({ datePreset: preset }),
  setCustomDateRange: (from, to) => set({ customDateFrom: from, customDateTo: to, datePreset: 'custom' }),
  setError: (error) => set({ error }),
}));

/** Read the currently-resolved date range outside a React render (e.g. in an effect). */
export function getActiveDateRange(): ResolvedDateRange {
  const { datePreset, customDateFrom, customDateTo } = useTransactionStore.getState();
  return resolveDateRange(datePreset, customDateFrom, customDateTo);
}
