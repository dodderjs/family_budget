import { Box, Card, CardContent, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import React from 'react';
import { StackedMonthlyTrends } from '../../services/transactionService';
import { formatCurrency } from '../../utils/currency';
import { buildCategoryMomentum } from './insightHelpers';

interface CategoryMomentumCardProps {
  stackedTrends: StackedMonthlyTrends;
  maxRows?: number;
  onCategoryClick?: (category: string) => void;
  /** Displayed label for a category key - stackedTrends carries a parent's
   * *key* at category_level=parent (see _build_parent_category_lookup), so it
   * round-trips through onCategoryClick's filter; this resolves it to a label
   * for display. Identity by default. */
  resolveLabel?: (category: string) => string;
}

const formatRatio = (ratio: number | null): string => {
  if (ratio === null) return 'new';
  const pct = ratio * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
};

export const CategoryMomentumCard: React.FC<CategoryMomentumCardProps> = ({
  stackedTrends,
  maxRows = 6,
  onCategoryClick,
  resolveLabel = (category) => category,
}) => {
  const momentum = buildCategoryMomentum(stackedTrends);
  const months = Object.keys(stackedTrends).sort();
  const latestMonth = months[months.length - 1];

  const risers = momentum.filter((m) => m.delta > 0).slice(0, maxRows);
  const fallers = momentum.filter((m) => m.delta < 0).slice(-maxRows).reverse();
  const worstDelta = risers.length > 0 ? risers[0].delta : 0;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">What Changed Last Month</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {months.length < 2
            ? 'Needs at least two months in the selected period.'
            : `${latestMonth} against each category's own average over the ${months.length - 1} month${months.length - 1 === 1 ? '' : 's'} before it.`}
        </Typography>

        {months.length < 2 ? (
          <Typography variant="body2" color="text.secondary">
            Widen the period filter above to compare months.
          </Typography>
        ) : (
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'error.main', mb: 1 }}>
                Spending more than usual
              </Typography>
              {risers.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nothing rose against its average — a good month.
                </Typography>
              ) : (
                <Stack spacing={1.25}>
                  {risers.map((row) => (
                    <Box
                      key={row.category}
                      onClick={onCategoryClick ? () => onCategoryClick(row.category) : undefined}
                      sx={{ cursor: onCategoryClick ? 'pointer' : 'default' }}
                    >
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Typography variant="body2">{resolveLabel(row.category)}</Typography>
                          <Chip size="small" color="error" variant="outlined" label={formatRatio(row.deltaRatio)} />
                        </Stack>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          +{formatCurrency(row.delta)}
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        color="error"
                        value={worstDelta > 0 ? Math.min((row.delta / worstDelta) * 100, 100) : 0}
                        sx={{ mt: 0.5 }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {formatCurrency(row.latest)} this month vs {formatCurrency(row.baseline)} typical
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>

            {fallers.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'success.main', mb: 1 }}>
                  Spending less than usual
                </Typography>
                <Stack spacing={0.75}>
                  {fallers.map((row) => (
                    <Stack
                      key={row.category}
                      direction="row"
                      sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Typography variant="body2" color="text.secondary">{resolveLabel(row.category)}</Typography>
                      <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 600 }}>
                        {formatCurrency(row.delta)}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};
