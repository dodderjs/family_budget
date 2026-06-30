import { Card, Grid, Title } from '@mantine/core';
import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BreakdownEntry, TrendEntry } from '../../services/analyticsService';
import { BreakdownGroupBy } from '../../services/transactionService';
import { formatCurrency } from '../../utils/currency';

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1', '#d084d0', '#ffb347'];
const CHART_GRID_COLOR = 'var(--mantine-color-dark-4)';
const CHART_TEXT_COLOR = 'var(--mantine-color-dimmed)';
const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'var(--mantine-color-body)',
  border: '1px solid var(--mantine-color-default-border)',
  borderRadius: 'var(--mantine-radius-sm)',
};

const GROUP_BY_LABEL: Record<BreakdownGroupBy, string> = {
  category: 'Category',
  merchant: 'Merchant',
  account: 'Account',
};

interface AnalyticsChartsProps {
  breakdown: BreakdownEntry[];
  trends: TrendEntry[];
  groupBy: BreakdownGroupBy;
}

export const AnalyticsCharts: React.FC<AnalyticsChartsProps> = ({ breakdown, trends, groupBy }) => (
  <>
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Card withBorder p="lg">
          <Card.Section inheritPadding py="xs">
            <Title order={4}>Breakdown by {GROUP_BY_LABEL[groupBy]}</Title>
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
  </>
);
