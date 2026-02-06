/// <reference types="vitest" />
import react from '@vitejs/plugin-react-swc';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';

// Minimal Vite config for local dev inside the monorepo.
// - Serves frontend on :5173 by default.
// - Proxies /jobs* to the local batch-backend API (default :8080) so the UI
//   can talk to the backend without extra CORS handling.
//
// Configure target via env if needed:
// - BATCH_BACKEND_URL (e.g. http://localhost:8080)
// - Or rely on the default below.
const batchBackendUrl = process.env.BATCH_BACKEND_URL || 'http://localhost:8080';
const proxyRoutes = ['/api'];

function withCookieForwarding(): ProxyOptions {
  return {
    target: batchBackendUrl,
    changeOrigin: true,
    secure: false,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        const cookie = req.headers.cookie;
        if (cookie) {
          proxyReq.setHeader('cookie', cookie);
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
      const proxyConfig: Record<string, ProxyOptions> = {};
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
  test: {
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
