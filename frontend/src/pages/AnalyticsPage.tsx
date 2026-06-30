import { Container, Loader, Stack, Text, Title } from '@mantine/core';
import React, { useEffect, useState } from 'react';
import { AnalyticsCharts } from '../components/analytics/AnalyticsCharts';
import { AnalyticsSummaryCards } from '../components/analytics/AnalyticsSummaryCards';
import { AnalyticsToolbar } from '../components/analytics/AnalyticsToolbar';
import { FilterBar } from '../components/FilterBar';
import { analyticsService, BreakdownEntry, TrendEntry } from '../services/analyticsService';
import { AnalyticsSummary, BreakdownGroupBy } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';
import { downloadCsvFile } from '../utils/csvExport';
import { accountIdParam, resolveDateRange } from '../utils/dateRange';

export const AnalyticsPage: React.FC = () => {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [previousSummary, setPreviousSummary] = useState<AnalyticsSummary | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownEntry[]>([]);
  const [trends, setTrends] = useState<TrendEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [groupBy, setGroupBy] = useState<BreakdownGroupBy>('category');
  const [compare, setCompare] = useState(false);

  const selectedAccountIds = useTransactionStore((s) => s.selectedAccountIds);
  const datePreset = useTransactionStore((s) => s.datePreset);
  const customDateFrom = useTransactionStore((s) => s.customDateFrom);
  const customDateTo = useTransactionStore((s) => s.customDateTo);
  const setError = useTransactionStore((s) => s.setError);

  const range = resolveDateRange(datePreset, customDateFrom, customDateTo);
  const accountId = accountIdParam(selectedAccountIds);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await analyticsService.loadDashboardData({
        accountId,
        range,
        groupBy,
        compare,
      });
      setSummary(data.summary);
      setBreakdown(data.breakdown);
      setTrends(data.trends);
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
  }, [accountId, range.from, range.to, groupBy, compare]);

  if (loading && !summary) {
    return <Container py="xl"><Loader /></Container>;
  }

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <div>
          <Title order={1}>Analytics Dashboard</Title>
          <Text c="dimmed">View your financial overview and trends</Text>
        </div>

        <FilterBar />

        <AnalyticsToolbar
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          compare={compare}
          onCompareChange={setCompare}
          compareEnabled={!!range.from && !!range.to}
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
          <AnalyticsSummaryCards
            summary={summary}
            previousSummary={previousSummary}
            selectedAccountCount={selectedAccountIds.length}
          />
        )}

        <AnalyticsCharts breakdown={breakdown} trends={trends} groupBy={groupBy} />
      </Stack>
    </Container>
  );
};
