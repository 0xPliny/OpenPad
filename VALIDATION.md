# Validation

OpenPad is an early Windows preview. Source presence, automated tests, desktop behavior, and release certification are distinct claims.

## Scope of the test suite

- `npm test`: 210 model and failure-injection tests, including encodings, search/replacement, recovery, Watch, context metering, review persistence, templates, and MCP boundaries.
- `npm run test:ui`: build plus 34 isolated Electron desktop scripts covering file opening (including external opening), editing, panes, recovery, context workflows, and MCP integration.
- The Windows CI workflow runs both commands after `npm ci`. A workflow definition alone is not evidence of a successful hosted run; inspect the checks on the commit you use.

The pre-publication development build passed 210 model tests and all 34 packaged desktop scripts on Windows x64 with Node.js 26.5.1 and Electron 44.3.0. Local installer install/uninstall, package hashes, and file registration also received checks. Those local observations do not certify a public binary release. Public-snapshot validation is reported through this repository's commit checks.

## What this does not certify

- macOS/Linux runtime behavior, screen readers, physical printing, native Recycle Bin operations, or complete high-contrast/DPI behavior.
- Power-loss durability. Process-stop fault injection does not reproduce all storage failures; text since the last completed snapshot may be lost.
- External-writer exclusion or crash-atomic multi-file replacement. Pre-rename validation is not a compare-and-swap operation or file lock.
- Authenticated writer identity. Watch records observations, and historical review decisions do not reverse changes or gate writes.
- Unbounded performance, complete watcher event capture, network-drive behavior, or log rotation.
- Exact Claude tokenization, universal agent-instruction hierarchy, or semantic contradiction detection.
- Real Cursor/Claude Code client configuration, durable MCP audit logging, or staged MCP writes.
- Code signing, automatic updates, package-manager distribution, or reproducible binary output.

Tests use synthetic fixtures and isolated profiles; some OS dialogs are stubbed. No comparative performance claim is made. See [SCOPE.md](SCOPE.md) for feature-specific bounds and the [build guide](docs/BUILDING.md) to reproduce checks.
