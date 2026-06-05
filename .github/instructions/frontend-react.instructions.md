---
name: "Frontend Component Development"
description: "Use when: building React components, pages, managing state with Zustand, or connecting to APIs. Focus on component structure, hooks, and TypeScript typing."
applyTo: "frontend/src/**/*.tsx"
---

# Frontend Component Development Guide

## Quick Rules

1. **Always use TypeScript** - No `any` types (except justified escapes)
2. **Functional components + hooks** - No class components
3. **Type Props interface** - Every component gets `interface ComponentProps {}`
4. **Use Zustand for global state** - Not useState for shared data
5. **Handle errors gracefully** - Try/catch, show error messages
6. **Use Mantine components** - Consistent UI
7. **Mobile-responsive** - Use Grid, responsive props

---

## Project Structure

```
frontend/src/
├── App.tsx                  # Router setup
├── pages/
│   ├── UploadPage.tsx       # CSV upload
│   ├── ReviewPage.tsx       # Category review
│   └── AnalyticsPage.tsx    # Dashboard
├── components/              # Reusable components (if any)
├── services/
│   ├── api.ts               # Axios instance
│   ├── transactionService.ts  # API wrappers
│   └── csvService.ts        # CSV utilities
├── store/
│   └── transactionStore.ts  # Zustand store
└── utils/                   # Helpers
```

---

## Creating a Component

### Basic Template
```typescript
import React, { useEffect, useState } from 'react';
import { Container, Stack, Button, Card } from '@mantine/core';
import { transactionService } from '../services/transactionService';
import { useTransactionStore } from '../store/transactionStore';

interface MyComponentProps {
  title: string;
  onClose?: () => void;
}

export const MyComponent: React.FC<MyComponentProps> = ({ 
  title, 
  onClose 
}) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState([]);
  const [error, setError] = useState<string | null>(null);
  const globalState = useTransactionStore();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await transactionService.getData();
      setData(response.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="lg" py="xl">
      <Stack spacing="lg">
        <h1>{title}</h1>
        {error && <Alert color="red">{error}</Alert>}
        <Button onClick={loadData} loading={loading}>
          Refresh
        </Button>
        {/* Component content */}
      </Stack>
    </Container>
  );
};
```

---

## Working with Zustand Store

### Store Definition
```typescript
import { create } from 'zustand';

interface TransactionStore {
  transactions: Transaction[];
  selectedAccount: string | null;
  loading: boolean;
  
  setTransactions: (tx: Transaction[]) => void;
  setSelectedAccount: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  addTransaction: (tx: Transaction) => void;
}

export const useTransactionStore = create<TransactionStore>((set) => ({
  transactions: [],
  selectedAccount: null,
  loading: false,
  
  setTransactions: (transactions) => set({ transactions }),
  setSelectedAccount: (id) => set({ selectedAccount: id }),
  setLoading: (loading) => set({ loading }),
  addTransaction: (tx) => set((state) => ({
    transactions: [...state.transactions, tx]
  })),
}));
```

### Using Store
```typescript
export const MyComponent = () => {
  const transactions = useTransactionStore((state) => state.transactions);
  const setTransactions = useTransactionStore((state) => state.setTransactions);
  
  const updateTransactions = () => {
    setTransactions([...transactions, newTx]);
  };
  
  return <div>{transactions.length} items</div>;
};
```

---

## API Integration Pattern

### Service Interface
```typescript
// frontend/src/services/transactionService.ts
export const transactionService = {
  getTransactions: (limit = 100, offset = 0) =>
    api.get('/transactions', { params: { limit, offset } }),
  
  updateTransaction: (id: string, category: string) =>
    api.patch(`/transactions/${id}`, { category_final: category }),
};
```

### Component Usage
```typescript
const MyComponent = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await transactionService.getTransactions();
      setTransactions(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return <div>{/* ... */}</div>;
};
```

---

## Using Mantine Components

### Common UI Patterns

**Stack Layout**
```typescript
<Stack spacing="lg">
  <h1>Title</h1>
  <Text>Description</Text>
  <Button>Action</Button>
</Stack>
```

**Grid for Responsive**
```typescript
<Grid gutter="lg">
  <Grid.Col span={{ base: 12, md: 6 }}>
    {/* 12 cols on mobile, 6 on desktop */}
  </Grid.Col>
  <Grid.Col span={{ base: 12, md: 6 }}>
    {/* ... */}
  </Grid.Col>
</Grid>
```

**Alert/Notifications**
```typescript
<Alert color="red">
  Error message
</Alert>

<Alert color="green">
  Success!
</Alert>

<Alert color="blue">
  Info
</Alert>
```

**Form Input**
```typescript
<TextInput
  label="Name"
  placeholder="Enter name"
  value={name}
  onChange={(e) => setName(e.currentTarget.value)}
/>

<Select
  label="Category"
  data={CATEGORIES}
  value={selected}
  onChange={setSelected}
  searchable
/>

<Button onClick={handleSubmit} loading={loading}>
  Submit
</Button>
```

---

## Data Tables with AG Grid

