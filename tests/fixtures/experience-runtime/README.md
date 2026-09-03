# Forma experience runtime — isolated foundation

**Stage 1A fixture.** This harness starts no Worker, accesses no account, writes no canonical project/Document/context, calls no provider, and offers no live handoff. Its result is a fixture receipt and retained decisions, never a purported generated artifact. Shared definitions/compiler/view now live in `src/experiences/`; compatibility re-exports keep this harness isolated. The separate application entry implements Stage 1B authenticated Document setup; see `docs/forma-experience-runtime-implementation-2026-09-02.md` for its scope and remaining gates.

The current source baseline is production 180, `ead677e48a2c329d06b42c5f317a09a8cec9775a`, preserving production 179's accepted 3D source and qualified reliability merge. The earlier missing-3D-source prerequisite has cleared. Live Memory, paid-provider acceptance, and broader E6/release holds are not changed by this fixture.

## Implemented

- Eight typed definitions share one controller and presentation host. Their distinct composition, causal, knowledge, order, reveal, motion, energy, and proportion feedback remains explicit.
- Bounded JSON validation rejects unregistered output/renderer/viewer references, missing bindings, removed touch contracts, arbitrary code/paths, duplicate identities, and unapproved copy.
- Compilation snapshots inputs, resolves exact dependency hashes, and freezes the result. Defaults remain distinct from authored choices.
- Drafts bind to stable, document-scoped fixture context records. These are a future adapter's typed input, **not already-persisted Forma blocks**.
- The proposal interface accepts only typed reorder/layout patches against an exact release. Trusted code computes the semantic diff. The compare-and-swap registry manages local previews, not publication.
- Explicit setup previews retain the execution release and draft identity. Review and later states reject interface replacement.
- Review/submission/recovery retain one exact intent. Duplicate requests reuse it; changed content conflicts; lost responses are inspected without another submission. Detached instances and mismatched results cannot complete.
- The Lit host uses Forma's existing presentational base and button/field primitives, keyed decisions, composition-aware fields, and focus restoration. Setup disappears after fixture completion.
- Phone layouts use container queries, 44px targets, 16px inputs, tap alternatives, reduced-motion handling, and no playback, orbit, dragging or page-scroll interception.

## Run from the repository root

```sh
node --experimental-strip-types --test tests/fixtures/experience-runtime/runtime.test.mjs
pnpm exec tsc --noEmit -p tests/fixtures/experience-runtime/tsconfig.json
pnpm exec eslint tests/fixtures/experience-runtime --ignore-pattern '*.css' --ignore-pattern '*.html' --ignore-pattern '*.json'
pnpm exec vite --config tests/fixtures/experience-runtime/vite.config.mjs
```

Open `http://127.0.0.1:4192/tests/fixtures/experience-runtime/index.html`.

The fixture server deliberately omits Sites/Cloudflare plugins and reuses the qualified native-fixture tooling-connection guard. Its HTML CSP denies application connections and form submission. The harness can change output, preview approved presentation changes, and simulate unavailable capabilities. Unknown-output selection actually invokes compiler rejection. Returning to an existing recipe retains that in-memory draft; this does not establish durable cross-reload recovery.

Build the fixture separately:

```sh
pnpm exec vite build --config tests/fixtures/experience-runtime/vite.config.mjs
```

Output is written to the task-owned `forma-experience-runtime-build` directory beside this checkout, not the application's `dist` directory. The root build separately includes the real `experiences.html` entry and generates its shared component metadata.

## LLM-compatible proposal entrance

Inspect the exact current fixture release:

```sh
node --experimental-strip-types tests/fixtures/experience-runtime/propose.mjs image
```

Supply its returned `releaseHash` as `baseReleaseHash` in a JSON patch:

```json
{
  "schemaVersion": 1,
  "baseReleaseHash": "<exact returned releaseHash>",
  "operations": [{ "kind": "reorder-decisions", "ids": ["subject", "lighting", "composition"] }]
}
```

```sh
node --experimental-strip-types tests/fixtures/experience-runtime/propose.mjs image patch.json
```

The command returns a candidate and computed diff, with `published: false`. It makes no LLM call, grants no authority, executes no patch-supplied code, and reads at most 16 KiB of patch data. A new output family, renderer, provider parameter, or viewer requires qualified code/catalog work; a new name in JSON does not enable one.

## Verification and remaining gates

At this checkpoint: **44 direct tests pass**, fixture TypeScript and ESLint pass, and the fixture build succeeds. The preview HTTP request returned 200. Browser geometry, interactive DOM/IME/focus behavior, actual mobile devices, screen readers, and live generation/handoff were **not verified** in this checkpoint. The code's accessibility directions are not a substitute for those checks.

The initial fixture imported about **586 kB CSS and 1,094 kB JavaScript** before compression. The shared lightweight locale controller now avoids the full catalog/Store dependency; the final application-entry manifest totals **74,132 bytes JavaScript (27,145 gzip)**. Inherited CSS remains **585,764 bytes (96,705 gzip)** including experience rules. These are application build measurements, not a remeasurement of the standalone fixture or production performance qualification. A small shared token/control stylesheet still requires extraction and qualification; do not fork controls or suppress bundle warnings.

Stage 1B now provides authenticated personal canonical intake, native context binding, immutable retained drafts, current authority checks and exact same-Document setup handoff. **Generation, persisted paid jobs and read-only output viewers remain unimplemented.** Public guest intake, sponsor grants, custody/claim, output-only sharing and paid-output qualification require their own gates. Personal Memory remains inactive; product-learning evidence must not become private memory or publishing authority.

The isolated implementation branch adds application routes and shared components, but no migration, provider/account setting, release access or deployment has changed. This standalone harness retains its no-network/no-canonical-write boundary.
