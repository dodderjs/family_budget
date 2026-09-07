import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Same-origin API in dev: the page calls /api/v1 on whatever host it was
    // loaded from (localhost, a LAN IP, a hostname), so no cross-origin request
    // is ever made and CORS never applies.
    proxy: {
      '/api': { target: 'http://backend:8000', changeOrigin: true },
    },
    watch: {
      // The source lives on a Windows drive bind-mounted into WSL2, where
      // inotify events don't propagate - without polling, HMR never fires.
      // The interval is explicit because the default (~100ms) re-stats every
      // watched file ten times a second for no benefit here.
      usePolling: true,
      interval: 1000,
    },
    // Dev serves every module as its own request, and the first load pays the
    // transform cost for all of them. Warming the entry points transforms them
    // in the background at startup instead of during that first page load.
    // Deliberately only the route entry points: globbing every component (and
    // through ReviewPage, all of ag-grid-enterprise) pinned the whole module
    // graph in memory from startup for a first-load saving that never showed up.
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/App.tsx',
        './src/pages/DashboardHomePage.tsx',
        './src/pages/ReviewPage.tsx',
        './src/theme/AppTheme.tsx',
      ],
    },
  },
  // Dependency pre-bundles are never stepped through in a debugger, and their
  // sourcemaps were over half of the 27MB .vite/deps cache the dev server reads
  // and holds.
  optimizeDeps: {
    esbuildOptions: { sourcemap: false },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
  },
})
