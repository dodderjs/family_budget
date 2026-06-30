import { Card, Grid, Text } from '@mantine/core';
import React from 'react';
import { AnalyticsSummary } from '../../services/transactionService';
import { formatCurrency } from '../../utils/currency';

interface AnalyticsSummaryCardsProps {
  summary: AnalyticsSummary;
  previousSummary: AnalyticsSummary | null;
  selectedAccountCount: number;
}

const delta = (current: number, previous: number): string => {
  if (!previous) return '';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}% vs previous period`;
};

export const AnalyticsSummaryCards: React.FC<AnalyticsSummaryCardsProps> = ({
  summary,
  previousSummary,
  selectedAccountCount,
}) => (
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
    {selectedAccountCount > 1 && (
      <Grid.Col span={{ base: 12, md: 3 }}>
        <Card withBorder p="lg" c="blue">
          <Text size="xs" fw={500}>Transferred Between Selected Accounts</Text>
          <Text size="xl" fw={700}>{formatCurrency(summary.total_transferred)}</Text>
        </Card>
      </Grid.Col>
    )}
  </Grid>
);
