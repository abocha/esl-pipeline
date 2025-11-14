import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// Minimal Vite config for local dev inside the monorepo.
// - Serves frontend on :5173 by default.
// - Proxies /jobs* to the local batch-backend API (default :8080) so the UI
//   can talk to the backend without extra CORS handling.
//
// Configure target via env if needed:
// - BATCH_BACKEND_URL (e.g. http://localhost:8080)
// - Or rely on the default below.
const batchBackendUrl = process.env.BATCH_BACKEND_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Proxy all API routes to batch-backend for authentication
      '/api': {
        target: batchBackendUrl,
        changeOrigin: true,
        configure: (proxy, _options) => {
          // Ensure cookies are forwarded for authentication
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Forward cookies for session management
            if (req.headers.cookie) {
              proxyReq.setHeader('cookie', req.headers.cookie);
            }
          });
        },
      },
    },
    // Security headers for development
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },
  build: {
    sourcemap: true,
    // Security headers for production build
    rollupOptions: {
      output: {
        // Add integrity checks to chunks
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  // Content Security Policy
  define: {
    __CSP__: JSON.stringify({
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'font-src': ["'self'"],
      'connect-src': ["'self'", batchBackendUrl.replace(/\/$/, '')],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
    }),
  },
});
