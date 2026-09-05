import { AnalyticsSummary, RecurringCharge, StackedMonthlyTrends } from '../../services/transactionService';

export interface CategoryMomentum {
  category: string;
  /** Spend in the most recent month of the selected period. */
  latest: number;
  /** Mean monthly spend across the months before it. */
  baseline: number;
  /** latest - baseline, in currency. Positive = spending more than usual. */
  delta: number;
  /** delta as a share of baseline. Infinity-safe: null when there's no baseline. */
  deltaRatio: number | null;
}

/** Ranks expense categories by how far the latest month departs from that
 * category's own trailing average. This is the "what changed" view - a big
 * category that spends the same every month isn't a savings lead, whereas a
 * small one that just doubled is. Needs at least two months to say anything. */
export const buildCategoryMomentum = (
  stackedTrends: StackedMonthlyTrends,
  minBaselineAmount = 0,
): CategoryMomentum[] => {
  const months = Object.keys(stackedTrends).sort();
  if (months.length < 2) return [];

  const latestMonth = months[months.length - 1];
  const priorMonths = months.slice(0, -1);

  const categories = new Set<string>();
  months.forEach((m) => Object.keys(stackedTrends[m]?.expenses || {}).forEach((c) => categories.add(c)));

  const rows: CategoryMomentum[] = [];
  categories.forEach((category) => {
    const latest = stackedTrends[latestMonth]?.expenses?.[category] || 0;
    // Months where the category didn't appear count as zero spend, not as
    // missing data - "we used to not buy this at all" is exactly the signal.
    const baselineTotal = priorMonths.reduce(
      (sum, m) => sum + (stackedTrends[m]?.expenses?.[category] || 0),
      0,
    );
    const baseline = baselineTotal / priorMonths.length;
    if (latest < minBaselineAmount && baseline < minBaselineAmount) return;
    rows.push({
      category,
      latest,
      baseline,
      delta: latest - baseline,
      deltaRatio: baseline > 0 ? (latest - baseline) / baseline : null,
    });
  });

  return rows.sort((a, b) => b.delta - a.delta);
};

export interface SpendingSummaryMetrics {
  monthlyAverageSpend: number;
  monthCount: number;
  savingsRate: number | null;
  biggestCategory: { name: string; value: number } | null;
}

/** Headline numbers derived from data the dashboard already has. Savings rate
 * is the share of income that wasn't spent; null when there's no income in the
 * period, since 0/0 would read as "saved nothing" rather than "not applicable".
 *
 * `monthsInRange` should be the selected period's actual calendar month count
 * (see enumerateMonths) - falling back to the months stackedTrends happens to
 * have would divide by "months with activity" instead, understating average
 * spend for a period that includes quiet months. */
export const buildSpendingSummary = (
  stackedTrends: StackedMonthlyTrends,
  totalIncome: number,
  totalExpenses: number,
  breakdown: Array<{ name: string; value: number }>,
  monthsInRange?: number,
): SpendingSummaryMetrics => {
  const monthCount = monthsInRange && monthsInRange > 0 ? monthsInRange : Object.keys(stackedTrends).length;
  const biggest = breakdown.length > 0 ? [...breakdown].sort((a, b) => b.value - a.value)[0] : null;
  return {
    monthlyAverageSpend: monthCount > 0 ? totalExpenses / monthCount : 0,
    monthCount,
    savingsRate: totalIncome > 0 ? (totalIncome - totalExpenses) / totalIncome : null,
    biggestCategory: biggest ? { name: biggest.name, value: biggest.value } : null,
  };
};

export interface Insight {
  id: string;
  /** Higher sorts first - roughly "how much this deserves attention". */
  severity: number;
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
}

export interface CoverageMonthTotals {
  covered: number;
  gap: number;
  missing: number;
  dismissed: number;
}

/** Generates the dashboard's lead insight statements, most severe first. Each
 * generator returns null when it has nothing worth saying (e.g. under two
 * months of data) rather than a placeholder - callers slice the top few. */
export const buildTopInsights = (params: {
  stackedTrends: StackedMonthlyTrends;
  summary: AnalyticsSummary;
  previousSummary: AnalyticsSummary | null;
  merchantBreakdown: Array<{ name: string; value: number; total: number }>;
  recurring: RecurringCharge[];
  monthsInRange: number;
  coverageMonths: CoverageMonthTotals;
  resolveCategoryLabel: (key: string) => string;
}): Insight[] => {
  const { stackedTrends, summary, previousSummary, merchantBreakdown, recurring, monthsInRange, coverageMonths, resolveCategoryLabel } = params;
  const insights: Insight[] = [];

  const momentum = buildCategoryMomentum(stackedTrends).filter((m) => m.deltaRatio !== null);
  if (momentum.length > 0 && momentum[0].delta > 0) {
    const top = momentum[0];
    insights.push({
      id: 'biggest-mover',
      severity: Math.abs(top.deltaRatio || 0) * 100,
      tone: 'negative',
      text: `${resolveCategoryLabel(top.category)} is up ${((top.deltaRatio || 0) * 100).toFixed(0)}% on its own average (+${Math.round(top.delta).toLocaleString()} Ft).`,
    });
  }

  if (previousSummary && previousSummary.total_income > 0 && summary.total_income > 0) {
    const currentRate = (summary.total_income - summary.total_expenses) / summary.total_income;
    const previousRate = (previousSummary.total_income - previousSummary.total_expenses) / previousSummary.total_income;
    const deltaPts = (currentRate - previousRate) * 100;
    if (Math.abs(deltaPts) >= 1) {
      insights.push({
        id: 'savings-rate',
        severity: Math.abs(deltaPts) * 2,
        tone: deltaPts >= 0 ? 'positive' : 'negative',
        text: `Savings rate ${deltaPts >= 0 ? 'improved' : 'dropped'} to ${(currentRate * 100).toFixed(0)}% from ${(previousRate * 100).toFixed(0)}% last period.`,
      });
    }
  }

  if (recurring.length > 0 && monthsInRange > 0) {
    const monthlySpend = summary.total_expenses / monthsInRange;
    const recurringPerMonth = recurring.reduce((sum, c) => sum + c.annualized_amount, 0) / 12;
    const share = monthlySpend > 0 ? (recurringPerMonth / monthlySpend) * 100 : 0;
    if (share >= 5) {
      insights.push({
        id: 'subscriptions',
        severity: share,
        tone: 'neutral',
        text: `${recurring.length} recurring charge${recurring.length === 1 ? '' : 's'} committing ${Math.round(recurringPerMonth).toLocaleString()} Ft/month - ${share.toFixed(0)}% of average spend.`,
      });
    }
  }

  const spendOnly = merchantBreakdown.filter((m) => m.total < 0);
  if (spendOnly.length > 0 && summary.total_expenses > 0) {
    const top = [...spendOnly].sort((a, b) => b.value - a.value)[0];
    const share = (top.value / summary.total_expenses) * 100;
    if (share >= 10) {
      insights.push({
        id: 'merchant-concentration',
        severity: share * 1.5,
        tone: 'neutral',
        text: `${top.name} alone accounts for ${share.toFixed(0)}% of this period's spending.`,
      });
    }
  }

  if (coverageMonths.missing > 0) {
    insights.push({
      id: 'coverage-gap',
      severity: coverageMonths.missing * 20,
      tone: 'negative',
      text: `${coverageMonths.missing} month${coverageMonths.missing === 1 ? ' is' : 's are'} flagged as missing data - figures below may be incomplete.`,
    });
  }

  return insights.sort((a, b) => b.severity - a.severity);
};
