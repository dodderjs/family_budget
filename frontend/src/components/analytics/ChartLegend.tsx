import { Box, Stack, Typography } from '@mui/material';
import React from 'react';
import { withAlpha } from './analyticsChartsHelpers';

const DESELECTED_COLOR = '#9e9e9e';

export interface ChartLegendEntry {
  id: string;
  label: string;
  color: string;
  /** Null for a rolled-up "Other Income"/"Other Expenses" bucket - shown, but
   * not clickable, since it isn't one real category to filter by. */
  categoryKey: string | null;
}

interface ChartLegendProps {
  entries: ChartLegendEntry[];
  activeCategoryKeys: string[];
  hasPrevious: boolean;
  onEntryClick?: (event: React.MouseEvent, categoryKey: string) => void;
}

/** One entry per category instead of x-charts' default legend, which lists
 * the current and previous-period series separately - up to 8 income + 8
 * expense categories x2 periods otherwise. Previous period is represented by
 * a second, faded swatch next to the same label rather than its own entry. */
export const ChartLegend: React.FC<ChartLegendProps> = ({ entries, activeCategoryKeys, hasPrevious, onEntryClick }) => {
  if (entries.length === 0) return null;

  return (
    <Stack spacing={0.5} sx={{ mt: 1 }}>
      {hasPrevious && (
        <Typography variant="caption" color="text.secondary">
          Solid = this period, faded = previous period
        </Typography>
      )}
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {entries.map((entry) => {
          const clickable = !!entry.categoryKey && !!onEntryClick;
          const active = entry.categoryKey ? activeCategoryKeys.includes(entry.categoryKey) : false;
          // A filter is active and this entry isn't part of it - still fully
          // legible (the whole point is being able to read every label and
          // pick more), just recolored grey rather than faded/washed out.
          const deselected = activeCategoryKeys.length > 0 && !active;
          const swatchColor = deselected ? DESELECTED_COLOR : entry.color;
          return (
            <Box
              key={entry.id}
              onClick={(event) => clickable && onEntryClick!(event, entry.categoryKey!)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                cursor: clickable ? 'pointer' : 'default',
                borderRadius: 1,
                px: 0.5,
                '&:hover': clickable ? { bgcolor: 'action.hover' } : undefined,
              }}
            >
              <Box sx={{ display: 'flex', width: hasPrevious ? 18 : 10, height: 10 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: swatchColor }} />
                {hasPrevious && (
                  <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: withAlpha(swatchColor, 0.35), ml: '-2px' }} />
                )}
              </Box>
              <Typography variant="caption" sx={{ fontWeight: active ? 700 : 400, color: deselected ? 'text.disabled' : 'text.primary' }}>
                {entry.label}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
};
