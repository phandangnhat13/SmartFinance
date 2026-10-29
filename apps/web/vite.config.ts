import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev proxy target is overridable so the browser E2E suite can point the
// app at its own isolated API instance instead of the developer's server.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks keep the browser cache useful across
        // deployments while pages are loaded on demand.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'data-vendor': ['@tanstack/react-query'],
          'form-vendor': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'chart-vendor': ['recharts'],
        },
      },
    },
  },
});
