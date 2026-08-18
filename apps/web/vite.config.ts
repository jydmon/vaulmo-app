import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Phase 1: internal only. The dev server proxies /api to the backend so there
// is no cross-origin exposure and no public surface.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_URL ?? 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
});
