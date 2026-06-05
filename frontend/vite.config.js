import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// During dev we proxy /api to the backend so the browser never needs the
// backend origin and there are no CORS surprises.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_BACKEND_URL || 'http://localhost:4000';
  return {
    plugins: [react()],
    server: {
      // Bind to all interfaces (IPv4 + IPv6). Without this, Vite may bind only to
      // IPv6 ::1 on Windows, so http://localhost (IPv4 127.0.0.1) is refused.
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        // Force the proxy target to IPv4 so it reaches the backend reliably.
        '/api': { target: backend.replace('localhost', '127.0.0.1'), changeOrigin: true },
      },
    },
  };
});
