# Experience public styles

This follow-up is based on the frozen experience series through `7372d79`. The deployment owner approved the CSS-only source/build/static-test scope; it does not authorize generation, lifecycle testing, public access changes or publication.

## Shared source, bounded payload

`build/public-controls.ts` exposes one build-time virtual stylesheet. It parses the two canonical stylesheets with Vite's existing PostCSS dependency and selects explicitly marked, complete top-level rule groups in original order. Missing, duplicate, malformed, nested, reordered or empty groups stop the build. Source offsets preserve entire parsed nodes, including the terminator on the font import. Nothing is selected with partial-rule regular expressions, deduplicated or hoisted. No parser ships to the client.

Before: `src/experiences/entry.ts` imported `styles.css`, `design-system.css`, then its experience stylesheet. After: it imports the virtual shared stylesheet, then the same experience stylesheet. The virtual sheet contains canonical tokens, script overrides, reset, actual button/field rules, late overrides, focus, icons, and complete contrast/motion/forced-color groups. The existing font import is retained; this slice makes no font or network-policy change.

Main still imports its full `styles.css` followed by `design-system.css`, unchanged. Removing only the publication-marker comment lines from both source files reproduces their frozen bytes exactly:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| styles.css | 413,878 | 6c1f88add5e68c79744dca99929ccb1c6c9ca72d5921a7a24530fe35adb8bc13 |
| design-system.css | 242,537 | d48d07804f5d62b119744190023804a2a46d0dd84580d2f63bb009eb292a5561 |

Both source files are watched. A source change includes the virtual stylesheet in Vite's existing invalidation path, so dev and production use the same extraction. The standalone fixture deliberately retains its existing full stylesheets; only the application `/make` entry changes.

## Build measurements

Static Vite-manifest closure, each asset counted once:

| /make asset | Before raw / gzip | After raw / gzip |
| --- | ---: | ---: |
| Initial JS, 10 chunks | 77,499 / 28,417 | 77,463 / 28,404 |
| CSS | 585,764 / 96,705 | 26,658 / 5,894 |

The main entry retains its full stylesheet, 701,178 raw / 109,578 gzip bytes. These figures are transfer-size evidence, not startup, rendering or physical-device measurements. Existing large-chunk warnings remain visible.

## Verification and limits

The new pure stylesheet suite exercises parsed canonical rule/declaration/condition equality, required late overrides and accessibility rules, malformed-group rejection, the actual Vite load/watch/update hooks, source propagation, entry order and built dependency budgets. Existing component-library checks remain unchanged. Build, root/fixture TypeScript and targeted lint are included in the handoff evidence.

Final selected verification passes **22 tests** (6 public stylesheet/build checks and 16 unchanged component-library checks), build, root/fixture TypeScript, explicit non-ignored build-plugin lint and whole-range whitespace checking. Initial lint reported the build directory's ordinary ignore rule; the final run explicitly includes the new plugin rather than treating an ignored file as checked.

An initial test run caught an at-rule serialization defect: serializing `@import` alone dropped its semicolon and consumed the following root rule. The extractor now uses whole-node parser offsets, and parsed-rule equality detects this regression. A marker initially interrupted a source-text picker test; the unused native choice group was removed from extraction, preserving that test and native select source unchanged. Initial failures are retained separately from final passing logs.

No native intake/generation/paid operation/retirement lifecycle test was run for this slice. No browser, visual, zoom, real HMR, touch, IME or assistive-technology acceptance is claimed. The deployment owner requires representative main and `/make` visual/zoom/focus qualification before integration/publication. Generation and all other product completion gates remain open.
