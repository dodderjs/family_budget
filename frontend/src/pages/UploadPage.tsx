import { Alert, Badge, Button, Container, FileInput, Group, Modal, PasswordInput, Stack, Tabs, TextInput } from '@mantine/core';
import React, { useState } from 'react';
import { csvService } from '../services/csvService';
import { transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

export const UploadPage: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [bankFormat, setBankFormat] = useState('bank_a');
  const [suggestedMapping, setSuggestedMapping] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{type: 'success'|'error'|'info', text: string} | null>(null);
  
  // New account form state
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountNumber, setNewAccountNumber] = useState('');
  const [accountNumberError, setAccountNumberError] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);

  const { setError } = useTransactionStore();

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

  const handleFileSelect = async (file: File | null) => {
    if (!file) return;
    setFile(file);
    setMessage(null);
    setLoading(true);

    try {
      const rows = await csvService.parseFile(file);
      setPreview(rows.slice(0, 5));

      const response = await transactionService.uploadCSV(file);
      setSuggestedMapping(response.data.suggested_mapping);
      setBankFormat(response.data.detected_format);
      setMessage({ type: 'info', text: `${response.data.row_count} rows ready to process` });
    } catch (err: any) {
      setError(err.message);
      setMessage({ type: 'error', text: 'Failed to parse CSV' });
    } finally {
      setLoading(false);
    }
  };

  const handleProcessFile = async () => {
    if (!file || !selectedAccount || !preview) return;
    setLoading(true);

    try {
      const response = await transactionService.normalizeTransactions(
        selectedAccount,
        bankFormat,
        preview
      );
      setMessage({ 
        type: 'success', 
        text: `Created: ${response.data.created}, Duplicates: ${response.data.duplicates}` 
      });
      setFile(null);
      setPreview(null);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!newAccountName.trim()) {
      setMessage({ type: 'error', text: 'Please enter account name' });
      return;
    }

    if (!validateAccountNumber(newAccountNumber)) {
      return;
    }

    setCreatingAccount(true);
    try {
      await transactionService.createAccount(newAccountName, newAccountNumber);
      setMessage({ type: 'success', text: 'Account created successfully' });
      setNewAccountName('');
      setNewAccountNumber('');
      setShowAddAccountModal(false);
      await loadAccounts();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'Failed to create account' });
    } finally {
      setCreatingAccount(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const response = await transactionService.listAccounts();
      setAccounts(response.data);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load accounts' });
    }
  };

  React.useEffect(() => {
    loadAccounts();
  }, []);

  return (
    <Container size="lg" py="xl">
      <Stack spacing="lg">
        <div>
          <h1>Upload Transactions</h1>
          <p>Upload a CSV file with your transaction history</p>
        </div>

        {message && (
          <Alert color={message.type === 'error' ? 'red' : message.type === 'success' ? 'green' : 'blue'}>
            {message.text}
          </Alert>
        )}

        <Modal
          opened={showAddAccountModal}
          onClose={() => setShowAddAccountModal(false)}
          title="Create New Account"
          size="sm"
        >
          <Stack spacing="md">
            <TextInput
              label="Account Name"
              placeholder="e.g., Checking, Savings, Business"
              value={newAccountName}
              onChange={(e) => setNewAccountName(e.currentTarget.value)}
            />
            <PasswordInput
              label="Account Number"
              placeholder="e.g., ****1234 or 1234567890"
              description="Enter full or masked account number (at least 4 characters)"
              value={newAccountNumber}
              onChange={(e) => {
                setNewAccountNumber(e.currentTarget.value);
                validateAccountNumber(e.currentTarget.value);
              }}
              error={accountNumberError || false}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setShowAddAccountModal(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreateAccount} 
                loading={creatingAccount}
                disabled={!isAccountFormValid()}
              >
                Create Account
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Tabs defaultValue="select-account">
          <Tabs.List>
            <Tabs.Tab value="select-account">Select Account</Tabs.Tab>
            <Tabs.Tab value="upload" disabled={!selectedAccount}>Upload CSV</Tabs.Tab>
            <Tabs.Tab value="preview" disabled={!preview}>Preview</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="select-account" pt="lg">
            <Stack spacing="md">
              <Group>
                <h3 style={{ margin: 0, flex: 1 }}>Your Accounts</h3>
                <Button 
                  onClick={() => setShowAddAccountModal(true)}
                  variant="filled"
                >
                  + Add Account
                </Button>
              </Group>

              {accounts.length === 0 ? (
                <Alert color="yellow">
                  <p>No accounts yet. Create one to get started!</p>
                </Alert>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
                  {accounts.map((acc) => (
                    <div
                      key={acc.id}
                      onClick={() => setSelectedAccount(acc.id)}
                      style={{
                        padding: '1rem',
                        border: selectedAccount === acc.id ? '2px solid #007bff' : '1px solid #ddd',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        backgroundColor: selectedAccount === acc.id ? '#e7f5ff' : '#fff',
                        transition: 'all 0.2s'
                      }}
                    >
                      <strong>{acc.name}</strong>
                      <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9em', color: '#666' }}>
                        {acc.account_number}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="upload" pt="lg">
            <Stack spacing="md">
              <FileInput 
                label="Select CSV File"
                placeholder="Choose file"
                value={file}
                onChange={handleFileSelect}
                accept=".csv"
              />
              {suggestedMapping && (
                <div>
                  <h4>Detected Format: <Badge>{bankFormat}</Badge></h4>
                  <pre style={{ backgroundColor: '#f5f5f5', padding: '1rem', borderRadius: '4px', overflow: 'auto' }}>
                    {JSON.stringify(suggestedMapping, null, 2)}
                  </pre>
                </div>
              )}
              <Group>
                <Button onClick={handleProcessFile} loading={loading} disabled={!preview}>
                  Process File
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="preview" pt="lg">
            {preview && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {Object.keys(preview[0]).map(key => (
                        <th key={key} style={{ padding: '8px', borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val, j) => (
                          <td key={j} style={{ padding: '8px', borderBottom: '1px solid #eee' }}>
                            {String(val).substring(0, 30)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
};
