import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AccountForm } from '../components/AccountForm';
import { accountFormService } from '../services/accountFormService';
import { csvService } from '../services/csvService';
import { Account, CsvRow, transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

const getFieldValue = (row: Record<string, any> | undefined, field: string | null | undefined): string => {
  if (!row || !field) return '';
  if (field in row) return String(row[field] ?? '').trim();
  const target = field.trim().toLowerCase();
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === target);
  return key ? String(row[key] ?? '').trim() : '';
};

type QueuedFileStatus = 'detecting' | 'ready' | 'needs-account' | 'processing' | 'done' | 'error';

interface QueuedFile {
  id: string;
  file: File;
  status: QueuedFileStatus;
  rows?: CsvRow[];
  bankFormat?: string;
  suggestedMapping?: any;
  rowCount?: number;
  detectedNumber?: string;
  accountId?: string | null;
  resultText?: string;
  errorText?: string;
}

let nextQueueId = 0;
const makeQueueId = () => `qf-${Date.now()}-${nextQueueId++}`;
const defaultTab = 'upload';

export const UploadPage: React.FC = () => {
  const location = useLocation();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [decidingFileId, setDecidingFileId] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(defaultTab);
  const [processingAll, setProcessingAll] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const {
    accounts,
    setSelectedAccountIds,
    setCustomDateRange,
    loadAccounts,
  } = useTransactionStore();

  const [accountDialog, setAccountDialog] = useState<{
    open: boolean;
    id?: string;
    name?: string;
    number?: string;
    type?: string|null;
    cards?: string[];
  }>({ open: false});  


  const navigate = useNavigate();

  React.useEffect(() => {
    setActiveTab(location.pathname === '/accounts' ? 'accounts' : 'upload');
  }, [location.pathname]);

  const updateQueueItem = (id: string, patch: Partial<QueuedFile>) => {
    setQueue((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const openAddAccountDialog = (suggestedName: string, suggestedNumber: string) => {
    setAccountDialog({ open: true, name: suggestedName, number: suggestedNumber });
  };


  const tryAutoResolvePendingFiles = (allAccounts: Account[]) => {
    setQueue((prev) =>
      prev.map((f) => {
        if (f.status !== 'needs-account' || !f.detectedNumber) return f;
        const match = accountFormService.findMatchingAccount(allAccounts, f.detectedNumber);
        return match ? { ...f, status: 'ready', accountId: match.id } : f;
      })
    );
  };

  const detectQueuedFile = async (id: string, file: File) => {
    try {
      const parsedRows = await csvService.parseFile(file);
      const response = await transactionService.uploadCSV(file);
      const mapping = response.data.suggested_mapping;
      const detectedFormat = response.data.detected_format;
      const detectedNumber = getFieldValue(parsedRows[0], mapping?.accountNumberField);
      const matchedAccount = accountFormService.findMatchingAccount(useTransactionStore.getState().accounts, detectedNumber);

      updateQueueItem(id, {
        rows: parsedRows,
        rowCount: parsedRows.length,
        bankFormat: detectedFormat,
        suggestedMapping: mapping,
        detectedNumber,
        status: matchedAccount ? 'ready' : 'needs-account',
        accountId: matchedAccount ? matchedAccount.id : null,
      });
    } catch (err: any) {
      updateQueueItem(id, { status: 'error', errorText: err.message || 'Failed to parse CSV' });
    }
  };

  const handleFilesChange = (files: File[] | null) => {
    const list = files || [];
    if (list.length === 0) return;
    setMessage(null);
    for (const file of list) {
      const id = makeQueueId();
      setQueue((prev) => [...prev, { id, file, status: 'detecting' }]);
      detectQueuedFile(id, file);
    }
  };

  const removeQueuedFile = (id: string) => {
    setQueue((prev) => prev.filter((f) => f.id !== id));
    if (previewFileId === id) setPreviewFileId(null);
  };

  const handleAssignExistingAccount = (fileId: string, accountId: string) => {
    updateQueueItem(fileId, { accountId, status: 'ready' });
    tryAutoResolvePendingFiles(accounts);
  };

  const handleOpenAddAccountForFile = (f: QueuedFile) => {
    setDecidingFileId(f.id);
    const displayName = f.suggestedMapping?.displayName || 'New';
    openAddAccountDialog(`${displayName} Account`, f.detectedNumber || '');
  };

  const handleProcessAll = async () => {
    const ready = queue.filter((f) => f.status === 'ready');
    if (ready.length === 0) return;
    setProcessingAll(true);

    const touchedAccountIds = new Set<string>();
    let minDate: string | null = null;
    let maxDate: string | null = null;
    let anyCreated = false;

    for (const f of ready) {
      updateQueueItem(f.id, { status: 'processing' });
      try {
        const response = await transactionService.normalizeTransactions(f.accountId!, f.bankFormat!, f.rows!);
        updateQueueItem(f.id, {
          status: 'done',
          resultText: `Created: ${response.data.created}, Duplicates: ${response.data.duplicates}, Skipped: ${response.data.skipped ?? 0}`,
        });
        if (response.data.created > 0) {
          anyCreated = true;
          touchedAccountIds.add(f.accountId!);
          if (response.data.date_from && (!minDate || response.data.date_from < minDate)) minDate = response.data.date_from;
          if (response.data.date_to && (!maxDate || response.data.date_to > maxDate)) maxDate = response.data.date_to;
        }
      } catch (err: any) {
        updateQueueItem(f.id, { status: 'error', errorText: err.response?.data?.detail || err.message || 'Failed to process file' });
      }
    }

    setProcessingAll(false);

    if (anyCreated) {
      if (minDate && maxDate) setCustomDateRange(minDate, maxDate);
      setSelectedAccountIds([...touchedAccountIds]);
      navigate('/review');
    }
  };

  const onSuccessAddAccount = async (acc: Account) => {
        await loadAccounts();
        if (decidingFileId) {
          updateQueueItem(decidingFileId, { accountId: acc.id, status: 'ready' });
        }
        tryAutoResolvePendingFiles(useTransactionStore.getState().accounts);
  }

  const readyCount = queue.filter((f) => f.status === 'ready').length;
  const previewableFiles = queue.filter((f) => f.rows);
  const previewFile = queue.find((f) => f.id === previewFileId) || previewableFiles[0];
  const accountCount = accounts.length;
  const cardsCount = accounts.reduce((sum, account) => sum + account.cards.length, 0);
  const detectedCount = queue.filter((f) => f.status !== 'detecting').length;
  const processedCount = queue.filter((f) => f.status === 'done').length;

  const statusBadge = (f: QueuedFile) => {
    switch (f.status) {
      case 'detecting':
        return <Chip size="small" color="default" label="Detecting..." />;
      case 'ready':
        return <Chip size="small" color="primary" label="Ready" />;
      case 'needs-account':
        return <Chip size="small" color="warning" label="Needs account" />;
      case 'processing':
        return <Chip size="small" color="warning" label="Processing..." />;
      case 'done':
        return <Chip size="small" color="success" label="Done" />;
      case 'error':
        return <Chip size="small" color="error" label="Error" />;
      default:
        return null;
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={3}>

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
              <Typography variant="overline" color="text.secondary">Tracked accounts</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{accountCount}</Typography>
              <Typography variant="caption" color="text.secondary">Accounts available for upload routing</Typography>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary">Stored card hints</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{cardsCount}</Typography>
              <Typography variant="caption" color="text.secondary">Card values used for matching edge cases</Typography>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary">Detected files</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{detectedCount}</Typography>
              <Typography variant="caption" color="text.secondary">CSV files parsed and classified</Typography>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary">Processed files</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{processedCount}</Typography>
              <Typography variant="caption" color="text.secondary">Files normalized and sent to review</Typography>
            </CardContent>
          </Card>
        </Box>

        {message && (
          <Alert severity={message.type === 'error' ? 'error' : message.type === 'success' ? 'success' : 'info'}>
            {message.text}
          </Alert>
        )}

        <AccountForm {...accountDialog} onSuccess={onSuccessAddAccount} onCancel={() => setAccountDialog({ open: false })} onMessage={setMessage} />
        
        <Tabs value={activeTab} onChange={(_, value) => setActiveTab(value)} sx={{ mt: 0.5 }}>
          <Tab label="Upload CSV" value="upload" />
          <Tab label="Preview" value="preview" disabled={previewableFiles.length === 0} />
        </Tabs>
        {activeTab === 'upload' && (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: 1 }}>
              <Button component="label" variant="contained" sx={{ alignSelf: 'flex-start' }}>
              Select CSV file(s)
              <input
                hidden
                type="file"
                accept=".csv"
                multiple
                onChange={(event) => {
                  const selectedFiles = Array.from(event.target.files || []);
                  handleFilesChange(selectedFiles);
                  event.currentTarget.value = '';
                }}
              />
              </Button>
              <Typography variant="body2" color="text.secondary">
                {queue.length > 0 ? `${queue.length} queued file(s)` : 'No files queued yet'}
              </Typography>
            </Stack>
            {queue.length > 0 && (
              <Card variant="outlined" sx={{ overflow: 'hidden' }}>
                <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                      <TableCell>File</TableCell>
                      <TableCell>Format</TableCell>
                      <TableCell>Rows</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {queue.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell>{f.file.name}</TableCell>
                        <TableCell>{f.bankFormat ? <Chip size="small" variant="outlined" label={f.bankFormat} /> : '-'}</TableCell>
                        <TableCell>{f.rowCount ?? '-'}</TableCell>
                        <TableCell>
                          {f.status === 'needs-account' ? (
                            <Stack direction="row" spacing={0.5}>
                              <TextField
                                select
                                size="small"
                                sx={{ minWidth: 160 }}
                                value=""
                                onChange={(event) => event.target.value && handleAssignExistingAccount(f.id, event.target.value)}
                              >
                                <MenuItem value="">Choose account</MenuItem>
                                {accounts.map((account) => (
                                  <MenuItem key={account.id} value={account.id}>
                                    {account.name}
                                  </MenuItem>
                                ))}
                              </TextField>
                              <Button size="small" variant="outlined" onClick={() => handleOpenAddAccountForFile(f)}>
                                + New
                              </Button>
                            </Stack>
                          ) : f.accountId ? (
                            <Chip
                              size="small"
                              color="primary"
                              label={accounts.find((account) => account.id === f.accountId)?.name || 'Unknown'}
                            />
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {statusBadge(f)}
                          {f.status === 'done' && f.resultText && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{f.resultText}</Typography>
                          )}
                          {f.status === 'error' && f.errorText && (
                            <Typography variant="caption" color="error" sx={{ display: 'block' }}>{f.errorText}</Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5}>
                            {f.rows && (
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => {
                                  setPreviewFileId(f.id);
                                  setActiveTab('preview');
                                }}
                              >
                                Preview
                              </Button>
                            )}
                            <Button
                              size="small"
                              variant="text"
                              color="error"
                              disabled={f.status === 'processing'}
                              onClick={() => removeQueuedFile(f.id)}
                            >
                              Remove
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </TableContainer>
              </Card>
            )}
            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button onClick={handleProcessAll} disabled={readyCount === 0 || processingAll} variant="contained">
                {processingAll
                  ? 'Processing...'
                  : `Process All Ready Files${readyCount > 0 ? ` (${readyCount})` : ''}`}
              </Button>
            </Stack>
          </Stack>
        )}
        {activeTab === 'preview' && (
          <Stack spacing={2}>
            {previewableFiles.length > 1 && (
              <TextField
                select
                label="Previewing"
                value={previewFile?.id || ''}
                onChange={(event) => setPreviewFileId(event.target.value || null)}
                sx={{ maxWidth: 420 }}
              >
                {previewableFiles.map((f) => (
                  <MenuItem key={f.id} value={f.id}>
                    {f.file.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {previewFile?.rows && previewFile.rows.length > 0 && (
              <Card variant="outlined" sx={{ overflow: 'hidden' }}>
                <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                      {Object.keys(previewFile.rows[0]).map((key) => (
                        <TableCell key={key}>{key}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewFile.rows.slice(0, 5).map((row, i) => (
                      <TableRow key={i}>
                        {Object.values(row).map((val, j) => (
                          <TableCell key={j}>{String(val).substring(0, 30)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </TableContainer>
              </Card>
            )}
          </Stack>
        )}
      </Stack>
    </Container>
  );
};
