# OpenPad scope

Updated 2026-09-12. OpenPad is becoming a desktop context workbench for the Markdown people and AI agents maintain. The intended workflow is watch, measure, review and curate. This is an implementation contract, not a claim that the entire workbench exists today.

## Current foundation

The Windows editor opens and saves local files, displays Markdown previews, compares buffer snapshots, searches folders, preserves explicit encodings and maintains recoverable sessions. Tabs, pins, groups, workspaces, bookmarks, marks, macros and column insertion remain useful editor heritage. Notepad++ parity is retired.

Agent Watch now uses recursive filesystem events with a bounded initial scan, alongside the older polling single-file monitor. The compare view is not an approval gate. Saved/unsaved change bars are not author provenance. Recovery of text does not imply recovery of review decisions or undo history.

## Workbench acceptance

| Capability | Required behavior | Status |
| --- | --- | --- |
| Agent Watch | Event-driven folder watching, filters, bounded activity feed, session boundaries, explicit skipped/error states and tailing without overwriting dirty buffers | Implemented with bounds below; Windows packaged tests passed |
| Context metering | Local o200k_base/cl100k_base counts, heading subtree costs, configurable budgets, clear approximation labels | Implemented with bounds below; Windows packaged tests passed |
| Observed review | Retained before/after queue, acknowledged/needs-attention decisions, immutable observations and persisted decision revisions | Windows packaged tests passed with opt-in retention. These decisions do not gate or restore files |
| Write approval | Accept/reject/edit-then-accept for staged proposals, with a validated conflict protocol | Planned |
| Staged proposals | Opt-in agent proposals stored away from target files; human approval before promotion; validated platform conflict protocol | Planned; no concurrency guarantee |
| Provenance | Persisted filesystem sessions, latest-observation line ranges, unknown-writer gutter and Markdown report export | Implemented with text-hash validation; authenticated identities and cumulative attribution remain planned |
| Corpus budget | Scoped totals and heavy-file ranking with cancellation and skipped-path reporting | Windows packaged tests passed. Duplicate/empty/date findings remain planned |
| Agent-file lint | Advisory/dismissible local checks for budgets, empty sections, repeated prose, placeholders and configured date references | Windows packaged lint and seven starter-template tests passed; references, conversion and hierarchy remain planned |
| MCP | Opt-in loopback Streamable HTTP, bearer auth, workspace allowlist, bounded/cancellable tools and redacted audit records | Seven-tool Windows packaged implementation verified. Logs are bounded in-memory metadata, not a durable audit |
| Vault support | Byte-preserving Markdown, wikilinks, YAML properties, backlinks/tags/tasks and optional Obsidian UI bridge | Planned beyond plain Markdown |

Filesystem notifications establish that content changed, not whether an agent or a human caused it. Labels supplied by clients remain claimed identity unless independently authenticated. Reviewing a change already on disk acknowledges it; only staging can gate an upcoming write. Session reports must preserve these distinctions.

Agent instruction discovery and precedence vary by client. OpenPad will use named, versioned profiles with cited rules; it will not invent a universal `~/.agents/AGENTS.md` cascade or claim to resolve arbitrary natural-language contradictions. Line and token thresholds are configurable heuristics, not universal specification limits.

MCP audit records must redact sensitive content and tokens. Logging every raw argument/result would copy document contents and credentials into another store. Loopback binding alone is not authentication. No claim of safe atomic promotion follows from a pre-rename hash check.

## Watch and metering bounds

Watch defaults: 5,000 tracked files, 2 MiB per UTF-8 file, 64 MiB read per baseline/subtree scan, 20,000 scanned entries, 24 directory levels, 2,000 queued paths and 2,000 retained events. Filters use `*`, `**` and `?`; secret/generated directories and symlinks are excluded. Filename exclusions include .env variants, private-key extensions and case-insensitive *id_rsa* path components; include globs cannot override them. This is a filename policy, not secret-content detection. Issues and overflows keep coverage marked incomplete until restart. Events may coalesce or be missed; no network-drive or rotation guarantee. Follow requires a clean saved included file and is read-only; pin-to-bottom is optional.

Observed-range snapshots use a 16 MiB retained UTF-16 text budget in memory, separate from scan limits; this is not a bound on total process memory. Evicted/unavailable snapshots have no invented range. Markers show the latest observed change whose normalized text hash matches the buffer; they clear when text changes. They are not cumulative author blame. Historical session metadata persists with checksums and a previous generation, bounded to 20 sessions / 10,000 events / 4 MiB; older sessions/events are evicted. No document contents are persisted in this activity store. Recent unsaved activity can be lost; watches do not resume automatically.

