import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { RecurringCharge } from '../../services/transactionService';
import { formatCurrency } from '../../utils/currency';

interface RecurringChargesCardProps {
  charges: RecurringCharge[];
  /** Latest transaction date in the data, used to flag charges that have
   * stopped appearing (a cancelled or lapsed subscription). */
  latestDataDate?: string | null;
  maxRows?: number;
}

/** A charge whose last hit is more than ~2 months before the newest data is
 * probably no longer active - worth showing, but not counted as committed
 * future spend. */
const STALE_AFTER_DAYS = 70;

const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);

export const RecurringChargesCard: React.FC<RecurringChargesCardProps> = ({
  charges,
  latestDataDate,
  maxRows = 10,
}) => {
  const withStatus = charges.map((charge) => {
    const stale =
      !!latestDataDate && !!charge.last_date && daysBetween(charge.last_date, latestDataDate) > STALE_AFTER_DAYS;
    return { ...charge, stale };
  });

  const active = withStatus.filter((c) => !c.stale);
  const committedPerYear = active.reduce((sum, c) => sum + c.annualized_amount, 0);
  const rows = withStatus.slice(0, maxRows);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          useFlexGap
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'baseline' }, mb: 0.5 }}
        >
          <Typography variant="h6">Recurring &amp; Subscription-like Charges</Typography>
          {active.length > 0 && (
            <Typography variant="body2" sx={{ fontWeight: 700, color: 'warning.main' }}>
              ≈ {formatCurrency(committedPerYear)}/year committed
            </Typography>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Merchants billing about once a month for a steady amount, over the last 12 months of data.
          The clearest place to look for cancellable spend.
        </Typography>

        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No recurring pattern found yet — this needs at least three months of history per merchant.
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Merchant</TableCell>
                  <TableCell align="right">Typical</TableCell>
                  <TableCell align="right">Per year</TableCell>
                  <TableCell align="right">Seen</TableCell>
                  <TableCell>Last charge</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((charge) => (
                  <TableRow key={charge.merchant}>
                    <TableCell>
                      <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="body2">{charge.merchant}</Typography>
                        {charge.stale && (
                          <Tooltip title="No charge in the last ~2 months of data — possibly already cancelled">
                            <Chip size="small" variant="outlined" label="lapsed?" />
                          </Tooltip>
                        )}
                        {charge.amount_spread === 0 && !charge.stale && (
                          <Tooltip title="Every charge was exactly the same amount">
                            <Chip size="small" variant="outlined" color="info" label="fixed" />
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">{formatCurrency(charge.average_amount)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      {formatCurrency(charge.annualized_amount)}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.secondary">
                        {charge.months_active} mo
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {charge.last_date || '-'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};
