import { Badge, Button, Card, Container, Group, Loader, Menu, Stack, Text, Title, Tooltip } from '@mantine/core';
import React, { useEffect, useState } from 'react';
import { Account, AccountCoverage, CoverageMonthEntry, transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

const STATUS_COLOR: Record<CoverageMonthEntry['status'], string> = {
  covered: 'green',
  gap: 'gray',
  missing: 'red',
  dismissed: 'blue',
};

const MonthCell: React.FC<{
  entry: CoverageMonthEntry;
  onSetStatus: (status: 'missing' | 'dismissed' | 'gap') => void;
}> = ({ entry, onSetStatus }) => {
  const box = (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 4,
        backgroundColor: entry.status === 'covered' ? `var(--mantine-color-${STATUS_COLOR[entry.status]}-6)` : 'transparent',
        border: `2px solid var(--mantine-color-${STATUS_COLOR[entry.status]}-6)`,
        cursor: entry.status === 'covered' ? 'default' : 'pointer',
      }}
    />
  );

  const tooltipLabel = `${entry.month} - ${entry.transaction_count} transaction${entry.transaction_count === 1 ? '' : 's'} (${entry.status})`;

  if (entry.status === 'covered') {
    return <Tooltip label={tooltipLabel}>{box}</Tooltip>;
  }

  return (
    <Menu shadow="md" position="bottom">
      <Menu.Target>
        <Tooltip label={tooltipLabel}>{box}</Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {entry.status !== 'missing' && (
          <Menu.Item onClick={() => onSetStatus('missing')}>Mark as missing</Menu.Item>
        )}
        {entry.status !== 'dismissed' && (
          <Menu.Item onClick={() => onSetStatus('dismissed')}>Dismiss (not a real gap)</Menu.Item>
        )}
        {entry.status !== 'gap' && (
          <Menu.Item onClick={() => onSetStatus('gap')}>Reset</Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
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
    <Card withBorder padding="md">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Text fw={600}>{account.name}</Text>
          {account.type && <Badge variant="light">{account.type}</Badge>}
        </Group>
        {coverage?.first_date && coverage?.last_date && (
          <Text size="sm" c="dimmed">{coverage.first_date} - {coverage.last_date}</Text>
        )}
      </Group>

      {loading ? (
        <Loader size="sm" />
      ) : !coverage || coverage.months.length === 0 ? (
        <Text size="sm" c="dimmed">No transactions yet</Text>
      ) : (
        <Group gap={6} wrap="wrap">
          {coverage.months.map((entry) => (
            <MonthCell
              key={entry.month}
              entry={entry}
              onSetStatus={(status) => handleSetStatus(entry.month, status)}
            />
          ))}
        </Group>
      )}
    </Card>
  );
};

export const CoveragePage: React.FC = () => {
  const accounts = useTransactionStore((s) => s.accounts);
  const accountsLoading = useTransactionStore((s) => s.accountsLoading);
  const loadAccounts = useTransactionStore((s) => s.loadAccounts);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (accounts.length === 0) loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Container size="lg">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={2}>Account Coverage</Title>
          <Button variant="light" onClick={() => setRefreshKey((k) => k + 1)}>Refresh</Button>
        </Group>

        {accountsLoading ? (
          <Loader />
        ) : accounts.length === 0 ? (
          <Text c="dimmed">No accounts yet - upload a CSV to create one.</Text>
        ) : (
          accounts.map((account) => (
            <AccountCoverageCard key={`${account.id}-${refreshKey}`} account={account} />
          ))
        )}
      </Stack>
    </Container>
  );
};
