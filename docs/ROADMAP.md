# Context workbench roadmap

Updated 2026-09-12. This replaces the Notepad++ competitor backlog. Milestones describe acceptance, not promised dates. Existing editor behavior remains supported; no parity completion work is scheduled.

1. **0.3 — Agent Watch:** event-driven folder monitoring with explicit coverage limits; activity feed and session boundaries; safe read-only follow/tail; local file and Markdown-section token counts; evidence-labelled session provenance and restart persistence. Prepare screenshots, Windows installer/portable archive, hashes and validation. The source preview is public; binary distribution still requires signing and release validation.
2. **0.4 — Review:** persisted diff queue, per-file accept/reject/edit-then-accept, optional hunks, session report export. Staged proposals must use a tested platform-specific conflict/commit protocol before claiming protection from external writers.
3. **0.5 — Budget and lint:** corpus totals and budgets, duplicate/empty/date findings, agent-file templates and advisory lint, client-specific hierarchy profiles, provenance for discovered rules and reviewed config conversion.
4. **0.6 — MCP:** opt-in workspace loopback server, authenticated editor-control/context tools, staged-write routing, path allowlists, secret exclusions, cancellation/rate limits and redacted session audit. Publish client snippets only after protocol and security testing.
5. **0.7 — Vault:** wikilinks, frontmatter, backlinks/outgoing links, tags/tasks and optional Obsidian bridge. Preserve unsupported Markdown syntax; no plugin/graph emulation.
6. **1.0 — Hardening and platforms:** real macOS/Linux open/edit/save/recovery validation, accessibility and DPI audit, measured benchmarks, storage/power-loss work and longer recovery history.

Durability, concurrent-writer safety and accessible review are continuous requirements. There is no claim of market uniqueness, universal rule precedence, exact Claude tokenization or authenticated author identity from filesystem events. Competitive claims and old time estimates are hypotheses requiring fresh evidence.

Current implementation boundaries are in [SCOPE.md](../SCOPE.md), test evidence in [VALIDATION.md](../VALIDATION.md). Installer tooling and a regex migration corpus begun before the pivot are retained as useful engineering work; they do not revive parity scope. MIT licensing, ASAR and ignored build output already existed. `private: true` remains the npm publishing guard.
