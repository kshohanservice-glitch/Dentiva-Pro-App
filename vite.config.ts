import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri 2 dev server: fixed port, strictPort. sql.js WASM served from node_modules.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2021',
    // Web bundle goes to dist-web; repo-root /dist is reserved for the
    // final Windows installer fallback artifact (per release spec).
    outDir: 'dist-web',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  } as never,
});
