import { Box, Button, Card, CardContent, Chip, CircularProgress, Container, Menu, MenuItem, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { Account, AccountCoverage, CoverageMonthEntry, transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

const STATUS_COLOR: Record<CoverageMonthEntry['status'], 'success' | 'error' | 'info' | 'grey'> = {
  covered: 'success',
  gap: 'grey',
  missing: 'error',
  dismissed: 'info',
};

const MonthCell: React.FC<{
  entry: CoverageMonthEntry;
  onSetStatus: (status: 'missing' | 'dismissed' | 'gap') => void;
}> = ({ entry, onSetStatus }) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const theme = useTheme();
  const open = Boolean(anchorEl);
  const colorToken = STATUS_COLOR[entry.status];
  const borderColor =
    colorToken === 'grey'
      ? theme.palette.grey[600]
      : theme.palette[colorToken].main;

  const box = (
    <Box
      sx={{
        width: 28,
        height: 28,
        flexShrink: 0,
        borderRadius: 1,
        backgroundColor: entry.status === 'covered' ? borderColor : 'transparent',
        border: `2px solid ${borderColor}`,
        cursor: entry.status === 'covered' ? 'default' : 'pointer',
      }}
    />
  );

  const tooltipLabel = `${entry.month} - ${entry.transaction_count} transaction${entry.transaction_count === 1 ? '' : 's'} (${entry.status})`;

  if (entry.status === 'covered') {
    return <Tooltip title={tooltipLabel}>{box}</Tooltip>;
  }

  return (
    <>
      <Box
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{ display: 'flex', flexShrink: 0 }}
      >
        <Tooltip title={tooltipLabel}>{box}</Tooltip>
      </Box>
      <Menu anchorEl={anchorEl} open={open} onClose={() => setAnchorEl(null)}>
        {entry.status !== 'missing' && (
          <MenuItem
            onClick={() => {
              onSetStatus('missing');
              setAnchorEl(null);
            }}
          >
            Mark as missing
          </MenuItem>
        )}
        {entry.status !== 'dismissed' && (
          <MenuItem
            onClick={() => {
              onSetStatus('dismissed');
              setAnchorEl(null);
            }}
          >
            Dismiss (not a real gap)
          </MenuItem>
        )}
        {entry.status !== 'gap' && (
          <MenuItem
            onClick={() => {
              onSetStatus('gap');
              setAnchorEl(null);
            }}
          >
            Reset
          </MenuItem>
        )}
      </Menu>
    </>
  );
};

const AccountCoverageCard: React.FC<{ account: Account }> = ({ account }) => {
  const [coverage, setCoverage] = useState<AccountCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const setError = useTransactionStore((s) => s.setError);

  const fetchCoverage = async () => {
    setLoading(true);
    try {
      const response = await transactionService.getAccountCoverage(account.id);
      setCoverage(response.data);
    } catch {
      setError(`Failed to load coverage for ${account.name}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoverage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  const handleSetStatus = async (month: string, status: 'missing' | 'dismissed' | 'gap') => {
    try {
      await transactionService.setCoverageMonthStatus(account.id, month, status);
      await fetchCoverage();
    } catch {
      setError(`Failed to update ${month} for ${account.name}`);
    }
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" sx={{ mb: 1, justifyContent: 'space-between', alignItems: 'center' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography sx={{ fontWeight: 600 }}>{account.name}</Typography>
            {account.type && <Chip size="small" variant="outlined" label={account.type} />}
          </Stack>
        {coverage?.first_date && coverage?.last_date && (
          <Typography variant="body2" color="text.secondary">{coverage.first_date} - {coverage.last_date}</Typography>
        )}
        </Stack>

      {loading ? (
        <CircularProgress size={18} />
      ) : !coverage || coverage.months.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No transactions yet</Typography>
      ) : (
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {coverage.months.map((entry) => (
            <MonthCell
              key={entry.month}
              entry={entry}
              onSetStatus={(status) => handleSetStatus(entry.month, status)}
            />
          ))}
        </Stack>
      )}
      </CardContent>
    </Card>
  );
};

export const CoveragePage: React.FC = () => {
  const accounts = useTransactionStore((s) => s.accounts);
  const accountsLoading = useTransactionStore((s) => s.accountsLoading);
  const [refreshKey, setRefreshKey] = useState(0);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshot, setSnapshot] = useState({ covered: 0, gap: 0, missing: 0, dismissed: 0 });

  const loadCoverageSnapshot = async () => {
    if (accounts.length === 0) {
      setSnapshot({ covered: 0, gap: 0, missing: 0, dismissed: 0 });
      return;
    }
    setSnapshotLoading(true);
    try {
      // One batched request for the headline tallies. This used to fan out one
      // /accounts/{id}/coverage call per account, on top of the one each
      // AccountCoverageCard already makes for its own month grid.
      const summaries = (await transactionService.listAccountsCoverage()).data;
      const next = { covered: 0, gap: 0, missing: 0, dismissed: 0 };
      for (const row of summaries) {
        next.covered += row.covered;
        next.gap += row.gap;
        next.missing += row.missing;
        next.dismissed += row.dismissed;
      }
      setSnapshot(next);
    } finally {
      setSnapshotLoading(false);
    }
  };

  useEffect(() => {
    loadCoverageSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, refreshKey]);

  const trackedMonths = snapshot.covered + snapshot.gap + snapshot.missing + snapshot.dismissed;
  const healthyMonths = snapshot.covered + snapshot.dismissed;
  const healthRatio = trackedMonths > 0 ? (healthyMonths / trackedMonths) * 100 : 0;

  return (
    <Container maxWidth="lg">
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Coverage
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Track monthly import continuity and mark real vs expected gaps.
          </Typography>
        </Box>

        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                md: 'repeat(4, minmax(0, 1fr))',
              },
              flexGrow: 1,
              mr: 2,
            }}
          >
            <Card variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">Coverage health</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{healthRatio.toFixed(0)}%</Typography>
            </Card>
            <Card variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">Covered</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'success.main' }}>{snapshot.covered}</Typography>
            </Card>
            <Card variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">Missing</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'error.main' }}>{snapshot.missing}</Typography>
            </Card>
            <Card variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">Dismissed</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'info.main' }}>{snapshot.dismissed}</Typography>
            </Card>
          </Box>
          <Button variant="outlined" onClick={() => setRefreshKey((k) => k + 1)}>Refresh</Button>
        </Stack>

        {snapshotLoading && <CircularProgress size={22} />}

        {accountsLoading ? (
          <CircularProgress size={28} />
        ) : accounts.length === 0 ? (
          <Typography color="text.secondary">No accounts yet - upload a CSV to create one.</Typography>
        ) : (
          accounts.map((account) => (
            <AccountCoverageCard key={`${account.id}-${refreshKey}`} account={account} />
          ))
        )}
      </Stack>
    </Container>
  );
};
