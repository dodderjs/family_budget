import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded';
import CalendarViewMonthRoundedIcon from '@mui/icons-material/CalendarViewMonthRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import React from 'react';

export type NavLink = {
  to: string;
  label: string;
  icon: React.ReactNode;
  subLabel?: string;
};

export const NAV_LINKS: NavLink[] = [
  { to: '/', label: 'Dashboard', icon: <DashboardRoundedIcon sx={{ fontSize: 20 }} /> },
  { to: '/categories', label: 'Categories', icon: <BarChartRoundedIcon sx={{ fontSize: 20 }} />, subLabel: 'Compare spending periods, inspect category concentration, and export category and trend views.' },
  { to: '/uploads', label: 'Uploads', icon: <CloudUploadRoundedIcon sx={{ fontSize: 20 }} />, subLabel: 'Upload one or more CSV files with your transaction history' },
  { to: '/accounts', label: 'Accounts', icon: <AccountBalanceWalletRoundedIcon sx={{ fontSize: 20 }} />, subLabel: 'Manage accounts' },
  { to: '/coverage', label: 'Coverage', icon: <CalendarViewMonthRoundedIcon sx={{ fontSize: 20 }} />, subLabel: 'View coverage data' },
  { to: '/review', label: 'Review', icon: <FactCheckRoundedIcon sx={{ fontSize: 20 }} />, subLabel: 'Review and correct transaction categories' },
];
