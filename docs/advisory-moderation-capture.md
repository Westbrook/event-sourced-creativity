# Personal Still Image advisory moderation custody

This prospective correction retains the existing snapshot-moderation operation before ordinary personal Still Image admission. It does not change moderation input bytes, verdicts, provider request count, safety acknowledgement or admission policy. It does not qualify historical source completeness, E2a or any other media.

`moderateGenerationSnapshot` has an advisory-only observation boundary. It awaits request/response checkpoints but catches their storage/reporting errors separately from moderation. A failed request checkpoint cannot suppress the provider request; a failed response checkpoint cannot replace a valid clear/flagged verdict. The later exact-prompt moderation path retains its original checkpoint semantics.

Raw request/response bytes use existing owner-private `provider-output` content. Preflight JSON contains only bounded `advisoryCapture` links and status, original operation/preflight/source/request binding, hashes and original per-record expiry. Records contain their private owner/stream binding. At most two references and500KB per record are accepted. No schema migration, new endpoint or access grant is introduced.

Both full cache hits and `previousSafety` reuse qualify the original private records without refreshing them or making a replacement moderation call. Their original preflight identity stays in `origin`; the consuming preflight/request is recorded separately in `adoptedBy`. Cache validity remains the existing10minutes. Content expiry remains its original private retention deadline; those two clocks are independent. Legacy summary-only and missing/expired/redacted/foreign/mismatched receipts are explicitly unavailable or capture-incomplete. Capture state never supplies a safety pass.

Admission rejects client-supplied `advisoryCapture` and existing evidence references as server-owned fields. The actual admitted job gets the references in its original checkpoint. Foreground execution restores these trusted references after stripping request checkpoints, then later planner, exact-prompt moderation and image observations append normally. Success and failure terminal results preserve the original advisory binding.

The existing authenticated terminal job evidence reader requalifies advisory receipt identity, original deadline, document revision and consuming job/preflight/request binding. It reads only owner/personal content under existing Memory exclusions, removes unavailable bytes, and rechecks custody plus the existing principal/job/event/content authority. Raw bodies never enter public probes, audit events, report data or financial submissions. Governed, sponsored, native Output, workflow and non-Still paths are not opted into this extension; existing governed behavior remains unchanged.

## Remaining limits

A preflight may precede admission, return428/409, never yield a job, or be canceled before GenerationRequested. Its capture is marked `unavailable-before-admission` for inspection; no complete end-to-end job observation is claimed and no job or reader is invented. A canceled admitted job without GenerationRequested remains outside the original-attempt download selector. Existing job inspection can retain its metadata; that is not proof of a full executed chain.

`retained` describes captured original bytes after checks, not permission, source completeness, financial settlement or human acceptance. Retrieval can later report those bytes unavailable. Raw bytes cannot be reconstructed from a legacy summary. Per-record storage failures, truncated provider responses and unknown dispatch stay explicit limitations. No historical backfill or retention extension occurs.

## Validation

The real SQLite writer/Worker fixtures retain all four actual envelopes for a fresh personal job: advisory moderation, planner, exact-prompt moderation and image. Success and provider503 run against source and the actual rebuilt Worker, with exact request hashes and no extra provider call. The suite covers both reuse paths, legacy/missing/expired/foreign/mismatched records, attempted expiry extension, forged client fields, changed source revision, original request binding, revoked consent, expiry during read, cancellation, and early428/409 without an invented job. Existing historical positive/refusal/authority tests stay intact. Separate unit fixtures throw at request, response and both capture callbacks with clear and flagged moderation, preserving exact input and verdict.

Run:

```sh
node --import tsx --test --test-name-pattern='advisory custody|isolated schema delivers' tests/event-save-repair.test.mjs
node --import tsx --test tests/advisory-moderation-boundary.test.mjs tests/generation-outcome-evidence.test.mjs tests/generation-request-parity.test.mjs tests/moderation-response-validation.test.mjs tests/workspace-generation-readiness.test.mjs tests/generation-budget.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```

The release candidate additionally runs changed-file ESLint, custom-element generation, localization audit, memory-schema generated-artifact check and the normal production build. Fixtures use fake credentials and local in-memory migrations only; no deployed migration or provider call is performed.
