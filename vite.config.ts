import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Read active API port dynamically from env or runtime-ports.json
const readRuntimeApiPort = (): number => {
  if (process.env.CM_API_PORT) return Number(process.env.CM_API_PORT);
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    const file = path.resolve('launcher/runtime-ports.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.apiPort && Number(data.apiPort) > 0) return Number(data.apiPort);
    }
  } catch {}
  return 5180;
};

const SERVER_PORT = readRuntimeApiPort();
const WEB_PORT = Number(process.env.CM_WEB_PORT ?? 5173);

const runtimePortsPlugin = (): Plugin => ({
  name: 'cm-runtime-ports',
  configureServer(server) {
    server.httpServer?.once('listening', () => {
      const addr = server.httpServer?.address();
      if (addr && typeof addr === 'object') {
        const actualPort = addr.port;
        try {
          const file = path.resolve('launcher/runtime-ports.json');
          let current: Record<string, unknown> = {};
          if (fs.existsSync(file)) {
            try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
          }
          current.webPort = actualPort;
          current.webPid = process.pid;
          current.updatedAt = new Date().toISOString();
          const dir = path.dirname(file);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf8');
        } catch {}
      }
    });
  },
});

export default defineConfig({
  plugins: [runtimePortsPlugin()],
  server: {
    host: '0.0.0.0',
    port: WEB_PORT,
    // When port is already occupied by another app, dynamically find next free port
    strictPort: false,
    allowedHosts: true,
    watch: {
      ignored: [
        '**/.agents/**',
        '**/projects/**',
        '**/.git/**',
        '**/resources/**',
        '**/dist-electron/**',
        '**/data/**',
        '**/launcher/runtime-ports.json',
      ],
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

