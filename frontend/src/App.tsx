import { Alert, AppShell, Box, Button, Group, Text } from '@mantine/core';
import React from 'react';
import { Link, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';
import './App.css';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CoveragePage } from './pages/CoveragePage';
import { ReviewPage } from './pages/ReviewPage';
import { UploadPage } from './pages/UploadPage';
import { useTransactionStore } from './store/transactionStore';

const NAV_LINKS = [
  { to: '/', label: 'Upload' },
  { to: '/review', label: 'Review' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/coverage', label: 'Coverage' },
];

function NavBar() {
  const location = useLocation();
  return (
    <Group>
      {NAV_LINKS.map((link) => (
        <Button
          key={link.to}
          component={Link}
          to={link.to}
          variant={location.pathname === link.to ? 'filled' : 'subtle'}
        >
          {link.label}
        </Button>
      ))}
    </Group>
  );
}

function GlobalErrorBanner() {
  const { error, setError } = useTransactionStore();
  if (!error) return null;
  return (
    <Alert color="red" mb="md" withCloseButton onClose={() => setError(null)}>
      {error}
    </Alert>
  );
}

function App() {
  const loadAccounts = useTransactionStore((s) => s.loadAccounts);
  const loadCategories = useTransactionStore((s) => s.loadCategories);

  React.useEffect(() => {
    loadAccounts();
    loadCategories();
  }, [loadAccounts, loadCategories]);

  return (
    <Router>
      <AppShell
        header={{ height: 60 }}
        padding="md"
      >
        <AppShell.Header p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Group justify="space-between" style={{ height: '100%' }}>
            <Text component="h1" fw={700} size="lg" m={0}>Family Budget</Text>
            <NavBar />
          </Group>
        </AppShell.Header>

        <AppShell.Main>
          <Box p="md">
            <GlobalErrorBanner />
            <Routes>
              <Route path="/" element={<UploadPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/coverage" element={<CoveragePage />} />
            </Routes>
          </Box>
        </AppShell.Main>
      </AppShell>
    </Router>
  );
}

export default App;
