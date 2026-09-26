// Copies sql.js WASM into public/ so the browser fallback backend can load it
// offline (dev server, tests, and Tauri bundle).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const wasm = join(dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
const dest = join(here, '..', 'public', 'sql-wasm.wasm');
mkdirSync(dirname(dest), { recursive: true });
if (existsSync(wasm)) {
  copyFileSync(wasm, dest);
  console.log('copied sql-wasm.wasm -> public/');
} else {
  console.warn('sql-wasm.wasm not found at', wasm);
}
