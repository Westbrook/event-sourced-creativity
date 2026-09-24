# Still En Reve main refresh

**Superseded by upstream-only adoption:** En Reve main `28305070` now supplies these capabilities. The extension manifest, description patch and partial-adoption receipts described below have been retired. See [the reassessment](still-en-reve-upstream-2026-09-24.md). The remaining text is historical evidence.

Source: `/Users/westbrook/Documents/repos/design-system`, local `main` at `6b625021e8542ab07f3f50f30ffd3bb54e8c39eb` (`feat(elements): unify supporting description content across components`). This is the design-system branch, not codex main. The source checkout was on `codex/theme-api-adoption` with unrelated dirty work; its working files and dist were not used for the main refresh or changed.

An isolated `git archive main` in `/private/tmp/still-en-reve-main` was built in dependency order: tokens, styles, primitives, elements. Still now vendors 454 JavaScript/declaration modules plus token CSS. Its semantic theme is unchanged. Dialog and icon registration use the public `define` entrypoints and upstream dependency graph instead of locally assembled definitions. The refresh brings current registration infrastructure, supporting-description handling, control/press styling, token defaults and declarations to the main-sourced closure.

## Existing extensions retained

Still's local creation workflow and document scrolling already use APIs ahead of design-system main. Twenty-two JS/declaration files (eleven modules) retain Still extensions, explicitly listed and hashed in `scripts/still-vendor-extensions.json`. The initial refresh preserved them byte-for-byte; the description follow-up below merges a narrow main change into the editor element pair:

- Portable rich documents, range capture/validation/decorations/replacement, command matching, editor extension and clipboard identity hooks.
- The document-scroll-aware virtual collection controller.

This is **main plus the existing pinned extensions**, not an assertion that all 454 modules are unmodified main. Retire an exception only after the equivalent upstream behavior passes Still's relevant regressions. No other dirty design-system changes were imported.

`provenance.json` records the exact main revision, main-sourced build hash, actual output-closure hash and extension hashes. Historical rich-text/virtual-collection receipts remain as adoption history; the full receipt describes the current shared runtime. The vendoring script follows static and dynamic imports, includes public registration entrypoints and editor modules, and refuses to overwrite extensions whose hashes changed without review. Two full runs produced identical output.

To reproduce, build the four packages in an isolated checkout of the recorded design-system revision, then run from codex:

```sh
node scripts/vendor-still-primitives.mjs /path/to/built-design-system 6b625021e8542ab07f3f50f30ffd3bb54e8c39eb
```

## Verification

- Upstream tokens/styles/primitives/elements build: pass.
- Still `pnpm typecheck`, `pnpm build`, focused vendoring/integration ESLint and diff whitespace: pass.
- 38 focused Node tests: pass (rich documents, replacement, creation controller, palette, toolbar fit and help copy).
- Six rich-editor range tests: pass across Chromium, Firefox and WebKit against the exact refreshed vendor directory (decorations/selection, multiple replacements, undo/redo, canceled transactions and formatting).
- Still Chromium browser suite: 33 passing records, four failing leaf checks and two failed parent records; help, unified creation, output configuration and tooltip suites pass. Baseline comparison of the four failures is recorded below.
- In-app browser: live local New project layout inspected; How this works opens, Escape dismisses it and focus returns to the trigger. Existing Progress Report return link is present.
- Local providers remain unconfigured in browser fixtures. No paid requests, publication, commit or push performed by this task.

Preview: http://127.0.0.1:5191/still/action/new-project?creation=1&progress-report

Progress report: http://127.0.0.1:4187/

Logs for this session: `/private/tmp/still-en-reve-{build,unit,browser,ranges,scroll-rerun,baseline-browser}.log`.

### Pre-update comparison

An isolated copy of the current Still source with the exact pre-refresh vendor directory and original dialog/icon registration files reproduces all four failing leaf checks:

1. Document scrolling: the fixture's hard-coded row-top expectation of 104px times out.
2. Document scrolling: last-row bottom 588.5px versus toolbar top 587px exceeds the fixture's 1px tolerance. Identical geometry before and after refresh.
3. Form toolbar: reuse expects one named command but finds zero.
4. Form toolbar: research/reference flow waits for the old Review cost button.

These remain existing failures, not newly introduced regressions. The comparison suite reports 11 passes and six failure records (four leaf failures plus two parent records). No tests were weakened or application behavior changed to make these pass. Initial sandbox localhost denial and the temporary baseline's dependency-resolution setup were corrected before comparison; those setup failures are not product results.

## Rich editor description follow-up

The pinned rich editor element was initially excluded from main’s supporting-description update. It now adopts main `6b625021`’s `description` property, shared `descriptionTemplate`, named description slot, public slot/part documentation, and `aria-describedby="description rich-hint"` on both initial and mounted editor surfaces. This uses the shared template and styles already refreshed from main. All portable-document, range, decoration, command, clipboard and undo APIs remain intact. The other twenty pinned files are unchanged.

The precise two-file adoption is retained in `scripts/vendor-patches/rich-editor-main-description.patch`. The extension manifest records source revision, original hashes, resulting hashes and patch hash; `provenance.json` includes this adoption plus the refreshed output-closure hash. To reproduce this narrow merge from the prior pinned bytes, apply that patch from the codex root, then run the full vendoring command above with the updated extension manifest. Subsequent vendoring preserves the merged extension and validates its resulting hashes. No dirty design-system working files were imported or modified. Neither repository has a configured remote, so this is the latest available local main revision, not a claim of a remote fetch.

Follow-up validation: all six public editor range regressions pass against this exact vendor in Chromium, Firefox and WebKit (selection/decorations, multi-replacement undo/redo, canceled transactions, formatting); ten focused rich-document/replacement Node tests pass. Vendoring runs twice successfully with the pinned hash checks; focused vendoring-script ESLint passes. Logs: `/private/tmp/still-description-ranges.log` and `/private/tmp/still-description-unit.log`. Application-level description/help accessibility is verified separately by the contextual-help suite.
