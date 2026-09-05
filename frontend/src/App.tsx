import { Alert, Box, CssBaseline, IconButton, Stack } from '@mui/material';
import { useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import './App.css';
import AppNavbar from './components/AppNavbar';
import Header from './components/Header';
import SideMenu from './components/SideMenu';
import { AccountsPage } from './pages/AccountsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CoveragePage } from './pages/CoveragePage';
import { DashboardHomePage } from './pages/DashboardHomePage';
import { ReviewPage } from './pages/ReviewPage';
import { UploadPage } from './pages/UploadPage';
import { useTransactionStore } from './store/transactionStore';
import AppTheme from './theme/AppTheme';
import { chartsCustomizations, datePickersCustomizations } from './theme/customizations';

const xThemeComponents = {
  ...chartsCustomizations,
  ...datePickersCustomizations,
};

function GlobalErrorBanner() {
  const { error, setError } = useTransactionStore();
  if (!error) return null;
  return (
    <Alert
      severity="error"
      sx={{ mb: 2, width: '100%' }}
      action={
        <IconButton aria-label="close" color="inherit" size="small" onClick={() => setError(null)}>
          ×
        </IconButton>
      }
    >
      {error}
    </Alert>
  );
}

export default function App(props: { disableCustomTheme?: boolean }) {
  // Previously only loaded as a side effect of visiting Uploads/Categories/
  // Review - landing directly on any other route (notably "/", the default)
  // left accounts and categories empty for the whole session: the Accounts
  // filter stayed unpickable and any category-key-to-label lookup failed
  // silently. .getState() rather than the hook - this doesn't need to
  // re-render App when they load.
  useEffect(() => {
    const { loadAccounts, loadCategories } = useTransactionStore.getState();
    loadAccounts();
    loadCategories();
  }, []);

  return (
    <Router>
      <AppTheme {...props} themeComponents={xThemeComponents}>
        <CssBaseline enableColorScheme />
        <Box sx={{ display: 'flex' }}>
          <SideMenu />
          <AppNavbar />
          {/* Main content */}
          <Box
            component="main"
            sx={{
              flexGrow: 1,
              backgroundColor: 'background.default',
              overflow: 'auto',
            }}
          >
            <Stack
              spacing={2}
              sx={{
                alignItems: 'center',
                mx: 3,
                pb: 5,
                mt: { xs: 8, md: 0 },
              }}
            >
              <Header />
              <Box sx={{ width: '100%', maxWidth: '1700px' }}>
                <GlobalErrorBanner />
                <Routes>
                  <Route path="/" element={<DashboardHomePage />} />
                  <Route path="/categories" element={<CategoriesPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/uploads" element={<UploadPage />} />
                  <Route path="/accounts" element={<AccountsPage />} />
                  <Route path="/review" element={<ReviewPage />} />
                  <Route path="/coverage" element={<CoveragePage />} />
                </Routes>
              </Box>
            </Stack>
          </Box>
        </Box>
      </AppTheme>
    </Router>
  );
}
