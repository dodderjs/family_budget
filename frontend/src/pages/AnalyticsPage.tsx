import { Button, Card, Container, Grid, Group, Loader, Select, Stack, Switch, Text, Title } from '@mantine/core';
import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FilterBar } from '../components/FilterBar';
import { AnalyticsSummary, BreakdownGroupBy, transactionService } from '../services/transactionService';
import { accountIdParam, previousPeriod, resolveDateRange, useTransactionStore } from '../store/transactionStore';
import { formatCurrency } from '../utils/currency';

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1', '#d084d0', '#ffb347'];
const CHART_GRID_COLOR = 'var(--mantine-color-dark-4)';
const CHART_TEXT_COLOR = 'var(--mantine-color-dimmed)';
const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'var(--mantine-color-body)',
  border: '1px solid var(--mantine-color-default-border)',
  borderRadius: 'var(--mantine-radius-sm)',
};

const GROUP_BY_OPTIONS: { value: BreakdownGroupBy; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'merchant', label: 'Merchant' },
  { value: 'account', label: 'Account' },
];

interface BreakdownEntry {
  name: string;
  value: number;
}

interface TrendEntry {
  month: string;
  income: number;
  expenses: number;
}

const downloadCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
  const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

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
      const [summaryRes, breakdownRes, trendsRes] = await Promise.all([
        transactionService.getAnalyticsSummary(accountId, range.from, range.to),
        transactionService.getCategoryBreakdown(accountId, range.from, range.to, groupBy),
        transactionService.getMonthlyTrends(accountId, range.from, range.to),
      ]);

      setSummary(summaryRes.data);

      const breakdownData = Object.entries(breakdownRes.data).map(([key, data]) => ({
        name: key,
        value: Math.abs(data.total)
      }));
      setBreakdown(breakdownData);

      const trendData = Object.entries(trendsRes.data).map(([month, data]) => ({
        month,
        income: data.income,
        expenses: data.expenses
      }));
      setTrends(trendData);

      if (compare && range.from && range.to) {
        const prev = previousPeriod(range);
        const prevSummaryRes = await transactionService.getAnalyticsSummary(accountId, prev.from, prev.to);
        setPreviousSummary(prevSummaryRes.data);
      } else {
        setPreviousSummary(null);
      }
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

  const delta = (current: number, previous: number): string => {
    if (!previous) return '';
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(0)}% vs previous period`;
  };

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

        <Group>
          <Select
            label="Breakdown by"
            data={GROUP_BY_OPTIONS}
            value={groupBy}
            onChange={(val) => setGroupBy((val as BreakdownGroupBy) || 'category')}
            allowDeselect={false}
            w={160}
          />
          <Switch
            label="Compare to previous period"
            checked={compare}
            onChange={(e) => setCompare(e.currentTarget.checked)}
            disabled={!range.from || !range.to}
            mt={24}
          />
          <Button onClick={loadData} loading={loading} mt={24}>Refresh</Button>
          <Button
            onClick={() => downloadCsv(
              `breakdown-${new Date().toISOString().slice(0, 10)}.csv`,
              [groupBy, 'total'],
              breakdown.map((b) => [b.name, b.value])
            )}
            variant="default"
            disabled={!breakdown.length}
            mt={24}
          >
            Export Breakdown CSV
          </Button>
          <Button
            onClick={() => downloadCsv(
              `trends-${new Date().toISOString().slice(0, 10)}.csv`,
              ['month', 'income', 'expenses'],
              trends.map((t) => [t.month, t.income, t.expenses])
            )}
            variant="default"
            disabled={!trends.length}
            mt={24}
          >
            Export Trends CSV
          </Button>
        </Group>

        {summary && (
          <Grid gutter="lg">
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Card withBorder p="lg">
                <Text size="xs" fw={500}>Total Transactions</Text>
                <Text size="xl" fw={700}>{summary.total_transactions}</Text>
                {previousSummary && (
                  <Text size="xs" c="dimmed">{delta(summary.total_transactions, previousSummary.total_transactions)}</Text>
                )}
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Card withBorder p="lg" c="green">
                <Text size="xs" fw={500}>Total Income</Text>
                <Text size="xl" fw={700}>{formatCurrency(summary.total_income)}</Text>
                {previousSummary && (
                  <Text size="xs" c="dimmed">{delta(summary.total_income, previousSummary.total_income)}</Text>
                )}
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Card withBorder p="lg" c="red">
                <Text size="xs" fw={500}>Total Expenses</Text>
                <Text size="xl" fw={700}>{formatCurrency(summary.total_expenses)}</Text>
                {previousSummary && (
                  <Text size="xs" c="dimmed">{delta(summary.total_expenses, previousSummary.total_expenses)}</Text>
                )}
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Card withBorder p="lg">
                <Text size="xs" fw={500}>Average Transaction</Text>
                <Text size="xl" fw={700}>{formatCurrency(summary.average_transaction)}</Text>
                {previousSummary && (
                  <Text size="xs" c="dimmed">{delta(summary.average_transaction, previousSummary.average_transaction)}</Text>
                )}
              </Card>
            </Grid.Col>
            {selectedAccountIds.length > 1 && (
              <Grid.Col span={{ base: 12, md: 3 }}>
                <Card withBorder p="lg" c="blue">
                  <Text size="xs" fw={500}>Transferred Between Selected Accounts</Text>
                  <Text size="xl" fw={700}>{formatCurrency(summary.total_transferred)}</Text>
                </Card>
              </Grid.Col>
            )}
          </Grid>
        )}

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder p="lg">
              <Card.Section inheritPadding py="xs">
                <Title order={4}>Breakdown by {GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label}</Title>
              </Card.Section>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={breakdown}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${formatCurrency(value)}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {breakdown.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder p="lg">
              <Card.Section inheritPadding py="xs">
                <Title order={4}>Monthly Trends</Title>
              </Card.Section>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
                  <XAxis dataKey="month" stroke={CHART_TEXT_COLOR} />
                  <YAxis stroke={CHART_TEXT_COLOR} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Legend />
                  <Bar dataKey="income" fill="#82ca9d" />
                  <Bar dataKey="expenses" fill="#ff7c7c" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Grid.Col>
        </Grid>

        {trends.length > 0 && (
          <Card withBorder p="lg">
            <Card.Section inheritPadding py="xs">
              <Title order={4}>Income vs Expenses Over Time</Title>
            </Card.Section>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trends} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
                <XAxis dataKey="month" stroke={CHART_TEXT_COLOR} />
                <YAxis stroke={CHART_TEXT_COLOR} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend />
                <Line type="monotone" dataKey="income" stroke="#82ca9d" />
                <Line type="monotone" dataKey="expenses" stroke="#ff7c7c" />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}
      </Stack>
    </Container>
  );
};
