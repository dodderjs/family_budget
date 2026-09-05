import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import React, { useState } from 'react';
import { BreakdownEntry } from '../../services/analyticsService';
import { formatCurrency } from '../../utils/currency';

interface TopMerchantsCardProps {
  merchants: BreakdownEntry[];
  totalExpenses: number;
  maxRows?: number;
}

// Each "Show more" click steps to the next of these rather than revealing
// everything at once - the full list can run into the hundreds of merchants.
const ROW_STEPS = [8, 20, 50, 100];

export const TopMerchantsCard: React.FC<TopMerchantsCardProps> = ({
  merchants,
  totalExpenses,
  maxRows = 8,
}) => {
  const [visibleCount, setVisibleCount] = useState(maxRows);

  // Net-positive merchants are income sources (an employer, a refund), not
  // places money went - they'd otherwise dominate this list and push the
  // share of spending over 100%.
  const spendOnly = merchants.filter((m) => m.total < 0);
  const sorted = [...spendOnly].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, visibleCount);
  const largest = top.length > 0 ? top[0].value : 0;
  const topShare = totalExpenses > 0 ? (top.reduce((s, m) => s + m.value, 0) / totalExpenses) * 100 : 0;
  const nextStep = ROW_STEPS.find((step) => step > visibleCount);
  const canShowMore = sorted.length > visibleCount;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">Where the Money Goes</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {top.length > 0
            ? `Top ${top.length} merchants account for ${topShare.toFixed(0)}% of spending this period.`
            : 'No merchant data in this period.'}
        </Typography>

        <Stack spacing={1.25}>
          {top.map((merchant) => (
            <Box key={merchant.name}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" sx={{ pr: 1, wordBreak: 'break-word' }}>
                  {merchant.name}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {formatCurrency(merchant.value)}
                </Typography>
              </Stack>
              {/* Bars are scaled against the biggest merchant, not the period
                  total, so the smaller entries stay readable. */}
              <Box
                sx={{
                  mt: 0.5,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: 'action.hover',
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    width: `${largest > 0 ? Math.max((merchant.value / largest) * 100, 2) : 0}%`,
                    height: '100%',
                    borderRadius: 3,
                    backgroundColor: 'primary.main',
                  }}
                />
              </Box>
            </Box>
          ))}
        </Stack>

        {canShowMore && (
          <Button
            size="small"
            sx={{ mt: 1.5 }}
            onClick={() => setVisibleCount(nextStep || sorted.length)}
          >
            Show more ({sorted.length - visibleCount} more)
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
