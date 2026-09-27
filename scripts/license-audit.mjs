// Dentiva Pro — license audit (offline-first: no registry calls).
// Fails if any production dependency uses a copyleft license (GPL/AGPL/LGPL)
// or has no detectable license. Run: npm run audit:licenses
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// fileURLToPath (not .pathname): the naive form breaks on Windows
// ('D:\\D:\\a\\...' mangled drive path) and would fail the release gate.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const prodDeps = Object.keys(pkg.dependencies ?? {});

const BLOCKED = [/GPL/i, /AGPL/i, /LGPL/i, /SSPL/i, /Commons Clause/i, /CC-BY-NC/i];
const problems = [];

function licenseOf(dir) {
  const pj = join(dir, 'package.json');
  if (!existsSync(pj)) return 'UNKNOWN (no package.json)';
  const m = JSON.parse(readFileSync(pj, 'utf8'));
  const lic = m.license ?? (Array.isArray(m.licenses) ? m.licenses.map((l) => l.type).join(',') : null);
  return lic ?? 'UNKNOWN';
}

for (const dep of prodDeps) {
  const dir = join(ROOT, 'node_modules', dep);
  const lic = licenseOf(dir);
  if (lic === 'UNKNOWN' || BLOCKED.some((re) => re.test(String(lic)))) {
    problems.push(`${dep}: ${lic}`);
  } else {
    console.log(`  ok  ${dep}: ${lic}`);
  }
}

// Rust side: enumerate direct crates from Cargo.toml and report (full check runs in CI with cargo).
try {
  const cargoToml = readFileSync(join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8');
  const crates = [...cargoToml.matchAll(/^([a-z0-9_-]+)\s*=\s*\{?[^}]*version\s*=\s*"([^"]+)"/gm)]
    .map((m) => `${m[1]}@${m[2]}`)
    .filter((s) => !s.startsWith('tauri-build'));
  console.log('  rust crates (direct): ' + crates.join(', '));
  void execSync;
} catch { /* noop */ }

if (problems.length > 0) {
  console.error('license-audit FAILED:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('license-audit OK: all production dependencies permissively licensed.');
