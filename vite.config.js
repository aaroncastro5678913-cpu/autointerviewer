import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One Vite config for the whole project. The interview UI source lives in
// frontend/ (it is NOT a separate npm project — there is one root package.json).
// Output goes to dist/ which Netlify publishes.
export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Dev proxy: the browser calls /api/*, forwarded to the local backend.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
});
