# Forma experience runtime: implementation checkpoint

## Baseline and ownership

The isolated `codex/forma-experience-runtime` branch is based on production 180, `ead677e48a2c329d06b42c5f317a09a8cec9775a`. Sites' saved version 180 independently identifies that commit, and the release owner reported its deployment succeeded. Sites access remains workspace-wide, revision 7. All three experience commits replayed without conflict or source-patch changes onto that baseline; only this checkpoint documentation was subsequently updated.

The original qualification baseline was production 179, `7eb914d5c5d8ad7d237db92566edcb3cf6e870bb`; deployment `appgdep_6a98baea298c81919a377e3ac60e240f` was independently checked as succeeded. It supplied accepted 3D integration, the qualified hosted schema path and the reliability merge. Version 180 adds the release owner's approved reliability labels/offline comparison/classifier changes, not any experience or Memory activation.

This clears the missing-3D-source prerequisite. It does not clear live Memory, E6, protected-video/accounting holds, paid-provider acceptance, or the mini-app release gates. The “Assemble Forma specialist team” task retains canonical checkout, source-main, Site, environment and publication ownership. This branch is a review handoff, not a deployment. The concurrent Memory task's reserved migration 0024 and settings/recall/scheduled work are untouched.

## Implemented scope

**Stage 1A: dynamic foundation.** Eight recipes share strict typed definitions, a dependency-hashed compiler, semantic controls and a Lit presentation host in `src/experiences/`. The isolated harness remains in `tests/fixtures/experience-runtime/`. Its proposal CLI produces typed candidates and computed semantic diffs against an exact release; it does not publish, execute supplied code or call an LLM.

**Stage 1B: authenticated canonical context intake.** `/make` and `/make/{image,short-story,scene,slides,storyboard,video,audio,model3d}` use a separate application entry. A server-owned recipe converts reviewed decisions to one canonical Project, one Document and document-scoped native blocks. The immutable release, decisions, provenance, event plan and identities are retained privately before commit. The existing atomic intake implementation supplies transactional authority and exact original receipts.

This is **Document setup, not output generation**. The UI says “Document setup · No generation”, “Save to Forma” and “Generated output unavailable”. Its “Edit in Forma” link is enabled only after validating the exact canonical creation receipt. The final product's post-generation handoff still requires the generation/viewer phase. This preview must not be marketed as a completed mini-app generator.

## Experience flow

```text
/make/<output>
  Decisions + semantic preview
  → Review [immutable private snapshot]
  → Save to Forma [atomic canonical commit]
  → Document saved [exact receipt]
  → Edit in Forma [same Document]

Lost save/commit response
  → Check result [GET only, original intent/draft]
  → Exact original receipt, or explicit unresolved state
  → Retry original [same identity; current release required]

Reload
  → Retained draft/intent in URL
  → GET original snapshot + receipt
  → Same Document; no implicit commit
```

Changed registrations block new commits under stale definitions but do not block read-only recovery of an existing Document. Review freezes the interface. Back-to-setup edits require a new immutable intent; the old snapshot retains its normal expiry. No private values are stored in localStorage or URL parameters.

| Output | Decisions and setup feedback | Native inputs |
| --- | --- | --- |
| Image | Subject, lighting, composition grid | Subject, lighting, composition |
| Short story | Character, causal progression, ending | Subject, action, direction |
| Scene | Participants/conflict, knowledge asymmetry, tension | Action, direction, emotion |
| Slides | Claim and ordered evidence | Message blocks with stable order |
| Storyboard | Event and reveal position | Action and composition |
| Video | Subject, camera, motion | Subject, camera, motion |
| Audio | Moment, energy curve, instrument | Text-only direction/emotion instructions |
| 3D model | Object, proportions, surface | Subject, scale, material |

The Audio adapter deliberately does not create an Audio reference-asset block. Native Audio source/transfer protections remain unchanged. Semantic choice labels and ordered/relationship values survive as readable context. Authored choices remain distinct from defaults. Internal `experience_*` metadata is removed from provider-facing facts while readable instructions remain active.

## Server and privacy contract

