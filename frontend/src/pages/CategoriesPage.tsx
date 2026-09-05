import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React, { useMemo, useState } from 'react';
import { CategoryNode, transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

type DialogMode = 'new-main' | 'edit-main' | 'edit-leaf';

interface EditState {
  open: boolean;
  mode: DialogMode;
  category: CategoryNode | null;
  labelInput: string;
  isIncome: boolean | null;
  requiresTransfer: boolean;
  parentId: string;
}

const initialEditState: EditState = {
  open: false,
  mode: 'new-main',
  category: null,
  labelInput: '',
  isIncome: null,
  requiresTransfer: false,
  parentId: '',
};

const getIncomeLabel = (isIncome: boolean | null): string => {
  if (isIncome === true) return 'Income';
  if (isIncome === false) return 'Expense';
  return 'Unconstrained';
};

const getIncomeColor = (isIncome: boolean | null): 'success' | 'error' | 'default' => {
  if (isIncome === true) return 'success';
  if (isIncome === false) return 'error';
  return 'default';
};

export const CategoriesPage: React.FC = () => {
  const { categories, loadCategories } = useTransactionStore();
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [editState, setEditState] = useState<EditState>(initialEditState);

  const mains = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const leafsByMain = useMemo(() => {
    const map = new Map<string, CategoryNode[]>();
    mains.forEach((main) => map.set(main.id, []));
    categories.filter((c) => !!c.parent_id).forEach((leaf) => {
      const arr = map.get(leaf.parent_id!);
      if (arr) arr.push(leaf);
    });
    return map;
  }, [categories, mains]);

  const mainCount = mains.length;
  const leafCount = categories.filter((c) => !!c.parent_id).length;
  const incomeCount = mains.filter((m) => m.is_income === true).length;
  const expenseCount = mains.filter((m) => m.is_income === false).length;

  const openNewMainDialog = () => {
    setEditState({
      open: true,
      mode: 'new-main',
      category: null,
      labelInput: '',
      isIncome: null,
      requiresTransfer: false,
      parentId: '',
    });
  };

  const openEditMainDialog = (category: CategoryNode) => {
    setEditState({
      open: true,
      mode: 'edit-main',
      category,
      labelInput: category.label,
      isIncome: category.is_income,
      requiresTransfer: false,
      parentId: '',
    });
  };

  const openEditLeafDialog = (category: CategoryNode) => {
    setEditState({
      open: true,
      mode: 'edit-leaf',
      category,
      labelInput: category.label,
      isIncome: category.is_income,
      requiresTransfer: category.requires_transfer_account,
      parentId: category.parent_id || '',
    });
  };

  const handleSave = async () => {
    if (!editState.labelInput.trim()) {
      setMessage({ type: 'error', text: 'Category name cannot be empty' });
      return;
    }

    try {
      if (editState.mode === 'new-main') {
        await transactionService.createMainCategory(editState.labelInput, editState.isIncome);
      } else if (editState.mode === 'edit-main' && editState.category) {
        const updates: any = {};
        if (editState.labelInput !== editState.category.label) {
          updates.label = editState.labelInput;
        }
        if (editState.isIncome !== editState.category.is_income) {
          updates.is_income = editState.isIncome;
        }
        if (Object.keys(updates).length > 0) {
          await transactionService.updateCategory(editState.category.id, updates);
        }
      } else if (editState.mode === 'edit-leaf' && editState.category) {
        const updates: any = {};
        if (editState.labelInput !== editState.category.label) {
          updates.label = editState.labelInput;
        }
        if (editState.isIncome !== editState.category.is_income) {
          updates.is_income = editState.isIncome;
        }
        if (editState.requiresTransfer !== editState.category.requires_transfer_account) {
          updates.requires_transfer_account = editState.requiresTransfer;
        }
        if (editState.parentId !== editState.category.parent_id) {
          updates.parent_id = editState.parentId;
        }
        if (Object.keys(updates).length > 0) {
          await transactionService.updateCategory(editState.category.id, updates);
        }
      }

      await loadCategories();
      setMessage({ type: 'success', text: 'Category saved successfully' });
      setEditState(initialEditState);
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.response?.data?.detail || err.message || 'Failed to save category',
      });
    }
  };

  const handleClose = () => {
    setEditState(initialEditState);
  };

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={3}>
        {/* Stats Cards */}
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(4, minmax(0, 1fr))',
            },
          }}
        >
          <Card variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary">
                Main Groups
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {mainCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Top-level category groups
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary">
                Sub-Categories
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {leafCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Leaf categories under groups
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary">
                Income Types
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {incomeCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Main categories flagged as income
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary">
                Expense Types
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {expenseCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Main categories flagged as expense
              </Typography>
            </CardContent>
          </Card>
        </Box>

        {/* Message Alert */}
        {message && (
          <Alert severity={message.type} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        {/* Header */}
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Category Hierarchy
          </Typography>
          <Button variant="contained" onClick={openNewMainDialog}>
            + New Main Group
          </Button>
        </Stack>

        {/* Category List */}
        <Stack spacing={2}>
          {mains.length === 0 ? (
            <Alert severity="warning">No main categories yet. Create one to get started!</Alert>
          ) : (
            mains.map((main) => {
              const leaves = leafsByMain.get(main.id) || [];
              return (
                <Card key={main.id} variant="outlined">
                  {/* Main Category Header */}
                  <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1 }}>
                        <Typography sx={{ fontWeight: 600 }}>{main.label}</Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={getIncomeLabel(main.is_income)}
                          color={getIncomeColor(main.is_income)}
                        />
                      </Stack>
                      <Button size="small" variant="text" onClick={() => openEditMainDialog(main)}>
                        Edit
                      </Button>
                    </Stack>
                  </Box>

                  {/* Leaf Categories */}
                  {leaves.length === 0 ? (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                        No sub-categories yet
                      </Typography>
                    </Box>
                  ) : (
                    <Stack
                      sx={{
                        p: 1.5,
                        '& > div': {
                          pl: 3,
                          py: 1,
                          borderLeft: 3,
                          borderColor: 'divider',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        },
                      }}
                    >
                      {leaves.map((leaf) => (
                        <Stack
                          key={leaf.id}
                          direction="row"
                          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                        >
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 500 }}>{leaf.label}</Typography>
                            <Chip
                              size="small"
                              variant="outlined"
                              label={getIncomeLabel(leaf.is_income)}
                              color={getIncomeColor(leaf.is_income)}
                            />
                            {leaf.requires_transfer_account && (
                              <Chip size="small" variant="outlined" label="Transfer" />
                            )}
                            {leaf.transaction_count > 0 && (
                              <Chip
                                size="small"
                                variant="filled"
                                label={`${leaf.transaction_count} txn`}
                                sx={{ ml: 'auto' }}
                              />
                            )}
                          </Stack>
                          <Button size="small" variant="text" onClick={() => openEditLeafDialog(leaf)}>
                            Edit
                          </Button>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Card>
              );
            })
          )}
        </Stack>
      </Stack>

      {/* Edit/Create Dialog */}
      <Dialog open={editState.open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editState.mode === 'new-main'
            ? 'New Main Category Group'
            : editState.mode === 'edit-main'
            ? 'Edit Main Category'
            : 'Edit Sub-Category'}
        </DialogTitle>
        <DialogContent sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            autoFocus
            fullWidth
            label="Category name"
            value={editState.labelInput}
            onChange={(e) => setEditState((prev) => ({ ...prev, labelInput: e.target.value }))}
            onKeyDown={(e) => e.stopPropagation()}
          />

          {/* Income/Expense Toggle */}
          <Box>
            <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
              Type
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant={editState.isIncome === true ? 'contained' : 'outlined'}
                color="success"
                onClick={() =>
                  setEditState((prev) => ({
                    ...prev,
                    isIncome: prev.isIncome === true ? null : true,
                  }))
                }
              >
                Income
              </Button>
              <Button
                size="small"
                variant={editState.isIncome === false ? 'contained' : 'outlined'}
                color="error"
                onClick={() =>
                  setEditState((prev) => ({
                    ...prev,
                    isIncome: prev.isIncome === false ? null : false,
                  }))
                }
              >
                Expense
              </Button>
            </Stack>
          </Box>

          {/* Leaf-specific fields */}
          {editState.mode === 'edit-leaf' && (
            <>
              <FormControlLabel
                control={
                  <Switch
                    checked={editState.requiresTransfer}
                    onChange={(e) =>
                      setEditState((prev) => ({
                        ...prev,
                        requiresTransfer: e.target.checked,
                      }))
                    }
                  />
                }
                label="Requires transfer account pairing"
              />

              <TextField
                fullWidth
                select
                label="Parent Group"
                value={editState.parentId}
                onChange={(e) =>
                  setEditState((prev) => ({
                    ...prev,
                    parentId: e.target.value,
                  }))
                }
              >
                {mains.map((main) => (
                  <MenuItem key={main.id} value={main.id}>
                    {main.label}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!editState.labelInput.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};
