import { Badge, Button, Container, Group, Select, Stack, Switch, Text, Title } from '@mantine/core';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { AllCommunityModule, ColDef, IServerSideDatasource, ModuleRegistry } from 'ag-grid-community';
import { CellSelectionModule, MasterDetailModule, ServerSideRowModelApiModule, ServerSideRowModelModule } from "ag-grid-enterprise";
import { AgGridReact } from 'ag-grid-react';

import { CategoryPicker } from '../components/CategoryPicker';
import { FilterBar } from '../components/FilterBar';
import { Transaction, transactionService } from '../services/transactionService';
import { accountIdParam, resolveDateRange, useTransactionStore } from '../store/transactionStore';
import { formatCurrency } from '../utils/currency';

import { colorSchemeDarkBlue, themeMaterial } from 'ag-grid-community';
import './ReviewPage.css';
// No legacy ag-grid CSS imports here on purpose - the new Theming API
// (the `theme` object below) and the old CSS-class-based themes
// (ag-theme-quartz etc.) fight each other if both are loaded: the legacy
// CSS file's light-mode defaults win for anything the JS theme doesn't
// explicitly override, which is what made the grid render white/unstyled.
export const agGridTheme = themeMaterial.withPart(colorSchemeDarkBlue).withParams({
    headerTextColor: '#fff',
    spacing: 6
});

// ServerSideRowModelModule: the grid now pulls one block of rows at a time from
// GET /transactions/review (sorting/filtering/paging all happen in the DB)
// instead of loading every row and slicing client-side. MasterDetailModule: the
// Curve/bank-account duplicate that used to be spliced in as a synthetic detail
// row is now a native master/detail expand on the rows that have one.
ModuleRegistry.registerModules([
  AllCommunityModule,
  CellSelectionModule,
  ServerSideRowModelModule,
  // ServerSideRowModelModule alone doesn't pull in api.refreshServerSide() -
  // that's a separate module; without it, refreshServerSide() just logs an
  // error and does nothing (silent no-op, not a thrown exception).
  ServerSideRowModelApiModule,
  MasterDetailModule,
]);

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

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

// Native master/detail renderer for a row whose purchase is also reported via a
// linked Curve/bank-account transaction. The linked side isn't necessarily in
// the loaded block (e.g. it's already finalized and "show finalized" is off), so
// it's fetched on expand by its id rather than read from the grid.
const LinkedTransactionDetail: React.FC<any> = (params) => {
  const data = params.data as Transaction;
  const [linked, setLinked] = useState<Transaction | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!data.duplicate_of_id) return;
    transactionService
      .getTransaction(data.duplicate_of_id)
      .then((res) => active && setLinked(res.data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [data.duplicate_of_id]);

  if (failed) return <Text size="xs" c="red" p="sm">Failed to load linked transaction</Text>;
  if (!linked) return <Text size="xs" c="dimmed" p="sm">Loading linked transaction…</Text>;
  return (
    <Group gap="md" wrap="nowrap" p="sm">
      <Badge color="grape" variant="light">Linked Curve transaction</Badge>
      <Text size="sm">{linked.date}</Text>
      <Text size="sm">{formatCurrency(linked.amount)}</Text>
      <Text size="sm" style={{ flex: 1 }}>{linked.description}</Text>
      <Text size="sm" c="dimmed">{linked.merchant || ''}</Text>
    </Group>
  );
};