- The public catalog contains definitions only and declares generation unavailable. Every draft/read/commit/receipt requires a consented real creator/admin principal with personal author capability. Selected project contexts, fictional personas and project-execution authority are refused, not silently rebound.
- Mutation bodies are bounded to 32 KiB, exact-shaped, same-origin and server-validated. Callers cannot supply event plans, provider parameters, authority or another manifest. At most 50 new retained drafts per owner are admitted in a rolling 24-hour window. No generation spend is possible through these routes.
- An owner/intent hash identifies an insert-only `experience-draft` row in existing `private_content`. Same-intent/same-content retries resolve the retained original. Conflicting, erased or expired identities cannot be overwritten or resurrected.
- Drafts have personal custody only: no project resource scope or organization retention scope. Reads and commits recheck current authority, exact bytes, custody, expiry, erasure and canonical Project/Document removal. Atomic denial rolls back all events and receipts.
- The kind is `transient-private`: existing `FORMA_RETENTION_DAYS`, default 30 days. Existing bounded retention sweeps physically erase expired content while retaining the non-reusable identity. Existing personal-authored-context erasure clears draft bodies and canonical private event inputs. No new retention exemption or cleanup system is added.
- Draft bodies are excluded from ordinary main-app, chat and Memory private-content hydration. No Memory proposal/recall surface is enabled. Canonical blocks remain normal Document inputs; private draft metadata is not a Memory source.
- Completion comes from canonical receipts, not a second status write. The client checks draft hash, resource IDs, route, event identities, actor, stream, client, correlation, schema, contiguous sequence, exact payload and absence of rejections. Mismatches cannot expose handoff.
- API responses and experience HTML are private/no-store. Opaque recovery IDs confer no read or creation authority. Existing share tokens are not accepted as guest authority.

## Shared controls and performance

The locale controller moved to `src/components/design-system/locale-controller.ts`. `localization.ts` remains the application facade and owns catalogs, switching and the scoped provider. Both import paths expose the same class and root port; late root installation keeps already-connected controls subscribed. Main bootstrap remains unchanged. Public-safe controls use explicit functional fallbacks without importing app-wide catalogs or Store.

The built `experiences.html` static dependency closure contains the entry, modulepreload polyfill, presentational element, locale controller, Lit repeat/directive helpers, icons, design primitives and route helpers. It does not load the full localization facade, Store, output viewers or provider clients.

Measured from the reviewed `560cdee` Vite manifest, following static imports and counting each asset once:

| Asset | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| Initial JavaScript (9 chunks) | 74,132 | 27,145 |
| Experience stylesheet | 9,883 | 2,288 |
| Inherited shared stylesheet | 575,881 | 94,417 |

The original fixture loaded roughly 1.1 MB of initial JavaScript. The new entry reduces that substantially, but **CSS extraction and a qualified public-entry budget remain open**. Existing large-chunk/dynamic-import warnings are not suppressed. Byte counts are build evidence, not device startup/interaction measurements.

## Mobile, touch and accessibility

The host uses logical dimensions and container queries: paired preview/decisions on wide containers, one column below 700px and narrower card layouts below 380px. Controls provide at least 44px targets, 16px text inputs, wrapping actions and safe-area footer spacing. Ranges have decrease/increase alternatives; ordered inputs have tap buttons. No autoplay, orbit gesture or scroll interception is introduced.

Keyed decision nodes, composition-aware updates and focus restoration are retained. Saving disables native fieldsets and shared fields. Review freezes inputs; completed Document setup removes setup controls. Reduced motion is respected. There is no chat or advanced-edit surface.

These are implementation directions and automated contract checks, **not physical-device, browser geometry, IME, assistive-technology or touch qualification**. Browser QA was not performed. Experience copy is currently English; the shared controller's EN/FR/AR/JA regressions do not imply complete experience translation.

## Verification

- Root build, root TypeScript, fixture TypeScript and targeted ESLint pass.
- 35 direct experience-intake tests pass with the actual routed Worker and in-memory SQLite. Coverage includes all eight native Documents, semantic rendering, hydration exclusion, duplicate/concurrent/lost responses, stale registrations, exact handoff validation, owner/context isolation, transaction-time role loss/erasure, privacy erasure and retention cleanup. Global network/provider calls are denied; financial/job counters remain unchanged.
- 2 locale tests pass: one class/root across imports; late installation, nested scopes, EN/FR/AR/JA, RTL, formatting/timezone, asynchronous switching, disconnect/reconnect, default/system messages and single custom-element registration through native event/attribute test ports.
- 44 fixture contract/controller/CLI tests cover typed recipes, malformed definitions, dependency drift, default provenance, stale proposals, duplicate/lost requests, snapshotting, mismatched results and network denial.
- **627 tests passed, 0 failures/skips**, on the original version-179 baseline: `tests/project-intake*.test.mjs`, `experience-intake`, `locale-controller`, `component-library`, `prompt-policy`, `private-content-identity-admission*`, `responsive-product`, `surface-load-focus-host`, `presentation-guidance-accessibility`, `presentation-accessibility` and the fixture runtime suite. This is a selected regression result, not a claim that the entire repository suite passes.
- After replay onto **version 180**, build, root/fixture TypeScript and targeted lint pass again; **106 tests pass** across experience intake, locale controller, fixture runtime, prompt policy and the post-build component library. `git range-diff` confirmed the three source patches were unchanged. The earlier held-control suites were not rerun following the release owner's scope restriction.
- No live provider, hosted authentication, deployed integration, physical-device or end-to-end browser acceptance is claimed.

