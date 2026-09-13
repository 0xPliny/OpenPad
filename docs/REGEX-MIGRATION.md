# Regex migration from Notepad++

OpenPad's shared search and replacement models use JavaScript regular expressions. They do not translate Boost syntax. Notepad++ documents Boost as its search engine. See the [Notepad++ search manual](https://github.com/notepad-plus-plus/npp-usermanual/blob/master/content/docs/searching.md).

## Executable evidence

[regex-compatibility.json](../test/fixtures/regex-compatibility.json) contains 29 hand-authored cases with inputs, options, UTF-16 half-open spans, replacement outputs, and expectation provenance. [The test](../test/regex-compatibility.test.cjs) exercises the real search/replacement models, buffer search worker with nonzero selection offset, folder search worker, and buffer/folder replacement preview functions. Folder fixtures are read-only: tests verify their original bytes remain unchanged. A separate pathological-expression test terminates the real search worker.

Verified 2026-09-12: **31 tests passed** on both runtimes:

| Runtime | Node | V8 |
| --- | --- | --- |
| Workstation | 26.5.1 | 14.6.202.34-node.24 |
| Verified OpenPad executable, Electron 44.3.0 | 24.20.0 | 15.2.124.19-electron.0 |

The historical Electron run used `ELECTRON_RUN_AS_NODE=1` with a local executable that is not distributed in this source repository. It executed the checked-out corpus/models using that embedded runtime; it was not a packaged renderer UI test or validation of a public binary. Run the corpus locally with `node --test test/regex-compatibility.test.cjs`.

**No Notepad++ executable comparator was run.** Fixture `boost` entries are documented expectations, not observations of installed Notepad++ behavior. Exact behavior without a justified expectation is `UNVERIFIED`; `notepadObservation` remains `NOT_RUN` with no version or results. A finite corpus does not establish general equivalence.

## Expressions to review

| Saved expression | OpenPad shared-model result | Migration direction |
| --- | --- | --- |
| `\R` | Syntax error | Choose the actual newline set; normalized editor buffers usually need `\n`. |
| `foo\Kbar` | Syntax error | For this fixed prefix, test `(?<=foo)bar`; do not mechanically rewrite arbitrary patterns. |
| `(?i)cat` | Syntax error | Set case-insensitive search, or test scoped `(?i:cat)`. |
| `(?i:cat)` | Works in both tested runtimes | Keep scoped behavior; test other deployed runtimes. |
| `(?<=a+)b` | Matches in this corpus | Do not assume the reverse migration works. |
| `[[:digit:]]+` | Syntax error | For ASCII digits use `[0-9]+`; choose Unicode properties deliberately. |
| `a\z`, `a\Z` | Syntax error | For absolute end, test `a(?![\s\S])`; trailing-newline semantics need their own expression. |
| `\p{digit}+`, `\p{L}+` | Both work in tested cases | Property-name compatibility is not universal. |
| `\v` | Matches vertical tab only | Write an explicit intended character set. |

Boost documents `\R`, `\K`, buffer-end assertions, scoped/global modifiers, POSIX classes, and fixed-length lookbehind. These are dialect-sensitive constructs. [Boost Perl syntax](https://www.boost.org/doc/libs/1_85_0/libs/regex/doc/html/boost_regex/syntax/perl_syntax.html). The Notepad++ manual describes a broader vertical-space meaning for `\v`. [Character escape sequences](https://github.com/notepad-plus-plus/npp-usermanual/blob/master/content/docs/searching.md#character-escape-sequences).

The shared models always enable `gmu`; case-insensitive matching adds `i`, and Dot matches newline adds `s`. `m` makes `^`/`$` line anchors. Unicode mode makes `.` consume the emoji as one match in the corpus, while spans still count two UTF-16 units. Empty matches advance by a Unicode code point, preventing repeated matching at the same offset. This does not assert identical Notepad++ Replace All iteration.

## Replacement text needs a separate migration

| Template | OpenPad example/result | Action |
| --- | --- | --- |
| `$1`, `$2` | Numbered groups expand | Preview captures and unmatched alternatives. |
| `\1` | Literal backslash and digit | Use `$1` when a capture is intended. |
| `$0` | Literal `$0` | Use `$&` for the whole match. |
| `$+{word}` | Literal text | Use `$<word>` with a named group. |
| `\U$1\E` | Backslash commands remain literal | Use a separate case transformation workflow. |
| `\n` | Literal backslash and `n` | Enter a real newline in the replacement field. |
| `($&)` | Parentheses appear in output | Decide whether parentheses are intended output. |
| `$$`, `$&`, `$12` | Corpus produces `$:a:a2` with one group | Review numeric suffixes; do not infer group 12 exists. |

Notepad++ documents different backslash, named-group, case-conversion, and grouping substitution syntax. [Substitutions](https://github.com/notepad-plus-plus/npp-usermanual/blob/master/content/docs/searching.md#substitutions). Preview every migrated replacement before applying it; successful regex compilation does not validate replacement meaning.

## Boundaries of this verification

Folder reads normalize CR and CRLF to LF before matching. The corpus records separate disk expectations where raw-model CR/CRLF results differ. Replacement previews also validate re-encoding; this corpus does not write replacement output to disk. Raw-model cases are synthetic inputs, not a claim that the editor retains raw CRLF internally.

CodeMirror's built-in document Find/Replace panel, UI selection routing, replacement-worker cancellation, packaged renderer behavior, and a version-recorded Notepad++ runtime comparison remain separate verification paths. Whole-file large-preview search is literal UTF-8 search, not this regex engine. No warning scanner or automatic syntax converter is provided by this corpus.
