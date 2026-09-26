// Dentiva Pro — about screen.

import { useApp } from '../state/app';
import { Icons } from '../components/icons';

export function AboutPage() {
  const { status } = useApp();
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">About</h1>
          <p className="page-sub">Product and build information.</p>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="card card-pad" style={{ textAlign: 'center' }}>
          <div className="brand-mark" style={{ width: 64, height: 64, margin: '8px auto 14px' }}>{Icons.tooth}</div>
          <h2 style={{ margin: '0 0 4px', color: 'var(--dp-navy-900)' }}>Dentiva Pro</h2>
          <p className="muted">Professional offline dental clinic management for Windows</p>
          <div className="mt-3 small" style={{ textAlign: 'left', display: 'inline-block' }}>
            <div><strong>Version:</strong> {status?.version ?? '1.0.0'}</div>
            <div><strong>Database schema:</strong> v{status?.schemaVersion ?? 1}</div>
            <div><strong>Runtime:</strong> {status?.backend === 'tauri' ? 'Tauri desktop (Rust + SQLite)' : 'Web preview (SQLite/WASM mirror)'}</div>
            <div><strong>Developer / creator:</strong> Shohan Khan</div>
            <div><strong>Email:</strong> helloiamshohan@gmail.com</div>
          </div>
        </div>
        <div className="card card-pad">
          <h3 className="card-title">Third-party notices</h3>
          <p className="card-sub">Open-source components bundled with Dentiva Pro</p>
          <div className="small" style={{ maxHeight: 340, overflowY: 'auto' }}>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              <li><strong>React / ReactDOM</strong> — MIT License, Meta Platforms, Inc.</li>
              <li><strong>Tauri</strong> — MIT / Apache-2.0, Tauri Programme within The Commons Conservancy.</li>
              <li><strong>rusqlite / SQLite</strong> — MIT (rusqlite); SQLite is public domain.</li>
              <li><strong>Argon2 (RustCrypto)</strong> — MIT / Apache-2.0.</li>
              <li><strong>sql.js</strong> — MIT License (fallback runtime & tests).</li>
              <li><strong>Vite / Vitest / TypeScript</strong> — MIT (build & test tooling).</li>
              <li><strong>Noto Sans Bengali</strong> — SIL Open Font License 1.1, Google Fonts.</li>
            </ul>
            <p className="muted mt-3">Full license texts ship with the release notes. No component requires a paid license, online activation, or cloud service.</p>
            <p className="muted">Dentiva Pro is a clinical record-management application. It does not provide autonomous diagnosis; all clinical content is entered by the treating dentist.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
