# One missing interface: authenticated F3 study financial approval

This is a concrete unimplemented extension, not an executable grant installer. P3 stops here under its explicit unsupported-capability alternative. No other platform is proposed.

## Exact break

`retainSuppliedStudyInputs` calls `resolveFinancialPolicy` for both `imageFinancialScope` / `operationKey` values before inserting either private copy. `resolveFinancialPolicy` requires an exact, unexpired, authorized `generation_study_financial_grants` row containing the canonical F3 policy. There is no non-test producer of that row in the inspected source. The study grant and supplied-review row also have no non-test producer.

`approveSponsorCampaign` is a genuine payer-authenticated approval producer, but for its allowlisted sponsor policy families. It rejects an F3 policy before writing. Its terms describe sponsor campaigns, eligible actors, issuers, templates/recipes, maximum allowances and finite resources; they do not represent F3's `accepted-estimate` unknown maximum liability decision, `bounded-proof` evidence, dedicated lifecycle reserve/term, or exact two study operation identities. F3 terms cannot be squeezed into a sponsor amount or inferred from administrator status. Extending that producer to F3 would require a new financial approval contract, not a lookup or adapter. No current authenticated F3 financial producer was established.

The existing authoring path is likewise not already a study producer. `AuthoringPlan.operation` is a closed union for context proposal, document copy, canvas arrangement, adaptive proposal and workspace quick edit. `commitAuthoringPlan` requires genuine authored events and a verified receipt; it cannot commit an empty “study approval” through its current signature. Fake document events would obscure the side effect. The context application route enforces its own retained operation and digest.

## Minimum extension proposal

Add **one** narrowly typed `generation-supplied-study-approval` operation to the authenticated server-owned authoring review/commit domain. This becomes the missing F3 approval producer, with an explicit new contract review. Do not add a standalone financial-grant endpoint, accept raw row JSON, reuse a sponsor receipt for F3, or introduce a generic grant factory.

The proposed callable surface is a single default-off study handler with `preview`, `commit`, and `status` actions. It accepts only an opaque server proposal ID; `commit` also accepts the retained preview ID, displayed digest, intent ID and explicit decision command. These are requests to authenticate and verify a decision, never authority by themselves. The server loads its own finite proposal and account/evidence configuration. The handler must have a study-specific typed branch in the existing authoring domain; current document-edit APIs must not silently acquire financial powers.

A proposed server-retained review contains:

- Exact source and frozen direction bytes for full display, agent authorship, intentional tether conflict, approved use, rubric, safety/fidelity distinction and protocol version.
- Complete six HTTP requests, candidate/profile, configuration, runtime closure and inventory hashes; both stable operation identities and zero-retry/order limits.
- Current principal/permission snapshot, intent, explicit expiry and revocation; no extension of October 1 or inherited approval.
- Both complete F3 policies. Each must separately identify the real payer, credential/account/project-header/region binding, verified rate/cost-basis evidence and expiry, reservation split, mode and required liability decision. `accepted-estimate` must explicitly disclose null maximum loss and lack of provider cap. `bounded-proof` must carry substantiated evidence. A proposed $3 allowance selects neither mode.
- Separate actual financial settlement and lifecycle authority references, including funded retention of source-free accounting after private content expiry; deletion ownership, term and actual closure evidence. Missing evidence keeps the preview non-committable.

**One transaction domain:** use the same `env.DB` for retained review, principal/evidence rechecks, authoring commit receipt, study grant, supplied review and the two financial grants. Introduce a narrowly typed authoring commit proof for these side effects; the existing event-only proof is insufficient. Preserve current event commits without fake events. A schema adjustment to the existing receipt, if required, must be explicitly versioned and separately rehearsed. Use DB-time expiry, immutable values, unique intent/review/operation keys, and final CHECK assertions so partial writes roll back. No `INSERT OR REPLACE`, secondary database, asynchronous grant completion or independently trusted grant issuer.

The same transaction should insert the two private copies using extracted, statement-only P2 intake preparation, with its existing custody and financial guards. Do not invoke the current separately committing intake helper halfway through the approval batch. After commit, reconstruct the unchanged P2 host from server configuration and reread the exact durable bindings. Every I/O boundary must retain its current principal/custody/revocation/financial checks. Commit approval still does not dispatch a provider request; a later explicitly authorized execution action addresses the original operation only.

For lost acknowledgements and duplicate/concurrent commits, return only the existing byte-equivalent receipt after current authorization; conflicting digests fail. Keep original purchase intent, settlement, hard stops and expiry irreversible. Reconciliation never turns unknown accounting into authority to retry.

## Acceptance before claiming connection

Exercise the actual authenticated producer → authoring transaction → private intake → P2 host, with intercepted transport and disposable transactional fixtures. Require wrong/stale/forged review and changed display/bytes/protocol/runtime/principal to fail; revocation/expiry and missing either financial policy or lifecycle evidence to fail; duplicate/concurrent intent to produce one receipt; faults after each insert to leave no partial approvals/copies; personal kinds and retained-source v1 denials to hold; every disabled entry to make zero DB/provider calls. Preserve the original six POST slots, nine evidence records per arm, original-only recovery and human/settlement gates.

P3's tests verify the existing consumers and the exact unsupported producer rejection. They do **not** pass this future complete-chain acceptance, because the producer is absent. Creating the producer is the minimum remaining implementation. Its financial terms require actual evidence and human approval independently of local implementation.
