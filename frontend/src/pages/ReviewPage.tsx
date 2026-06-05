import { Badge, Button, Container, Group, Select, Stack } from '@mantine/core';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { AgGridReact } from 'ag-grid-react';
import React, { useEffect, useState } from 'react';
import { Transaction, transactionService } from '../services/transactionService';

const CATEGORIES = [
  'groceries',
  'rent',
  'salary',
  'utilities',
  'transport',
  'entertainment',
  'other'
];

export const ReviewPage: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string>();

  const loadAccounts = async () => {
    try {
      const response = await transactionService.listAccounts();
      setAccounts(response.data);
    } catch (err) {
      console.error('Failed to load accounts');
    }
  };

  const loadTransactions = async () => {
    setLoading(true);
    try {
      const response = await transactionService.getReviewTransactions(50);
      setTransactions(response.data);
    } catch (err) {
      console.error('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
    loadTransactions();
  }, []);

  const handleCategoryUpdate = async (transactionId: string, category: string) => {
    try {
      await transactionService.updateTransaction(transactionId, category);
      setTransactions(t => t.map(x => 
        x.id === transactionId ? { ...x, category_final: category } : x
      ));
      setEditingId(null);
    } catch (err) {
      console.error('Failed to update transaction');
    }
  };

  const columns = [
    { 
      field: 'date', 
      headerName: 'Date', 
      width: 100,
      cellClass: 'fixed-column'
    },
    { 
      field: 'amount', 
      headerName: 'Amount', 
      width: 100,
      valueFormatter: (params: any) => `$${(params.value || 0).toFixed(2)}`
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
      width: 150
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
      width: 100,
      valueFormatter: (params: any) => `${((params.value || 0) * 100).toFixed(0)}%`
    },
    { 
      field: 'category_final',
      headerName: 'Final Category',
      width: 150,
      cellRenderer: (params: any) => (
        editingId === params.data.id ? (
          <Select
            placeholder="Select category"
            data={CATEGORIES}
            value={editingCategory}
            onChange={(val) => setEditingCategory(val || undefined)}
            searchable
            onBlur={() => {
              if (editingCategory) {
                handleCategoryUpdate(params.data.id, editingCategory);
              }
            }}
          />
        ) : (
          <div onClick={() => {
            setEditingId(params.data.id);
            setEditingCategory(params.value);
          }} style={{ cursor: 'pointer', padding: '4px', borderRadius: '4px', backgroundColor: '#f0f0f0' }}>
            {params.value ? <Badge>{params.value}</Badge> : '+ Add'}
          </div>
        )
      )
    }
  ];

  return (
    <Container size="xl" py="xl">
      <Stack spacing="lg">
        <div>
          <h1>Review & Categorize</h1>
          <p>Review and correct transaction categories</p>
        </div>

        <Group>
          <Button onClick={loadTransactions} loading={loading}>
            Refresh
          </Button>
          <Button onClick={() => transactionService.retrainModel()} variant="outline">
            Retrain Model
          </Button>
        </Group>

        <div style={{ height: '600px', width: '100%' }} className="ag-theme-quartz">
          <AgGridReact 
            rowData={transactions}
            columnDefs={columns}
            domLayout="fill"
            rowSelection="multiple"
            pagination={true}
            paginationPageSize={25}
          />
        </div>
      </Stack>
    </Container>
  );
};
