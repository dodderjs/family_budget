import { Box, Card, CardContent, Typography } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { PieChart } from '@mui/x-charts/PieChart';
import React, { useMemo } from 'react';
import { BreakdownEntry, TrendEntry } from '../../services/analyticsService';
import { BreakdownGroupBy, CategoryLevel, StackedMonthlyTrends } from '../../services/transactionService';
import { formatCurrency } from '../../utils/currency';
import {
  buildBreakdownRows,
  buildComparisonTrendRows,
  buildStackedBarData,
  MAX_BREAKDOWN_ITEMS,
  nextCategorySelection,
} from './analyticsChartsHelpers';

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
  groupBy: BreakdownGroupBy;
  categoryLevel?: CategoryLevel;
  /** Receives the complete next category filter after a Monthly Trends legend
   * click. The chart computes it rather than the caller because only the chart
   * knows the full set of categories on screen, which Ctrl+click needs in
   * order to select "everything else". The "Other Income"/"Other Expenses"
   * rollups aren't real categories and never fire this. */
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
  groupBy,
  categoryLevel = 'leaf',
  onCategoryFilterChange,
  activeCategoryKeys = [],
}) => {
  const barData = buildStackedBarData(stackedTrends, previousStackedTrends, CHART_COLORS, formatCurrency);
  const categoryKeyBySeriesId = useMemo(
    () => Object.fromEntries(barData.series.map((s) => [s.id, s.categoryKey])),
    [barData.series]
  );
  // Deduped: the current and previous-period series repeat the same category
  // keys, and the "Other" rollups carry null.
  const allCategoryKeys = useMemo(
    () => [...new Set(barData.series.map((s) => s.categoryKey).filter((k): k is string => !!k))],
    [barData.series]
  );
  const handleLegendItemClick = (event: React.MouseEvent, legendItem: { seriesId?: string }) => {
    const categoryKey = legendItem.seriesId ? categoryKeyBySeriesId[legendItem.seriesId] : null;
    if (!categoryKey || !onCategoryFilterChange) return;
    // metaKey so Cmd works on macOS, where Ctrl+click opens the context menu.
    const exclude = event.ctrlKey || event.metaKey;
    onCategoryFilterChange(
      nextCategorySelection(activeCategoryKeys, categoryKey, allCategoryKeys, exclude)
    );
  };
  const displayBreakdown = buildBreakdownRows(breakdown);
  const showPieLegend = displayBreakdown.length <= MAX_BREAKDOWN_ITEMS;
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
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
              Breakdown by {GROUP_BY_LABEL[groupBy]}
            </Typography>
            <PieChart
              series={[{
                data: displayBreakdown.map((item, i) => ({
                  id: i,
                  value: item.value,
                  label: item.name,
                  color: CHART_COLORS[i % CHART_COLORS.length],
                })),
                innerRadius: 52,
                outerRadius: 88,
                paddingAngle: 2,
                valueFormatter: ({ value }) => formatCurrency(value ?? 0),
              }]}
              height={250}
              slots={!showPieLegend ? { legend: () => null } : undefined}
              sx={{ width: '100%' }}
            />
            {!showPieLegend && (
              <Typography variant="caption" color="text.secondary">
                Showing top {MAX_BREAKDOWN_ITEMS - 1} items plus Other.
              </Typography>
            )}
          </CardContent>
        </Card>

        {/* Monthly bar chart */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Monthly Trends (Stacked by {categoryLevel === 'parent' ? 'Parent Category' : 'Leaf Category'})
            </Typography>
            {onCategoryFilterChange && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {activeCategoryKeys.length > 0
                  ? 'Click a legend entry again to remove it from the filter. Ctrl+click removes it too.'
                  : 'Click a legend entry to filter the whole page by it — Ctrl+click to exclude it instead.'}
              </Typography>
            )}
            <BarChart
              series={barData.series}
              xAxis={[{ data: barData.months, scaleType: 'band' }]}
              yAxis={[{ valueFormatter: (v: number | null) => formatCurrency(v ?? 0) }]}
              height={250}
              sx={{
                width: '100%',
                ...(onCategoryFilterChange && {
                  '& .MuiChartsLegend-series': { cursor: 'pointer' },
                }),
              }}
              slotProps={onCategoryFilterChange ? { legend: { onItemClick: handleLegendItemClick } } : undefined}
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

