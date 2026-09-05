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
import { BarChart } from '@mui/x-charts/BarChart';
import React from 'react';
import { TransferAnalytics } from '../../services/transactionService';
import { formatCurrency } from '../../utils/currency';

interface TransfersCardProps {
  transfers: TransferAnalytics;
  maxFlows?: number;
  /** Every month in the selected period (see enumerateMonths) - without this
   * the chart only shows months that actually had a transfer, which for a
   * quiet period can collapse to a single bar. Falls back to the months
   * transfers.monthly actually has when not given (e.g. the 'all' preset). */
  months?: string[];
}

const TRANSFER_COLOR = '#8b5cf6';

export const TransfersCard: React.FC<TransfersCardProps> = ({ transfers, maxFlows = 8, months: monthsAxis }) => {
  const months = monthsAxis && monthsAxis.length > 0 ? monthsAxis : Object.keys(transfers.monthly).sort();
  const amounts = months.map((m) => transfers.monthly[m]?.amount || 0);
  const flows = transfers.flows.slice(0, maxFlows);
  const busiestMonth = months.reduce<{ month: string; amount: number } | null>((best, m) => {
    const amount = transfers.monthly[m]?.amount || 0;
    return !best || amount > best.amount ? { month: m, amount } : best;
  }, null);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          useFlexGap
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'baseline' }, mb: 0.5 }}
        >
          <Typography variant="h6">Transfers Between Your Accounts</Typography>
          <Typography variant="body2" color="text.secondary">
            {formatCurrency(transfers.total_amount)} over {transfers.transfer_count} transfers
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Money moved between your own accounts — excluded from income and expense totals everywhere
          else, so it is never double-counted. Each transfer is counted once, from its outgoing side.
        </Typography>

        {months.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No transfers detected in this period.
          </Typography>
        ) : (
          <>
            <BarChart
              series={[
                {
                  data: amounts,
                  label: 'Transferred',
                  color: TRANSFER_COLOR,
                  valueFormatter: (v: number | null) => formatCurrency(v ?? 0),
                },
              ]}
              xAxis={[{ data: months, scaleType: 'band' }]}
              yAxis={[{ valueFormatter: (v: number | null) => formatCurrency(v ?? 0) }]}
              height={220}
              sx={{ width: '100%' }}
            />
            {busiestMonth && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Busiest month: <strong>{busiestMonth.month}</strong> at {formatCurrency(busiestMonth.amount)}.
              </Typography>
            )}

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1, mb: 1 }}>
              Where the money went
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Route</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell align="right">Transfers</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {flows.map((flow) => (
                    <TableRow key={`${flow.from_account}->${flow.to_account}-${flow.matched}`}>
                      <TableCell>
                        <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Typography variant="body2">{flow.from_account}</Typography>
                          <Typography variant="body2" color="text.secondary">→</Typography>
                          <Typography variant="body2">{flow.to_account}</Typography>
                          {!flow.matched && (
                            <Tooltip title="One-sided: the counterpart account is named on the transaction, but no matching transaction was found to pair it with">
                              <Chip size="small" variant="outlined" label="unpaired" />
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(flow.amount)}</TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" color="text.secondary">{flow.count}</Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
};
