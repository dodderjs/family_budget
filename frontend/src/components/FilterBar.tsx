import { Autocomplete, Box, Button, MenuItem, Stack, TextField } from '@mui/material';
import React from 'react';
import { useTransactionStore } from '../store/transactionStore';
import { DATE_RANGE_PRESETS, DateRangePreset } from '../utils/dateRange';

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
  const accountOptions = accounts.map((account) => ({ id: account.id, label: account.name }));
  const selectedAccountOptions = accountOptions.filter((option) => selectedAccountIds.includes(option.id));

  return (
    <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
      {showAccountFilter && (
        <>
          <Autocomplete
            multiple
            options={accountOptions}
            getOptionLabel={(option) => option.label}
            value={selectedAccountOptions}
            onChange={(_, value) => setSelectedAccountIds(value.map((option) => option.id))}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            sx={{
              flex: '1 1 320px',
              minWidth: 280,
              maxWidth: 520,
              '& .MuiAutocomplete-tag': {
                maxWidth: 160,
              },
            }}
            renderInput={(params) => <TextField {...params} size="small" label="Accounts" placeholder="All accounts" />}
          />
          <Button
            variant={allSelected ? 'contained' : 'outlined'}
            onClick={() =>
              setSelectedAccountIds(allSelected ? [] : accounts.map((a) => a.id))
            }
            disabled={accounts.length === 0}
          >
            All accounts
          </Button>
        </>
      )}
      <TextField
        select
        size="small"
        label="Period"
        sx={{ minWidth: 200 }}
        value={datePreset}
        onChange={(event) => setDatePreset((event.target.value as DateRangePreset) || 'all')}
      >
        {DATE_RANGE_PRESETS.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      {datePreset === 'custom' && (
        <>
          <TextField
            label="From"
            type="date"
            size="small"
            value={customDateFrom || ''}
            onChange={(event) => setCustomDateRange(event.target.value || null, customDateTo)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="To"
            type="date"
            size="small"
            value={customDateTo || ''}
            onChange={(event) => setCustomDateRange(customDateFrom, event.target.value || null)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </>
      )}
      <Box sx={{ flexGrow: 1 }} />
    </Stack>
  );
};
