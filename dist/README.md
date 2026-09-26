# /dist — local fallback drop folder for the Windows installer

Primary distribution channel: the **Release** GitHub Actions workflow
(`.github/workflows/release.yml`), which builds the NSIS installer on
`windows-latest` and attaches the `.exe` files to the GitHub Release plus
workflow artifacts.

Fallback: when GitHub Actions is unavailable, build locally on a Windows
machine with Node 20 + the Rust stable toolchain:

```powershell
npm ci
npm test
npx tauri build
```

Then copy the installer(s) from `src-tauri\target\release\bundle\nsis\` into
this folder:

- `Dentiva Pro_1.0.0_x64-setup.exe` — NSIS installer (per-machine)
- `Dentiva Pro.exe` — portable executable (if produced)

`*.exe` files are intentionally git-ignored so the repository stays lean; the
GitHub Release remains the canonical artifact store.
