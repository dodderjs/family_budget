export type DateRangePreset =
  | 'all'
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'last_year'
  | 'custom';

export interface ResolvedDateRange {
  from: string | null;
  to: string | null;
}

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

/** Every "YYYY-MM" in [from, to] inclusive. Returns [] when either bound is
 * missing (the 'all' preset, or a not-yet-resolved previous period) - callers
 * fall back to whatever months the data actually has instead of guessing an
 * unbounded axis. Used to zero-fill monthly series so a chart's x-axis always
 * spans the selected period, rather than only the months with transactions. */
export function enumerateMonths(from: string | null, to: string | null): string[] {
  if (!from || !to) return [];
  const cursor = new Date(`${from.slice(0, 7)}-01`);
  const end = new Date(`${to.slice(0, 7)}-01`);
  const months: string[] = [];
  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
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

/** Join multi-select account ids into the comma-separated string the API's
 * account_id filter param expects; undefined means "no filter". */
export function accountIdParam(ids: string[]): string | undefined {
  return ids.length ? ids.join(',') : undefined;
}