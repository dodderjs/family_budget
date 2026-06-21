import { Button, Group, MultiSelect, Select, TextInput } from '@mantine/core';
import React from 'react';
import { DATE_RANGE_PRESETS, DateRangePreset, useTransactionStore } from '../store/transactionStore';

interface FilterBarProps {
  /** Hide the account selector when a page manages account selection itself (e.g. Upload). */
  showAccountFilter?: boolean;
}

export const FilterBar: React.FC<FilterBarProps> = ({ showAccountFilter = true }) => {
  const {
    accounts,
    selectedAccountIds,
    setSelectedAccountIds,
    datePreset,
    setDatePreset,
    customDateFrom,
    customDateTo,
    setCustomDateRange,
  } = useTransactionStore();

  const allSelected = accounts.length > 0 && selectedAccountIds.length === accounts.length;

  return (
    <Group align="flex-end" wrap="wrap">
      {showAccountFilter && (
        <>
          <MultiSelect
            label="Accounts"
            placeholder="All accounts"
            data={accounts.map((a) => ({ value: a.id, label: a.name }))}
            value={selectedAccountIds}
            onChange={setSelectedAccountIds}
            clearable
            searchable
            w={280}
            styles={{
              pillsList: { flexWrap: 'nowrap', overflowX: 'auto' },
            }}
          />
          <Button
            variant={allSelected ? 'filled' : 'default'}
            onClick={() =>
              setSelectedAccountIds(allSelected ? [] : accounts.map((a) => a.id))
            }
            disabled={accounts.length === 0}
          >
            All accounts
          </Button>
        </>
      )}
      <Select
        label="Period"
        data={DATE_RANGE_PRESETS}
        value={datePreset}
        onChange={(val) => setDatePreset((val as DateRangePreset) || 'all')}
        allowDeselect={false}
        w={200}
      />
      {datePreset === 'custom' && (
        <>
          <TextInput
            label="From"
            type="date"
            value={customDateFrom || ''}
            onChange={(e) => setCustomDateRange(e.currentTarget.value || null, customDateTo)}
          />
          <TextInput
            label="To"
            type="date"
            value={customDateTo || ''}
            onChange={(e) => setCustomDateRange(customDateFrom, e.currentTarget.value || null)}
          />
        </>
      )}
    </Group>
  );
};
