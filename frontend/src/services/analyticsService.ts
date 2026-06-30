import { ResolvedDateRange, previousPeriod } from '../utils/dateRange';
import {
    AnalyticsSummary,
    BreakdownGroupBy,
    CategoryBreakdown,
    MonthlyTrends,
    transactionService,
} from './transactionService';

export interface BreakdownEntry {
  name: string;
  value: number;
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
  compare: boolean;
}

export interface AnalyticsDashboardData {
  summary: AnalyticsSummary;
  previousSummary: AnalyticsSummary | null;
  breakdown: BreakdownEntry[];
  trends: TrendEntry[];
}

export function mapBreakdown(breakdown: CategoryBreakdown): BreakdownEntry[] {
  return Object.entries(breakdown).map(([key, data]) => ({
    name: key,
    value: Math.abs(data.total),
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
    const { accountId, range, groupBy, compare } = params;

    const [summaryRes, breakdownRes, trendsRes] = await Promise.all([
      transactionService.getAnalyticsSummary(accountId, range.from, range.to),
      transactionService.getCategoryBreakdown(accountId, range.from, range.to, groupBy),
      transactionService.getMonthlyTrends(accountId, range.from, range.to),
    ]);

    let previousSummary: AnalyticsSummary | null = null;
    if (compare && range.from && range.to) {
      const prev = previousPeriod(range);
      const prevSummaryRes = await transactionService.getAnalyticsSummary(accountId, prev.from, prev.to);
      previousSummary = prevSummaryRes.data;
    }

    return {
      summary: summaryRes.data,
      previousSummary,
      breakdown: mapBreakdown(breakdownRes.data),
      trends: mapTrends(trendsRes.data),
    };
  },
};