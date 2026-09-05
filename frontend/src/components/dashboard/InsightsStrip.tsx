import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import React from 'react';
import { Insight } from './insightHelpers';

const TONE_COLOR: Record<Insight['tone'], string> = {
  positive: 'success.main',
  negative: 'error.main',
  neutral: 'text.primary',
};

interface InsightsStripProps {
  insights: Insight[];
  maxItems?: number;
}

/** The dashboard's lead insights - generated statements ranked by how much
 * they deserve attention, shown above the charts rather than after them. */
export const InsightsStrip: React.FC<InsightsStripProps> = ({ insights, maxItems = 4 }) => {
  const shown = insights.slice(0, maxItems);
  if (shown.length === 0) return null;

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: `repeat(${shown.length}, minmax(0, 1fr))`,
        },
      }}
    >
      {shown.map((insight) => (
        <Card key={insight.id} variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <Box
                sx={{
                  mt: 0.6,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  bgcolor: TONE_COLOR[insight.tone],
                }}
              />
              <Typography variant="body2">{insight.text}</Typography>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
};
