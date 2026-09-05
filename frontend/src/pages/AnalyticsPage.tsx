import { Alert, Box, Button, Card, CardContent, CircularProgress, Container, Stack, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { AnalyticsCharts } from '../components/analytics/AnalyticsCharts';
import { AnalyticsSummaryCards } from '../components/analytics/AnalyticsSummaryCards';
import { AnalyticsToolbar } from '../components/analytics/AnalyticsToolbar';
import { FilterBar } from '../components/FilterBar';
import { analyticsService, BreakdownEntry, TrendEntry } from '../services/analyticsService';
import { AnalyticsSummary, BreakdownGroupBy, CategoryLevel, StackedMonthlyTrends } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';
import { downloadCsvFile } from '../utils/csvExport';
import { accountIdParam, resolveDateRange } from '../utils/dateRange';

export const AnalyticsPage: React.FC = () => {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [previousSummary, setPreviousSummary] = useState<AnalyticsSummary | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownEntry[]>([]);
  const [trends, setTrends] = useState<TrendEntry[]>([]);
  const [previousTrends, setPreviousTrends] = useState<TrendEntry[]>([]);
  const [stackedTrends, setStackedTrends] = useState<StackedMonthlyTrends>({});
  const [previousStackedTrends, setPreviousStackedTrends] = useState<StackedMonthlyTrends | null>(null);
  const [availableMerchants, setAvailableMerchants] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [groupBy, setGroupBy] = useState<BreakdownGroupBy>('category');
  const [categoryLevel, setCategoryLevel] = useState<CategoryLevel>('leaf');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedMerchants, setSelectedMerchants] = useState<string[]>([]);
  const [compare, setCompare] = useState(false);

  const selectedAccountIds = useTransactionStore((s) => s.selectedAccountIds);
  const categories = useTransactionStore((s) => s.categories);
  const datePreset = useTransactionStore((s) => s.datePreset);
  const customDateFrom = useTransactionStore((s) => s.customDateFrom);
  const customDateTo = useTransactionStore((s) => s.customDateTo);
  const setError = useTransactionStore((s) => s.setError);

  const range = resolveDateRange(datePreset, customDateFrom, customDateTo);
  const accountId = accountIdParam(selectedAccountIds);

  const categoryKeys = selectedCategories.length > 0 ? selectedCategories.join(',') : undefined;
  const merchantNames = selectedMerchants.length > 0 ? selectedMerchants.join(',') : undefined;
  const topCategory = breakdown.length > 0 ? [...breakdown].sort((a, b) => b.value - a.value)[0] : null;
  const comparisonEnabled = !!range.from && !!range.to;
  const expenseDelta = previousSummary
    ? `${(((summary?.total_expenses || 0) - previousSummary.total_expenses) / Math.abs(previousSummary.total_expenses || 1) * 100).toFixed(1)}%`
    : null;
  const incomeDelta = previousSummary
    ? `${((((summary?.total_income || 0) - previousSummary.total_income) / Math.abs(previousSummary.total_income || 1)) * 100).toFixed(1)}%`
    : null;

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await analyticsService.loadDashboardData({
        accountId,
        range,
        groupBy,
        categoryLevel,
        categoryKeys,
        merchantNames,
        compare,
        includeMerchants: true,
      });
      setSummary(data.summary);
      setBreakdown(data.breakdown);
      setTrends(data.trends);
      setPreviousTrends(data.previousTrends);
      setStackedTrends(data.stackedTrends);
      setPreviousStackedTrends(data.previousStackedTrends);
      setAvailableMerchants(data.availableMerchants);
      setPreviousSummary(data.previousSummary);
    } catch (err: any) {
      setError(err.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, range.from, range.to, groupBy, categoryLevel, categoryKeys, merchantNames, compare]);

  if (loading && !summary) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <CircularProgress size={28} />
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack spacing={3}>

        <FilterBar />

        {!comparisonEnabled && (
          <Alert severity="info">
            Choose a bounded period to unlock previous-period comparison insights.
          </Alert>
        )}

        <AnalyticsToolbar
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          categoryLevel={categoryLevel}
          onCategoryLevelChange={setCategoryLevel}
          availableCategories={categories}
          selectedCategories={selectedCategories}
          onCategoriesChange={setSelectedCategories}
          availableMerchants={availableMerchants}
          selectedMerchants={selectedMerchants}
          onMerchantsChange={setSelectedMerchants}
          compare={compare}
          onCompareChange={setCompare}
          compareEnabled={comparisonEnabled}
          loading={loading}
          onRefresh={loadData}
          onExportBreakdown={() =>
            downloadCsvFile(
              `breakdown-${new Date().toISOString().slice(0, 10)}.csv`,
              [groupBy, 'total'],
              breakdown.map((b) => [b.name, b.value])
            )
          }
          onExportTrends={() =>
            downloadCsvFile(
              `trends-${new Date().toISOString().slice(0, 10)}.csv`,
              ['month', 'income', 'expenses'],
              trends.map((t) => [t.month, t.income, t.expenses])
            )
          }
          hasBreakdown={breakdown.length > 0}
          hasTrends={trends.length > 0}
        />

        {summary && (
          <>
            <AnalyticsSummaryCards
              summary={summary}
              previousSummary={previousSummary}
              selectedAccountCount={selectedAccountIds.length}
            />

            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: {
                  xs: '1fr',
                  md: 'repeat(3, minmax(0, 1fr))',
                },
              }}
            >
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="overline" color="text.secondary">Leading category</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {topCategory?.name || 'No category data'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {topCategory ? `${topCategory.value.toLocaleString()} in selected range` : 'Upload and categorize transactions to populate this view.'}
                  </Typography>
                </CardContent>
              </Card>

              <Card variant="outlined">
                <CardContent>
                  <Typography variant="overline" color="text.secondary">Expense comparison</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'error.main' }}>
                    {expenseDelta ? `${expenseDelta} vs previous` : 'Comparison unavailable'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {previousSummary ? 'Based on the previous period with matching duration.' : 'Set a custom or bounded date range and enable compare.'}
                  </Typography>
                </CardContent>
              </Card>

              <Card variant="outlined">
                <CardContent>
                  <Typography variant="overline" color="text.secondary">Income comparison</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'success.main' }}>
                    {incomeDelta ? `${incomeDelta} vs previous` : 'Comparison unavailable'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedAccountIds.length > 0 ? `${selectedAccountIds.length} filtered account(s)` : 'All accounts included in the comparison.'}
                  </Typography>
                </CardContent>
              </Card>
            </Box>
          </>
        )}

        <AnalyticsCharts
          breakdown={breakdown}
          trends={trends}
          previousTrends={previousTrends}
          stackedTrends={stackedTrends}
          previousStackedTrends={previousStackedTrends}
          groupBy={groupBy}
          categoryLevel={categoryLevel}
          onCategoryFilterChange={setSelectedCategories}
          activeCategoryKeys={selectedCategories}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button variant="outlined" onClick={() => setGroupBy('category')}>Focus categories</Button>
          <Button variant="outlined" onClick={() => setGroupBy('merchant')}>Compare merchants</Button>
          <Button variant="outlined" onClick={() => setGroupBy('account')}>Compare accounts</Button>
        </Stack>
      </Stack>
    </Container>
  );
};
