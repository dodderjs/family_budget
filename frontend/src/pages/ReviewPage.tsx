import {
  Box,
  Button,
  Chip,
  Container,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { AllCommunityModule, ColDef, IServerSideDatasource, ModuleRegistry } from 'ag-grid-community';
import { CellSelectionModule, MasterDetailModule, ServerSideRowModelApiModule, ServerSideRowModelModule } from "ag-grid-enterprise";
import { AgGridReact } from 'ag-grid-react';

import { CategoryPicker } from '../components/CategoryPicker';
import { FilterBar } from '../components/FilterBar';
import { LinkedTransactionDetail } from '../components/review/LinkedTransactionDetail';
import { reviewService } from '../services/reviewService';
import { Transaction, transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';
import { downloadCsvFile } from '../utils/csvExport';
import { formatCurrency } from '../utils/currency';
import { accountIdParam, resolveDateRange } from '../utils/dateRange';

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
  const headers = ['date', 'amount', 'description', 'merchant', 'type', 'category_predicted', 'category_final'];
  const rows = transactions.map((t) => [
    t.date,
    t.amount,
    t.description,
    t.merchant,
    t.type,
    t.category_predicted,
    t.category_final,
  ]);
  downloadCsvFile(
    `review-export-${new Date().toISOString().slice(0, 10)}.csv`,
    headers,
    rows
  );
};

export const ReviewPage: React.FC = () => {
  const [includeFinalized, setIncludeFinalized] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [lastConfirmSummary, setLastConfirmSummary] = useState<string | null>(null);
  const [pairCategoryConflicts, setPairCategoryConflicts] = useState<Record<string, string>>({});
  const gridRef = useRef<AgGridReact>(null);
  const pageSizeRef = useRef(DEFAULT_PAGE_SIZE);

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
      // cacheBlockSize is kept in step with the page size (see
      // onPaginationChanged), so one block request is exactly one grid page.
      // The limit still comes from the live pagination API rather than
      // req.endRow, so a block requested mid-resize can't be short.
      const currentPageSize = gridRef.current?.api.paginationGetPageSize() ?? pageSizeRef.current;
      const endRow = startRow + currentPageSize;
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

  const markRowSelected = (transactionId: string) => {
    const node = gridRef.current?.api.getRowNode(transactionId);
    if (node) {
      node.setSelected(true);
    }
  };

  const clearPairConflict = (transactionIds: string[]) => {
    setPairCategoryConflicts((prev) => {
      const next = { ...prev };
      for (const transactionId of transactionIds) {
        delete next[transactionId];
      }
      return next;
    });
  };

  const handleCategoryUpdate = async (row: Transaction, category: string, previousCategoryFinal?: string | null) => {
    const currentCategoryFinal = previousCategoryFinal ?? row.category_final;
    if (!category || category === currentCategoryFinal) return;
    const pairId = row.transfer_match_id || row.duplicate_of_id;

    // No hard block on a missing transfer pairing - many real transfers (e.g. a
    // card top-up funded from outside the tracked accounts) never get a
    // counterpart transaction at all. The Transfer/Final Category cells still
    // render in red via requiresTransferAccount() so it stays visible, but it
    // no longer prevents saving the category.
    try {
      const result = await reviewService.updateCategoryWithPair(row, category);

      patchRow(row.id, { category_final: result.updated.category_final ?? category });
      markRowSelected(row.id);

      if (result.pairUpdated) {
        patchRow(result.pairUpdated.id, { category_final: result.pairUpdated.category_final ?? category });
      }

      clearPairConflict(pairId ? [row.id, pairId] : [row.id]);

      if (result.conflict) {
        const conflict = result.conflict;
        const message = `Pair already has final category: ${result.conflict.pairCategoryFinal}`;
        setPairCategoryConflicts((prev) => ({
          ...prev,
          [row.id]: message,
          [conflict.pairId]: message,
        }));
      }

      if (result.pairError) {
        setError(`Category saved, but paired-row sync failed: ${result.pairError}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update transaction');
    }
  };

  // Accepts the ML prediction as the final category for every checked row
  // (skipping any already finalized) in one go, then retrains so the model picks
  // up anything those confirmations changed, and reloads the current block. A
  // missing transfer pairing no longer blocks confirmation.
  const handleConfirmSelected = async () => {
    const selected = (gridRef.current?.api.getSelectedRows() || []).map((row) => !row?.category_final ? { ...row, category_final: row.category_predicted } : row) as Transaction[];
    if (selected.length === 0) return;

    setBulkConfirming(true);
    setLastConfirmSummary(null);
    try {
      const { succeeded, failed, retrained_samples_total, retrained_samples_selected } = await reviewService.confirmSelected(selected);
      if (failed > 0) {
        setError(`${failed} row(s) could not be confirmed.`);
      } else {
        setError(null);
      }
      setLastConfirmSummary(
        `Confirmed ${retrained_samples_selected ?? succeeded} selected row(s). Model retrained on ${retrained_samples_total ?? 0} total sample(s).`
      );
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
      const updated = await reviewService.updateTransferPair(transactionId, accId);
      patchRow(transactionId, updated);
    } catch (err: any) {
      setError(err.message || 'Failed to update transfer pairing');
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
            <Stack direction="row" spacing={0.5} sx={{ width: '100%', alignItems: 'center' }}>
              <TextField
                select
                size="small"
                sx={{ flex: 1, minWidth: 0 }}
                error={needsTransfer}
                value={params.data.transfer_match_account_id || ''}
                onChange={(event) => handleTransferAccountChange(params.data.id, event.target.value || null)}
                placeholder={needsTransfer ? 'Required for this category' : 'Not a transfer'}
              >
                <MenuItem value="">
                  {needsTransfer ? 'Required for this category' : 'Not a transfer'}
                </MenuItem>
                {accounts
                  .filter((a) => a.id !== params.data.account_id)
                  .map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.name}
                    </MenuItem>
                  ))}
              </TextField>
              {params.data.is_transfer && (
                <Tooltip
                  title={pairedRow
                    ? `Transfer pair - click to jump to: ${pairedRow.description} (${pairedRow.date})`
                    : 'Transfer pair - the other side isn\'t in the current view (different filter or not yet loaded)'}
                >
                  {/* Solid = the counterpart row is loaded in the grid and
                      clicking jumps to it; hollow = it isn't, so this is an
                      indicator only. Kept icon-only and circular: the column
                      is 210px and the account Select needs the rest of it.
                      Tooltip needs an element that holds a ref, hence the
                      wrapping span. */}
                  <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                    <IconButton
                      size="small"
                      disableRipple={!pairedRow}
                      onClick={pairedRow ? () => handleJumpToPair(params.data.transfer_match_id) : undefined}
                      sx={{
                        width: 26,
                        height: 26,
                        border: '1px solid',
                        borderColor: 'info.main',
                        color: pairedRow ? 'info.contrastText' : 'info.main',
                        backgroundColor: pairedRow ? 'info.main' : 'transparent',
                        cursor: pairedRow ? 'pointer' : 'default',
                        '&:hover': {
                          backgroundColor: pairedRow ? 'info.dark' : 'action.hover',
                        },
                      }}
                    >
                      <SwapHorizRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Stack>
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
      type: 'rightAligned',
      cellClass: params => {
          return params.data.original_amount ? ['ag-cell-has-different-currency', 'ag-right-aligned-cell'] : ['ag-right-aligned-cell'];
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
      // flex: 2,
      filter: 'agTextColumnFilter',
      wrapText: true,
      width: 300,
      // autoHeight: true
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
        return (<>
              {params.value || ''}
              {params.data.duplicate_of_id && (
                <Chip
                  size="small"
                  variant="outlined"
                  color="primary"
                  sx={{ cursor: pairedRow ? 'pointer' : 'default' }}
                  onClick={pairedRow ? () => handleJumpToPair(params.data.duplicate_of_id) : undefined}
                  label={params.data.is_duplicate ? 'curve copy' : 'via curve'}
                  title={pairedRow
                    ? `Curve pair - click to jump to: ${pairedRow.description} (${pairedRow.date})`
                    : 'Linked Curve/bank-account transaction - expand the row to view it'}
                />
              )}
            </>
        );
      }
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 160,
      filter: 'agTextColumnFilter',
    },
    {
      field: 'category_predicted',
      headerName: 'Predicted',
      width: 120,
      filter: 'agTextColumnFilter',
      cellRenderer: (params: any) => (
        <div style={CELL_CENTER_STYLE}>
          <Chip size="small" variant="outlined" label={params.value || 'N/A'} />
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
        const color = value >= 0.75 ? 'success' : value >= 0.5 ? 'warning' : 'error';
        return (
          <div style={CELL_CENTER_STYLE}>
            <Chip color={color} variant="outlined" size="small" label={`${(value * 100).toFixed(0)}%`} />
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
        const previousCategoryFinal = params.data.category_final;
        params.data.category_final = newValue;
        handleCategoryUpdate(params.data as Transaction, newValue, previousCategoryFinal);
        return true;
      },
      cellRenderer: (params: any) => {
        // Pre-fills with the ML prediction so the picker shows what "Confirm &
        // Retrain Selected" would save.
        const prefill = params.value || params.data.category_predicted || null;
        const needsTransfer = requiresTransferAccount(prefill) && !params.data.transfer_match_account_id;
        return (
          <div style={CELL_CENTER_STYLE}>
            <Stack direction="row" spacing={0.5} sx={{ width: '100%', alignItems: 'center' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <CategoryPicker
                  value={prefill}
                  onChange={(leafKey) => handleCategoryUpdate(params.data as Transaction, leafKey)}
                  error={needsTransfer}
                  placeholder="Select category"
                />
              </Box>
              {pairCategoryConflicts[params.data.id] && (
                <Chip size="small" color="warning" variant="outlined" title={pairCategoryConflicts[params.data.id]} label="!" />
              )}
            </Stack>
          </div>
        );
      }
    }
  ];

  const gridOptions = {
    theme: agGridTheme,
    rowModelType: 'serverSide' as const,
    serverSideDatasource: datasource,
    masterDetail: true,
    isRowMaster: (data: any) => !!data?.duplicate_of_id,
    detailCellRenderer: LinkedTransactionDetail,
    detailRowAutoHeight: true,
    defaultColDef: {
      filter: true,
      floatingFilter: true,
      sortable: true,
      editable: false,
    },
    // Floor height so Select/CategoryPicker controls (taller than one line of
    // plain text) never get clipped - the Description column's autoHeight still
    // grows rows taller than this when text wraps.
    rowHeight: 52,
    getRowId: (params: any) => params.data.id,
    onSelectionChanged: (e: any) => setSelectedCount(e.api.getSelectedRows().length),
    onPaginationChanged: (e: any) => {
      const newPageSize = e.api.paginationGetPageSize();
      if (newPageSize === pageSizeRef.current) return;
      // cacheBlockSize has to follow the page size or the grid asks for rows
      // in 20-row blocks while paginating 100 at a time, which desyncs its
      // row bookkeeping and prints a nonsense "X to Y of Z / Page N of M".
      // It isn't a reactive prop, so it goes through the grid API - and every
      // cached block is now the wrong size, hence the purge.
      pageSizeRef.current = newPageSize;
      setPageSize(newPageSize);
      e.api.setGridOption('cacheBlockSize', newPageSize);
      e.api.refreshServerSide({ purge: true });
    },
    rowSelection: {
      mode: "multiRow" as const,
      checkboxes: true,
      // Native header "select all" is disabled - the Server-Side Row Model
      // doesn't support scoping it to the current page (see getCurrentPageNodes
      // above); "Select Page" in the toolbar replaces it.
      headerCheckbox: false,
      enableClickSelection: false,
    },
    getRowClass: (params: any) => (pairCategoryConflicts[params.data?.id] ? 'row-category-conflict' : ''),
    cellSelection: {
      handle: {
        mode: 'fill' as const,
      }
    }
  };

  return (
    <Container maxWidth={false} sx={{ py: 4 }}>
      <Stack spacing={3}>

        <FilterBar />

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={refresh} variant="contained">
            Refresh
          </Button>
          <Button onClick={() => transactionService.retrainModel()} variant="outlined">
            Retrain Model
          </Button>
          <Button onClick={handleSelectPage} variant="outlined">
            Select Page
          </Button>
          <Button
            onClick={() => gridRef.current?.api.deselectAll()}
            variant="outlined"
            disabled={selectedCount === 0}
          >
            Clear Selection
          </Button>
          <Button
            onClick={handleConfirmSelected}
            variant="contained"
            disabled={selectedCount === 0}
            color="success"
          >
            {bulkConfirming ? 'Confirming...' : `Confirm & Retrain Selected${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
          </Button>
          <Button onClick={exportCsv} variant="outlined">
            Export CSV
          </Button>
          <FormControlLabel
            label="Show already-categorized transactions"
            control={
              <Switch
                checked={includeFinalized}
                onChange={(event) => setIncludeFinalized(event.target.checked)}
              />
            }
          />
        </Stack>

        {lastConfirmSummary && (
          <Typography variant="body2" color="text.secondary">{lastConfirmSummary}</Typography>
        )}

        <div style={{ height: '600px', width: '100%' }}>
          <AgGridReact
            ref={gridRef}
            gridOptions={gridOptions}
            columnDefs={columns}
            pagination
            paginationPageSize={pageSize}
            paginationPageSizeSelector={PAGE_SIZE_OPTIONS}
            cacheBlockSize={pageSize}
          />
        </div>
      </Stack>
    </Container>
  );
};
