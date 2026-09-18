# Native Memory source capture — 2026-09-18

## Implemented

`worker/memory-derivation-sources.ts` captures complete original Creator conversation text for an issued native reference-job lease. It does not use the eight truncated display excerpts. Personal and organization-scoped free/paid replies retain their actual event, turn, content, custody, consent, hash and lifetime proofs.

- Captures the entire job, up to 64 conversation pairs/128 original-role sources. Larger or oversized jobs remain incomplete; there is no partial-success cursor or silent truncation.
- Pins measured UTF-8 body, event and paid-consent sizes in the hydration SQL, so grow-between-reads replacements are rejected before transfer.
- Proves the original human event is after purpose consent, not just the assistant completion. Paid ancestry checks the original saved approval hash, both saved pointers and current pointers, including surviving origin tombstones after body/turn erasure.
- Keeps typed site activity observations separate from human quotations. They are not independent intent evidence or semantically completed work.
- Uses one atomic final lease/source replay, bounded by original source retention, native capability-grant expiry and scheduled pilot transitions. Copied input DTOs are staging data, never reusable authorization.
- Leaves the job, financial counters, provider and scheduler unchanged. No external requests, real credentials, user enrollment or rollout changes.

The paid specialist final-result reader also removes a duplicate ancestry binding from the same final SELECT. Its mandatory ancestry check remains and is checked first. This corrects a preexisting 105-binding D1 overflow; authority, custody and exact receipt checks remain intact.

## Verification

275/275 combined native derivation, specialist consent/lifecycle and assistant-authority regressions passed, including isolated real workerd/D1, full personal/shared paid/free sources, late withdrawal, exact-size races, minimized ancestry tombstones and 64/65-pair capacity. A separate original native grant-deadline regression passed. Typecheck and changed-source lint passed. Final native regression: 113/113 passed, including genuine personal/shared consumption recall through the unchanged query descriptor. Production build passed; document recovery regression: 66/66 passed.

The one-line document recovery test correction updates its SQL witness for the already-existing `slot.grant_id` projection. The old test failed on an unchanged baseline; no Output production behavior changed.

## Remaining native implementation

Capture is not processing. Independent cap/paired-hold accounting, privacy-safe receipt recovery, processing-window progress, separate Chat Studio delivery, grounded semantic derivation and publication, durable dependencies/corrections, broader scope/consumption coverage and integration verification remain in the full plan. This slice alone does not make the full Memory branch merge-ready.

Hosted/provider qualification, external vector storage, schedule registration and explicit individual enrollment remain separate operator gates in [the Sites capability to-do](forma-memory-sites-capability-todo-2026-09-18.md).
