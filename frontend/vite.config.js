import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
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
        warmup: {
            clientFiles: [
                './src/main.tsx',
                './src/App.tsx',
                './src/pages/DashboardHomePage.tsx',
                './src/pages/ReviewPage.tsx',
                './src/theme/AppTheme.tsx',
                './src/theme/customizations/*.tsx',
                './src/components/**/*.tsx',
            ],
        },
    },
    preview: {
        host: '0.0.0.0',
        port: 5173,
    },
});