Local token counting supports o200k_base and cl100k_base, plus an explicitly approximate characters/4 option. It counts unsaved text up to 1 MiB UTF-8 with at most 1,000 top-level Markdown headings and a 10-second worker timeout. ATX/setext headings skip fenced code/frontmatter/indented code; this is not a complete CommonMark parser. Subtree counts overlap. Counts exclude chat framing and do not claim exact Claude tokenization. Budget and line thresholds are configurable guidance, not format rules.

Corpus budgeting counts saved UTF-8 files in the selected Watch scope, excluding unsaved buffers. Limits are 1 MiB per file, 64 MiB read, 5,000 candidate files, 20,000 entries, 24 levels and 30 seconds. Files are counted at different times, not as an atomic folder snapshot. Ranking shows the heaviest 200 counted files and up to 100 skipped paths; totals include all counted files. Scope changes, cancellation and replaced results invalidate opening; disk bytes are rechecked before opening and different existing buffers are preserved. Counts reflect decoded disk line endings, which can differ from normalized editor counts. File-tree badges and duplicate/empty/date findings remain planned.

## Current limits

The initial MCP surface provides `open_file`, `reveal_range`, `set_status`, `count_tokens`, `lint_agent_file`, `get_context_budget` and `get_session_provenance`. Enable it explicitly after starting Watch. It binds an ephemeral port on 127.0.0.1 with a new in-memory bearer token; stopping Watch, navigating/reloading the editor, disabling MCP or quitting revokes it. It never auto-enables. File tools use the native-selected Watch scope and exclusions, with a 1 MiB UTF-8 file limit. Token/corpus tools measure saved disk snapshots; supplied text is bounded to 64 KiB. Existing unsaved editor buffers remain intact. Reveal can require a matching normalized buffer hash. Status messages are labelled Agent and do not replace save status.

MCP requests have a 64 KiB body limit, four active requests/tools, 60 authenticated requests per minute and a 10-second tool deadline. Corpus scans use the existing traversal limits with a 10-second deadline. Disconnect and disable cancel work; legacy cancellation notifications are explicitly unsupported. Exact Host checks and rejection of every Origin header restrict this initial profile to native clients. Manual bearer authentication is not an OAuth deployment. MCP SDK 2.0 and legacy SDK 1.30 clients have test coverage; real Cursor/Claude Code configuration is not yet validated. The last 200 invocation metadata records remain in memory, rate bounded; arguments, results, paths and bearer tokens are excluded. Logs are incomplete and disappear on restart. Session provenance results include available 1-based half-open before/after line ranges and normalized text hashes; missing metadata and explicit unavailable ranges remain distinct. These describe observations, not necessarily current buffer or disk text. Staged writes, review decisions, annotations, vault tools and durable audit storage are not exposed.

Observed review retention is optional for each watch and stores document contents separately from metadata history. It retains at most 128 observations, 1 MiB per text side and an 8 MiB serialized checksummed envelope, with a previous generation. Oversized or evicted baselines are explicitly unavailable; absent files and empty text remain distinct. Decisions reference immutable observations and require the current decision revision; acknowledgment is returned only after persistence. Current disk state is not checked by historical review. Retention does not resume automatically, and recent captures can be lost before persistence. This is not a complete audit trail or write-approval gate.

Advisory context checks use unsaved text up to 1 MiB in a cancellable worker with a 10-second timeout and 1,000-finding limit. Budgets are user guidelines. Date checks are off until an age is configured and indicate references to review, not stale content. Markdown code and frontmatter are excluded from prose checks. Heading discovery retains the meter's top-level parser limits. Dismissals persist locally, bounded to 1,000 keys. These checks do not validate instruction precedence, natural-language contradictions, file references or mandatory sections. Seven context-file starters are available from the command palette, with editable name/description, read-only preview and creation as a new unsaved tab. They never bind a destination or overwrite an existing file. Their sections are suggested examples, not official format requirements.

Only Windows has runtime evidence. Files opened for editing are limited to 32 MiB; this is not an enforced global in-memory or save-size limit. Large-file read-only UTF-8 paging and exact search remain available as existing utilities. JavaScript regex differences are documented; no Boost equivalence is intended.

Recovery can lose text since the last completed snapshot and is not power-loss certified. Undo is not restored after restart. Existing save/replacement conflict checks can race external writers, and batch replacement is not crash-atomic. Physical printer, screen-reader, high-contrast and complete DPI audits remain open. See [VALIDATION.md](VALIDATION.md) for tested scenarios.

## Excluded goals

Notepad++ parity, native DLL plugins, Boost regex, virtual space, UDL XML and macro import, editing giant files, LSP/debugger/build tools, cloud collaboration, retrieval/embeddings, graph visualization and Obsidian plugin emulation are outside the active product scope.

Single-user review and MCP remain part of the MIT open-source direction. Team services are a future possibility, not an implemented offering or a reason to gate current local features. Signed binary releases and package-manager submission have not occurred.
