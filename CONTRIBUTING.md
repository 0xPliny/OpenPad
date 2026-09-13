# Contributing to OpenPad

Read [SCOPE.md](SCOPE.md), [VALIDATION.md](VALIDATION.md), and the [roadmap](docs/ROADMAP.md) before changing a feature. OpenPad is a context workbench with existing editor functionality, not an ongoing Notepad++ parity project.

Use Windows x64 with Node.js 26. Run `npm ci` and `npm start`; run `npm test` and `npm run test:ui` before submitting changes. See [BUILDING.md](docs/BUILDING.md) for packaging and frozen-artifact verification.

Keep changes focused. Preserve original file bytes, unsaved buffers, undo boundaries, cancellation, and recovery. Add meaningful regression coverage for data-loss risks and asynchronous behavior. Passing a narrow test does not certify a complete feature.

Open an issue for a substantial proposal. Pull requests should explain the problem, resulting behavior, validation, and remaining limits. Keep upstream license notices and historical attribution intact.

Use synthetic fixtures and screenshots. Never commit personal documents, application profiles, credentials, private paths, generated releases, or raw diagnostic dumps containing user data. Review the actual staged diff, including binary files, before submitting it.

Security reports must not include credentials or private documents. Avoid disclosing actionable vulnerabilities in public issues; use GitHub's private vulnerability reporting option when available.
