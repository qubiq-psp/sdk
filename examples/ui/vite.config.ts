import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';

/**
 * Two builds from the same code (plan 4.11). The only difference is the payment widget component:
 * - `sdk`   — `<PspCheckout>` of `@qubiq-psp/react`;
 * - `plain` — a plain iframe with its own `postMessage` handling, so the bundle carries no `@qubiq-psp/*` code.
 * `vite build --mode sdk|plain` picks one; `vite` (dev) takes `sdk` unless `--mode plain` or `UI_VARIANT=plain`.
 */
export type UiVariant = 'sdk' | 'plain';

export function uiVariant(mode: string, env: Record<string, string | undefined>): UiVariant {
  if (mode === 'sdk' || mode === 'plain') return mode;
  return env['UI_VARIANT'] === 'plain' ? 'plain' : 'sdk';
}

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

const SDK_MODULE = /@qubiq-psp[\\/]|[\\/]packages[\\/](react|node)[\\/]/;

/**
 * Checks the module graph of the bundle: the `plain` build fails when any module of `@qubiq-psp/*` (or of the
 * workspace packages) ends up in a chunk; the `sdk` build fails when `@qubiq-psp/react` is missing, which proves the
 * check sees the SDK when it is there.
 */
function sdkModuleCheck(variant: UiVariant): Plugin {
  return {
    name: 'psp-examples:sdk-module-check',
    apply: 'build',
    generateBundle(_options, bundle) {
      const sdk = Object.values(bundle).flatMap((chunk) =>
        chunk.type === 'chunk' ? Object.keys(chunk.modules).filter((id) => SDK_MODULE.test(id)) : [],
      );
      if (variant === 'plain' && sdk.length > 0) {
        this.error(`the plain build must not contain SDK code, found: ${sdk.join(', ')}`);
      }
      if (variant === 'sdk' && sdk.length === 0) this.error('the sdk build must contain @qubiq-psp/react');
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), ['VITE_', 'UI_']) };
  const variant = uiVariant(mode, env);
  // Dev only: Vite serves the UI with hot reload and passes /api and /webhooks to a backend (plain listens on 4600,
  // sdk on 4900). A deployment has nginx in front instead.
  const backend = env['VITE_BACKEND_URL'] ?? 'http://127.0.0.1:4600';
  const toBackend: ProxyOptions = {
    target: backend,
    changeOrigin: true,
    // A platform call may take up to 180 s per attempt (gateway docs 13.10)
    timeout: 190_000,
    proxyTimeout: 190_000,
    configure(proxy) {
      // Server-Sent Events must reach the browser at once: no compression, no buffering
      proxy.on('proxyReq', (proxyReq, req) => {
        if (req.url?.startsWith('/api/stream')) proxyReq.setHeader('accept-encoding', 'identity');
        // The backend refuses a state-changing request whose Origin is not its Host (CSRF). changeOrigin sets Host to
        // the backend's, so a request of this dev page gets the backend's origin too; any other Origin (another
        // site) goes on as it is and is refused.
        const origin = req.headers.origin;
        if (origin !== undefined && origin === `http://${req.headers.host ?? ''}`) {
          proxyReq.setHeader('origin', new URL(backend).origin);
        }
      });
      proxy.on('proxyRes', (proxyRes, req) => {
        if (req.url?.startsWith('/api/stream')) {
          proxyRes.headers['cache-control'] = 'no-store';
          proxyRes.headers['x-accel-buffering'] = 'no';
        }
      });
    },
  };

  return {
    plugins: [react(), tailwindcss(), sdkModuleCheck(variant)],
    resolve: {
      alias: [
        // The widget of this build: one of the two files, chosen here and nowhere else
        { find: 'virtual:checkout-frame', replacement: src(`widget/checkout-frame.${variant}.tsx`) },
        { find: /^@\//, replacement: src('') },
      ],
    },
    server: {
      host: '127.0.0.1',
      port: 5177,
      strictPort: false,
      proxy: { '/api': toBackend, '/webhooks': toBackend },
    },
    preview: { host: '127.0.0.1', port: 5178, proxy: { '/api': toBackend, '/webhooks': toBackend } },
    build: {
      outDir: `dist/${variant}`,
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: false,
      // No data: URLs, so a strict CSP (`img-src 'self'`, `font-src 'self'`) works
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          // Libraries in their own chunks: the browser cache outlives deployments that change only the UI code
          manualChunks(id) {
            if (!id.includes('/node_modules/')) return undefined;
            if (/\/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id)) return 'react';
            if (/\/node_modules\/(@radix-ui|@floating-ui)\//.test(id)) return 'radix';
            return 'vendor';
          },
        },
      },
    },
  };
});
