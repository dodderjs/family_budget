import {
  Autocomplete,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import React from 'react';
import { BreakdownGroupBy, CategoryLevel, CategoryNode } from '../../services/transactionService';

interface AnalyticsToolbarProps {
  groupBy: BreakdownGroupBy;
  onGroupByChange: (value: BreakdownGroupBy) => void;
  categoryLevel: CategoryLevel;
  onCategoryLevelChange: (value: CategoryLevel) => void;
  availableCategories: CategoryNode[];
  selectedCategories: string[];
  onCategoriesChange: (value: string[]) => void;
  availableMerchants: string[];
  selectedMerchants: string[];
  onMerchantsChange: (value: string[]) => void;
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

type CategoryOption = {
  key: string;
  label: string;
  parentLabel: string;
};

export const AnalyticsToolbar: React.FC<AnalyticsToolbarProps> = ({
  groupBy,
  onGroupByChange,
  categoryLevel,
  onCategoryLevelChange,
  availableCategories,
  selectedCategories,
  onCategoriesChange,
  availableMerchants,
  selectedMerchants,
  onMerchantsChange,
  compare,
  onCompareChange,
  compareEnabled,
  loading,
  onRefresh,
  onExportBreakdown,
  onExportTrends,
  hasBreakdown,
  hasTrends,
}) => {
  const byId = new Map(availableCategories.map((category) => [category.id, category]));
  const categoryOptions: CategoryOption[] = availableCategories
    .filter((category) => category.parent_id)
    .map((category) => {
      const parent = byId.get(category.parent_id as string);
      return {
        key: category.key,
        label: category.label,
        parentLabel: parent?.label || 'Other',
      };
    })
    .sort(
    (a, b) => a.parentLabel.localeCompare(b.parentLabel) || a.label.localeCompare(b.label)
  );

  const leavesByParent = categoryOptions.reduce<Record<string, string[]>>((acc, option) => {
    if (!acc[option.parentLabel]) acc[option.parentLabel] = [];
    acc[option.parentLabel].push(option.key);
    return acc;
  }, {});

  const selectedCategoryOptions = categoryOptions.filter((option) => selectedCategories.includes(option.key));
  const selectedMerchantOptions = availableMerchants.filter((merchant) => selectedMerchants.includes(merchant));

  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="analytics-group-by-label">Breakdown by</InputLabel>
        <Select
          labelId="analytics-group-by-label"
          label="Breakdown by"
          value={groupBy}
          onChange={(event) => onGroupByChange((event.target.value as BreakdownGroupBy) || 'category')}
        >
          {GROUP_BY_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Autocomplete
        multiple
        options={categoryOptions}
        disableCloseOnSelect
        groupBy={(option) => option.parentLabel}
        getOptionLabel={(option) => option.label}
        value={selectedCategoryOptions}
        onChange={(_, value) => onCategoriesChange(value.map((option) => option.key))}
        isOptionEqualToValue={(option, value) => option.key === value.key}
        renderOption={(props, option, { selected }) => (
          <li {...props}>
            <Checkbox
              size="small"
              checked={selected}
              sx={{ mr: 1 }}
            />
            {option.label}
          </li>
        )}
        renderGroup={(params) => {
          const parentLabel = params.group;
          const groupLeafKeys = leavesByParent[parentLabel] || [];
          const selectedInGroup = groupLeafKeys.filter((key) => selectedCategories.includes(key)).length;
          const allSelected = groupLeafKeys.length > 0 && selectedInGroup === groupLeafKeys.length;
          const partiallySelected = selectedInGroup > 0 && !allSelected;

          return (
            <li key={params.key}>
              <ListSubheader
                component="div"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (allSelected) {
                    onCategoriesChange(selectedCategories.filter((key) => !groupLeafKeys.includes(key)));
                    return;
                  }

                  const merged = new Set([...selectedCategories, ...groupLeafKeys]);
                  onCategoriesChange(Array.from(merged).sort((a, b) => a.localeCompare(b)));
                }}
                sx={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  lineHeight: '32px',
                  py: 0,
                }}
              >
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={partiallySelected}
                  tabIndex={-1}
                  sx={{ p: 0.25 }}
                />
                {parentLabel}
              </ListSubheader>
              <ul>{params.children}</ul>
            </li>
          );
        }}
        sx={{ minWidth: 260 }}
        renderInput={(params) => <TextField {...params} size="small" label="Categories" placeholder="All categories" />}
      />

      <Autocomplete
        multiple
        options={availableMerchants}
        getOptionLabel={(option) => option}
        value={selectedMerchantOptions}
        onChange={(_, value) => onMerchantsChange(value)}
        isOptionEqualToValue={(option, value) => option === value}
        sx={{ minWidth: 260 }}
        renderInput={(params) => <TextField {...params} size="small" label="Merchants" placeholder="All merchants" />}
      />

      <ToggleButtonGroup
        value={categoryLevel}
        exclusive
        size="small"
        onChange={(_, value) => {
          if (value) onCategoryLevelChange(value as CategoryLevel);
        }}
        aria-label="category level"
      >
        <ToggleButton value="parent">Parent</ToggleButton>
        <ToggleButton value="leaf">Leaf</ToggleButton>
      </ToggleButtonGroup>

      <FormControlLabel
        control={
          <Switch
            checked={compare}
            onChange={(event) => onCompareChange(event.target.checked)}
            disabled={!compareEnabled}
          />
        }
        label="Compare to previous period"
      />

      <Button variant="contained" onClick={onRefresh} disabled={loading}>
        {loading ? 'Refreshing...' : 'Refresh'}
      </Button>

      <Button variant="outlined" onClick={onExportBreakdown} disabled={!hasBreakdown}>
        Export Breakdown CSV
      </Button>

      <Button variant="outlined" onClick={onExportTrends} disabled={!hasTrends}>
        Export Trends CSV
      </Button>
    </Stack>
  );
};
