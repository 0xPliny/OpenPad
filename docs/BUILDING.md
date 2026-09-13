# Building and testing

The verified development environment is Windows x64, Node.js 26, npm, Git, and PowerShell 7 (`pwsh.exe`). Dependency versions are locked in `package-lock.json`.

```powershell
npm ci
npm run build
npm test
npm run test:ui
```

Desktop tests launch isolated Electron profiles and may open windows. Some native dialogs are stubbed. These tests do not certify physical printers, native Recycle Bin behavior, or accessibility.

## Windows packages

Commit your changes and start from a clean Git checkout:

```powershell
npm run package
```

The packaging script creates a unique directory under `release/builds/`, bundles the application, includes runtime dependencies and license notices, and produces an NSIS installer, portable ZIP, checksums, and build metadata. It does not publish artifacts. The current packaging script intentionally produces unsigned artifacts. Signing requires a separately reviewed packaging change; signing and distribution need separate validation.

For a frozen executable, set `OPENPAD_EXECUTABLE` to its absolute path and invoke each individual desktop `node test/<script>.cjs` command listed in `package.json`. Do not use `test:ui` as frozen-artifact evidence: that script rebuilds source. Retain results with the exact source commit and artifact hashes.

Build-from-source instructions are provided; bit-for-bit reproducibility is not certified. macOS and Linux packages have not been runtime-validated.
