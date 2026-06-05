import { Button, Card, Container, Grid, Group, Loader, Select, Stack, Text } from '@mantine/core';
import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { transactionService } from '../services/transactionService';

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1', '#d084d0', '#ffb347'];

export const AnalyticsPage: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [breakdown, setBreakdown] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>();

  const loadData = async () => {
    setLoading(true);
    try {
      const [summaryRes, breakdownRes, trendsRes] = await Promise.all([
        transactionService.getAnalyticsSummary(selectedAccount),
        transactionService.getCategoryBreakdown(selectedAccount),
        transactionService.getMonthlyTrends(selectedAccount),
      ]);

      setSummary(summaryRes.data);
      
      // Format breakdown for pie chart
      const breakdownData = Object.entries(breakdownRes.data).map(([cat, data]: any) => ({
        name: cat,
        value: Math.abs(data.total)
      }));
      setBreakdown(breakdownData);

      // Format trends for line chart
      const trendData = Object.entries(trendsRes.data).map(([month, data]: any) => ({
        month,
        income: data.income,
        expenses: data.expenses
      }));
      setTrends(trendData);
    } catch (err) {
      console.error('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedAccount]);

  useEffect(() => {
    transactionService.listAccounts().then(res => setAccounts(res.data));
  }, []);

  if (loading) {
    return <Container py="xl"><Loader /></Container>;
  }

  return (
    <Container size="xl" py="xl">
      <Stack spacing="lg">
        <div>
          <h1>Analytics Dashboard</h1>
          <p>View your financial overview and trends</p>
        </div>

        <Group>
          <Select
            placeholder="Select account"
            data={accounts.map(a => ({ value: a.id, label: a.name }))}
            value={selectedAccount}
            onChange={setSelectedAccount}
            clearable
            searchable
          />
          <Button onClick={loadData}>Refresh</Button>
        </Group>

        {summary && (
          <Grid gutter="lg">
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Card withBorder p="lg">
                <Text size="xs" fw={500}>Total Transactions</Text>
                <Text size="xl" fw={700}>{summary.total_transactions}</Text>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Card withBorder p="lg" c="green">
                <Text size="xs" fw={500}>Total Income</Text>
                <Text size="xl" fw={700}>${summary.total_income.toFixed(2)}</Text>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Card withBorder p="lg" c="red">
                <Text size="xs" fw={500}>Total Expenses</Text>
                <Text size="xl" fw={700}>${summary.total_expenses.toFixed(2)}</Text>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Card withBorder p="lg">
                <Text size="xs" fw={500}>Average Transaction</Text>
                <Text size="xl" fw={700}>${summary.average_transaction.toFixed(2)}</Text>
              </Card>
            </Grid.Col>
          </Grid>
        )}

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder p="lg">
              <Card.Section>
                <h3 style={{ margin: '0.5rem' }}>Category Breakdown</h3>
              </Card.Section>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={breakdown}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: $${value.toFixed(0)}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {breakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder p="lg">
              <Card.Section>
                <h3 style={{ margin: '0.5rem' }}>Monthly Trends</h3>
              </Card.Section>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
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
            <Card.Section>
              <h3 style={{ margin: '0.5rem' }}>Income vs Expenses Over Time</h3>
            </Card.Section>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trends} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
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
