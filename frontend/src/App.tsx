import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded';
import CalendarViewMonthRoundedIcon from '@mui/icons-material/CalendarViewMonthRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import {
    Alert,
    AppBar,
    Box,
    Chip,
    CssBaseline,
    IconButton,
    List,
    ListItemButton,
    ListItemIcon,
    Stack,
    Toolbar,
    Typography
} from '@mui/material';
import React, { useContext } from 'react';
import { Link, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';
import './App.css';
import { AccountsPage } from './pages/AccountsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CoveragePage } from './pages/CoveragePage';
import { DashboardHomePage } from './pages/DashboardHomePage';
import { ReviewPage } from './pages/ReviewPage';
import { UploadPage } from './pages/UploadPage';
import { useTransactionStore } from './store/transactionStore';
import { ColorModeContext } from './theme/ColorModeContext';

const DRAWER_WIDTH = 240;

const NAV_LINKS: { to: string; label: string; icon: React.ReactNode; subLabel?: string }[] = [
  { to: '/',           label: 'Dashboard',  icon: <DashboardRoundedIcon sx={{ fontSize: 18 }} /> },
  { to: '/categories', label: 'Categories', icon: <BarChartRoundedIcon sx={{ fontSize: 18 }} />, subLabel: 'Compare spending periods, inspect category concentration, and export category and trend views.' },
  { to: '/uploads',    label: 'Uploads',    icon: <CloudUploadRoundedIcon sx={{ fontSize: 18 }} />, subLabel: 'Upload one or more CSV files with your transaction history' },
  { to: '/accounts',   label: 'Accounts',   icon: <AccountBalanceWalletRoundedIcon sx={{ fontSize: 18 }} />, subLabel: 'Manage accounts' },
  { to: '/coverage',   label: 'Coverage',   icon: <CalendarViewMonthRoundedIcon sx={{ fontSize: 18 }} />, subLabel: 'View coverage data' },
  { to: '/review',     label: 'Review',     icon: <FactCheckRoundedIcon sx={{ fontSize: 18 }} />, subLabel: 'Review and correct transaction categories' },
];

function NavBar() {
  const location = useLocation();
  return (
    <List sx={{ py: 0 }}>
      {NAV_LINKS.map((link) => (
        <ListItemButton
          key={link.to}
          component={Link}
          to={link.to}
          selected={location.pathname === link.to}
          sx={{
            borderRadius: 1.5,
            mb: 0.25,
            px: 1.5,
            py: 0.875,
            minHeight: 40,
            '&.Mui-selected': {
              bgcolor: 'action.selected',
              '& .MuiListItemIcon-root': { color: 'primary.main' },
              '& .MuiTypography-root':   { color: 'primary.main', fontWeight: 700 },
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 30, color: 'text.secondary' }}>{link.icon}</ListItemIcon>
          <Typography sx={{ fontWeight: 500, fontSize: '0.83rem' }}>{link.label}</Typography>
        </ListItemButton>
      ))}
    </List>
  );
}

function GlobalErrorBanner() {
  const { error, setError } = useTransactionStore();
  if (!error) return null;
  return (
    <Alert severity="error" sx={{ mb: 2 }}
      action={<IconButton aria-label="close" color="inherit" size="small" onClick={() => setError(null)}>×</IconButton>}
    >
      {error}
    </Alert>
  );
}

function PageHeader({ setMobileOpen }: { setMobileOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  const location = useLocation();
  const { mode, toggleMode } = useContext(ColorModeContext);
  const { label = '' } = NAV_LINKS.find((l) => l.to === location.pathname) || {};
  return (
    <AppBar position="fixed" color="default" elevation={0}
      sx={{
        width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
        ml: { md: `${DRAWER_WIDTH}px` },
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', minHeight: { xs: 54, sm: 58 }, px: { xs: 2, sm: 2.5 } }}>
        <Stack direction="row" sx={{ alignItems: 'center' }} spacing={0.75}>
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Family Budget</Typography>
          <NavigateNextRoundedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{label || 'Home'}</Typography>
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Chip
            label={new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            size="small" variant="outlined"
            sx={{ fontSize: '0.7rem', height: 24, borderRadius: '6px', display: { xs: 'none', sm: 'flex' } }}
          />
          <IconButton size="small" aria-label="notifications" sx={{ color: 'text.secondary', width: 34, height: 34 }}>
            <NotificationsRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton size="small" onClick={toggleMode} aria-label="toggle theme" sx={{ color: 'text.secondary', width: 34, height: 34 }}>
            {mode === 'dark' ? <LightModeRoundedIcon sx={{ fontSize: 18 }} /> : <DarkModeRoundedIcon sx={{ fontSize: 18 }} />}
          </IconButton>
          <IconButton onClick={() => setMobileOpen((p) => !p)} sx={{ display: { md: 'none' }, color: 'text.secondary', width: 34, height: 34 }} size="small">
            <MenuRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}



import AppTheme from './theme/AppTheme';
import {
    chartsCustomizations,
    dataGridCustomizations,
    datePickersCustomizations,
    treeViewCustomizations,
} from './theme/customizations';

const xThemeComponents = {
  ...chartsCustomizations,
  ...dataGridCustomizations,
  ...datePickersCustomizations,
  ...treeViewCustomizations,
};

export default function App(props: { disableCustomTheme?: boolean }) {
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
          sx={(theme) => ({
            flexGrow: 1,
            backgroundColor: theme.vars
              ? `rgba(${theme.vars.palette.background.defaultChannel} / 1)`
              : alpha(theme.palette.background.default, 1),
            overflow: 'auto',
          })}
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
            <GlobalErrorBanner />
            <Routes>
              <Route path="/"           element={<DashboardHomePage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/analytics"  element={<AnalyticsPage />} />
              <Route path="/uploads"    element={<UploadPage />} />
              <Route path="/accounts"   element={<AccountsPage />} />
              <Route path="/review"     element={<ReviewPage />} />
              <Route path="/coverage"   element={<CoveragePage />} />
            </Routes>
          </Stack>
        </Box>
      </Box>
    </AppTheme>
    </Router>
  );
}

