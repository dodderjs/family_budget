import { Button, Group, Select, Switch } from '@mantine/core';
import React from 'react';
import { BreakdownGroupBy } from '../../services/transactionService';

interface AnalyticsToolbarProps {
  groupBy: BreakdownGroupBy;
  onGroupByChange: (value: BreakdownGroupBy) => void;
  compare: boolean;
  onCompareChange: (value: boolean) => void;
  compareEnabled: boolean;
  loading: boolean;
  onRefresh: () => void;
  onExportBreakdown: () => void;
  onExportTrends: () => void;
  hasBreakdown: boolean;
  hasTrends: boolean;
}

const GROUP_BY_OPTIONS: { value: BreakdownGroupBy; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'merchant', label: 'Merchant' },
  { value: 'account', label: 'Account' },
];

export const AnalyticsToolbar: React.FC<AnalyticsToolbarProps> = ({
  groupBy,
  onGroupByChange,
  compare,
  onCompareChange,
  compareEnabled,
  loading,
  onRefresh,
  onExportBreakdown,
  onExportTrends,
  hasBreakdown,
  hasTrends,
}) => (
  <Group>
    <Select
      label="Breakdown by"
      data={GROUP_BY_OPTIONS}
      value={groupBy}
      onChange={(val) => onGroupByChange((val as BreakdownGroupBy) || 'category')}
      allowDeselect={false}
      w={160}
    />
    <Switch
      label="Compare to previous period"
      checked={compare}
      onChange={(e) => onCompareChange(e.currentTarget.checked)}
      disabled={!compareEnabled}
      mt={24}
    />
    <Button onClick={onRefresh} loading={loading} mt={24}>
      Refresh
    </Button>
    <Button onClick={onExportBreakdown} variant="default" disabled={!hasBreakdown} mt={24}>
      Export Breakdown CSV
    </Button>
    <Button onClick={onExportTrends} variant="default" disabled={!hasTrends} mt={24}>
      Export Trends CSV
    </Button>
  </Group>
);
