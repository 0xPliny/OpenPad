# OpenPad

**A local context workbench for Markdown maintained by people and AI agents.**

Watch files change, inspect observed diffs, measure context costs, and curate project notes in a desktop text editor.

**Early preview · MIT licensed · Windows verified**
## Features

| Workflow | Available today |
| --- | --- |
| Watch activity | Event-driven folder monitoring, filters, activity feed, session history, and read-only follow/tail for clean buffers. |
| Inspect changes | Opt-in retained before/after observations, historical review decisions, and Markdown session reports. |
| Measure context | Local `o200k_base` and `cl100k_base` counts, Markdown heading subtree costs, configurable budgets, and saved-file corpus rankings. |
| Improve context | Advisory checks for length, empty sections, repeated prose, placeholders, optional date reminders, and seven editable starter templates. |
| Connect an agent | An opt-in authenticated localhost MCP server with seven editor-control and context tools. |
| Edit comfortably | Tabs, pins, groups, workspaces, independent panes, Markdown preview, folder search, comparison, bookmarks, macros, and explicit encoding/EOL handling. |

Filesystem observations do not identify the writer. Historical review acknowledges changes already on disk; it does not reverse them or require approval before a write. Staging and write approval remain planned.

## Run from source

Use **Windows x64, Node.js 26, npm, and Git**. Other platforms have not received runtime validation.

```powershell
git clone https://github.com/0xPliny/OpenPad.git
cd OpenPad
npm ci
npm start
```

Dependencies are installed locally; `node_modules` is not distributed in this repository. The lockfile keeps installation consistent.

Use the command palette (`Ctrl+Shift+P`) for context, Watch, review, and template actions. Quick Open is `Ctrl+P`. Start Watch on a folder to establish the scope for corpus tools and optional MCP access.

## MCP integration

Start Watch, then explicitly enable MCP. The server uses an ephemeral `127.0.0.1` port and a fresh bearer token. Stopping Watch, disabling MCP, reloading, or quitting revokes access. It never enables itself on restart.

Tools: `open_file`, `reveal_range`, `set_status`, `count_tokens`, `lint_agent_file`, `get_context_budget`, and `get_session_provenance`.

Tools use the selected Watch scope and filename exclusions, preserve existing unsaved buffers, and expose no file-write or review-decision operations. Native HTTP clients use bearer authentication; browser origins are rejected. SDK interoperability is tested, but end-user Cursor and Claude Code configurations remain unverified. Invocation metadata stays in bounded memory without raw arguments, document contents, paths, or tokens; it is not a durable audit log.

## Development and packaging

```powershell
npm test
npm run test:ui
```

The source preview passed **210 model tests and 34 isolated Electron desktop scripts locally on Windows**. Some native dialogs are stubbed. These results do not certify physical printing, native Recycle Bin behavior, accessibility, or power-loss durability. There is no hosted CI guarantee.

For local Windows packages, install PowerShell 7 (`pwsh.exe`), commit your changes, and run `npm run package` from a clean checkout. The script creates a unique directory under `release/builds/` with an NSIS installer, portable ZIP, checksums, and build metadata. It does not upload artifacts. The current script intentionally requires unsigned output; signing needs a separately reviewed packaging change. Automatic updates and package-manager distribution are not available yet. Bit-for-bit build reproducibility is not certified.

For frozen-artifact desktop checks, set `OPENPAD_EXECUTABLE` and invoke each individual `node test/<script>.cjs` command in `package.json`. The `test:ui` command rebuilds source and should not be used as evidence for an immutable package.

## Current limits

- Files opened for editing are limited to 32 MiB. Larger files have bounded read-only UTF-8 utilities. This is not a global memory or save-size limit.
- Watch defaults include 5,000 tracked files, 2 MiB per UTF-8 file, and 2,000 retained events. Events may coalesce or be missed. Network drives and log rotation have no guarantees; watches do not resume automatically.
- File metering and corpus analysis accept at most 1 MiB per file. Corpus scans are bounded to 5,000 candidates and 64 MiB read. Counts exclude chat framing; characters/4 is an estimate, not exact Claude tokenization. Heading subtree counts overlap. Corpus totals measure saved files at different times, not an atomic snapshot or unsaved buffers.
- Observed line markers describe only the latest matching observation, not cumulative author attribution. History and optional retained review contents are bounded and may be evicted.
- MCP has a 64 KiB request body limit, four active requests/tools, 60 authenticated requests per minute, and a 10-second tool deadline. Filename exclusions are not secret-content detection.
- Lint findings are advisory. Instruction precedence, semantic contradictions, and file-reference validation are not implemented.
- Recovery can lose changes since the last completed snapshot. Undo does not survive restart. Save conflict checks can race external writers; multi-file replacement is not crash-atomic.
- Windows is the only runtime-verified platform. Screen-reader, high-contrast, complete DPI, and power-loss audits remain open. No comparative performance claim is made.

Planned work includes staged proposals with a validated conflict protocol, richer context linting, vault relationships, and platform/accessibility hardening. OpenPad is not pursuing Notepad++ parity, an IDE, retrieval/embeddings, or Obsidian plugin emulation. Search uses JavaScript regular expressions, with no Boost compatibility guarantee.

## Contributing

Keep changes focused and preserve file bytes, unsaved edits, undo boundaries, cancellation, and recovery. Include the problem, resulting behavior, meaningful tests, and remaining limits in pull requests. Use synthetic fixtures. This repository accepts application/test source, required build manifests, this README, and license information; local prompts, agent configuration, conversations, profiles, credentials, and generated artifacts must stay outside it. Review staged changes explicitly: ignore rules do not remove already-tracked content or sanitize Git history.

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses. The package's `private: true` setting prevents accidental npm publication; it does not restrict use or contribution under the MIT license.
