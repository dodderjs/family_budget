import { BreakdownEntry, TrendEntry } from '../../services/analyticsService';
import { StackedMonthlyTrends } from '../../services/transactionService';

/** Fades a "#rrggbb" color for the previous-period series - so it reads as a
 * ghosted echo of its current-period counterpart instead of an identical,
 * separately-legended color needing its own "Prev X" entry. */
export const withAlpha = (hex: string, alpha: number): string => {
  const clean = hex.replace('#', '');
  const value = parseInt(clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const MAX_BREAKDOWN_ITEMS = 10;
export const MAX_STACK_CATEGORIES = 8;
export const OTHER_INCOME_LABEL = 'Other Income';
export const OTHER_EXPENSE_LABEL = 'Other Expenses';

export interface BarSeries {
  id: string;
  label: string;
  data: number[];
  stack: string;
  color: string;
  valueFormatter: (v: number | null) => string;
  /** The raw category key this series represents (e.g. "salary"), for
   * clicking the legend to filter the page by it. Null for the rolled-up
   * "Other Income"/"Other Expenses" bucket, which isn't one real category. */
  categoryKey: string | null;
}

export interface StackedBarData {
  months: string[];
  series: BarSeries[];
}

export const buildBreakdownRows = (breakdown: BreakdownEntry[]) => {
  const sorted = [...breakdown].sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_BREAKDOWN_ITEMS) return sorted;
  const primary = sorted.slice(0, MAX_BREAKDOWN_ITEMS - 1);
  const otherTotal = sorted.slice(MAX_BREAKDOWN_ITEMS - 1).reduce((sum, item) => sum + item.value, 0);
  return [...primary, { name: 'Other', value: otherTotal }];
};

export const pickTopCategories = (
  totals: Record<string, number>,
  maxCount: number,
  otherLabel: string,
): string[] => {
  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  if (sorted.length <= maxCount) return sorted;
  return [...sorted.slice(0, maxCount - 1), otherLabel];
};

const extractCategoryData = (
  source: StackedMonthlyTrends,
  sourceMonths: string[],
  displayLength: number,
  keep: Set<string>,
  otherLabel: string,
  field: 'income' | 'expenses',
): Record<string, number[]> => {
  const result: Record<string, number[]> = {};
  for (let i = 0; i < displayLength; i += 1) {
    const sourceMonth = sourceMonths[i];
    const entry = sourceMonth ? source[sourceMonth] : undefined;
    Object.entries(entry?.[field] || {}).forEach(([cat, val]) => {
      const target = keep.has(cat) ? cat : otherLabel;
      if (!result[target]) result[target] = new Array(displayLength).fill(0);
      result[target][i] = (result[target][i] || 0) + val;
    });
  }
  return result;
};

export const buildStackedBarData = (
  current: StackedMonthlyTrends,
  previous: StackedMonthlyTrends | null,
  colors: string[],
  formatValue: (v: number) => string,
  // Dense per-period axes (see enumerateMonths) so current and previous are
  // each read at their own offset - a 1-month current period next to an
  // 8-month previous one no longer zips index-for-index into unrelated
  // months. Falls back to the months actually present when not given.
  currentMonthsAxis: string[] = Object.keys(current).sort(),
  previousMonthsAxis: string[] = Object.keys(previous || {}).sort(),
): StackedBarData => {
  const currentMonths = currentMonthsAxis;
  const previousMonths = previousMonthsAxis;
  const rowCount = Math.max(currentMonths.length, previousMonths.length);
  const months = Array.from({ length: rowCount }, (_, i) => currentMonths[i] || previousMonths[i] || '');

  const incomeTotals: Record<string, number> = {};
  const expenseTotals: Record<string, number> = {};

  [...Object.values(current), ...Object.values(previous || {})].forEach((entry) => {
    Object.entries(entry.income).forEach(([cat, val]) => { incomeTotals[cat] = (incomeTotals[cat] || 0) + val; });
    Object.entries(entry.expenses).forEach(([cat, val]) => { expenseTotals[cat] = (expenseTotals[cat] || 0) + val; });
  });

  const topIncomeCategories = pickTopCategories(incomeTotals, MAX_STACK_CATEGORIES, OTHER_INCOME_LABEL);
  const topExpenseCategories = pickTopCategories(expenseTotals, MAX_STACK_CATEGORIES, OTHER_EXPENSE_LABEL);
  const incomeKeep = new Set(topIncomeCategories.filter((n) => n !== OTHER_INCOME_LABEL));
  const expenseKeep = new Set(topExpenseCategories.filter((n) => n !== OTHER_EXPENSE_LABEL));

  const curIncomeData = extractCategoryData(current, currentMonths, rowCount, incomeKeep, OTHER_INCOME_LABEL, 'income');
  const curExpenseData = extractCategoryData(current, currentMonths, rowCount, expenseKeep, OTHER_EXPENSE_LABEL, 'expenses');

  const vf = (v: number | null) => formatValue(v ?? 0);
  const series: BarSeries[] = [];

  topIncomeCategories.forEach((cat, i) => {
    series.push({
      id: `cur-income-${i}`,
      label: `Income: ${cat}`,
      data: curIncomeData[cat] || new Array(rowCount).fill(0),
      stack: 'current-income',
      color: colors[i % colors.length],
      valueFormatter: vf,
      categoryKey: cat === OTHER_INCOME_LABEL ? null : cat,
    });
  });

  topExpenseCategories.forEach((cat, i) => {
    series.push({
      id: `cur-expense-${i}`,
      label: `Expense: ${cat}`,
      data: curExpenseData[cat] || new Array(rowCount).fill(0),
      stack: 'current-expense',
      color: colors[(i + 3) % colors.length],
      valueFormatter: vf,
      categoryKey: cat === OTHER_EXPENSE_LABEL ? null : cat,
    });
  });

  if (previous) {
    const prevIncomeData = extractCategoryData(previous, previousMonths, rowCount, incomeKeep, OTHER_INCOME_LABEL, 'income');
    const prevExpenseData = extractCategoryData(previous, previousMonths, rowCount, expenseKeep, OTHER_EXPENSE_LABEL, 'expenses');

    topIncomeCategories.forEach((cat, i) => {
      series.push({
        id: `prev-income-${i}`,
        label: `Prev Income: ${cat}`,
        data: prevIncomeData[cat] || new Array(rowCount).fill(0),
        stack: 'previous-income',
        // Same base hue as its current-period counterpart, faded - a ghost of
        // that series rather than a separately-legended color.
        color: withAlpha(colors[i % colors.length], 0.35),
        valueFormatter: vf,
        categoryKey: cat === OTHER_INCOME_LABEL ? null : cat,
      });
    });

    topExpenseCategories.forEach((cat, i) => {
      series.push({
        id: `prev-expense-${i}`,
        label: `Prev Expense: ${cat}`,
        data: prevExpenseData[cat] || new Array(rowCount).fill(0),
        stack: 'previous-expense',
        color: withAlpha(colors[(i + 3) % colors.length], 0.35),
        valueFormatter: vf,
        categoryKey: cat === OTHER_EXPENSE_LABEL ? null : cat,
      });
    });
  }

  return { months, series };
};

/** Works out the page-wide category filter after a legend click.
 *
 * Plain click toggles the clicked category. Ctrl/Cmd+click *excludes* it: with
 * no filter yet that means selecting every other category, so the clicked one
 * drops out of the chart - the point being to hide a category big enough to
 * flatten all the others. Once a filter exists, excluding is just removal.
 *
 * Ctrl+clicking a category that isn't in a non-empty filter is a no-op: it is
 * already excluded, and re-deriving "everything else" from the full list would
 * silently widen the filter the user built.
 *
 * `allKeys` is what the legend shows, which buildStackedBarData caps at
 * MAX_STACK_CATEGORIES per sign - so "everything else" means every category
 * the user can actually see, not every category in the database. The long tail
 * folded into "Other Income"/"Other Expenses" is excluded along with the
 * clicked one. That keeps the gesture WYSIWYG and the resulting chip row
 * readable. Returning `current` unchanged for the no-op case preserves the
 * array reference, so React skips the re-render and no refetch fires. */
export const nextCategorySelection = (
  current: string[],
  clicked: string,
  allKeys: string[],
  exclude: boolean,
): string[] => {
  const isSelected = current.includes(clicked);

  if (!exclude) {
    return isSelected ? current.filter((key) => key !== clicked) : [...current, clicked];
  }
  if (isSelected) {
    return current.filter((key) => key !== clicked);
  }
  if (current.length > 0) {
    return current;
  }
  return allKeys.filter((key) => key !== clicked);
};

export const buildComparisonTrendRows = (
  trends: TrendEntry[],
  previousTrends: TrendEntry[],
): Array<{ month: string; income: number; expenses: number; previousIncome: number; previousExpenses: number }> => {
  const rowCount = Math.max(trends.length, previousTrends.length);
  return Array.from({ length: rowCount }, (_, i) => ({
    month: trends[i]?.month || previousTrends[i]?.month || '',
    income: trends[i]?.income || 0,
    expenses: trends[i]?.expenses || 0,
    previousIncome: previousTrends[i]?.income || 0,
    previousExpenses: previousTrends[i]?.expenses || 0,
  }));
};
