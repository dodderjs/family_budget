import { Badge, Button, Container, Group, Select, Stack, Switch, Text, Title } from '@mantine/core';
import { ColDef } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { AgGridReact } from 'ag-grid-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CategoryPicker } from '../components/CategoryPicker';
import { FilterBar } from '../components/FilterBar';
import { Transaction, transactionService } from '../services/transactionService';
import { accountIdParam, resolveDateRange, useTransactionStore } from '../store/transactionStore';
import { formatCurrency } from '../utils/currency';

// AG Grid's pagination paginates over whatever's in rowData - it was only
// ever fetching the worst 50 (confidence-sorted) rows total, so the controls
// looked like pagination but never reached anything past page 2. Fetch the
// whole queue instead and let the grid actually page through all of it.
const REVIEW_FETCH_LIMIT = 10000;

const downloadCsv = (transactions: Transaction[]) => {
  const headers = ['date', 'amount', 'description', 'merchant', 'category_predicted', 'category_final'];
  const rows = transactions.map((t) =>
    headers.map((h) => `"${String((t as any)[h] ?? '').replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `review-export-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

export const ReviewPage: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [includeFinalized, setIncludeFinalized] = useState(false);
  // Transaction ids whose linked Curve/bank-account duplicate is expanded
  // into a drill row directly beneath them.
  const [expandedLinkIds, setExpandedLinkIds] = useState<Set<string>>(new Set());
  // Lazily-fetched linked transactions, keyed by their own id - the linked
  // side isn't necessarily in the current page of `transactions` (e.g. it's
  // already finalized and the "show finalized" toggle is off).
  const [linkedTransactions, setLinkedTransactions] = useState<Record<string, Transaction>>({});
  const [selectedCount, setSelectedCount] = useState(0);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const gridRef = useRef<AgGridReact>(null);

  const selectedAccountIds = useTransactionStore((s) => s.selectedAccountIds);
  const accounts = useTransactionStore((s) => s.accounts);
  const datePreset = useTransactionStore((s) => s.datePreset);
  const customDateFrom = useTransactionStore((s) => s.customDateFrom);
  const customDateTo = useTransactionStore((s) => s.customDateTo);
  const setError = useTransactionStore((s) => s.setError);

  const { from, to } = resolveDateRange(datePreset, customDateFrom, customDateTo);
  const accountId = accountIdParam(selectedAccountIds);

  // Mirrors backend CategoryService.requires_transfer_account - whether
  // finalizing this leaf category requires a transfer account to already
  // be picked (Transfer column). Looked up from the store instead of a
  // hardcoded set, since leaves are now creatable at runtime. Reads the
  // store imperatively (not the reactive hook) so creating a category from
  // CategoryPicker's popover doesn't re-render ReviewPage and recreate the
  // (unmemoized) AG Grid columns array mid-interaction - that would make AG
  // Grid discard and recreate the CategoryPicker cell, closing its popover
  // and wiping its in-progress state right as the user picks a category.
  const requiresTransferAccount = (leafKey: string | null | undefined): boolean =>
    !!leafKey && !!useTransactionStore.getState().categories.find((c) => c.key === leafKey)?.requires_transfer_account;

  const loadTransactions = async () => {
    setLoading(true);
    try {
      const response = await transactionService.getReviewTransactions(
        REVIEW_FETCH_LIMIT, accountId, from, to, includeFinalized
      );
      setTransactions(response.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, from, to, includeFinalized]);

  const handleCategoryUpdate = async (transactionId: string, category: string) => {
    if (requiresTransferAccount(category)) {
      const txn = transactions.find((t) => t.id === transactionId);
      if (!txn?.transfer_match_account_id) {
        setError(`Category "${category}" requires a transfer account - pick one in the Transfer column first.`);
        return;
      }
    }
    try {
      await transactionService.updateTransaction(transactionId, category);
      setTransactions(t => t.map(x =>
        x.id === transactionId ? { ...x, category_final: category } : x
      ));
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to update transaction');
    }
  };

  // Accepts the ML prediction as the final category for every checked row
  // (skipping any already finalized) in one go, then retrains so the model
  // picks up anything those confirmations changed. Rows predicted as a
  // transfer category with no transfer account picked yet are skipped
  // rather than failing the whole batch.
  const handleConfirmSelected = async () => {
    const selected = (gridRef.current?.api.getSelectedRows() || []) as Transaction[];
    const eligible = selected.filter((t) => !t.category_final && t.category_predicted);
    const blockedIds = new Set(
      eligible
        .filter((t) => requiresTransferAccount(t.category_predicted) && !t.transfer_match_account_id)
        .map((t) => t.id)
    );
    const toConfirm = eligible.filter((t) => !blockedIds.has(t.id));

    if (toConfirm.length === 0) {
      if (blockedIds.size > 0) {
        setError(`${blockedIds.size} row(s) need a transfer account picked first (Transfer column) before their category can be confirmed.`);
      }
      return;
    }

    setBulkConfirming(true);
    try {
      const results = await Promise.allSettled(
        toConfirm.map((t) => transactionService.updateTransaction(t.id, t.category_predicted!))
      );
      const succeededIds = new Set<string>();
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') succeededIds.add(toConfirm[i].id);
      });
      setTransactions((prev) => prev.map((t) =>
        succeededIds.has(t.id) ? { ...t, category_final: t.category_predicted } : t
      ));
      if (succeededIds.size > 0) await transactionService.retrainModel();
      const skipped = blockedIds.size + (toConfirm.length - succeededIds.size);
      if (skipped > 0) {
        setError(`${skipped} row(s) could not be confirmed - check the Transfer column for rows needing a paired account.`);
      }
      gridRef.current?.api.deselectAll();
    } catch (err: any) {
      setError(err.message || 'Failed to confirm selected transactions');
    } finally {
      setBulkConfirming(false);
    }
  };

  const handleTransferAccountChange = async (transactionId: string, accountId: string | null) => {
    try {
      const response = await transactionService.setTransferPair(transactionId, accountId);
      setTransactions((prev) => prev.map((t) => (t.id === transactionId ? response.data : t)));
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to update transfer pairing');
    }
  };

  const accountNameById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    [accounts]
  );

  // Tied to the filter selection, not the loaded page of data - a 2-account
  // filter should show the column even if the current (confidence-sorted)
  // page happens to be dominated by just one of them. Zero selected means no
  // filter at all (every account), which is the same "could be multiple" case.
  const showAccountColumn = selectedAccountIds.length === 0 || selectedAccountIds.length > 1;

  const handleToggleLink = async (t: Transaction) => {
    if (!t.duplicate_of_id) return;
    const linkedId = t.duplicate_of_id;
    setExpandedLinkIds((prev) => {
      const next = new Set(prev);
      if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
      return next;
    });
    if (!linkedTransactions[linkedId]) {
      try {
        const response = await transactionService.getTransaction(linkedId);
        setLinkedTransactions((prev) => ({ ...prev, [linkedId]: response.data }));
      } catch (err: any) {
        setError(err.message || 'Failed to load linked transaction');
      }
    }
  };

  // Rows actually fed to the grid: the loaded transactions, with a synthetic
  // "detail" row spliced in directly under any row whose link is expanded -
  // rendered full-width via colSpan on the Date column below.
  const displayRows = useMemo(() => {
    const rows: any[] = [];
    for (const t of transactions) {
      rows.push(t);
      if (expandedLinkIds.has(t.id) && t.duplicate_of_id) {
        rows.push({ id: `detail-${t.id}`, __detailFor: t.id, __linked: linkedTransactions[t.duplicate_of_id] });
      }
    }
    return rows;
  }, [transactions, expandedLinkIds, linkedTransactions]);

  const columns: ColDef<any>[] = [
    {
      field: 'date',
      headerName: 'Date',
      width: 130,
      cellClass: 'fixed-column',
      colSpan: (params) => (params.data.__detailFor ? 100 : 1),
      checkboxSelection: (params: any) => !params.data.__detailFor,
      headerCheckboxSelection: true,
      cellRenderer: (params: any) => {
        if (params.data.__detailFor) {
          const linked = params.data.__linked as Transaction | undefined;
          if (!linked) return <Text size="xs" c="dimmed">Loading linked transaction...</Text>;
          return (
            <Group gap="md" wrap="nowrap" py={4}>
              <Badge color="grape" variant="light">Linked Curve transaction</Badge>
              <Text size="sm">{linked.date}</Text>
              <Text size="sm">{formatCurrency(linked.amount)}</Text>
              <Text size="sm" style={{ flex: 1 }}>{linked.description}</Text>
              <Text size="sm" c="dimmed">{linked.merchant || ''}</Text>
            </Group>
          );
        }
        return params.value;
      }
    },
    ...(showAccountColumn ? [{
      field: 'account_id',
      headerName: 'Account',
      width: 160,
      valueGetter: (params: any) => accountNameById[params.data.account_id] || params.data.account_id,
    } as ColDef<any>] : []),
    {
      field: 'is_transfer',
      headerName: 'Transfer',
      width: 180,
      cellRenderer: (params: any) => {
        if (params.data.__detailFor) return null;
        const currentCategory = params.data.category_final || params.data.category_predicted;
        const needsTransfer = requiresTransferAccount(currentCategory) && !params.data.transfer_match_account_id;
        return (
          <Select
            size="xs"
            placeholder={needsTransfer ? 'Required for this category' : 'Not a transfer'}
            error={needsTransfer}
            data={accounts.filter((a) => a.id !== params.data.account_id).map((a) => ({ value: a.id, label: a.name }))}
            value={params.data.transfer_match_account_id || null}
            onChange={(val) => handleTransferAccountChange(params.data.id, val)}
            clearable
            comboboxProps={{ withinPortal: true }}
          />
        );
      }
    },
    {
      field: 'amount',
      headerName: 'Amount',
      width: 100,
      valueFormatter: (params) => formatCurrency(params.value || 0)
    },
    {
      field: 'description',
      headerName: 'Description',
      flex: 2,
      wrapText: true,
      autoHeight: true
    },
    {
      field: 'merchant',
      headerName: 'Merchant',
      width: 170,
      cellRenderer: (params: any) => (
        <Group gap={4} wrap="nowrap">
          <Text size="sm">{params.value || ''}</Text>
          {params.data.duplicate_of_id && (
            <Badge
              size="xs"
              variant="dot"
              color="blue"
              style={{ cursor: 'pointer' }}
              onClick={() => handleToggleLink(params.data)}
              title="Click to view the linked Curve/bank-account transaction"
            >
              {params.data.is_duplicate ? 'curve copy' : 'via curve'}
            </Badge>
          )}
        </Group>
      )
    },
    {
      field: 'category_predicted',
      headerName: 'Predicted',
      width: 120,
      cellRenderer: (params: any) => (
        <Badge size="sm" variant="light">
          {params.value || 'N/A'}
        </Badge>
      )
    },
    {
      field: 'category_confidence',
      headerName: 'Confidence',
      width: 110,
      cellRenderer: (params: any) => {
        const value = params.value || 0;
        const color = value >= 0.75 ? 'green' : value >= 0.5 ? 'yellow' : 'red';
        return (
          <Badge color={color} variant="light" size="sm">
            {(value * 100).toFixed(0)}%
          </Badge>
        );
      }
    },
    {
      field: 'category_final',
      headerName: 'Final Category',
      width: 200,
      cellRenderer: (params: any) => {
        if (params.data.__detailFor) return null;
        // Pre-fills with the ML prediction so the picker shows what "Confirm
        // & Retrain Selected" would save.
        const prefill = params.value || params.data.category_predicted || null;
        const needsTransfer = requiresTransferAccount(prefill) && !params.data.transfer_match_account_id;
        return (
          <CategoryPicker
            value={prefill}
            amount={params.data.amount}
            onChange={(leafKey) => handleCategoryUpdate(params.data.id, leafKey)}
            error={needsTransfer}
            placeholder="Select category"
          />
        );
      }
    }
  ];

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <div>
          <Title order={1}>Review & Categorize</Title>
          <Text c="dimmed">Review and correct transaction categories</Text>
        </div>

        <FilterBar />

        <Group>
          <Button onClick={loadTransactions} loading={loading}>
            Refresh
          </Button>
          <Button onClick={() => transactionService.retrainModel()} variant="outline">
            Retrain Model
          </Button>
          <Button
            onClick={handleConfirmSelected}
            loading={bulkConfirming}
            disabled={selectedCount === 0}
            color="green"
          >
            Confirm & Retrain Selected{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </Button>
          <Button onClick={() => downloadCsv(transactions)} variant="default" disabled={!transactions.length}>
            Export CSV
          </Button>
          <Switch
            label="Show already-categorized transactions"
            checked={includeFinalized}
            onChange={(e) => setIncludeFinalized(e.currentTarget.checked)}
          />
        </Group>

        <div style={{ height: '600px', width: '100%' }} className="ag-theme-quartz-dark">
          <AgGridReact
            ref={gridRef}
            rowData={displayRows}
            columnDefs={columns}
            defaultColDef={{
              filter: true,
            }}
            getRowId={(params) => params.data.id}
            rowSelection="multiple"
            suppressRowClickSelection
            onSelectionChanged={(e) => setSelectedCount(e.api.getSelectedRows().length)}
            pagination={true}
            paginationPageSize={25}
          />
        </div>
      </Stack>
    </Container>
  );
};
