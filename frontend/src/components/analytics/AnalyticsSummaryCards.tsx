import { Box, Card, CardContent, Typography } from '@mui/material';
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
}) => {
  const cards = [
    {
      title: 'Total Transactions',
      value: String(summary.total_transactions),
      deltaText: previousSummary ? delta(summary.total_transactions, previousSummary.total_transactions) : null,
      valueColor: 'text.primary',
    },
    {
      title: 'Total Income',
      value: formatCurrency(summary.total_income),
      deltaText: previousSummary ? delta(summary.total_income, previousSummary.total_income) : null,
      valueColor: 'success.main',
    },
    {
      title: 'Total Expenses',
      value: formatCurrency(summary.total_expenses),
      deltaText: previousSummary ? delta(summary.total_expenses, previousSummary.total_expenses) : null,
      valueColor: 'error.main',
    },
    {
      title: 'Average Transaction',
      value: formatCurrency(summary.average_transaction),
      deltaText: previousSummary ? delta(summary.average_transaction, previousSummary.average_transaction) : null,
      valueColor: 'text.primary',
    },
  ];

  if (selectedAccountCount > 1) {
    cards.push({
      title: 'Transferred Between Selected Accounts',
      value: formatCurrency(summary.total_transferred),
      deltaText: null,
      valueColor: 'primary.main',
    });
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: '1fr',
          md: 'repeat(4, minmax(0, 1fr))',
        },
      }}
    >
      {cards.map((card) => (
        <Card key={card.title} variant="outlined">
          <CardContent>
            <Typography variant="caption" sx={{ fontWeight: 500 }}>
              {card.title}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, color: card.valueColor }}>
              {card.value}
            </Typography>
            {card.deltaText && (
              <Typography variant="caption" color="text.secondary">
                {card.deltaText}
              </Typography>
            )}
          </CardContent>
        </Card>
      ))}
    </Box>
  );
};