### Basic Setup
```typescript
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

export const MyTable = () => {
  const [rowData, setRowData] = useState([]);

  const columns = [
    { 
      field: 'date', 
      headerName: 'Date',
      width: 100
    },
    { 
      field: 'amount', 
      headerName: 'Amount',
      valueFormatter: (params: any) => 
        `$${(params.value || 0).toFixed(2)}`
    },
    { 
      field: 'description',
      headerName: 'Description',
      flex: 2,
      wrapText: true,
      autoHeight: true
    },
  ];

  return (
    <div style={{ height: '600px', width: '100%' }} 
         className="ag-theme-quartz">
      <AgGridReact 
        rowData={rowData}
        columnDefs={columns}
        pagination={true}
        paginationPageSize={25}
      />
    </div>
  );
};
```

---

## Charts with Recharts

### Pie Chart
```typescript
import { PieChart, Pie, Cell, Legend, Tooltip } from 'recharts';

const data = [
  { name: 'groceries', value: 520 },
  { name: 'rent', value: 1200 },
];

<ResponsiveContainer width="100%" height={300}>
  <PieChart>
    <Pie
      data={data}
      cx="50%"
      cy="50%"
      outerRadius={100}
      fill="#8884d8"
      dataKey="value"
    >
      {data.map((entry, index) => (
        <Cell key={`cell-${index}`} fill={COLORS[index]} />
      ))}
    </Pie>
    <Legend />
    <Tooltip />
  </PieChart>
</ResponsiveContainer>
```

### Bar Chart
```typescript
<ResponsiveContainer width="100%" height={300}>
  <BarChart data={trendData}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="month" />
    <YAxis />
    <Tooltip />
    <Legend />
    <Bar dataKey="income" fill="#82ca9d" />
    <Bar dataKey="expenses" fill="#ff7c7c" />
  </BarChart>
</ResponsiveContainer>
```

---

## File Upload Handling

### CSV File Upload
```typescript
import { FileInput } from '@mantine/core';
import { csvService } from '../services/csvService';

const [file, setFile] = useState<File | null>(null);

const handleFileSelect = async (file: File | null) => {
  if (!file) return;
  
  try {
    const rows = await csvService.parseFile(file);
    console.log('Parsed rows:', rows);
    // Process rows
  } catch (err) {
    console.error('Failed to parse', err);
  }
};

return (
  <FileInput
    label="Select CSV"
    placeholder="Choose file"
    value={file}
    onChange={handleFileSelect}
    accept=".csv"
  />
);
```

---

## Common Patterns

### Loading States
```typescript
{loading ? (
  <Loader />
) : data.length > 0 ? (
  <div>{/* Render data */}</div>
) : (
  <Text>No data available</Text>
)}
```

### Error Handling
```typescript
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  loadData();
}, []);

const loadData = async () => {
  setError(null);
  try {
    const res = await api.get('/endpoint');
    setData(res.data);
  } catch (err: any) {
    setError(err.response?.data?.detail || 'Error');
  }
};

return (
  <>
    {error && <Alert color="red">{error}</Alert>}
    {/* ... */}
  </>
);
```

### Filtering & Pagination
```typescript
const [filtered, setFiltered] = useState<Transaction[]>([]);
const [page, setPage] = useState(0);
const pageSize = 25;

const paginatedData = filtered.slice(
  page * pageSize, 
  (page + 1) * pageSize
);

const totalPages = Math.ceil(filtered.length / pageSize);
```

---

## Responsive Design

### Mantine Responsive Props
```typescript
// Different sizes for different breakpoints
<Grid gutter={{ base: 8, xs: 12, md: 16 }}>
  <Grid.Col span={{ base: 12, xs: 6, md: 4 }}>
    Small screen: full width, Medium+: 33%
  </Grid.Col>
</Grid>

// Responsive hiding
<div style={{ display: isSmall ? 'none' : 'block' }}>
  Hidden on mobile
</div>

// Responsive padding
<Container size={{ base: '100%', md: 'lg' }} py={{ base: 16, md: 32 }}>
  Variable sizes
</Container>
```

---

## TypeScript Tips

### Type All Props
```typescript
interface PageProps {
  onSubmit: (data: Transaction) => void;
  initialValue?: string;
}

export const MyPage: React.FC<PageProps> = ({ 
  onSubmit, 
  initialValue = '' 
}) => {
  // ...
};
```

### Union Types
```typescript
type Status = 'loading' | 'success' | 'error';

const [status, setStatus] = useState<Status>('loading');
```

### Optional Chaining
```typescript
const value = data?.item?.nested?.field ?? 'fallback';
```

---

## Testing Component

### Manual Testing
1. Save file → Auto-reloads via Vite
2. Open browser DevTools (F12)
3. Check Network tab for API calls
4. Check Console for errors

### Debug Hooks
```typescript
useEffect(() => {
  console.log('Component mounted');
  return () => console.log('Component unmounted');
}, []);

useEffect(() => {
  console.log('Data changed:', data);
}, [data]);
```

---

## Common Mistakes

❌ **Don't use `any` type**
```typescript
// WRONG
const handleChange = (e: any) => {
  // ...
};
```

✅ **Do type properly**
```typescript
// RIGHT
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  // ...
};
```

❌ **Don't call async in render**
```typescript
// WRONG - causes infinite loops
return (
  <div>
    {transactionService.getTransactions().then(...)}
  </div>
);
```

✅ **Use useEffect**
```typescript
// RIGHT
useEffect(() => {
  loadData();
}, []);
```

---

**Example**: See `frontend/src/pages/` for all current pages
