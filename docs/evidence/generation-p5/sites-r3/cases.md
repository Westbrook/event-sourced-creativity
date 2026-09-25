# Fixed cases and evidence

Only `/p5` accepts POST JSON. Fields are exactly `{action}` or `{action:"step",index}`. There is no SQL, row/chunk, grant, policy, credential, provider URL, clock, mode, retry or fault field. The importer uses 26 compiled statements in one D1 batch with the new run record. Any statement failure rolls the import back. An existing run, dirty application table, wrong catalog, wrong dataset or wrong native owner refuses.

A real hosted run would use normal owner-private Sites dispatch and its authenticated ID/email. The email hash is a consistency pin, not a secret or bearer token. First start pins the Site-specific ID; subsequent requests require it. Hosted access must remain owner-private. Local tests supply clearly synthetic native headers and therefore do not prove the managed dispatcher. The wrapper's fixed internal application requests use `mock-owner` and `owner@example.test` only inside the isolated synthetic database. No production Forma identity or content is accessed.

| Step / case | Actual path and required evidence |
| --- | --- |
| Before start | Missing ID, wrong owner email, cross-origin, unexpected SQL field and oversized body refuse. Wrong schema, wrong persistent dataset and credential-shaped bindings have independent local refusal cases. |
| start | One atomic compiled import and P5 claim; persist dataset, owner, start, original tombstone hash. No original N10H action is invoked. |
| 0 rollback | Real approval preview and commit. Wrapper appends one deliberate failing CHECK to the actual approval batch. Complete grant/receipt rollback; zero committed study grants/receipts. Original preview remains a separate pre-commit private record and is later deleted. |
| 1 approve | Actual P5 approval receipt. Concurrent identical HTTP claims have one winner. All others fail their atomic cursor/phase claim. Driver may discard the committed acknowledgement and recover cursor via status; no replacement commit. |
| 2 baseline | Actual adapter, three exact compiled synthetic provider responses. Every response observes a persisted original operation and `intent` stage before returning. Advisory/moderation/image bodies must byte-match compiled requests; unmatched transport is denied. |
| 3 recover-original | Driver deliberately discards baseline's acknowledgement; a later HTTP invocation inspects the same cursor/operation/receipt. Duplicate execute makes zero provider dispatches. Actual recovery reads original PNG and validates its hash. This is cross-request durability, **not forced runtime restart**. |
| 4 settle-baseline | Fixed synthetic original charge and reconciliation linked to original request/receipt, then actual reconciliation endpoint. No caller-supplied billing data or authentic funding claim. |
| 5 observe | Treatment first refuses without baseline observation. A fixed synthetic human-observation simulation records expected benign fidelity failure and explicit resume. It is not real human review. |
| 6 treatment | Actual adapter, three further exact synthetic responses; one original operation. No provider retry or replacement. |
| 7 settle-treatment | Same original-charge linkage and actual reconciliation for treatment. |
| 8 expiry-revocation | Attempted proposal-expiry mutation is rejected by the unchanged immutable trigger. A compiled private account-evidence body is expired and actual execute refuses `authoring_study_evidence_unavailable`. Irreversible configuration revocation then makes preview refuse. Dates are never renewed. |
| 9 terminal-stop | Actual stop; another execute is denied with zero new responses. |
| cleanup | Read/hash each of the two compiled keys if present, delete each, then read-null. Delete only synthetic owner's private bodies, verify zero private rows, retain original accounting, recheck old catalog/tombstone, and persist P5 disabled/report-null. |

The isolated failure harness additionally covers: forbidden binding, wrong canonical schema, wrong dataset, one-hour run expiry, and stop before purchase plus an orphaned successful R2 put whose acknowledgement was lost. For the latter it seeds the exact original compiled key directly in the local emulator, leaves operation rows absent, then invokes the **unchanged proposed cleanup**. Cleanup finds both known keys without trusting a possibly missing `artifact_ref`. This local fault setup is not exposed over HTTP and is not claimed as a hosted put-ack fault injection. Actual provider response loss is not induced; only compiled synthetic responses exist.

The run phase is atomically `ready → busy → ready` with one cursor per step. On an unexpected post-claim failure it is stopped; a lost stop acknowledgement leaves busy/consumed state, so replay still refuses. Start never resets an existing record. Stop prevents new steps; it cannot revoke an already completed side effect. Cleanup during busy is denied until the one-hour run window expires, preventing cleanup from racing normal in-flight work. Cleanup is recoverable from `cleaning` after an uncertain deletion acknowledgement, using the same keys and no provider call.

29 relevant new checks passed against the proposed compiled bundle. R1's 266 and unchanged discovery were not repeated. No emulated time change, production mutation, forced restart, provider billing, quality evaluation or managed performance claim is hidden in these labels.
