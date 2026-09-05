import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    LinearProgress,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnalyticsCharts } from '../components/analytics/AnalyticsCharts';
import { CategoryMomentumCard } from '../components/dashboard/CategoryMomentumCard';
import { buildTopInsights } from '../components/dashboard/insightHelpers';
import { InsightsStrip } from '../components/dashboard/InsightsStrip';
import { KpiCard } from '../components/dashboard/KpiCard';
import { RecurringChargesCard } from '../components/dashboard/RecurringChargesCard';
import { TopMerchantsCard } from '../components/dashboard/TopMerchantsCard';
import { TransfersCard } from '../components/dashboard/TransfersCard';
import { FilterBar } from '../components/FilterBar';
import { dashboardService } from '../services/dashboardService';
import { CategoryLevel } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';
import { buildCategoryGroups, mainCategoryLabel } from '../utils/categoryHierarchy';
import { formatCurrency } from '../utils/currency';
import { accountIdParam, resolveDateRange } from '../utils/dateRange';

export const DashboardHomePage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardService.loadHomeData>> | null>(null);

  const selectedAccountIds = useTransactionStore((s) => s.selectedAccountIds);
  const datePreset = useTransactionStore((s) => s.datePreset);
  const customDateFrom = useTransactionStore((s) => s.customDateFrom);
  const customDateTo = useTransactionStore((s) => s.customDateTo);
  const categories = useTransactionStore((s) => s.categories);

  // The dashboard has no category picker of its own - this only exists so a
  // Monthly Trends legend click (or a donut drill-down) can filter the page,
  // and is shown/cleared via the chip row below FilterBar so the filter is
  // never silent.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  // Parent is the landing view - 23 leaf categories is too much to scan at a
  // glance, and drilling in is one click away.
  const [categoryLevel, setCategoryLevel] = useState<CategoryLevel>('parent');
  const [drilldownParent, setDrilldownParent] = useState<string | null>(null);

  const range = resolveDateRange(datePreset, customDateFrom, customDateTo);
  const accountId = accountIdParam(selectedAccountIds);
  const categoryKeys = selectedCategories.length > 0 ? selectedCategories.join(',') : undefined;

  const categoryGroups = useMemo(() => buildCategoryGroups(categories), [categories]);
  // At parent level (and not drilled) the backend reports parent *keys* (see
  // _build_parent_category_lookup) so they round-trip through category_keys -
  // resolve to a label anywhere one is displayed.
  const resolveCategoryLabel = (key: string): string =>
    categoryLevel === 'parent' && !drilldownParent ? mainCategoryLabel(categories, key) : key;

  const handleLegendCategoryToggle = (categoryKey: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryKey) ? prev.filter((k) => k !== categoryKey) : [...prev, categoryKey]
    );
  };

  const handleDrilldown = (parentKey: string) => {
    const group = categoryGroups.find((g) => g.parentKey === parentKey);
    setDrilldownParent(parentKey);
    setCategoryLevel('leaf');
    setSelectedCategories(group ? group.leafKeys : []);
  };

  const handleClearDrilldown = () => {
    setDrilldownParent(null);
    setCategoryLevel('parent');
    setSelectedCategories([]);
  };

  const handleCategoryLevelChange = (level: CategoryLevel) => {
    // Only reachable at the top level (the toggle hides itself while
    // drilled) - always a level switch on an empty filter, not a change
    // underneath an existing one.
    setCategoryLevel(level);
    setSelectedCategories([]);
  };

  // Changing a filter fires a new load while the previous one is still in
  // flight, and the two can finish out of order - without this guard a stale
  // response overwrites the current one, leaving the page showing data for a
  // filter the user has already moved off.
  const requestIdRef = useRef(0);

  const loadData = async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await dashboardService.loadHomeData({ accountId, range, categoryKeys, categoryLevel });
      if (requestId !== requestIdRef.current) return;
      setData(response);
    } catch (err: any) {
      if (requestId !== requestIdRef.current) return;
      setError(err?.message || 'Failed to load dashboard data');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, range.from, range.to, categoryKeys, categoryLevel]);

  const topCategories = useMemo(() => {
    if (!data) return [];
    return [...data.analytics.breakdown].sort((a, b) => b.value - a.value).slice(0, 6);
  }, [data]);

  const insights = useMemo(() => {
    if (!data) return [];
    return buildTopInsights({
      stackedTrends: data.analytics.stackedTrends,
      summary: data.analytics.summary,
      previousSummary: data.analytics.previousSummary,
      merchantBreakdown: data.analytics.merchantBreakdown,
      recurring: data.recurring,
      monthsInRange: data.analytics.months.length || Object.keys(data.analytics.stackedTrends).length,
      coverageMonths: data.totals.coverageMonths,
      resolveCategoryLabel,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, categoryLevel, drilldownParent, categories]);

  if (loading && !data) {
    return <CircularProgress size={28} />;
  }

  if (!data) {
    return <Alert severity="error">{error || 'No dashboard data available'}</Alert>;
  }

  const summary = data.analytics.summary;
  const previousSummary = data.analytics.previousSummary;
  const latestDataDate = data.uploadAccounts.reduce<string | null>(
    (latest, account) => (account.lastDate && (!latest || account.lastDate > latest) ? account.lastDate : latest),
    null
  );
  const expenseDeltaPct = previousSummary && previousSummary.total_expenses
    ? ((summary.total_expenses - previousSummary.total_expenses) / Math.abs(previousSummary.total_expenses)) * 100
    : null;
  const incomeDeltaPct = previousSummary && previousSummary.total_income
    ? ((summary.total_income - previousSummary.total_income) / Math.abs(previousSummary.total_income)) * 100
    : null;

  const coverageTotalMonths =
    data.totals.coverageMonths.covered +
    data.totals.coverageMonths.gap +
    data.totals.coverageMonths.missing +
    data.totals.coverageMonths.dismissed;
  const coverageScore = coverageTotalMonths > 0
    ? ((data.totals.coverageMonths.covered + data.totals.coverageMonths.dismissed) / coverageTotalMonths) * 100
    : 0;

  const expenseSparkline = data.analytics.trends.map((t) => t.expenses);
  const incomeSparkline = data.analytics.trends.map((t) => t.income);
  const drilldownLabel = drilldownParent ? mainCategoryLabel(categories, drilldownParent) : null;

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' } }}>
        <Button variant="contained" onClick={loadData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Stack>

      {error && <Alert severity="warning">{error}</Alert>}

      <FilterBar />

      {selectedCategories.length > 0 && !drilldownParent && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">Filtered by category:</Typography>
          {selectedCategories.map((key) => (
            <Chip key={key} size="small" label={resolveCategoryLabel(key)} onDelete={() => handleLegendCategoryToggle(key)} />
          ))}
          <Button size="small" onClick={() => setSelectedCategories([])}>Clear</Button>
        </Stack>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            lg: 'repeat(4, minmax(0, 1fr))',
          },
        }}
      >
        <KpiCard
          label="Expenses (Current Period)"
          value={formatCurrency(summary.total_expenses)}
          valueColor="error.main"
          deltaPct={expenseDeltaPct}
          higherIsBetter={false}
          sparkline={expenseSparkline}
          sparklineColor="#f87171"
        />
        <KpiCard
          label="Income (Current Period)"
          value={formatCurrency(summary.total_income)}
          valueColor="success.main"
          deltaPct={incomeDeltaPct}
          higherIsBetter
          sparkline={incomeSparkline}
          sparklineColor="#10b981"
        />
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">User Uploads Tracked</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{data.totals.uploadedTransactions.toLocaleString()}</Typography>
            <Typography variant="body2" color="text.secondary">
              {data.totals.activeAccounts}/{data.totals.trackedAccounts} active accounts
            </Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">Coverage Health</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{coverageScore.toFixed(0)}%</Typography>
            <LinearProgress variant="determinate" value={coverageScore} sx={{ mt: 1, mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              Covered + dismissed months out of tracked history
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <InsightsStrip insights={insights} />

      <AnalyticsCharts
        breakdown={data.analytics.breakdown}
        trends={data.analytics.trends}
        previousTrends={data.analytics.previousTrends}
        stackedTrends={data.analytics.stackedTrends}
        previousStackedTrends={data.analytics.previousStackedTrends}
        months={data.analytics.months}
        previousMonths={data.analytics.previousMonths}
        groupBy="category"
        categoryLevel={categoryLevel}
        categories={categories}
        onCategoryLevelChange={handleCategoryLevelChange}
        onDrilldown={handleDrilldown}
        drilldownLabel={drilldownLabel}
        onClearDrilldown={handleClearDrilldown}
        onCategoryFilterChange={setSelectedCategories}
        activeCategoryKeys={selectedCategories}
      />

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
        }}
      >
        <CategoryMomentumCard
          stackedTrends={data.analytics.stackedTrends}
          onCategoryClick={handleLegendCategoryToggle}
          resolveLabel={resolveCategoryLabel}
        />
        <TopMerchantsCard
          merchants={data.analytics.merchantBreakdown}
          totalExpenses={summary.total_expenses}
        />
      </Box>

      <RecurringChargesCard charges={data.recurring} latestDataDate={latestDataDate} />

      <TransfersCard transfers={data.transfers} months={data.analytics.months} />

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: {
            xs: '1fr',
            lg: '1.3fr 1fr',
          },
        }}
      >
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6">User Upload Activity by Account</Typography>
              <Button component={Link} to="/uploads" size="small">Open Uploads</Button>
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Account</TableCell>
                  <TableCell>Uploaded Tx</TableCell>
                  <TableCell>First</TableCell>
                  <TableCell>Last</TableCell>
                  <TableCell>Coverage</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.uploadAccounts.map((row) => (
                  <TableRow key={row.accountId}>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2">{row.accountName}</Typography>
                        {row.accountType && <Chip size="small" variant="outlined" label={row.accountType} />}
                      </Stack>
                    </TableCell>
                    <TableCell>{row.transactionsInCoverage.toLocaleString()}</TableCell>
                    <TableCell>{row.firstDate || '-'}</TableCell>
                    <TableCell>{row.lastDate || '-'}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {row.coverageSummary.covered} covered, {row.coverageSummary.missing} missing
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Category Focus</Typography>
            <Stack spacing={1.25}>
              {topCategories.map((category) => (
                <Box key={category.name}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2">{resolveCategoryLabel(category.name)}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatCurrency(category.value)}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={summary.total_expenses > 0 ? Math.min((category.value / summary.total_expenses) * 100, 100) : 0}
                    sx={{ mt: 0.5 }}
                  />
                </Box>
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button component={Link} to="/categories" size="small" variant="outlined">Category Comparison</Button>
              <Button component={Link} to="/coverage" size="small" variant="outlined">Coverage Details</Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Stack>
  );
};
