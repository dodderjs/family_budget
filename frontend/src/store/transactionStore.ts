import { create } from 'zustand';
import { Account, CategoryNode, transactionService } from '../services/transactionService';

export type DateRangePreset =
  | 'all'
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'last_year'
  | 'custom';

export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'this_month', label: 'Month to Date (MTD)' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_year', label: 'Year to Date (YTD)' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'custom', label: 'Custom range' },
];

export interface ResolvedDateRange {
  from: string | null;
  to: string | null;
}

const toIso = (d: Date): string => d.toISOString().slice(0, 10);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

export function resolveDateRange(
  preset: DateRangePreset,
  customFrom?: string | null,
  customTo?: string | null
): ResolvedDateRange {
  const today = new Date();
  switch (preset) {
    case 'this_month':
      // Month to date: start of the current month through today, not the
      // whole month - matches "this_year" (YTD)'s semantics below.
      return { from: toIso(startOfMonth(today)), to: toIso(today) };
    case 'last_month': {
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { from: toIso(startOfMonth(lastMonth)), to: toIso(endOfMonth(lastMonth)) };
    }
    case 'last_3_months':
      return { from: toIso(new Date(today.getFullYear(), today.getMonth() - 2, 1)), to: toIso(today) };
    case 'last_6_months':
      return { from: toIso(new Date(today.getFullYear(), today.getMonth() - 5, 1)), to: toIso(today) };
    case 'this_year':
      return { from: `${today.getFullYear()}-01-01`, to: toIso(today) };
    case 'last_year': {
      const lastYear = today.getFullYear() - 1;
      return { from: `${lastYear}-01-01`, to: `${lastYear}-12-31` };
    }
    case 'custom':
      return { from: customFrom || null, to: customTo || null };
    case 'all':
    default:
      return { from: null, to: null };
  }
}

/** Shifts a resolved range back by its own length, for period-over-period comparison. */
export function previousPeriod(range: ResolvedDateRange): ResolvedDateRange {
  if (!range.from || !range.to) return { from: null, to: null };
  const from = new Date(range.from);
  const to = new Date(range.to);
  const lengthMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - lengthMs);
  return { from: toIso(prevFrom), to: toIso(prevTo) };
}

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
  datePreset: 'all',
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

/** Join multi-select account ids into the comma-separated string the API's
 * account_id filter param expects; undefined means "no filter". */
export function accountIdParam(ids: string[]): string | undefined {
  return ids.length ? ids.join(',') : undefined;
}

/** Read the currently-resolved date range outside a React render (e.g. in an effect). */
export function getActiveDateRange(): ResolvedDateRange {
  const { datePreset, customDateFrom, customDateTo } = useTransactionStore.getState();
  return resolveDateRange(datePreset, customDateFrom, customDateTo);
}
