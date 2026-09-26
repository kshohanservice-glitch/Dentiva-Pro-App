// Dentiva Pro — no-TODO gate: production source must not contain placeholders.
// Run: npm run audit:todo
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-web', 'target', '.vite', 'coverage']);
const SCAN_EXTS = new Set(['.ts', '.tsx', '.rs']);

// NOTE: HTML/UX input attributes named `placeholder=` are legitimate and exempt.
const PATTERNS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /\bHACK\b/,
  /lorem ipsum/i,
  /coming soon/i,
  /not implemented/i,
  /console\.log\(/,
];

const findings = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(e)) walk(p);
    } else if (SCAN_EXTS.has(extname(e))) {
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const stripped = line.replace(/placeholder\s*=\s*(['"`{])[^'"}`]*['"`}]?/g, '');
        for (const re of PATTERNS) {
          if (re.test(stripped)) findings.push(`${p}:${i + 1}: ${stripped.trim().slice(0, 140)}`);
        }
      });
    }
  }
}
walk(join(ROOT, 'src'));
walk(join(ROOT, 'src-tauri'));
if (findings.length > 0) {
  console.error('no-todo FAILED:\n' + findings.join('\n'));
  process.exit(1);
}
console.log('no-todo OK: no placeholders or TODO markers.');
