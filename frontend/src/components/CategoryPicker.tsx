import { Button, Group, Popover, Select, Stack, TextInput } from '@mantine/core';
import React, { useMemo, useState } from 'react';
import { transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

const CREATE_NEW = '__create_new__';

interface CategoryPickerProps {
  /** The current leaf category's key, or null/empty if none picked yet. */
  value: string | null;
  /** Drives sign-based filtering of leaf suggestions, mirroring the old
   * categorySuggestionsForAmount logic. */
  amount: number;
  onChange: (leafKey: string) => void;
  error?: boolean;
  placeholder?: string;
}

/** Two-step picker: choose (or create) a main category, then choose (or
 * create) a leaf under it. Built from plain Mantine Selects inside a
 * Popover rather than a custom creatable-combobox primitive - simpler to
 * get right and fits an AG Grid cell's tight width. */
export const CategoryPicker: React.FC<CategoryPickerProps> = ({ value, amount, onChange, error, placeholder }) => {
  const categories = useTransactionStore((s) => s.categories);
  const loadCategories = useTransactionStore((s) => s.loadCategories);
  const setError = useTransactionStore((s) => s.setError);

  const [opened, setOpened] = useState(false);
  const [mainId, setMainId] = useState<string | null>(null);
  const [creatingMain, setCreatingMain] = useState(false);
  const [newMainLabel, setNewMainLabel] = useState('');
  const [creatingLeaf, setCreatingLeaf] = useState(false);
  const [newLeafLabel, setNewLeafLabel] = useState('');

  const mains = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const currentLeaf = useMemo(() => categories.find((c) => c.key === value) || null, [categories, value]);

  const leavesForMain = useMemo(() => {
    if (!mainId) return [];
    return categories
      .filter((c) => c.parent_id === mainId)
      .filter((c) => {
        if (!c.sign) return true;
        if (amount > 0) return c.sign === 'positive';
        if (amount < 0) return c.sign === 'negative';
        return true;
      });
  }, [categories, mainId, amount]);

  // Defaults to the leaf already assigned to this row (if it belongs to the
  // chosen main) - otherwise the first available leaf under that main, so
  // the picker never opens (or switches main) onto a blank selection.
  const selectedLeafId = useMemo(() => {
    if (currentLeaf && currentLeaf.parent_id === mainId) return currentLeaf.id;
    return leavesForMain[0]?.id || null;
  }, [currentLeaf, mainId, leavesForMain]);

  const openPopover = () => {
    // Defaults to the predicted/current leaf's main - or, if there isn't
    // one yet, the first main in the list, so the picker never opens on a
    // totally blank "Pick a main category" state.
    setMainId(currentLeaf?.parent_id || mains[0]?.id || null);
    setCreatingMain(false);
    setCreatingLeaf(false);
    setNewMainLabel('');
    setNewLeafLabel('');
    setOpened(true);
  };

  const handleMainChange = (val: string | null) => {
    if (val === CREATE_NEW) {
      setCreatingMain(true);
      return;
    }
    setMainId(val);
    setCreatingLeaf(false);
  };

  const handleSaveMain = async () => {
    if (!newMainLabel.trim()) return;
    try {
      const response = await transactionService.createMainCategory(newMainLabel.trim());
      await loadCategories();
      setMainId(response.data.id);
      setCreatingMain(false);
      setNewMainLabel('');
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to create category');
    }
  };

  const handleLeafChange = (val: string | null) => {
    if (val === CREATE_NEW) {
      setCreatingLeaf(true);
      return;
    }
    if (val) {
      const leaf = categories.find((c) => c.id === val);
      if (leaf) {
        onChange(leaf.key);
        setOpened(false);
      }
    }
  };

  const handleSaveLeaf = async () => {
    if (!newLeafLabel.trim() || !mainId) return;
    try {
      const response = await transactionService.createLeafCategory(newLeafLabel.trim(), mainId);
      await loadCategories();
      onChange(response.data.key);
      setCreatingLeaf(false);
      setNewLeafLabel('');
      setOpened(false);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to create category');
    }
  };

  const mainOptions = [
    ...mains.map((m) => ({ value: m.id, label: m.label })),
    { value: CREATE_NEW, label: '+ Create new main category' },
  ];
  const leafOptions = [
    ...leavesForMain.map((l) => ({ value: l.id, label: l.label })),
    { value: CREATE_NEW, label: '+ Create new category' },
  ];

  return (
    <Popover opened={opened} onChange={setOpened} withinPortal position="bottom-start" shadow="md">
      <Popover.Target>
        <Button
          size="xs"
          variant={error ? 'outline' : 'light'}
          color={error ? 'red' : undefined}
          onClick={() => (opened ? setOpened(false) : openPopover())}
          fullWidth
          justify="space-between"
        >
          {currentLeaf?.label || placeholder || 'Select category'}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        {/* The inner Selects render their dropdown inline (withinPortal:
            false) rather than in their own portal - otherwise the outer
            Popover's click-outside detection treats a click on the Select's
            options (a separate portal under document.body) as "outside"
            and closes itself immediately. */}
        <Stack gap="xs" w={240}>
          <Select
            label="Main category"
            placeholder="Pick a main category"
            data={mainOptions}
            value={mainId}
            onChange={handleMainChange}
            searchable
            comboboxProps={{ withinPortal: false }}
          />
          {creatingMain && (
            <Group gap="xs" wrap="nowrap">
              <TextInput
                placeholder="New main category name"
                value={newMainLabel}
                onChange={(e) => setNewMainLabel(e.currentTarget.value)}
                size="xs"
                style={{ flex: 1 }}
                autoFocus
              />
              <Button size="xs" onClick={handleSaveMain}>Add</Button>
            </Group>
          )}

          {mainId && !creatingMain && (
            <Select
              label="Category"
              placeholder="Pick a category"
              data={leafOptions}
              value={selectedLeafId}
              onChange={handleLeafChange}
              searchable
              comboboxProps={{ withinPortal: false }}
            />
          )}
          {creatingLeaf && (
            <Group gap="xs" wrap="nowrap">
              <TextInput
                placeholder="New category name"
                value={newLeafLabel}
                onChange={(e) => setNewLeafLabel(e.currentTarget.value)}
                size="xs"
                style={{ flex: 1 }}
                autoFocus
              />
              <Button size="xs" onClick={handleSaveLeaf}>Add</Button>
            </Group>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};
