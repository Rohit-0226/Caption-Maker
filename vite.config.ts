import { defineConfig } from 'vite';

// Defaults are the ports everyone uses; the overrides let a second, throwaway
// stack run beside the real one (tests, a desktop app started with other ports).
const SERVER_PORT = Number(process.env.CM_API_PORT ?? process.env.PORT ?? 5180);
const WEB_PORT = Number(process.env.CM_WEB_PORT ?? 5173);

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: WEB_PORT,
    // The desktop app and the Web & Share launcher share one stack on fixed
    // ports. Drifting to 5174 when 5173 is taken would leave a second, unseen
    // web server behind; failing loudly lets the late starter attach instead.
    strictPort: true,
    allowedHosts: true,
    watch: {
      ignored: ['**/.agents/**', '**/projects/**', '**/.git/**', '**/resources/**', '**/dist-electron/**', '**/data/**'],
    },
    proxy: {
      // the API and any media/SSE it serves live on the Node server
      '/api': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        // server-sent events must not be buffered
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
