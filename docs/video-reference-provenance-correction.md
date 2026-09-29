# Video reference provenance — bounded local correction

Local semantic correction based on main `25a7a722` (29 September 2026 UTC).
Owner: **Fix video reference provenance**. No deployment or activation. This is
an independent H/C/E cross-media follow-up, not P5 or the completed N2 audit.

## Reproduction and correction

The existing `adaptVideoPrompt` treated every reference with a provider field or
storyboard origin as generated and therefore fictional/synthetic. An `adult` or
`grown-up` keyword anywhere in its combined source channels could further label
all people adult and fictional. Neither inference is supported by asset origin.

Four authored synthetic fixtures traverse the existing
`generateCreativeVideo` → intercepted `fetch` path. Every network operation is
stubbed; unexpected URLs fail. Tiny fixed byte arrays stand in for reference
pixels and a result; they are not genuine images or rendered video.

| Fixture | Before: unsupported blanket addition | After: preserved authored meaning |
| --- | --- | --- |
| Generated reference depicting Ada Lovelace | Every depicted character fictional/synthetic | Real historical person, age 28 |
| Storyboard with Mara and Leo | Every depicted character fictional/synthetic | Mara age 35; Leo a child age 8 |
| Traveler of unknown identity/age, adult museum audience | Every person an adult fictional character | Traveler identity/age unspecified; audience remains adult |
| Explicit fictional adult Ivo | Every person an adult fictional character | Only authored Ivo is explicitly fictional, age 40 |

The reference-provenance section now states authorized reference use and that
asset origin does not establish identity or age. Subject assertions stay in
existing authored, active, scoped sections; no identity parser or new framework
is added. Provider/storyboard metadata does not even establish that *all* assets
were generated, so the blanket generated-asset sentence is also removed.
Ordered source-artifact bindings, reference modes, group scopes, hashes and
submitted byte arrays remain unchanged. Explicit identities, ages and exclusions
survive; an inactive subject stays excluded.

New prepared receipts use `identity_provenance: not-inferred-from-asset-origin`
for attached references, and `none` without references. This describes the
adapter's inference boundary, not a positive classification of each subject.
Existing source-artifact fields remain asset-origin evidence. The versioned
prompt contract changes `video-production-director` **1.1.0 → 1.1.1**. Transport
adapter `fal-seedance-reference` remains **2.0.0**: routing, financial units,
capabilities, audio, authorization and provider-call contracts are unchanged.

## Request evidence

[Readable before/after prompt diff](evidence/video-reference-provenance/requests.diff),
[exact UTF-8 byte replacements and hashes](evidence/video-reference-provenance/exact-diff.json),
[before capture](evidence/video-reference-provenance/before.json),
and [after capture](evidence/video-reference-provenance/after.json).
These are newly authored offline fixtures, never a historical replay or relabeling
of retained real requests/results. Regression tests compare the actual intercepted
request body byte-for-byte and apply the recorded byte replacement to reproduce it.
Only the provenance paragraph changes in each prompt; every other request field
and prompt section matches. Upload logs retain their original SDK timestamped
filenames; comparisons normalize only that clock-derived filename. Image bytes,
MIME type, upload/result URLs, ordering and counts compare unchanged.

Each new fixture has 8 intercepted operations: 2 upload initiations, 2 pixel
uploads, 1 video submission, 1 status, 1 original result and 1 download. Accounting
still emits pending/accepted/completed callbacks and the same 538,020 micro-USD
fixture estimate. This is unchanged software arithmetic, not current price
qualification or a settled charge. Recovery performs 3 GETs and no upload or
submission, preserving the entire old receipt, unsupported historical assertion,
old prompt-adapter version, reference inputs and metadata verbatim.

## Immediate consumers and bounded verification

- `worker/events-api.ts` stores the prepared parameter bag and reconstructs the
  retained receipt; its recovery checkpoint prefers the original values. No
  migration, backfill or historical evidence rewrite is needed.
- `src/model/generation-inputs.ts` exposes the retained Video input as the
  inspection `render_input`; it does not classify or rewrite `identity_provenance`.
- `worker/output-video-execution.ts` also calls `adaptVideoPrompt` and retains its
  adaptation version. It does not consume `identity_provenance`; its separate
  fixed transport/pricing check still requires adapter 2.0.0. Its direct execution
  and financial-recovery regression suites pass. No native contract was widened.
- Repository search found no production branch keyed on the old identity value.
  Only the fresh legacy prepared receipt wrote it; dependent assertions are updated.

[Verification record](evidence/video-reference-provenance/verification.json):
6 new focused tests pass; the broader prompt/reference/document suite is
127/133, and native consumer/recovery checks are 83/87. All 10 failures were
reproduced against unchanged main `25a7a722`: three stale document adapter/routing
assertions, three intake-fixture failures, and four extracted native-execution
fixtures missing `createNativeEventExecution`. They remain explicit limitations,
not regressions fixed by this work. TypeScript and changed-file ESLint pass using
the installed repository tools (Node 24.16.0, pnpm 11.16.0). The initial pnpm
wrapper attempted automatic dependency installation against the linked dependency
directory and hit sandbox permissions; checks instead ran the installed compiler
and linter directly. No dependency files were changed. No shared `dist` build,
browser, live provider, paid evaluation or media-quality/moderation test was run.

## Ownership and integration recommendation

The main checkout's three untracked proposals and other agents' files are
untouched. P5's approved `cc23f13d` package was inspected read-only. Its active
owner had advanced to `4d56f39e` with six additive R24 documentation files; this
patch neither imports nor changes that work, its source, envelopes or approvals.
P6 owns separate account/evidence feasibility; N2 remains complete.

Recommend integrating this isolated patch into current main as a standalone
Video semantic correction after reviewing the request diff and the recorded
baseline failures. Reconcile concurrent changes in the shared adapter first.
Keep it outside P5's exact approved package; do not rebuild or amend P5 envelopes.
Deployment/activation require separate work. Rendered video quality, identity
fidelity and moderation effects are unknown. This does not explain the historical
image rejection or demonstrate a lower rejection rate.
