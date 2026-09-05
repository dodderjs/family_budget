import { Box, Card, CardContent, LinearProgress, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { RecurringCharge, StackedMonthlyTrends } from '../../services/transactionService';
import { formatCurrency } from '../../utils/currency';
import { buildSpendingSummary } from './insightHelpers';

interface SpendingInsightCardsProps {
  stackedTrends: StackedMonthlyTrends;
  totalIncome: number;
  totalExpenses: number;
  breakdown: Array<{ name: string; value: number }>;
  recurring: RecurringCharge[];
  transferTotal: number;
}

const InsightCard: React.FC<{
  label: string;
  value: string;
  hint: string;
  tooltip?: string;
  valueColor?: string;
  progress?: number;
}> = ({ label, value, hint, tooltip, valueColor, progress }) => {
  const body = (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 700, color: valueColor }}>{value}</Typography>
        {progress !== undefined && (
          <LinearProgress
            variant="determinate"
            value={Math.max(0, Math.min(progress, 100))}
            sx={{ mt: 1, mb: 1 }}
          />
        )}
        <Typography variant="body2" color="text.secondary">{hint}</Typography>
      </CardContent>
    </Card>
  );
  return tooltip ? <Tooltip title={tooltip}>{body}</Tooltip> : body;
};

export const SpendingInsightCards: React.FC<SpendingInsightCardsProps> = ({
  stackedTrends,
  totalIncome,
  totalExpenses,
  breakdown,
  recurring,
  transferTotal,
}) => {
  const summary = buildSpendingSummary(stackedTrends, totalIncome, totalExpenses, breakdown);
  const recurringPerYear = recurring.reduce((sum, c) => sum + c.annualized_amount, 0);
  const recurringPerMonth = recurringPerYear / 12;
  const recurringShare =
    summary.monthlyAverageSpend > 0 ? (recurringPerMonth / summary.monthlyAverageSpend) * 100 : 0;

  return (
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
      <InsightCard
        label="Savings Rate"
        value={summary.savingsRate === null ? 'n/a' : `${(summary.savingsRate * 100).toFixed(0)}%`}
        valueColor={
          summary.savingsRate === null ? undefined : summary.savingsRate >= 0 ? 'success.main' : 'error.main'
        }
        progress={summary.savingsRate === null ? undefined : summary.savingsRate * 100}
        hint={
          summary.savingsRate === null
            ? 'No income recorded in this period'
            : `${formatCurrency(totalIncome - totalExpenses)} kept of ${formatCurrency(totalIncome)}`
        }
        tooltip="Share of income left over after expenses in the selected period. Transfers between your own accounts are excluded."
      />
      <InsightCard
        label="Average Monthly Spend"
        value={formatCurrency(summary.monthlyAverageSpend)}
        hint={
          summary.monthCount > 0
            ? `Across ${summary.monthCount} month${summary.monthCount === 1 ? '' : 's'} of activity`
            : 'No activity in this period'
        }
        tooltip="Total expenses divided by the number of months that actually had transactions."
      />
      <InsightCard
        label="Committed to Subscriptions"
        value={formatCurrency(recurringPerMonth)}
        valueColor="warning.main"
        hint={
          recurring.length > 0
            ? `${recurring.length} recurring charge${recurring.length === 1 ? '' : 's'} · ${recurringShare.toFixed(0)}% of monthly spend`
            : 'No recurring charges detected'
        }
        tooltip="Monthly cost of merchants that bill on a roughly monthly cadence, from the last 12 months of data. Independent of the period filter."
      />
      <InsightCard
        label="Biggest Category"
        value={summary.biggestCategory ? formatCurrency(summary.biggestCategory.value) : '-'}
        hint={
          summary.biggestCategory
            ? `${summary.biggestCategory.name} · ${formatCurrency(transferTotal)} moved between accounts`
            : 'No categorized spend yet'
        }
        tooltip="Largest single spending category in the selected period."
      />
    </Box>
  );
};