export const ReviewPage: React.FC = () => {
  const [includeFinalized, setIncludeFinalized] = useState(false);
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

  // The app-level filters (account/date from the FilterBar, plus the
  // include-finalized toggle) aren't AG Grid column filters - they're sent as
  // their own query params on every block request. The datasource is created
  // once (stable), so it reads the latest values through this ref rather than
  // closing over stale ones.
  const queryRef = useRef({ accountId, from, to, includeFinalized });
  queryRef.current = { accountId, from, to, includeFinalized };

  // Mirrors backend CategoryService.requires_transfer_account - whether this
  // leaf category is normally paired with a transfer account (Transfer
  // column). Purely advisory: it drives the red/error styling on the Transfer
  // and Final Category cells, but doesn't block saving - some real transfers
  // (e.g. a card top-up funded from outside the tracked accounts) never get a
  // counterpart transaction. Reads the store imperatively (not the reactive
  // hook) so creating a category from CategoryPicker's popover doesn't
  // re-render ReviewPage and recreate the (unmemoized) AG Grid columns array
  // mid-interaction - that would make AG Grid discard and recreate the
  // CategoryPicker cell, closing its popover and wiping its in-progress state.
  const requiresTransferAccount = (leafKey: string | null | undefined): boolean =>
    !!leafKey && !!useTransactionStore.getState().categories.find((c) => c.key === leafKey)?.requires_transfer_account;

  // The SSRM datasource: AG Grid calls getRows for each block, handing us the
  // requested row range, the active sortModel, and the per-column filterModel.
  // We translate those into the review endpoint's params - the column
  // filterModel goes through as JSON (the backend whitelists which columns it
  // honors), and the single-column sort the grid uses maps to sort_by/sort_dir.
  const datasource = useMemo<IServerSideDatasource>(() => ({
    getRows: async (params) => {
      const req = params.request;
      const q = queryRef.current;
      const sort = req.sortModel?.[0];
      const startRow = req.startRow ?? 0;
      const endRow = req.endRow ?? startRow + DEFAULT_PAGE_SIZE;
      try {
        const res = await transactionService.getReviewTransactions({
          limit: endRow - startRow,
          offset: startRow,
          account_id: q.accountId,
          date_from: q.from,
          date_to: q.to,
          include_finalized: q.includeFinalized,
          sort_by: sort?.colId ?? null,
          sort_dir: (sort?.sort as 'asc' | 'desc') ?? 'asc',
          filter_model:
            req.filterModel && Object.keys(req.filterModel).length
              ? JSON.stringify(req.filterModel)
              : undefined,
        });
        params.success({ rowData: res.data.items, rowCount: res.data.total });
      } catch (err: any) {
        params.fail();
        setError(err?.message || 'Failed to load transactions');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Changing an app-level filter invalidates every loaded block, so purge the
  // server-side cache and jump back to the first page. Skipped on the very
  // first run - AG Grid does the initial load itself when the datasource is
  // attached, so refreshing here too would double-fetch on mount.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const api = gridRef.current?.api;
    if (!api) return;
    api.refreshServerSide({ purge: true });
    api.paginationGoToFirstPage();
  }, [accountId, from, to, includeFinalized]);

  const refresh = () => gridRef.current?.api.refreshServerSide({ purge: true });

  // AG Grid's Server-Side Row Model doesn't support a scoped "select all"
  // header checkbox: internally it always does a full select-all (every row
  // matching the current filter on the server) and - separately - never
  // records those rows in the selection map that getSelectedRows() reads, so
  // "Confirm & Retrain Selected" would silently see zero rows selected. The
  // header checkbox is disabled (see gridOptions.rowSelection below) in favor
  // of this explicit page-scoped action, which goes through setNodesSelected
  // (the same path individual checkbox clicks use) so selection actually
  // registers. getDisplayedRowAtIndex (not forEachNode) is used because SSRM
  // keeps every visited page's block cached, so forEachNode would walk rows
  // from other pages too.
  const getCurrentPageNodes = () => {
    const api = gridRef.current?.api;
    if (!api) return [];
    const pageSize = api.paginationGetPageSize();
    const start = api.paginationGetCurrentPage() * pageSize;
    const end = Math.min(start + pageSize, api.paginationGetRowCount());
    const nodes = [];
    for (let i = start; i < end; i++) {
      const node = api.getDisplayedRowAtIndex(i);
      if (node?.data && !node.detail) nodes.push(node);
    }
    return nodes;
  };

  const handleSelectPage = () => {
    gridRef.current?.api.setNodesSelected({ nodes: getCurrentPageNodes(), newValue: true });
  };

  // Optimistic single-row update: write the new value straight onto the loaded
  // row node so the cell reflects it immediately, without re-fetching the whole
  // block.
  const patchRow = (transactionId: string, patch: Partial<Transaction>) => {
    const node = gridRef.current?.api.getRowNode(transactionId);
    if (node?.data) node.setData({ ...node.data, ...patch });
  };

  const handleCategoryUpdate = async (transactionId: string, category: string) => {
    // No hard block on a missing transfer pairing - many real transfers (e.g. a
    // card top-up funded from outside the tracked accounts) never get a
    // counterpart transaction at all. The Transfer/Final Category cells still
    // render in red via requiresTransferAccount() so it stays visible, but it
    // no longer prevents saving the category.
    try {
      await transactionService.updateTransaction(transactionId, category);
      patchRow(transactionId, { category_final: category });
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to update transaction');
    }
  };

  // Accepts the ML prediction as the final category for every checked row
  // (skipping any already finalized) in one go, then retrains so the model picks
  // up anything those confirmations changed, and reloads the current block. A
  // missing transfer pairing no longer blocks confirmation.
  const handleConfirmSelected = async () => {
    const selected = (gridRef.current?.api.getSelectedRows() || []).map((row) => !row?.category_final ? { ...row, category_final: row.category_predicted } : row) as Transaction[];
    const toConfirm = selected.filter((t) => t.category_final && t.category_predicted);

    if (toConfirm.length === 0) return;

    setBulkConfirming(true);
    try {
      const results = await Promise.allSettled(
        toConfirm.map((t) => transactionService.updateTransaction(t.id, t.category_predicted!))
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      if (succeeded > 0) await transactionService.retrainModel();
      const failed = toConfirm.length - succeeded;
      if (failed > 0) setError(`${failed} row(s) could not be confirmed.`);
      gridRef.current?.api.deselectAll();
    } catch (err: any) {
      setError(err.message || 'Failed to confirm selected transactions');
    } finally {
      setBulkConfirming(false);
      refresh();
    }
  };

  const handleTransferAccountChange = async (transactionId: string, accId: string | null) => {
    try {
      const response = await transactionService.setTransferPair(transactionId, accId);
      patchRow(transactionId, response.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to update transfer pairing');
    }
  };

  const exportCsv = () => {
    const api = gridRef.current?.api;
    if (!api) return;
    const rows: Transaction[] = [];
    // Loaded master rows only - skip the detail (linked-transaction) nodes.
    api.forEachNode((node) => {
      if (node.data && !node.detail) rows.push(node.data);
    });
    downloadCsv(rows);
  };

  const accountNameById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    [accounts]
  );

  const handleJumpToPair = (pairId: string) => {
    const api = gridRef.current?.api;
    const rowNode = api?.getRowNode(pairId);
    if (!api || !rowNode) return;
    api.ensureNodeVisible(rowNode, 'middle');
    api.flashCells({ rowNodes: [rowNode] });
  };

  // Tied to the filter selection, not the loaded block - a 2-account filter
  // should show the column even if the current page happens to be dominated by
  // just one of them. Zero selected means no filter at all (every account).
  const showAccountColumn = selectedAccountIds.length === 0 || selectedAccountIds.length > 1;

  // AG Grid centers plain text/value cells automatically, but custom
  // cellRenderer content (Select, CategoryPicker, Badge) doesn't get that for
  // free - wrap those in this to keep them vertically centered now that
  // rowHeight is taller than one line of text. grid (not flex) so a single
  // child still stretches to the full cell width.
  const CELL_CENTER_STYLE: React.CSSProperties = { display: 'grid', alignItems: 'center', height: '100%' };

  const columns: ColDef<any>[] = [
    {
      field: 'date',
      headerName: 'Date',
      width: 150,
      cellClass: 'fixed-column',
      filter: 'agDateColumnFilter',
      // Carries the master/detail expand toggle - only rows flagged by
      // isRowMaster (a Curve/bank duplicate) actually show the chevron.
      cellRenderer: 'agGroupCellRenderer',
    },
    ...(showAccountColumn ? [{
      field: 'account_id',
      headerName: 'Account',
      width: 160,
      // Account selection is owned by the FilterBar (multi-select); a per-column
      // filter here would be a confusing duplicate, and the cell shows the name
      // while the value is the id.
      filter: false,
      valueGetter: (params: any) => accountNameById[params.data.account_id] || params.data.account_id
    } as ColDef<any>] : []),
    {
      // The actual editable value is the paired account id, not is_transfer (a
      // derived boolean) - field has to match what the fill handle/copy-paste
      // should read and write, same fix as Final Category's column.
      field: 'transfer_match_account_id',
      headerName: 'Transfer',
      width: 210,
      // UI-only pairing widget, not a real Transaction column - not sortable or
      // filterable (the backend whitelist excludes it too).
      sortable: false,
      filter: false,
      editable: true,
      valueSetter: (params: any) => {
        const newValue = params.newValue ?? null;
        const current = params.data.transfer_match_account_id ?? null;
        if (newValue === current || newValue === params.data.account_id) return false;
        params.data.transfer_match_account_id = newValue;
        handleTransferAccountChange(params.data.id, newValue);
        return true;
      },
      cellRenderer: (params: any) => {
        const currentCategory = params.data.category_final || params.data.category_predicted;
        const needsTransfer = requiresTransferAccount(currentCategory) && !params.data.transfer_match_account_id;
        const pairedRow = params.data.is_transfer && params.data.transfer_match_id
          ? params.api.getRowNode(params.data.transfer_match_id)?.data
          : undefined;
        return (
          <div style={CELL_CENTER_STYLE}>
            <Group gap={4} wrap="nowrap" align="center" style={{ width: '100%' }}>
              <Select
                size="xs"
                style={{ flex: 1, minWidth: 0 }}
                placeholder={needsTransfer ? 'Required for this category' : 'Not a transfer'}
                error={needsTransfer}
                data={accounts.filter((a) => a.id !== params.data.account_id).map((a) => ({ value: a.id, label: a.name }))}
                value={params.data.transfer_match_account_id || null}
                onChange={(val) => handleTransferAccountChange(params.data.id, val)}
                clearable
                comboboxProps={{ withinPortal: true }}
              />
              {params.data.is_transfer && (
                <Badge
                  size="lg"
                  circle
                  variant={pairedRow ? 'filled' : 'outline'}
                  color="teal"
                  style={{ cursor: pairedRow ? 'pointer' : 'default', flexShrink: 0 }}
                  onClick={pairedRow ? () => handleJumpToPair(params.data.transfer_match_id) : undefined}
                  title={pairedRow
                    ? `Transfer pair - click to jump to: ${pairedRow.description} (${pairedRow.date})`
                    : 'Transfer pair - the other side isn\'t in the current view (different filter or not yet loaded)'}
                >
                  ⇄
                </Badge>
              )}
            </Group>
          </div>
        );
      }
    },
    {
      field: 'amount',
      headerName: 'Amount',
      width: 110,
      filter: 'agNumberColumnFilter',
      valueFormatter: (params) => formatCurrency(params.value || 0),
      type: 'numericColumn',
      cellClass: params => {
          return params.data.original_amount ? 'ag-cell-has-different-currency' : undefined;
      },
      cellRenderer: (params: any) => (
        <span title={params.data.original_amount ? `${params.data.original_amount} ${params.data.currency}` : undefined} >
          {params.valueFormatted || ''}
        </span>
      )
    },
    {
      field: 'description',
      headerName: 'Description',
      flex: 2,
      filter: 'agTextColumnFilter',
      wrapText: true,
      autoHeight: true
    },
    {
      field: 'merchant',
      headerName: 'Merchant',
      width: 170,
      filter: 'agTextColumnFilter',
      cellRenderer: (params: any) => {
        // Bidirectional duplicate_of_id means the pair is two real rows - if the
        // other side is loaded in the current block, the badge jumps to it;
        // otherwise expand this row's master/detail (the Date column chevron) to
        // see it inline.
        const pairedRow = params.data.duplicate_of_id
          ? params.api.getRowNode(params.data.duplicate_of_id)?.data
          : undefined;
        return (
          <div style={CELL_CENTER_STYLE}>
            <Group gap={4} wrap="nowrap">
              <Text size="sm">{params.value || ''}</Text>
              {params.data.duplicate_of_id && (
                <Badge
                  size="xs"
                  variant="dot"
                  color="blue"
                  style={{ cursor: pairedRow ? 'pointer' : 'default' }}
                  onClick={pairedRow ? () => handleJumpToPair(params.data.duplicate_of_id) : undefined}
                  title={pairedRow
                    ? `Curve pair - click to jump to: ${pairedRow.description} (${pairedRow.date})`
                    : 'Linked Curve/bank-account transaction - expand the row to view it'}
                >
                  {params.data.is_duplicate ? 'curve copy' : 'via curve'}
                </Badge>
              )}
            </Group>
          </div>
        );
      }
    },
    {
      field: 'category_predicted',
      headerName: 'Predicted',
      width: 120,
      filter: 'agTextColumnFilter',
      cellRenderer: (params: any) => (
        <div style={CELL_CENTER_STYLE}>
          <Badge size="sm" variant="light">
            {params.value || 'N/A'}
          </Badge>
        </div>
      )
    },
    {
      field: 'category_confidence',
      headerName: 'Confidence',
      width: 120,
      filter: 'agNumberColumnFilter',
      cellRenderer: (params: any) => {
        const value = params.value || 0;
        const color = value >= 0.75 ? 'green' : value >= 0.5 ? 'yellow' : 'red';
        return (
          <div style={CELL_CENTER_STYLE}>
            <Badge color={color} variant="light" size="sm">
              {(value * 100).toFixed(0)}%
            </Badge>
          </div>
        );
      }
    },
    {
      field: 'category_final',
      headerName: 'Final Category',
      width: 200,
      filter: 'agTextColumnFilter',
      // The fill handle only writes a value into cells whose column passes
      // isCellEditable - without this, dragging the handle silently does nothing
      // (no cellEditor popup is used; CategoryPicker is the always-on "editor"
      // via cellRenderer, so editable just unlocks fill).
      editable: true,
      valueSetter: (params: any) => {
        const newValue = params.newValue;
        if (!newValue || newValue === params.data.category_final) return false;
        params.data.category_final = newValue;
        handleCategoryUpdate(params.data.id, newValue);
        return true;
      },
      cellRenderer: (params: any) => {
        // Pre-fills with the ML prediction so the picker shows what "Confirm &
        // Retrain Selected" would save.
        const prefill = params.value || params.data.category_predicted || null;
        const needsTransfer = requiresTransferAccount(prefill) && !params.data.transfer_match_account_id;
        return (
          <div style={CELL_CENTER_STYLE}>
            <CategoryPicker
              value={prefill}
              onChange={(leafKey) => handleCategoryUpdate(params.data.id, leafKey)}
              error={needsTransfer}
              placeholder="Select category"
            />
          </div>
        );
      }
    }
  ];

  const gridOptions = {
    theme: agGridTheme,
    rowModelType: 'serverSide' as const,
    serverSideDatasource: datasource,
    // One DB-backed page per grid page; keep the block size aligned with the
    // page size so a page is exactly one block request.
    pagination: true,
    paginationPageSize: DEFAULT_PAGE_SIZE,
    paginationPageSizeSelector: PAGE_SIZE_OPTIONS,
    cacheBlockSize: DEFAULT_PAGE_SIZE,
    masterDetail: true,
    isRowMaster: (data: any) => !!data?.duplicate_of_id,
    detailCellRenderer: LinkedTransactionDetail,
    detailRowAutoHeight: true,
    defaultColDef: {
      filter: true,
      floatingFilter: true,
      sortable: true,
    },
    // Floor height so Select/CategoryPicker controls (taller than one line of
    // plain text) never get clipped - the Description column's autoHeight still
    // grows rows taller than this when text wraps.
    rowHeight: 52,
    getRowId: (params: any) => params.data.id,
    onSelectionChanged: (e: any) => setSelectedCount(e.api.getSelectedRows().length),
    rowSelection: {
      mode: "multiRow" as const,
      checkboxes: true,
      // Native header "select all" is disabled - the Server-Side Row Model
      // doesn't support scoping it to the current page (see getCurrentPageNodes
      // above); "Select Page" in the toolbar replaces it.
      headerCheckbox: false,
      enableClickSelection: false,
    },
    cellSelection: {
      handle: {
        mode: 'fill' as const,
      }
    }
  };

  return (
    <Container size="xl" py="xl" fluid>
      <Stack gap="lg">
        <div>
          <Title order={1}>Review & Categorize</Title>
          <Text c="dimmed">Review and correct transaction categories</Text>
        </div>

        <FilterBar />

        <Group>
          <Button onClick={refresh}>
            Refresh
          </Button>
          <Button onClick={() => transactionService.retrainModel()} variant="outline">
            Retrain Model
          </Button>
          <Button onClick={handleSelectPage} variant="default">
            Select Page
          </Button>
          <Button
            onClick={() => gridRef.current?.api.deselectAll()}
            variant="default"
            disabled={selectedCount === 0}
          >
            Clear Selection
          </Button>
          <Button
            onClick={handleConfirmSelected}
            loading={bulkConfirming}
            disabled={selectedCount === 0}
            color="green"
          >
            Confirm & Retrain Selected{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </Button>
          <Button onClick={exportCsv} variant="default">
            Export CSV
          </Button>
          <Switch
            label="Show already-categorized transactions"
            checked={includeFinalized}
            onChange={(e) => setIncludeFinalized(e.currentTarget.checked)}
          />
        </Group>

        <div style={{ height: '600px', width: '100%' }}>
          <AgGridReact
            ref={gridRef}
            gridOptions={gridOptions}
            columnDefs={columns}
          />
        </div>
      </Stack>
    </Container>
  );
};
