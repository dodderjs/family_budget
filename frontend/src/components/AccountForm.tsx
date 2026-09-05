import { Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import React, { useEffect } from 'react';
import { accountFormService } from '../services/accountFormService';
import { Account, transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

export interface AccountFormMessage {
    type: 'success' | 'error' | 'info';
    text: string;
}

interface AccountFormProps {
    open: boolean;
    id?: string;
    name?: string;
    number?: string;
    type?: string|null;
    cards?: string[];
    onSuccess?: (account: Account) => void;
    onCancel?: () => void;
    /** Save outcomes are reported up rather than held here - both callers
     * already own the message state and render it in their own Alert. */
    onMessage?: (message: AccountFormMessage) => void;
}

export const AccountForm: React.FC<AccountFormProps> = ({ open=false, id, name, number, type, cards, onSuccess, onCancel, onMessage }) => {
    const [useExistingAccountId, setUseExistingAccountId] = React.useState<string | null>(id || null);
    const [newAccountName, setNewAccountName] = React.useState(name || '');
    const [newAccountNumber, setNewAccountNumber] = React.useState(number || '');
    const [newAccountType, setNewAccountType] = React.useState(type || '');
    const [cardNumbers, setCardNumbers] = React.useState(cards || []);
    const [creatingAccount, setCreatingAccount] = React.useState(false);
    const [accountNumberError, setAccountNumberError] = React.useState('');
    const [showAddAccountModal, setShowAddAccountModal] = React.useState(open);

    const { accounts, loadAccounts } = useTransactionStore();

    const validateAccountNumber = (value: string): boolean => {
    const result = accountFormService.validateAccountNumber(value);
    setAccountNumberError(result.error);
    return result.valid;
    };
      
    const handleSaveAccount = async () => {
        if (!newAccountName?.trim()) {
        onMessage?.({ type: 'error', text: 'Please enter account name' });
        return;
        }

        if (!validateAccountNumber(newAccountNumber)) {
        return;
        }

        setCreatingAccount(true);
        try {
        if (useExistingAccountId) {
            const response = await transactionService.updateAccount(useExistingAccountId, {
            name: newAccountName,
            account_number: newAccountNumber,
            type: newAccountType.trim() || null,
            });
            const existingCards = accounts.find((a) => a.id === useExistingAccountId)?.cards || [];
            await accountFormService.syncCards(useExistingAccountId, existingCards, cardNumbers);
            onMessage?.({ type: 'success', text: `Account "${response.data.name}" updated` });
            setShowAddAccountModal(false);
            await loadAccounts();
        } else {
            const response = await transactionService.createAccount(
            newAccountName,
            newAccountNumber,
            newAccountType.trim() || undefined
            );
            await accountFormService.syncCards(response.data.id, [], cardNumbers);
            onMessage?.({ type: 'success', text: `Account "${response.data.name}" created` });
            setShowAddAccountModal(false);
            onSuccess?.(response?.data);
        }
        setNewAccountName('');
        setNewAccountNumber('');
        setNewAccountType('');
        setCardNumbers([]);
        } catch (err: any) {
        onMessage?.({ type: 'error', text: err.response?.data?.detail || 'Failed to save account' });
        } finally {
        setCreatingAccount(false);
        }
    };
  
    const closeAddAccountModal = () => {
      setShowAddAccountModal(false);
      onCancel?.();
    };

    useEffect(() => {
      setShowAddAccountModal(open);
      setUseExistingAccountId(id || null);
      setNewAccountName(name || '');
      setNewAccountNumber(number || '');
      setNewAccountType(type || '');
      setCardNumbers(cards || []);
    }, [open, id, name, number, type, cards]);

    return (
            <Dialog open={showAddAccountModal} onClose={closeAddAccountModal} maxWidth="sm" fullWidth>
                <DialogTitle>{id ? 'Edit account' : 'New account detected'}</DialogTitle>
                <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
                {!id && (
                    <Typography variant="body2" color="text.secondary">
                    We could not match this file to an existing account. Confirm the details below to add it, or pick an
                    existing account instead.
                    </Typography>
                )}
                <TextField
                    label="Account Name"
                    placeholder="e.g., Checking, Savings, Business"
                    value={newAccountName}
                    onChange={(event) => {
                    setNewAccountName(event.target.value);
                    setUseExistingAccountId(null);
                    }}
                    fullWidth
                />
                <TextField
                    label="Account Number"
                    type="password"
                    placeholder="e.g., ****1234 or 1234567890"
                    helperText="Enter full or masked account number (at least 4 characters)"
                    value={newAccountNumber}
                    onChange={(event) => {
                    setNewAccountNumber(event.target.value);
                    setUseExistingAccountId(null);
                    validateAccountNumber(event.target.value);
                    }}
                    error={!!accountNumberError}
                    fullWidth
                />
                <TextField
                    label="Account Type (optional)"
                    placeholder="e.g., Checking, Savings, Credit, Debit, Curve"
                    value={newAccountType}
                    onChange={(event) => setNewAccountType(event.target.value)}
                    fullWidth
                />

                <Autocomplete
                    multiple
                    freeSolo
                    options={[]}
                    value={cardNumbers}
                    onChange={(_, value) => setCardNumbers(value)}
                    renderInput={(params) => (
                    <TextField
                        {...params}
                        label="Card Numbers (optional)"
                        helperText="Last 4 digits or full/masked number. Keep old ones for replaced cards so past transactions still match."
                        placeholder="e.g. 9948"
                    />
                    )}
                />
                </Stack>
                </DialogContent>
                <DialogActions>
                <Button variant="outlined" onClick={closeAddAccountModal}>Cancel</Button>
                <Button
                    onClick={handleSaveAccount}
                    disabled={
                    creatingAccount ||
                    (!useExistingAccountId && !accountFormService.isAccountFormValid(newAccountName, newAccountNumber))
                    }
                    variant="contained"
                >
                    {creatingAccount
                    ? 'Saving...'
                    : useExistingAccountId
                        ? 'Update Account'
                        : 'Create Account'}
                </Button>
                </DialogActions>
            </Dialog>
    );
};
