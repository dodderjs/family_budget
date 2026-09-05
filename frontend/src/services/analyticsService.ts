import { ResolvedDateRange, previousPeriod } from '../utils/dateRange';
import {
    AnalyticsSummary,
    BreakdownGroupBy,
  CategoryLevel,
    CategoryBreakdown,
    MonthlyTrends,
  StackedMonthlyTrends,
    transactionService,
} from './transactionService';

export interface BreakdownEntry {
  name: string;
  /** Absolute size, for charts that only care about magnitude. */
  value: number;
  /** Signed sum: negative for a net expense, positive for net income. Needed
   * to tell a shop apart from an employer - both show up in a merchant
   * breakdown, and `value` alone can't distinguish them. */
  total: number;
}

export interface TrendEntry {
  month: string;
  income: number;
  expenses: number;
}

export interface LoadAnalyticsParams {
  accountId?: string | null;
  range: ResolvedDateRange;
  groupBy: BreakdownGroupBy;
  categoryLevel?: CategoryLevel;
  categoryKeys?: string;
  merchantNames?: string;
  compare: boolean;
  /** Fetches an extra merchant-grouped breakdown, which populates both
   * `availableMerchants` (the Analytics toolbar's merchant filter) and
   * `merchantBreakdown` (the dashboard's top-merchants list). Off by default
   * so callers that read neither don't pay for the aggregate. */
  includeMerchants?: boolean;
}

export interface AnalyticsDashboardData {
  summary: AnalyticsSummary;
  previousSummary: AnalyticsSummary | null;
  breakdown: BreakdownEntry[];
  trends: TrendEntry[];
  previousTrends: TrendEntry[];
  stackedTrends: StackedMonthlyTrends;
  previousStackedTrends: StackedMonthlyTrends | null;
  availableMerchants: string[];
  /** Spend per merchant, same shape as `breakdown`. Only populated when
   * `includeMerchants` is set - it costs an extra aggregate request. */
  merchantBreakdown: BreakdownEntry[];
}

export function mapBreakdown(breakdown: CategoryBreakdown): BreakdownEntry[] {
  return Object.entries(breakdown).map(([key, data]) => ({
    name: key,
    value: Math.abs(data.total),
    total: data.total,
  }));
}

export function mapTrends(trends: MonthlyTrends): TrendEntry[] {
  return Object.entries(trends).map(([month, data]) => ({
    month,
    income: data.income,
    expenses: data.expenses,
  }));
}

export const analyticsService = {
  async loadDashboardData(params: LoadAnalyticsParams): Promise<AnalyticsDashboardData> {
    const {
      accountId,
      range,
      groupBy,
      categoryLevel = 'leaf',
      categoryKeys,
      merchantNames,
      compare,
      includeMerchants = false,
    } = params;

    const [summaryRes, breakdownRes, trendsRes, stackedRes, merchantBreakdownRes] = await Promise.all([
      transactionService.getAnalyticsSummary(accountId, range.from, range.to, categoryKeys, merchantNames),
      transactionService.getCategoryBreakdown(accountId, range.from, range.to, groupBy, categoryLevel, categoryKeys, merchantNames),
      transactionService.getMonthlyTrends(accountId, range.from, range.to, categoryKeys, merchantNames),
      transactionService.getStackedMonthlyTrends(accountId, range.from, range.to, categoryLevel, categoryKeys, merchantNames),
      includeMerchants
        ? transactionService.getCategoryBreakdown(accountId, range.from, range.to, 'merchant', 'leaf', categoryKeys, undefined)
        : null,
    ]);

    let previousSummary: AnalyticsSummary | null = null;
    let previousTrends: TrendEntry[] = [];
    let previousStackedTrends: StackedMonthlyTrends | null = null;
    if (compare && range.from && range.to) {
      const prev = previousPeriod(range);
      const [prevSummaryRes, prevTrendsRes, prevStackedRes] = await Promise.all([
        transactionService.getAnalyticsSummary(accountId, prev.from, prev.to, categoryKeys, merchantNames),
        transactionService.getMonthlyTrends(accountId, prev.from, prev.to, categoryKeys, merchantNames),
        transactionService.getStackedMonthlyTrends(accountId, prev.from, prev.to, categoryLevel, categoryKeys, merchantNames),
      ]);
      previousSummary = prevSummaryRes.data;
      previousTrends = mapTrends(prevTrendsRes.data);
      previousStackedTrends = prevStackedRes.data;
    }

    return {
      summary: summaryRes.data,
      previousSummary,
      breakdown: mapBreakdown(breakdownRes.data),
      trends: mapTrends(trendsRes.data),
      previousTrends,
      stackedTrends: stackedRes.data,
      previousStackedTrends,
      availableMerchants: merchantBreakdownRes
        ? Object.keys(merchantBreakdownRes.data).sort((a, b) => a.localeCompare(b))
        : [],
      merchantBreakdown: merchantBreakdownRes ? mapBreakdown(merchantBreakdownRes.data) : [],
    };
  },
};