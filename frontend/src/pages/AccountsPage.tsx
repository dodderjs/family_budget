import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Container,
    Stack,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { AccountForm } from '../components/AccountForm';
import { Account, transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

export const AccountsPage: React.FC = () => {
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [accountDialog, setAccountDialog] = useState<{
    open: boolean;
    id?: string;
    name?: string;
    number?: string;
    type?: string|null;
    cards?: string[];
  }>({ open: false});  

  const {
    accounts,
    loadAccounts,
  } = useTransactionStore();


  const openAddAccountDialog = (name?: string, number?: string, type?: string) => {
    setAccountDialog({ open: true, name, number, type });
  };

  const openEditAccountDialog = (acc: Account) => {
    setAccountDialog({ 
        open: true, 
        id: acc.id,
        name: acc.name, 
        number: acc.account_number, 
        type: acc.type,
        cards: acc.cards.map((c) => c.card_number)
     });
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



  const accountCount = accounts.length;
  const cardsCount = accounts.reduce((sum, account) => sum + account.cards.length, 0);
  const typeCount = accounts.reduce((sum, account) => sum + (account.type ? 1 : 0), 0);
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
              <Typography variant="overline" color="text.secondary">Account types</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{typeCount}</Typography>
              <Typography variant="caption" color="text.secondary">Accounts with a specified type</Typography>
            </CardContent>
          </Card>
        </Box>

        {message && (
          <Alert severity={message.type === 'error' ? 'error' : message.type === 'success' ? 'success' : 'info'}>
            {message.text}
          </Alert>
        )}

        <AccountForm {...accountDialog} onSuccess={() => loadAccounts()} onMessage={setMessage} />
        
        <Stack spacing={2}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Your Accounts</Typography>
            <Button
            onClick={() => {
                openAddAccountDialog();
            }}
            variant="contained"
            >
            + Add Account
            </Button>
        </Stack>
        {accounts.length === 0 ? (
            <Alert severity="warning">No accounts yet. Create one to get started!</Alert>
        ) : (
            <Box
            sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(3, minmax(0, 1fr))',
                },
            }}
            >
            {accounts.map((acc) => (
                <Card key={acc.id} variant="outlined" sx={{ p: 2.25 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography sx={{ fontWeight: 600 }}>{acc.name}</Typography>
                        {acc.type && <Chip size="small" variant="outlined" label={acc.type} />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {acc.account_number}
                    </Typography>
                    {acc.cards.length > 0 && (
                        <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap' }}>
                        {acc.cards.map((c) => (
                            <Chip key={c.id} size="small" variant="outlined" label={c.card_number} />
                        ))}
                        </Stack>
                    )}
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                    <Button size="small" variant="text" onClick={() => openEditAccountDialog(acc)}>
                        Edit
                    </Button>
                    <Button size="small" variant="text" color="error" onClick={() => handleDeleteAccount(acc)}>
                        Delete
                    </Button>
                    </Stack>
                </Stack>
                </Card>
            ))}
            </Box>
        )}
        </Stack>
    
      </Stack>
    </Container>
  );
};
