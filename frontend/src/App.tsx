import { AppShell, Box, Button, Group } from '@mantine/core';
import { Link, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import './App.css';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ReviewPage } from './pages/ReviewPage';
import { UploadPage } from './pages/UploadPage';

function App() {
  return (
    <Router>
      <AppShell
        header={{ height: 60 }}
        padding="md"
      >
        <AppShell.Header p="md">
          <Group justify="space-between" style={{ height: '100%' }}>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Family Budget</h1>
            <Group>
              <Button component={Link} to="/" variant="subtle">Upload</Button>
              <Button component={Link} to="/review" variant="subtle">Review</Button>
              <Button component={Link} to="/analytics" variant="subtle">Analytics</Button>
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Main>
          <Box p="md">
            <Routes>
              <Route path="/" element={<UploadPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
            </Routes>
          </Box>
        </AppShell.Main>
      </AppShell>
    </Router>
  );
}

export default App;
