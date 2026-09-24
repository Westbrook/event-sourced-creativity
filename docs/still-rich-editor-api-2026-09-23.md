# Still portable editor integration

Still now uses unpatched En Reve main `28305070013d13a91e5ff0c7dd87a9b0b4fd76d0`. Build tokens, styles, primitives and elements from an isolated source snapshot, then refresh the complete closure:

```
node scripts/vendor-still-primitives.mjs <built-design-system> 28305070013d13a91e5ff0c7dd87a9b0b4fd76d0
```

Partial refresh modes and preserved library extensions are retired. `src/still/vendor/provenance.json` records all current module paths and output hashes. See [upstream adoption](still-en-reve-upstream-2026-09-24.md).

## Portable body API

Import `decodeRichDocument`, `richDocumentText`, `richDocumentFromRuns` and types `RichDocument`, `RichNode`, `TokenRun` from `src/still/vendor/elements/rich-document.js`. That module has no runtime imports, editor dependency, or browser global access; it is suitable for Worker validation.

`decodeRichDocument(unknown, {maxDepth?, maxNodes?, maxBytes?})` returns detached deeply frozen JSON or throws `TypeError`. Defaults are 32 node levels, 10,000 nodes and 1,000,000 UTF-8 serialized bytes. It validates the public node/content/mark/attribute schema, safe links and unique token occurrence IDs, without Unicode normalization. Still must additionally validate token kinds, payloads and authority. `richDocumentFromRuns` never resolves literal `@` text into identity.

## Editor API

Register the element through `src/still/vendor/elements/define/rich-text-editor.js`; its public class/types are exported by `src/still/vendor/elements/rich-text-editor.js`. Read `editor.document`; consume the cancelable `en-change` event's `detail.proposed` document. Author assignment to `.document` explicitly resets history and should be used for loading/resetting, not accepted passage replacements.

`editor.revision` identifies the current document revision. `editor.captureRange()` captures the current user selection or caret as a validated structured range without exposing private editor state. A `RichRange` has `{coordinate: 'text' | 'structured', from, to, expectedText, revision}`. Text offsets are UTF-16 offsets into the readable projection; structured positions count each container boundary as one position. `validateRange(range)` rejects stale content/revisions, invalid offsets, partial graphemes and partial token crossings. Upstream permits complete-token replacements. Still’s `isCreationReplacementRangeValid` application guard additionally refuses passages overlapping existing tokens for reference reuse and Output preference edits. A zero-width validated range supports insertion at a user-selected location.

- `decorateRanges([{id, range}])` validates all ranges before replacing decorations; it changes neither focus, selection, document revision nor undo history.
- `clearRangeDecorations()` clears only decorations. Revision changes automatically hide stale decoration ranges.
- `replaceRanges([{range, runs}])` validates all ranges and resulting token identities before committing nonoverlapping replacements as a single undoable transaction. It preserves formatting at insertion points, maps selection normally and respects canceled `en-change` events. It closes history on both sides of the transaction.

Custom trigger matchers are supported through `registerExtension({id, trigger, label, match, provide})`. `createEditorCommandMatcher(aliases, trigger = '/')` in `src/still/vendor/elements/editor-command-matcher.js` supports multiword command prefixes and excludes literal paths, URLs, escaped sigils and unknown commands. Application-level whole-input marker scanning, scope enforcement and identity resolution remain Still's responsibility.

`registerToken` options also accept `importToken(token)`, applied during the normal undoable clipboard transaction. Returning `undefined` retains only the token's literal fallback. The editor always owns the new occurrence ID. Still uses this hook to keep eligible same-Project canonical IDs pending fresh server authorization, turn cross-Project targets into unresolved text, and remap foreign-draft temporary identities to new local candidates while preserving explicitly shared identity across repeated pasted occurrences.

`src/still/creation-replacement.ts` prepares exact user-selected passage/caret previews with full source/dependency disclosure. Original qualifications remain by default; reductions use an explicit editable remaining-text field. Acceptance binds fresh source revisions and applies all nonoverlapping passages in one public range transaction. `src/still/creation-token-import.ts` owns the creation-specific clipboard identity reconciliation.

## Verification

- `node --test tests/still-rich-document.test.mjs`: 5 passing Node tests for the public codec, Unicode, strict schema, bounds, range guards and multiword matcher.
- Design-system `npm run build -w @en-reve/elements`: passed.
- Design-system `npx playwright test --config probes/rich-ranges/playwright.config.ts`: 6 passing source-browser checks across Chromium, Firefox and WebKit.
- Same browser command with `STILL_VENDOR_ROOT=/Users/westbrook/Documents/repos/codex/src/still/vendor`: 6 passing checks against the exact vendored closure. Tests cover selection-preserving decorations, overlap/stale rejection, undo/redo, canceled transactions and formatting preservation.

- `node --import tsx --test tests/still-creation-replacement.test.mjs`: 5 passing source-preview/replacement tests.
- `node --import tsx --test tests/browser/still-unified-creation.test.mjs`: 4 passing records (three user journeys) in each of Chromium, Firefox and WebKit. This runs actual Still UI/controller, Worker and disposable SQLite with providers unconfigured. It covers keyboard/IME, long-content presentation, current approval invalidation, mobile Progress Report control clearance, and paste identity/undo. Clipboard payload transport is explicitly mocked; actual editor paste handling runs. Firefox/WebKit used the already-installed sibling Playwright runtime via `CREATION_PLAYWRIGHT_MODULE` and `CREATION_TEST_BROWSER` because this checkout's matching browser binaries were absent.

These are local deterministic and browser checks, not paid-provider qualification or comprehensive assistive-technology qualification.