### Review correction: summary fidelity

A separate follow-up preserves authored source text exactly in both review and completed summaries, resolves choice labels only through the relevant interaction, and renders relationship/profile fields in registered order with registered labels. This also prevents canonical JSON key ordering from changing restored summaries. The stray blank EOF in the extracted locale controller is removed; the entire change range is checked, not only uncommitted changes.

Eight actual full-view render tests cover review, completion and restored drafts for all outputs, including hyphens, dates, newlines, markup escaping, reordered evidence, shuffled record keys and numeric zero. The focused intake/locale/fixture run passes 89 tests; build, root/fixture TypeScript and targeted lint pass. These finite template/native ports do not qualify browser layout or assistive technology.

Locale review evidence remains limited: concurrent locale switching uses a warm cache, and reconnect checks controller state rather than rendered updates. Cold-load switching and rendered reconnect behavior are not certified here.

Original `/tmp` build/test logs have been copied without alteration to the sibling `forma-experience-runtime-verification/frozen-560cdee` directory with a SHA-256 manifest. Follow-up verification receipts are retained separately; they do not overwrite the frozen handoff evidence.

### Review correction: actionable validation

A second separate follow-up keeps existing admission bounds but reports all invalid leaves: scalar decision IDs, `conflict.goalA`, `energy.peak`, and stable evidence paths such as `evidence.e2.text`. Malformed containers retain group errors. The actual shared field primitive now receives required state and its exact leaf error; valid siblings remain valid. Group and range errors have explicit description targets, and the status names the affected field.

Review captures the existing DOM-focus lease, runtime, draft, issue set and presentation. For local validation failure only, it waits for the host and field updates, finds the first invalid target in rendered order, and focuses the actual enabled input. New input, pointer/keyboard/focus activity, composition, runtime replacement, disconnect, another Review or presentation changes retire the pending handoff. This adds no Store singleton or paid-operation authority.

Twenty assembled tests run the actual host, shared button/field handlers and native focus ports. They cover all eight outputs, required/error/ARIA associations, sibling isolation, a tap reorder with stable evidence identities, defensive group/range error states, and stale-focus retirement through a child update. Summary tests additionally assert raw escaped markup before decoding it for text comparison. These are component/DOM-contract checks, not real-browser node lifetime, IME, device or assistive-technology certification.

The final selected run passes **135 tests**: 63 intake/presentation, 45 fixture/compiler, 2 locale, 9 prompt-policy and 16 post-build component-library tests. Build, root/fixture TypeScript, targeted lint and whole-range diff checking pass. The fixture TypeScript include now carries the repository's existing Cloudflare ambient declarations for the reused focus helper's type graph; the initial missing-declaration failure is preserved alongside the passing rerun, not hidden.

The new static entry closure is **10 JS chunks, 77,499 raw bytes / 28,417 gzip**; CSS remains **585,764 / 96,705 bytes**. The additional chunk is the existing focus lease. Public stylesheet, translation and browser/device gates remain open. Final logs and the exact build-closure receipt are retained in the sibling `forma-experience-runtime-verification/validation-correction` directory with byte counts and SHA-256 hashes.

## Short story reader source checkpoint — September 3

`src/experiences/results/short-story-reader.ts` now provides a small, disconnected read-only Lit template. It follows the native artifact reader's escaped text-part pattern: the nonblank title and complete `content_markdown` remain literal text, without HTML interpretation, linkification, summaries, truncation, or media requests. Blank titles do not create empty headings or replacement titles.

Its separate stylesheet uses Forma tokens, scalable serif text, logical sizing, long-line wrapping and automatic text direction. It has no fixed-height viewport, nested scroller, gesture interception, selection lock, or zoom override. A future authorized host must load both the reader and stylesheet. The public entry and viewer registry remain unchanged; this is not a mounted or released result experience.

Three cases were added to the existing result-contract suite for actual Lit template structure, hostile-looking literal text, repeated rendering of a complete 512,000-byte Unicode narrative, and blank headings. The whole-file suite ran once with Node 24.16.0: **53 passed, zero failures, skips or cancellations**, including all three reader cases. Independent saved-evidence review confirmed the raw TAP, successful process close, empty stderr, unchanged source/dependency bookends and all 29 file / 7 dependency-link pins. The evidence is retained at `/private/tmp/forma-short-story-reader-tests-evidence-r1`; the result receipt is SHA-256 `ef37941ffa413c8319a1b50af9f93b935e4b4c2b0b501ba5413c43232e8dac1d`. These tests qualify DTO and Lit-template contracts only.

