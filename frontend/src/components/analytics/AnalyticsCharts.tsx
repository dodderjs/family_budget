import { Box, Breadcrumbs, Card, CardContent, Link, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { PieChart } from '@mui/x-charts/PieChart';
import React, { useEffect, useMemo, useState } from 'react';
import { BreakdownEntry, TrendEntry } from '../../services/analyticsService';
import { BreakdownGroupBy, CategoryLevel, CategoryNode, StackedMonthlyTrends } from '../../services/transactionService';
import { mainCategoryLabel } from '../../utils/categoryHierarchy';
import { formatCurrency } from '../../utils/currency';
import {
  buildBreakdownRows,
  buildComparisonTrendRows,
  buildStackedBarData,
  MAX_BREAKDOWN_ITEMS,
  nextCategorySelection,
} from './analyticsChartsHelpers';
import { ChartLegend, ChartLegendEntry } from './ChartLegend';

const CHART_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#f87171', '#06b6d4', '#f97316'];
const INCOME_COLOR  = '#10b981';
const EXPENSE_COLOR = '#2563eb';

const GROUP_BY_LABEL: Record<BreakdownGroupBy, string> = {
  category: 'Category',
  merchant: 'Merchant',
  account:  'Account',
};

interface AnalyticsChartsProps {
  breakdown: BreakdownEntry[];
  trends: TrendEntry[];
  previousTrends?: TrendEntry[];
  stackedTrends?: StackedMonthlyTrends;
  previousStackedTrends?: StackedMonthlyTrends | null;
  /** Dense per-period month axes (see enumerateMonths) that the stacked bar
   * chart aligns current/previous against, each at its own offset, instead
   * of deriving an axis from whichever months happen to have a transaction. */
  months?: string[];
  previousMonths?: string[];
  groupBy: BreakdownGroupBy;
  categoryLevel?: CategoryLevel;
  /** Needed only to resolve a parent category's key (what the backend now
   * returns at category_level=parent, so it round-trips through the
   * category_keys filter) back to a display label. */
  categories?: CategoryNode[];
  /** Offers a Parent/Leaf toggle in the trend chart's header when set. */
  onCategoryLevelChange?: (level: CategoryLevel) => void;
  /** Fired when a parent-level donut slice is clicked, with that parent's
   * key. Only wired up when groupBy is 'category' and categoryLevel is
   * 'parent' - a leaf-level or merchant/account donut has nothing to drill
   * into. The "Other" rollup slice never fires this. */
  onDrilldown?: (parentKey: string) => void;
  /** Label of the parent currently drilled into, for the breadcrumb above the
   * donut. Null when at the top level. */
  drilldownLabel?: string | null;
  onClearDrilldown?: () => void;
  /** Receives the complete next category filter after a legend click. The
   * chart computes it rather than the caller because only the chart knows
   * the full set of categories on screen, which Ctrl+click needs in order to
   * select "everything else". The "Other Income"/"Other Expenses" rollups
   * aren't real categories and never fire this. */
  onCategoryFilterChange?: (nextCategoryKeys: string[]) => void;
  /** Category keys currently applied as a page-wide filter. The chart needs
   * these to work out the result of a click, so pass the same array the page
   * filters on. */
  activeCategoryKeys?: string[];
}

export const AnalyticsCharts: React.FC<AnalyticsChartsProps> = ({
  breakdown,
  trends,
  previousTrends = [],
  stackedTrends = {},
  previousStackedTrends = null,
  months,
  previousMonths,
  groupBy,
  categoryLevel = 'leaf',
  categories = [],
  onCategoryLevelChange,
  onDrilldown,
  drilldownLabel = null,
  onClearDrilldown,
  onCategoryFilterChange,
  activeCategoryKeys = [],
}) => {
  const barData = buildStackedBarData(
    stackedTrends,
    previousStackedTrends,
    CHART_COLORS,
    formatCurrency,
    months && months.length > 0 ? months : undefined,
    previousMonths && previousMonths.length > 0 ? previousMonths : undefined,
  );
  const liveLegendEntries: ChartLegendEntry[] = useMemo(
    () =>
      barData.series
        .filter((s) => s.id.startsWith('cur-'))
        .map((s) => ({ id: s.id, label: s.label, color: s.color, categoryKey: s.categoryKey })),
    [barData.series]
  );

  // A legend click narrows the page-wide filter, which re-fetches stackedTrends
  // scoped to just the selected category - so by the time the chart re-renders,
  // every other category has actually vanished from the data, not just from
  // view. The legend should still list all of them (greyed, still clickable to
  // bring back), so a snapshot of "every category in this view" is kept here,
  // separate from what the current (possibly filtered) fetch contains.
  //
  // Keyed on categoryLevel+drilldownLabel ("this view") rather than updated on
  // every render: syncing only when `stackedTrends` itself changes (a fetch
  // actually landed) avoids capturing a stale snapshot from the render(s)
  // between a level/drill change and its data arriving, where categoryLevel
  // already reflects the new view but stackedTrends is still the old view's.
  const viewKey = `${categoryLevel}:${drilldownLabel || ''}`;
  const [legendSnapshot, setLegendSnapshot] = useState<{ key: string; entries: ChartLegendEntry[] }>({ key: '', entries: [] });
  useEffect(() => {
    setLegendSnapshot((prev) => {
      if (prev.key !== viewKey) {
        // First fetch for this view - trustworthy as "every category in
        // scope" even if already filtered (a drill-down starts pre-filtered
        // to exactly its own full leaf set, which *is* the full view here).
        return { key: viewKey, entries: liveLegendEntries };
      }
      if (activeCategoryKeys.length === 0 && liveLegendEntries.length > prev.entries.length) {
        // Clearing a narrower filter revealed more categories - grow to match.
        return { key: viewKey, entries: liveLegendEntries };
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackedTrends]);

  const legendEntries = legendSnapshot.key === viewKey && legendSnapshot.entries.length > 0
    ? legendSnapshot.entries
    : liveLegendEntries;
  // Deduped: the current and previous-period series repeat the same category
  // keys, and the "Other" rollups carry null.
  const allCategoryKeys = useMemo(
    () => [...new Set(legendEntries.map((e) => e.categoryKey).filter((k): k is string => !!k))],
    [legendEntries]
  );
  const handleLegendEntryClick = (event: React.MouseEvent, categoryKey: string) => {
    if (!onCategoryFilterChange) return;
    const exclude = event.ctrlKey || event.metaKey;
    onCategoryFilterChange(
      nextCategorySelection(activeCategoryKeys, categoryKey, allCategoryKeys, exclude)
    );
  };

  const canDrilldown = !!onDrilldown && groupBy === 'category' && categoryLevel === 'parent';
  const displayBreakdown = buildBreakdownRows(breakdown);
  const showPieLegend = displayBreakdown.length <= MAX_BREAKDOWN_ITEMS && !canDrilldown;
  // At parent level the backend reports each slice by the parent's *key*
  // (see _build_parent_category_lookup) so a click round-trips through the
  // category_keys filter - resolve it to a label for display only.
  const resolvePieLabel = (name: string) =>
    categoryLevel === 'parent' && name !== 'Other' ? mainCategoryLabel(categories, name) : name;
  const handlePieItemClick = (_event: React.MouseEvent, identifier: { dataIndex: number }) => {
    if (!canDrilldown) return;
    const raw = displayBreakdown[identifier.dataIndex];
    if (!raw || raw.name === 'Other') return;
    onDrilldown!(raw.name);
  };

  const areaRows = buildComparisonTrendRows(trends, previousTrends);
  const hasPrevious = previousTrends.length > 0;

  const trendSeries = [
    { id: 'income', data: areaRows.map((r) => r.income), label: 'Income', color: INCOME_COLOR, area: true, showMark: false, valueFormatter: (v: number | null) => formatCurrency(v ?? 0) },
    { id: 'expenses', data: areaRows.map((r) => r.expenses), label: 'Expenses', color: EXPENSE_COLOR, area: true, showMark: false, valueFormatter: (v: number | null) => formatCurrency(v ?? 0) },
    ...(hasPrevious ? [
      { id: 'prev-income', data: areaRows.map((r) => r.previousIncome), label: 'Previous Income', color: INCOME_COLOR, showMark: false, valueFormatter: (v: number | null) => formatCurrency(v ?? 0) },
      { id: 'prev-expenses', data: areaRows.map((r) => r.previousExpenses), label: 'Previous Expenses', color: EXPENSE_COLOR, showMark: false, valueFormatter: (v: number | null) => formatCurrency(v ?? 0) },
    ] : []),
  ];

  return (
    <>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0,1fr))' }, minWidth: 0 }}>
        {/* Donut breakdown */}
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              {drilldownLabel ? (
                <Breadcrumbs sx={{ fontSize: '0.8rem' }}>
                  <Link component="button" variant="body2" onClick={onClearDrilldown} underline="hover">
                    All categories
                  </Link>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{drilldownLabel}</Typography>
                </Breadcrumbs>
              ) : (
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Breakdown by {GROUP_BY_LABEL[groupBy]}
                </Typography>
              )}
            </Stack>
            <PieChart
              series={[{
                data: displayBreakdown.map((item, i) => ({
                  id: i,
                  value: item.value,
                  label: resolvePieLabel(item.name),
                  color: CHART_COLORS[i % CHART_COLORS.length],
                })),
                innerRadius: 52,
                outerRadius: 88,
                paddingAngle: 2,
                valueFormatter: ({ value }) => formatCurrency(value ?? 0),
              }]}
              height={250}
              slots={!showPieLegend ? { legend: () => null } : undefined}
              onItemClick={canDrilldown ? handlePieItemClick : undefined}
              sx={{ width: '100%', ...(canDrilldown && { '& .MuiPieArc-root': { cursor: 'pointer' } }) }}
            />
            {canDrilldown && !drilldownLabel && (
              <Typography variant="caption" color="text.secondary">
                Click a slice to see its categories.
              </Typography>
            )}
            {!showPieLegend && !canDrilldown && (
              <Typography variant="caption" color="text.secondary">
                Showing top {MAX_BREAKDOWN_ITEMS - 1} items plus Other.
              </Typography>
            )}
          </CardContent>
        </Card>

        {/* Monthly bar chart */}
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5, gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Monthly Trends {groupBy === 'category' && `(Stacked by ${categoryLevel === 'parent' ? 'Parent' : 'Leaf'} Category)`}
              </Typography>
              {onCategoryLevelChange && !drilldownLabel && (
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={categoryLevel}
                  onChange={(_, value) => value && onCategoryLevelChange(value)}
                >
                  <ToggleButton value="parent" sx={{ py: 0.25, px: 1 }}>Parent</ToggleButton>
                  <ToggleButton value="leaf" sx={{ py: 0.25, px: 1 }}>Leaf</ToggleButton>
                </ToggleButtonGroup>
              )}
            </Stack>
            {onCategoryFilterChange && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {activeCategoryKeys.length > 0
                  ? 'Click a category again to remove it from the filter. Ctrl+click removes it too.'
                  : 'Click a category to filter the whole page by it — Ctrl+click to exclude it instead.'}
              </Typography>
            )}
            <BarChart
              series={barData.series}
              xAxis={[{ data: barData.months, scaleType: 'band' }]}
              yAxis={[{ valueFormatter: (v: number | null) => formatCurrency(v ?? 0) }]}
              height={220}
              slots={{ legend: () => null }}
              sx={{ width: '100%' }}
            />
            <ChartLegend
              entries={legendEntries}
              activeCategoryKeys={activeCategoryKeys}
              hasPrevious={!!previousStackedTrends}
              onEntryClick={onCategoryFilterChange ? handleLegendEntryClick : undefined}
            />
          </CardContent>
        </Card>
      </Box>

      {/* Line/area chart — income vs expenses over time */}
      {areaRows.length > 0 && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
              Income vs Expenses Over Time
            </Typography>
            <LineChart
              series={trendSeries}
              xAxis={[{ data: areaRows.map((r) => r.month), scaleType: 'point' }]}
              yAxis={[{ valueFormatter: (v: number | null) => formatCurrency(v ?? 0) }]}
              height={260}
              sx={{
                width: '100%',
                '& .MuiAreaElement-series-income': { fillOpacity: 0.2 },
                '& .MuiAreaElement-series-expenses': { fillOpacity: 0.2 },
                '& .MuiLineElement-series-prev-income': { strokeDasharray: '6 3', opacity: 0.5 },
                '& .MuiLineElement-series-prev-expenses': { strokeDasharray: '6 3', opacity: 0.5 },
              }}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
};
