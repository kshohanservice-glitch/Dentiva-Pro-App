// Dentiva Pro — secret scan (release gate).
// Fails if committed source contains secrets. NOTE: this scanner deliberately
// does NOT embed the genuine activation code either — instead it rejects any
// 16-digit numeric literal (the code format) anywhere in source/tests/docs, plus
// common secret patterns. Run: npm run audit:secrets
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not .pathname): the naive form breaks on Windows
// ('D:\\D:\\a\\...' mangled drive path) and would fail the release gate.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-web', 'target', '.vite', 'coverage']);
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.rs', '.toml', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.sql']);

const PATTERNS = [
  { re: /['"`][0-9]{16}['"`]/, label: '16-digit numeric literal (possible activation code)' },
  { re: /PRODUCT_CODE\s*=\s*['"`][0-9]/, label: 'PRODUCT_CODE assignment with digits' },
  { re: /BEGIN [A-Z ]*PRIVATE KEY/, label: 'private key block' },
  { re: /(ghp|gho|github_pat)_[A-Za-z0-9_]+/, label: 'GitHub token' },
  { re: /sk-(live|test)-[A-Za-z0-9]+/, label: 'Stripe-style secret key' },
  { re: /xox[baprs]-[A-Za-z0-9-]+/, label: 'Slack token' },
  { re: /AIza[0-9A-Za-z_-]{30}/, label: 'Google API key' },
  // NOTE: test passwords (e.g. `password: 'Owner@12345'` in integration tests)
  // are self-created fixtures, not secrets — intentionally not matched.
];

const findings = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(e)) walk(p);
    } else if (SCAN_EXTS.has(extname(e))) {
      const text = readFileSync(p, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        // Allow this scanner to describe the patterns it hunts
        // (separator-normalised so the exemption also holds on Windows).
        if (p.replace(/\\/g, '/').endsWith('scripts/secret-scan.mjs')) return;
        for (const { re, label } of PATTERNS) {
          if (re.test(line)) findings.push(`${p}:${i + 1}: ${label}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
  }
}
walk(ROOT);
// The scanner file itself is exempt above; anything else fails the gate.
if (findings.length > 0) {
  console.error('secret-scan FAILED:\n' + findings.join('\n'));
  process.exit(1);
}
console.log('secret-scan OK: no secrets detected.');
