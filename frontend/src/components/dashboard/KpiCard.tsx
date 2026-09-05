import { Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import React from 'react';

interface KpiCardProps {
  label: string;
  value: string;
  valueColor?: string;
  /** Percent change vs the previous period - renders a coloured delta chip.
   * Null when there's no previous-period baseline to compare against. */
  deltaPct: number | null;
  /** True when a rising value is the good direction (income) - flips which
   * way the delta chip's color points. Expenses default to false: up is bad. */
  higherIsBetter?: boolean;
  sparkline?: number[];
  sparklineColor?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  valueColor,
  deltaPct,
  higherIsBetter = false,
  sparkline,
  sparklineColor,
}) => {
  const improved = deltaPct === null ? null : higherIsBetter ? deltaPct >= 0 : deltaPct <= 0;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Stack spacing={0.25}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography variant="h5" sx={{ color: valueColor, fontWeight: 700 }}>{value}</Typography>
          </Stack>
          {sparkline && sparkline.length > 1 && (
            <SparkLineChart
              data={sparkline}
              height={36}
              width={72}
              showTooltip={false}
              showHighlight={false}
              color={sparklineColor}
            />
          )}
        </Stack>
        <Chip
          size="small"
          sx={{ mt: 1 }}
          color={improved === null ? 'default' : improved ? 'success' : 'error'}
          variant="outlined"
          label={deltaPct === null ? 'No previous-period baseline' : `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% vs previous`}
        />
      </CardContent>
    </Card>
  );
};
