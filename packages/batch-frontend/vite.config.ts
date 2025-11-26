import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

// Minimal Vite config for local dev inside the monorepo.
// - Serves frontend on :5173 by default.
// - Proxies /jobs* to the local batch-backend API (default :8080) so the UI
//   can talk to the backend without extra CORS handling.
//
// Configure target via env if needed:
// - BATCH_BACKEND_URL (e.g. http://localhost:8080)
// - Or rely on the default below.
const batchBackendUrl = process.env.BATCH_BACKEND_URL || 'http://localhost:8080';
const proxyRoutes = ['/auth', '/jobs/events', '/jobs', '/uploads', '/config', '/user', '/api'];

function withCookieForwarding() {
  return {
    target: batchBackendUrl,
    changeOrigin: true,
    secure: false,
    configure: (proxy: any) => {
      proxy.on('proxyReq', (proxyReq: any, req: any) => {
        if (req.headers.cookie) {
          proxyReq.setHeader('cookie', req.headers.cookie);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: (() => {
      const proxyConfig: Record<string, any> = {};
      for (const route of proxyRoutes) {
        proxyConfig[route] = {
          ...withCookieForwarding(),
          rewrite: (path: string) => path.replace(/^\/api/, ''),
        };
      }
      return proxyConfig;
    })(),
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