The separate synthetic reader fixture imports the actual reader and stylesheet, without the public entry, Store, Worker, provider, media, custody or handoff. Its final Playwright run passed **10/10 checks with no skips or retries** across desktop and 320px touch-emulated Chromium contexts. Checks cover literal DOM text and absent interpreted markup, blank headings, the complete 512,000-byte narrative, long-line/RTL reflow, 200% CSS text resizing, viewport resizing, dark fixture colors, native mouse selection, fixture-control Tab navigation and native page scrolling through mouse-wheel/CDP touch input. Source bookends match all 11 fixture/product/configuration inputs. The saved report, traces and 44 screenshot/data attachments are in `/private/tmp/forma-short-story-reader-browser-evidence-r5`; its compact result is SHA-256 `bf084257c658f7c47404d690777b84ad385a7e1f46b9b00cd91a01883bd641f7`.

Earlier browser attempts remain separate: R1 could not bind the loopback server within the sandbox; R2 exposed a test locator mismatch and was stopped after the first failure; R3 passed; R4 added output-focused screenshots and dark colors; R5 retained those assertions with reusable cache/report configuration. No product renderer defect was found. The original prototype fixture is unchanged.

The reader-only TypeScript configuration and targeted lint of the five new TS/MJS sources also pass. An initial temporary TypeScript config could not resolve inherited type libraries from `/private/tmp`; moving the scoped configuration under the existing fixture directory corrected resolution without changing product source. Both results are retained in `/private/tmp/forma-short-story-reader-static-validation-r1.json`. These checks do not rerun or qualify the held native-execution suite or root build.

This is bounded browser evidence, not full mobile or release acceptance. CSS text resizing is not browser chrome zoom. Touch and viewport emulation do not certify physical-device rotation, mobile long-press selection, IME or screen readers. Geometry uses system fonts and a small fixture subset of Forma tokens, not the full production stylesheet cascade. The browser-context request guard allowed only loopback static modules and observed no forbidden requests, errors, downloads or dialogs; that is not a process-wide network-isolation claim.

The deployment owner accepted the R5 checkpoint for that disconnected scope. A separate actual-browser-zoom check then passed in desktop headless Chromium 151.0.7922.34 using the existing `chrome.tabs.setZoom` extension and shared browser helpers. Read-back returned factor 2; DPR changed 1→2 and the CSS viewport changed 1280×813→640×406 while the physical window, 16px root font, CSS zoom 1 and visual scale 1 remained unchanged. All six synthetic samples retained their exact DOM text with no horizontal overflow; native Tab navigation and eight complete-viewport captures passed. Independent review verified nine selected source pins, 18 attachment hashes and screenshots. The result is `/private/tmp/forma-reader-browser-zoom.EAGGuE/result.json`, SHA-256 `24787a75e36c2cb00b40d9e785c69d4cb75fa5476368497b79b5e5f24b2b2c67`. This separately qualifies actual desktop zoom at that window size, not browser-toolbar operation, combined 320px-at-200%-zoom, other engines, hardware or assistive technology. Owned browser/server closure and profile removal completed; no public surface was activated.

The host must still obtain the original result through a trusted transport, validate its independently retained identity and current read authority, retire stale content, and provide exact same-Document continuation. Integrated acceptance must cover true browser zoom, physical touch selection/rotation, focus/reading-position retirement and assistive reading as well as the fixture checks above. The component adds no navigation, export, regeneration, or editing authority. The native bridge must distinguish the artifact JSON hash used by exact editor navigation from the exported Markdown hash, and retain a proved original experience-release/job association before claiming generation under that release.

The next bounded source-only proposal is `/private/tmp/forma-short-story-receipt-identity-bridge-proposal-r1.md` (SHA-256 `9522fa04f8609d76faf8831bbff8a9e9076fefebba14f2ea8fc12d11e80f0bab`). It identifies the missing internal selected-draft/preflight binding and proposes an exact original-receipt association in the existing private authorization event, committed atomically with the native job. The read path would combine original-receipt and retained-native proof before disclosure, then reuse the existing exact artifact route. No writer, transport, host integration, legacy backfill or activation from that proposal is implemented.

## Remaining delivery work

1. Integrate the three commits after canonical-publisher review: shared locale extraction, atomic intake-core extraction, additive experience integration.
2. Extract and qualify a small shared token/control stylesheet. Translate experience copy and qualify assembled browser/mobile/touch/IME/AT flows.
3. Add explicit output admission and persisted exact jobs through existing authority, consent, source, budget and provider protections. A retained interface release is not paid-execution authority. The current catalog's `fixture` qualification intentionally confers none.
4. Add qualified read-only output viewers and post-generation same-Document continuation. Setup feedback must not be labeled generated output.
5. Add separately governed guest sessions, sponsor grants, abuse limits, custody/claim and output-only sharing before public lead-generation launch.
6. Connect model/API and product-learning updates to typed proposals, evaluation gates and approved release publication. Unknown output families still require registered, qualified adapters/viewers; arbitrary JSON cannot activate them.

No release, deployment, access change, or paid generation was performed for this checkpoint.
