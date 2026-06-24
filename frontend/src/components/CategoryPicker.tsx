import {
  Autocomplete,
  Box,
  createFilterOptions,
  createTheme,
  IconButton,
  TextField,
  ThemeProvider,
  Typography,
} from '@mui/material';
import React, { useMemo } from 'react';
import { transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

// Matches the app's dark Mantine theme so the dropdown doesn't look like a
// foreign light-mode popup dropped into a dark grid cell.
const muiDarkTheme = createTheme({ palette: { mode: 'dark' } });

// Matches Mantine's size="xs" Select (used for the Transfer column right
// next to this one in the grid) so the two controls line up visually.
const CONTROL_HEIGHT = 30;
const CONTROL_FONT_SIZE = '0.75rem';

interface LeafOption {
  type: 'leaf';
  key: string;
  label: string;
  mainId: string;
  mainLabel: string;
  transactionCount: number;
}

interface AddMainOption {
  type: 'add-main';
  key: '__add_main__';
  label: string;
  newMainLabel: string;
}

type Option = LeafOption | AddMainOption;

const filter = createFilterOptions<Option>({ stringify: (option) => option.label });

interface CategoryPickerProps {
  value: string | null;
  onChange: (leafKey: string) => void;
  error?: boolean;
  placeholder?: string;
}

/** Single grouped, searchable Autocomplete: leaves are grouped by their main
 * category, typing filters both, a "+" on a group header adds a new leaf
 * under that main, and typing a name with no matching main shows an
 * "Add main category" option at the end of the list. The full hierarchy is
 * always shown regardless of the transaction's amount sign - an earlier
 * version filtered leaves by sign (income vs expense categories), but that
 * hid most of the seed hierarchy on every row, which was more confusing
 * than useful. */
export const CategoryPicker: React.FC<CategoryPickerProps> = ({ value, onChange, error, placeholder }) => {
  const categories = useTransactionStore((s) => s.categories);
  const loadCategories = useTransactionStore((s) => s.loadCategories);
  const setError = useTransactionStore((s) => s.setError);

  const mains = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const mainLabelById = useMemo(() => Object.fromEntries(mains.map((m) => [m.id, m.label])), [mains]);
  const mainIdByLabel = useMemo(() => Object.fromEntries(mains.map((m) => [m.label, m.id])), [mains]);

  const options: LeafOption[] = useMemo(() => {
    return categories
      .filter((c) => !!c.parent_id)
      .map((leaf) => ({
        type: 'leaf' as const,
        key: leaf.key,
        label: leaf.label,
        mainId: leaf.parent_id as string,
        mainLabel: mainLabelById[leaf.parent_id as string] || 'Other',
        transactionCount: leaf.transaction_count,
      }))
      .sort((a, b) => a.mainLabel.localeCompare(b.mainLabel) || a.label.localeCompare(b.label));
  }, [categories, mainLabelById]);

  const selectedOption = useMemo(() => options.find((o) => o.key === value) || null, [options, value]);

  const handleAddLeafToGroup = async (mainId: string, mainLabel: string) => {
    const label = window.prompt(`New category under "${mainLabel}":`);
    if (!label || !label.trim()) return;
    try {
      const response = await transactionService.createLeafCategory(label.trim(), mainId);
      await loadCategories();
      onChange(response.data.key);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to create category');
    }
  };

  const handleChange = async (_: React.SyntheticEvent, newValue: Option | null) => {
    // Clearing isn't a supported operation (no "unset category" endpoint) -
    // ignore it and the controlled `value` prop snaps back to the prior pick.
    if (!newValue) return;
    if (newValue.type === 'add-main') {
      try {
        // Mirrors the established default for new top-level categories: a
        // main plus a same-named leaf, so it's immediately selectable.
        const mainResponse = await transactionService.createMainCategory(newValue.newMainLabel);
        const leafResponse = await transactionService.createLeafCategory(newValue.newMainLabel, mainResponse.data.id);
        await loadCategories();
        onChange(leafResponse.data.key);
      } catch (err: any) {
        setError(err.response?.data?.detail || err.message || 'Failed to create category');
      }
      return;
    }
    onChange(newValue.key);
  };

  return (
    <ThemeProvider theme={muiDarkTheme}>
      <Autocomplete<Option>
        size="small"
        fullWidth
        options={options}
        value={selectedOption}
        onChange={handleChange}
        groupBy={(option) => (option.type === 'leaf' ? option.mainLabel : '')}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
        isOptionEqualToValue={(option, val) => option.key === val.key}
        filterOptions={(opts, state) => {
          const filtered = filter(opts, state);
          const trimmed = state.inputValue.trim();
          if (trimmed) {
            const existingMain = mains.find((m) => m.label.toLowerCase() === trimmed.toLowerCase());
            if (!existingMain) {
              filtered.push({
                type: 'add-main',
                key: '__add_main__',
                label: `+ Add main category "${trimmed}"`,
                newMainLabel: trimmed,
              });
            }
          }
          return filtered;
        }}
        renderOption={(props, option) => {
          const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key?: React.Key };
          return (
            <li key={key ?? option.key} {...rest} style={{ fontSize: CONTROL_FONT_SIZE }}>
              {option.type === 'leaf' && option.transactionCount > 0 ? (
                <Box sx={{ display: 'flex', flex: 1, justifyContent: 'space-between' }}>
                  <span>{option.label}</span>
                  <Typography component="span" sx={{ fontSize: CONTROL_FONT_SIZE, color: 'text.secondary' }}>
                    {option.transactionCount}
                  </Typography>
                </Box>
              ) : (
                option.label
              )}
            </li>
          );
        }}
        renderGroup={(params) => {
          if (!params.group) {
            return (
              <li key={params.key}>
                <ul style={{ padding: 0, margin: 0 }}>{params.children}</ul>
              </li>
            );
          }
          const mainId = mainIdByLabel[params.group];
          return (
            <li key={params.key}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, pt: 1 }}>
                <Typography sx={{ fontSize: CONTROL_FONT_SIZE, fontWeight: 700, color: 'text.secondary' }}>
                  {params.group}
                </Typography>
                <IconButton
                  size="small"
                  sx={{ p: 0.25 }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddLeafToGroup(mainId, params.group);
                  }}
                >
                  +
                </IconButton>
              </Box>
              <ul style={{ padding: 0, margin: 0 }}>{params.children}</ul>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField {...params} placeholder={placeholder || 'Select category'} error={error} />
        )}
        sx={{
          '& .MuiOutlinedInput-root': {
            height: CONTROL_HEIGHT,
            fontSize: CONTROL_FONT_SIZE,
          },
          '& .MuiOutlinedInput-input': {
            padding: '0 4px',
            fontSize: CONTROL_FONT_SIZE,
          },
        }}
      />
    </ThemeProvider>
  );
};
