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
import { RecurringChargesCard } from '../components/dashboard/RecurringChargesCard';
import { SpendingInsightCards } from '../components/dashboard/SpendingInsightCards';
import { TopMerchantsCard } from '../components/dashboard/TopMerchantsCard';
import { TransfersCard } from '../components/dashboard/TransfersCard';
import { FilterBar } from '../components/FilterBar';
import { dashboardService } from '../services/dashboardService';
import { useTransactionStore } from '../store/transactionStore';
import { formatCurrency } from '../utils/currency';
import { accountIdParam, resolveDateRange } from '../utils/dateRange';

const deltaText = (current: number, previous: number): string => {
  if (!previous) return 'No previous-period baseline';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}% vs previous period`;
};

export const DashboardHomePage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardService.loadHomeData>> | null>(null);

  const selectedAccountIds = useTransactionStore((s) => s.selectedAccountIds);
  const datePreset = useTransactionStore((s) => s.datePreset);
  const customDateFrom = useTransactionStore((s) => s.customDateFrom);
  const customDateTo = useTransactionStore((s) => s.customDateTo);
  // The dashboard has no category picker of its own - this only exists so a
  // Monthly Trends legend click can filter the page, and is shown/cleared via
  // the chip row below FilterBar so the filter is never silent.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const range = resolveDateRange(datePreset, customDateFrom, customDateTo);
  const accountId = accountIdParam(selectedAccountIds);
  const categoryKeys = selectedCategories.length > 0 ? selectedCategories.join(',') : undefined;

  const handleLegendCategoryToggle = (categoryKey: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryKey) ? prev.filter((k) => k !== categoryKey) : [...prev, categoryKey]
    );
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
      const response = await dashboardService.loadHomeData({ accountId, range, categoryKeys });
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
  }, [accountId, range.from, range.to, categoryKeys]);

  const topCategories = useMemo(() => {
    if (!data) return [];
    return [...data.analytics.breakdown].sort((a, b) => b.value - a.value).slice(0, 6);
  }, [data]);

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
  const expenseDelta = previousSummary ? deltaText(summary.total_expenses, previousSummary.total_expenses) : 'Enable period compare from filters';
  const incomeDelta = previousSummary ? deltaText(summary.total_income, previousSummary.total_income) : 'Enable period compare from filters';

  const coverageTotalMonths =
    data.totals.coverageMonths.covered +
    data.totals.coverageMonths.gap +
    data.totals.coverageMonths.missing +
    data.totals.coverageMonths.dismissed;
  const coverageScore = coverageTotalMonths > 0
    ? ((data.totals.coverageMonths.covered + data.totals.coverageMonths.dismissed) / coverageTotalMonths) * 100
    : 0;

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' } }}>
        <Button variant="contained" onClick={loadData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Stack>

      {error && <Alert severity="warning">{error}</Alert>}

      <FilterBar />

      {selectedCategories.length > 0 && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">Filtered by category:</Typography>
          {selectedCategories.map((key) => (
            <Chip key={key} size="small" label={key} onDelete={() => handleLegendCategoryToggle(key)} />
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
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">Expenses (Current Period)</Typography>
            <Typography variant="h5" sx={{ color: 'error.main', fontWeight: 700 }}>{formatCurrency(summary.total_expenses)}</Typography>
            <Typography variant="body2" color="text.secondary">{expenseDelta}</Typography>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">Income (Current Period)</Typography>
            <Typography variant="h5" sx={{ color: 'success.main', fontWeight: 700 }}>{formatCurrency(summary.total_income)}</Typography>
            <Typography variant="body2" color="text.secondary">{incomeDelta}</Typography>
          </CardContent>
        </Card>
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

      <AnalyticsCharts
        breakdown={data.analytics.breakdown}
        trends={data.analytics.trends}
        previousTrends={data.analytics.previousTrends}
        stackedTrends={data.analytics.stackedTrends}
        previousStackedTrends={data.analytics.previousStackedTrends}
        groupBy="category"
        onCategoryFilterChange={setSelectedCategories}
        activeCategoryKeys={selectedCategories}
      />

      <SpendingInsightCards
        stackedTrends={data.analytics.stackedTrends}
        totalIncome={summary.total_income}
        totalExpenses={summary.total_expenses}
        breakdown={data.analytics.breakdown}
        recurring={data.recurring}
        transferTotal={data.transfers.total_amount}
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
        />
        <TopMerchantsCard
          merchants={data.analytics.merchantBreakdown}
          totalExpenses={summary.total_expenses}
        />
      </Box>

      <RecurringChargesCard charges={data.recurring} latestDataDate={latestDataDate} />

      <TransfersCard transfers={data.transfers} />

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
                    <Typography variant="body2">{category.name}</Typography>
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
