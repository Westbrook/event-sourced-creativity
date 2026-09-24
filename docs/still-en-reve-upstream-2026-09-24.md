# Retiring Still's En Reve library extensions

The latest available local design-system main is `28305070013d13a91e5ff0c7dd87a9b0b4fd76d0`. Its implementation commit `28df0b53761573d9962d17253a09946e854d0a2b` upstreams all the editor and scrolling capabilities previously preserved by Still. The follow-up commit records integration evidence. No remote is configured; this is local main, not a claim of a remote fetch.

All 454 JavaScript/declaration modules in Still's vendor directory now match an isolated build of this exact main, after only package-import rewriting and source-map-comment removal. Token CSS matches exactly. There are no retained implementation patches, frozen extension modules or modules outside the recorded closure. Repeat generation is identical.

## What upstream now covers

| Previously preserved capability | Upstream status |
| --- | --- |
| Portable rich-document codec and readable projection | Public `elements/rich-document.js`; document version remains 1 |
| Revision-bound range capture, validation, decoration and atomic undoable replacement | Public rich-editor APIs; improved Select All, formatting and cancellation behavior |
| Multiword command matching | Public `elements/editor-command-matcher.js` |
| Clipboard token-import hooks and identity handling | Original source occurrences, per-paste context and editor-owned fresh occurrence IDs |
| Document-scrolling virtual collections | Document/element viewport handling, layout observation, anchoring, sticky insets, focus recovery and teardown |
| Editor supporting descriptions | Included in main; the separate description adoption patch is unnecessary |

The SHA-pinned extension manifest, two-file description patch, old partial-adoption receipts, and `--rich-only`/`--virtual-only` modes have been retired. The full regeneration script requires an explicit source path and revision and records every module path in `src/still/vendor/provenance.json`. Application styling still uses Still's theme and public APIs.

## Application compatibility in the separate creation work

Upstream intentionally permits complete-token replacements; partial token edits remain invalid. Still previously relied on the extended library rejecting every token overlap when replacing prose with references or editing an Output preference line.

The separate, unreleased unified-creation implementation uses `isCreationReplacementRangeValid` to express that narrower application rule using the public document and range APIs. It guards proposal preparation, final application and Output preference edits without changing library code. It supports readable and structured coordinates, nested blocks and boundary carets. A new regression verifies that upstream accepts a complete token while Still refuses to replace it, with zero mutation at preparation and acceptance. The codec test now checks upstream's documented whole-token behavior and retains partial-token rejection coverage.

Application authorization, same-Project identity checks, source freshness and private creation semantics remain outside En Reve.

## Verification

- Isolated upstream tokens/styles/primitives/elements builds: pass.
- Still production build, TypeScript, focused ESLint and whitespace checks: pass.
- 38 focused Node checks: pass, including the new application token-preservation regression.
- Upstream built editor range/clipboard/command contracts: 51 pass across Chromium, Firefox and WebKit.
- Upstream built document/element scrolling contracts: 30 pass across the same browsers at desktop and 390px viewports.
- Still Chromium integration: 18 passing records; two known scrolling leaf failures and their parent remain. Unified creation and contextual-help suites pass, including paste identity/undo, review, mobile presentation and RTL help.
- Source-to-vendor comparison: all 454 modules match; token CSS exact; no orphan modules; regenerated output identical.

The two Still scrolling failures are the same as the prior pre-update comparison: a hard-coded 104px row-top expectation, and last-row bottom 588.5px against dock top 587px with 1px tolerance. No tests were weakened to hide these. The successful independent upstream scrolling suite does not erase the Still fixture failures.

Validation used local deterministic fixtures. Native OS clipboard permissions, real IME sessions and assistive-technology behavior were not newly qualified. These checks preceded publication. No paid-provider request or changes to the design-system checkout were made by this task.

## Reproduction and handoff

Build exact design-system main in an isolated checkout, in order: tokens, styles, primitives, elements. From codex:

```sh
node scripts/vendor-still-primitives.mjs /path/to/clean-built-design-system 28305070013d13a91e5ff0c7dd87a9b0b4fd76d0
```

Current build snapshot: `/private/tmp/still-en-reve-28305070`. Prior vendor and retired files are backed up at `/private/tmp/still-before-upstream-retirement` for session comparison. Current verification logs are `/private/tmp/still-upstream-{node,typecheck,build,browser,rich-three-browsers,scroll-three-browsers}.log`.

Progress report: http://127.0.0.1:4187/

Existing local preview: http://127.0.0.1:5191/still/action/new-project?creation=1&progress-report

## Production release scope

The En Reve release is based on Production 542 (`1091e3ef5dadc5854dcfa0382117180c9e73d2d5`). It includes the upstream vendor closure, regeneration script, public icon/dialog registration, runtime dependencies and standalone codec tests. The separate unified-creation feature, its application token guard and pending release gates remain local. The existing migration release allowlist is unchanged.

Release-candidate validation: production build, TypeScript, focused ESLint and whitespace checks pass. All 31 focused codec/palette/toolbar/advisory tests pass. Browser checks report 15 passing records and the same two pre-existing scrolling leaf failures (plus their failed parent); toolbar tooltip checks pass. The built migration package contains exactly the 41 allowlisted SQL files and unchanged baseline journal. A supplemental broad event-save-repair run completed its first 13 checks but stalled before completion; it is not counted as a passing release check.
