import { StackedMonthlyTrends } from '../../services/transactionService';

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
 * period, since 0/0 would read as "saved nothing" rather than "not applicable". */
export const buildSpendingSummary = (
  stackedTrends: StackedMonthlyTrends,
  totalIncome: number,
  totalExpenses: number,
  breakdown: Array<{ name: string; value: number }>,
): SpendingSummaryMetrics => {
  const monthCount = Object.keys(stackedTrends).length;
  const biggest = breakdown.length > 0 ? [...breakdown].sort((a, b) => b.value - a.value)[0] : null;
  return {
    monthlyAverageSpend: monthCount > 0 ? totalExpenses / monthCount : 0,
    monthCount,
    savingsRate: totalIncome > 0 ? (totalIncome - totalExpenses) / totalIncome : null,
    biggestCategory: biggest ? { name: biggest.name, value: biggest.value } : null,
  };
};
