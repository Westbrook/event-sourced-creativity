# Memory derivation purpose controls

Feature-branch implementation only. This extends the [native continuation](forma-memory-native-continuation-2026-09-18.md), not the full semantic pipeline or a production activation.

## Implemented

- Separate permissions for rolling summaries, tentative profile patterns and suggestions. Reference-memory or palette consent does not imply these permissions.
- Operator qualification metadata binds the exact source SHA-256, HTTPS origin, deployment, purpose, recipe, model, frozen prices, token limits, retention disclosure and evidence hashes. The application supplies no default model price or monthly cap and exposes no qualification-creation endpoint. Evidence hashes identify operator-reviewed material; they are not independently generated proof of qualification.
- Explicit self-payer AI-allowance confirmation; future-originals watermark; exact native custody and parent revision; retention/expiry bounded by the parent and qualification; optional background consent. One immutable random consent ID per revision prevents renewal/revoke ABA after expiry or privacy cleanup. The 64-row bound limits retained versions, not lifetime revision numbers.
- Same-origin settings/consent/revoke API with native authorization and same-batch scope, source-head, enrollment, qualification, clock and inventory checks. Unknown write acknowledgements require a fresh explicit read, never an automatic retry.
- Original-actor metadata-only recovery and revocation remain available after learning is paused, deployment flags are disabled or parent permission expires. This path cannot read source bodies, offer new consent or restore document access.
- Enrollment replacement, purpose/qualification revocation, denied native access, Forget, personal/organization erasure and expiry cleanup revoke or remove grants. Broad privacy inverses have constant-size count/acknowledgement receipts and no 4,096-row lifetime ceiling; database execution failures remain atomic/retriable. They do not settle or refund money.
- Separate manual browser controls and strict bounded transport in the existing Memory panel, localized in English, French, Arabic and Japanese. Opening the disclosure does not fetch settings. The UI shows exact qualified prices/cap and retention disclosure; allowance, background and final consent start unchecked. Known permissions can be revoked. Stale navigation, expiry and uncertain mutation responses cannot resurrect UI state.
- Guest-custody schema inventories recognize only the exact new family and reject guest-linked grant metadata, partial/changed schemas and unexpected inbound dependencies.

## Additive migration

`drizzle/0043_memory_derivation_purpose_grants.sql` adds two tables and 13 explicit schema objects, including immutable/collision guards and parent/qualification revocation triggers. `db/schema.ts`, snapshot `0039` and the journal agree; existing ORM tables were compared with snapshot `0038` before generation and did not change. No historical migration or pending candidate was rewritten. No hosted migration was applied.

Exact schema digest: `sha256:ea62945c5ccafa73b45faf546169b6b8d198fdc038b7bbed666c882338b02523`.

## Verified locally

- 41 native consent/privacy tests, including actual isolated workerd D1 commit/read/revoke, D1 expression/function/parameter/SQL-limit compilation, more than 4,096 privacy rows, stale consent identities, lost/malformed acknowledgements, expiry races and existing personal-erasure compatibility.
- 582 client/model/component tests, including explicit controls, independent consent, request cancellation and stale delivery.
- 164 existing migration/schema/guest-inventory tests and nine added derivation guest-isolation tests.
- Two whole-application browser journeys: English desktop and Arabic 320px, with finite synthetic GET responses only. These test rendering and inactive controls, not hosted authorization or actual enrollment.
- Typecheck and production build; changed-source lint. Build retains existing chunk-size warnings.

## Still native implementation work

The API deliberately reports `processingImplemented:false`; the UI cannot enable a purpose while that is false. No semantic model, schedule, index or paid job is run by these controls.

The shared **payer / UTC calendar month / all Memory purposes and projects** cap is a consent contract, not yet an implemented financial ledger. Durable manifests, jobs/leases, native token and dollar holds, immutable dispatch/usage receipts, uncertain-outcome recovery, grounded result publication and their privacy inverses must be integrated before this can change. Saved purpose consent must never substitute for those checks.

The full [Sites-native implementation table](forma-memory-sites-capability-todo-2026-09-18.md#sites-native-code-still-to-implement) remains open. PostgreSQL, hosted scheduling/execution, provider qualification, measured cap approval and affirmative real-user enrollment remain separate [operational gates](forma-memory-nonimplementation-work-2026-09-17.md). No service, credential, budget, rollout flag, audience or schedule changed in this slice.
