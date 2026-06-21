import { Alert, Badge, Button, Card, Container, FileInput, Group, Modal, PasswordInput, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, TagsInput, Text, TextInput, Title } from '@mantine/core';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { csvService } from '../services/csvService';
import { Account, CsvRow, transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

// Tolerant lookup: CSV headers can carry stray whitespace/casing depending on
// which parser produced the row, so match loosely if an exact key miss.
const getFieldValue = (row: Record<string, any> | undefined, field: string | null | undefined): string => {
  if (!row || !field) return '';
  if (field in row) return String(row[field] ?? '').trim();
  const target = field.trim().toLowerCase();
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === target);
  return key ? String(row[key] ?? '').trim() : '';
};

const onlyDigits = (value: string) => value.replace(/\D/g, '');

const findMatchingAccount = (accounts: Account[], detectedNumber: string): Account | undefined => {
  if (!detectedNumber) return undefined;
  const detectedDigits = onlyDigits(detectedNumber);
  const suffixMatches = (registered: string) =>
    detectedDigits.length >= 4 && onlyDigits(registered).endsWith(detectedDigits);

  return accounts.find((acc) => {
    if (acc.account_number.trim() === detectedNumber) return true;
    // Curve only gives us the card's last 4 digits - match against a masked
    // or full account number that ends with the same digits, or against any
    // card registered to the account (a card can be replaced over time).
    if (suffixMatches(acc.account_number)) return true;
    return acc.cards.some((c) => suffixMatches(c.card_number));
  });
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

export const UploadPage: React.FC = () => {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [decidingFileId, setDecidingFileId] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [filesValue, setFilesValue] = useState<File[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>('upload');
  const [processingAll, setProcessingAll] = useState(false);
  const [message, setMessage] = useState<{type: 'success'|'error'|'info', text: string} | null>(null);

  // Account add/edit form state (shared modal for both flows)
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountNumber, setNewAccountNumber] = useState('');
  const [newAccountType, setNewAccountType] = useState('');
  const [cardNumbers, setCardNumbers] = useState<string[]>([]);
  const [accountNumberError, setAccountNumberError] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [useExistingAccountId, setUseExistingAccountId] = useState<string | null>(null);

  const {
    accounts,
    setSelectedAccountIds,
    setCustomDateRange,
    loadAccounts,
  } = useTransactionStore();

  const navigate = useNavigate();

  const updateQueueItem = (id: string, patch: Partial<QueuedFile>) => {
    setQueue((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  // Validate account number format (at least 4 digits or masked format like ****1234)
  const validateAccountNumber = (value: string): boolean => {
    const trimmed = value.trim();
    // Allow formats like: 1234567890, ****1234, XX...1234, or at least 4 characters
    if (trimmed.length < 4) {
      setAccountNumberError('Account number must be at least 4 characters');
      return false;
    }
    if (!/^[A-Za-z0-9*\-.]{4,}$/.test(trimmed)) {
      setAccountNumberError('Account number can only contain letters, numbers, *, -, and periods');
      return false;
    }
    setAccountNumberError('');
    return true;
  };

  // Check if account form is valid (without calling setState)
  const isAccountFormValid = (): boolean => {
    if (!newAccountName.trim()) return false;
    const trimmed = newAccountNumber.trim();
    if (trimmed.length < 4) return false;
    if (!/^[A-Za-z0-9*\-.]{4,}$/.test(trimmed)) return false;
    return true;
  };

  const openAddAccountDialog = (suggestedName: string, suggestedNumber: string) => {
    setEditingAccountId(null);
    setNewAccountName(suggestedName);
    setNewAccountNumber(suggestedNumber);
    setNewAccountType('');
    setCardNumbers([]);
    setAccountNumberError('');
    setUseExistingAccountId(null);
    setShowAddAccountModal(true);
  };

  const openEditAccountDialog = (acc: Account) => {
    setDecidingFileId(null);
    setEditingAccountId(acc.id);
    setNewAccountName(acc.name);
    setNewAccountNumber(acc.account_number);
    setNewAccountType(acc.type || '');
    setCardNumbers(acc.cards.map((c) => c.card_number));
    setAccountNumberError('');
    setUseExistingAccountId(null);
    setShowAddAccountModal(true);
  };

  const closeAddAccountModal = () => {
    setShowAddAccountModal(false);
    setDecidingFileId(null);
  };

  const syncCards = async (accountId: string, existingCards: { id: string; card_number: string }[], desiredNumbers: string[]) => {
    const existingNumbers = new Set(existingCards.map((c) => c.card_number));
    const desiredSet = new Set(desiredNumbers.map((n) => n.trim()).filter(Boolean));

    const toAdd = [...desiredSet].filter((n) => !existingNumbers.has(n));
    const toRemove = existingCards.filter((c) => !desiredSet.has(c.card_number));

    await Promise.all([
      ...toAdd.map((n) => transactionService.addCard(accountId, n)),
      ...toRemove.map((c) => transactionService.removeCard(accountId, c.id)),
    ]);
  };

  const handleDeleteAccount = async (acc: Account, force = false) => {
    try {
      await transactionService.deleteAccount(acc.id, force);
      await loadAccounts();
      setMessage({ type: 'success', text: `Account "${acc.name}" deleted${force ? ' along with its transactions' : ''}` });
    } catch (err: any) {
      if (err.response?.status === 409) {
        const detail = err.response?.data?.detail || 'This account has existing transactions.';
        if (window.confirm(`${detail}\n\nDelete the account and those transactions?`)) {
          await handleDeleteAccount(acc, true);
        }
      } else {
        setMessage({ type: 'error', text: err.response?.data?.detail || 'Failed to delete account' });
      }
    }
  };

  // Resolves any still-undecided queued file whose detected account number
  // now matches something in `allAccounts` - so creating or picking an
  // account for one file also resolves other pending files for that same
  // account, instead of asking the user again for each one.
  const tryAutoResolvePendingFiles = (allAccounts: Account[]) => {
    setQueue((prev) =>
      prev.map((f) => {
        if (f.status !== 'needs-account' || !f.detectedNumber) return f;
        const match = findMatchingAccount(allAccounts, f.detectedNumber);
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
      const matchedAccount = findMatchingAccount(useTransactionStore.getState().accounts, detectedNumber);

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
    setFilesValue([]); // reset so the same file(s) can be re-selected later if needed
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

  const handleSaveAccount = async () => {
    if (!editingAccountId && useExistingAccountId) {
      if (decidingFileId) {
        handleAssignExistingAccount(decidingFileId, useExistingAccountId);
      }
      closeAddAccountModal();
      return;
    }

    if (!newAccountName.trim()) {
      setMessage({ type: 'error', text: 'Please enter account name' });
      return;
    }

    if (!validateAccountNumber(newAccountNumber)) {
      return;
    }

    setCreatingAccount(true);
    try {
      if (editingAccountId) {
        const response = await transactionService.updateAccount(editingAccountId, {
          name: newAccountName,
          account_number: newAccountNumber,
          type: newAccountType.trim() || null,
        });
        const existingCards = accounts.find((a) => a.id === editingAccountId)?.cards || [];
        await syncCards(editingAccountId, existingCards, cardNumbers);
        setMessage({ type: 'success', text: `Account "${response.data.name}" updated` });
        setShowAddAccountModal(false);
        await loadAccounts();
      } else {
        const response = await transactionService.createAccount(
          newAccountName,
          newAccountNumber,
          newAccountType.trim() || undefined
        );
        await syncCards(response.data.id, [], cardNumbers);
        setMessage({ type: 'success', text: `Account "${response.data.name}" created` });
        setShowAddAccountModal(false);
        await loadAccounts();
        if (decidingFileId) {
          updateQueueItem(decidingFileId, { accountId: response.data.id, status: 'ready' });
        }
        tryAutoResolvePendingFiles(useTransactionStore.getState().accounts);
      }
      setNewAccountName('');
      setNewAccountNumber('');
      setNewAccountType('');
      setCardNumbers([]);
      setEditingAccountId(null);
      setDecidingFileId(null);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'Failed to save account' });
    } finally {
      setCreatingAccount(false);
    }
  };

  const readyCount = queue.filter((f) => f.status === 'ready').length;
  const previewableFiles = queue.filter((f) => f.rows);
  const previewFile = queue.find((f) => f.id === previewFileId) || previewableFiles[0];

  const statusBadge = (f: QueuedFile) => {
    switch (f.status) {
      case 'detecting':
        return <Badge color="gray">Detecting...</Badge>;
      case 'ready':
        return <Badge color="blue">Ready</Badge>;
      case 'needs-account':
        return <Badge color="orange">Needs account</Badge>;
      case 'processing':
        return <Badge color="yellow">Processing...</Badge>;
      case 'done':
        return <Badge color="green">Done</Badge>;
      case 'error':
        return <Badge color="red">Error</Badge>;
    }
  };

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <div>
          <h1>Upload Transactions</h1>
          <p>Upload one or more CSV files with your transaction history</p>
        </div>

        {message && (
          <Alert color={message.type === 'error' ? 'red' : message.type === 'success' ? 'green' : 'blue'}>
            {message.text}
          </Alert>
        )}

        <Modal
          opened={showAddAccountModal}
          onClose={closeAddAccountModal}
          title={editingAccountId ? 'Edit account' : 'New account detected'}
          size="sm"
        >
          <Stack gap="md">
            {!editingAccountId && (
              <Text size="sm" c="dimmed">
                We couldn't match this file to an existing account. Confirm the details below to add it, or pick an
                existing account instead.
              </Text>
            )}
            <TextInput
              label="Account Name"
              placeholder="e.g., Checking, Savings, Business"
              value={newAccountName}
              onChange={(e) => {
                setNewAccountName(e.currentTarget.value);
                setUseExistingAccountId(null);
              }}
            />
            <PasswordInput
              label="Account Number"
              placeholder="e.g., ****1234 or 1234567890"
              description="Enter full or masked account number (at least 4 characters)"
              value={newAccountNumber}
              onChange={(e) => {
                setNewAccountNumber(e.currentTarget.value);
                setUseExistingAccountId(null);
                validateAccountNumber(e.currentTarget.value);
              }}
              error={accountNumberError || false}
            />
            <TextInput
              label="Account Type (optional)"
              placeholder="e.g., Checking, Savings, Credit, Debit, Curve"
              value={newAccountType}
              onChange={(e) => setNewAccountType(e.currentTarget.value)}
            />
            <TagsInput
              label="Card Numbers (optional)"
              description="Last 4 digits or a full/masked number. Keep old ones here if a card was replaced - past transactions still need to match them (e.g. for Curve)."
              placeholder="e.g. 9948 - press Enter to add"
              value={cardNumbers}
              onChange={setCardNumbers}
            />
            {!editingAccountId && decidingFileId && accounts.length > 0 && (
              <Select
                label="Or use an existing account"
                placeholder="Choose an existing account"
                data={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.account_number})` }))}
                value={useExistingAccountId}
                onChange={setUseExistingAccountId}
                clearable
              />
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={closeAddAccountModal}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveAccount}
                loading={creatingAccount}
                disabled={!useExistingAccountId && !isAccountFormValid()}
              >
                {editingAccountId ? 'Save Changes' : useExistingAccountId ? 'Use This Account' : 'Create Account'}
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Tabs value={activeTab} onChange={setActiveTab}>
          <Tabs.List>
            <Tabs.Tab value="upload">Upload CSV</Tabs.Tab>
            <Tabs.Tab value="accounts">Accounts</Tabs.Tab>
            <Tabs.Tab value="preview" disabled={previewableFiles.length === 0}>Preview</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="upload" pt="lg">
            <Stack gap="md">
              <FileInput
                label="Select CSV File(s)"
                placeholder="Choose file(s)"
                value={filesValue}
                onChange={handleFilesChange}
                accept=".csv"
                multiple
                clearable
              />

              {queue.length > 0 && (
                <ScrollArea>
                  <Table striped highlightOnHover withTableBorder verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>File</Table.Th>
                        <Table.Th>Format</Table.Th>
                        <Table.Th>Rows</Table.Th>
                        <Table.Th>Account</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th></Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {queue.map((f) => (
                        <Table.Tr key={f.id}>
                          <Table.Td>{f.file.name}</Table.Td>
                          <Table.Td>{f.bankFormat ? <Badge variant="light">{f.bankFormat}</Badge> : '-'}</Table.Td>
                          <Table.Td>{f.rowCount ?? '-'}</Table.Td>
                          <Table.Td>
                            {f.status === 'needs-account' ? (
                              <Group gap={4} wrap="nowrap">
                                <Select
                                  placeholder="Choose account"
                                  size="xs"
                                  data={accounts.map((a) => ({ value: a.id, label: a.name }))}
                                  onChange={(val) => val && handleAssignExistingAccount(f.id, val)}
                                  style={{ width: 160 }}
                                />
                                <Button size="xs" variant="light" onClick={() => handleOpenAddAccountForFile(f)}>
                                  + New
                                </Button>
                              </Group>
                            ) : f.accountId ? (
                              <Badge color="blue">{accounts.find((a) => a.id === f.accountId)?.name || 'Unknown'}</Badge>
                            ) : (
                              '-'
                            )}
                          </Table.Td>
                          <Table.Td>
                            {statusBadge(f)}
                            {f.status === 'done' && f.resultText && (
                              <Text size="xs" c="dimmed">{f.resultText}</Text>
                            )}
                            {f.status === 'error' && f.errorText && (
                              <Text size="xs" c="red">{f.errorText}</Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} wrap="nowrap">
                              {f.rows && (
                                <Button
                                  size="xs"
                                  variant="subtle"
                                  onClick={() => {
                                    setPreviewFileId(f.id);
                                    setActiveTab('preview');
                                  }}
                                >
                                  Preview
                                </Button>
                              )}
                              <Button
                                size="xs"
                                variant="subtle"
                                color="red"
                                disabled={f.status === 'processing'}
                                onClick={() => removeQueuedFile(f.id)}
                              >
                                Remove
                              </Button>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}

              <Group>
                <Button onClick={handleProcessAll} loading={processingAll} disabled={readyCount === 0}>
                  Process All Ready Files{readyCount > 0 ? ` (${readyCount})` : ''}
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="accounts" pt="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={3}>Your Accounts</Title>
                <Button
                  onClick={() => {
                    setDecidingFileId(null);
                    openAddAccountDialog('', '');
                  }}
                  variant="filled"
                >
                  + Add Account
                </Button>
              </Group>

              {accounts.length === 0 ? (
                <Alert color="yellow">
                  No accounts yet. Create one to get started!
                </Alert>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                  {accounts.map((acc) => (
                    <Card key={acc.id} withBorder>
                      <Group justify="space-between" wrap="nowrap" align="flex-start">
                        <div>
                          <Group gap="xs">
                            <Text fw={600}>{acc.name}</Text>
                            {acc.type && <Badge size="sm">{acc.type}</Badge>}
                          </Group>
                          <Text size="sm" c="dimmed" mt={4}>{acc.account_number}</Text>
                          {acc.cards.length > 0 && (
                            <Group gap={4} mt={4}>
                              {acc.cards.map((c) => (
                                <Badge key={c.id} size="xs" variant="outline" color="gray">{c.card_number}</Badge>
                              ))}
                            </Group>
                          )}
                        </div>
                        <Group gap={4} wrap="nowrap">
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => openEditAccountDialog(acc)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="xs"
                            variant="subtle"
                            color="red"
                            onClick={() => handleDeleteAccount(acc)}
                          >
                            Delete
                          </Button>
                        </Group>
                      </Group>
                    </Card>
                  ))}
                </SimpleGrid>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="preview" pt="lg">
            <Stack gap="md">
              {previewableFiles.length > 1 && (
                <Select
                  label="Previewing"
                  data={previewableFiles.map((f) => ({ value: f.id, label: f.file.name }))}
                  value={previewFile?.id || null}
                  onChange={setPreviewFileId}
                />
              )}
              {previewFile?.rows && previewFile.rows.length > 0 && (
                <ScrollArea>
                  <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        {Object.keys(previewFile.rows[0]).map(key => (
                          <Table.Th key={key}>{key}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {previewFile.rows.slice(0, 5).map((row, i) => (
                        <Table.Tr key={i}>
                          {Object.values(row).map((val, j) => (
                            <Table.Td key={j}>{String(val).substring(0, 30)}</Table.Td>
                          ))}
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
};
