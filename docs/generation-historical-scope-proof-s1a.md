# S1a — authentic absence verified; historical proof ready for review

## Integrated, published and live-verified are separate

Current main and Production536 both contain diagnostic commit `f8751b5e1c6dbde004cbf384d4e238c2d6571483`. The existing native deployment receipt was rechecked successfully; no duplicate publication occurred. Environment revision16 and workspace audience revision7 remain unchanged. The production release's locally verified Worker SHA-256 is `e1f7287274f546753e45078c940ad6b0a1926e9bb7b535aad919f16380544f1e`. Local uploaded archive SHA-256 is `e79f4837ec7787b620f9773bf1c2d2afb29ba1efbb0101f871bfce86bb4e0983`; Sites' saved archive identity is `sha256:4fb1f0b5ca1a5f66fdb11533dd64551c7043ec98dac92eab6b7509ddb478ac2a`. These identify different packaging representations, not additional publications. The release contains exactly the 41 permitted migrations.

The original authenticated `includeSource=1` read was repeated at **2026-09-23T13:07:53.332Z**. The exact 4450-byte response is retained read-only in the existing protected evidence directory, with browser/local SHA-256 equality: `27169b43f9171b7e4f81ee1f082500a44ce4ccdc669ce8d8623fdc78fe279a64`. This is a fresh state observation, not an inference from Production535's failed Boolean comparisons.

| Rejected source event | ID suffix | Actual private/public fields | Actual sidecar | Live classification |
| --- | --- | --- | --- | --- |
| BlockPropertyEdited | 19761efe1330 | Document and project both missing | Both NULL; each agrees with original payload | absent_scope_metadata |
| DocumentRenamed | 0ce7ea2c8e2e | Matching document; project missing | Matching document; project NULL | absent_scope_metadata |
| DocumentRenamed | 2b6baf1c7d75 | Matching document; project missing | Matching document; project NULL | absent_scope_metadata |

All three have matching event identity, matching retained private body/history and envelopes compatible with both the current writer and historical migration. Actual historical producer attribution remains unestablished. **All three still report membershipProven:false in production.** The other seven required events pass the strict original lookup; the complete ten-event source certificate remains unavailable. See the prior packet for all ten event suffixes.

## Narrow local compatibility change

The additional change is local and not integrated into main or published. It applies only to the authentic missing-field shapes: BlockPropertyEdited with both document/project keys absent and an explicit block ID, and DocumentRenamed with an explicit matching document ID and project key absent. Explicit NULL, empty strings, different scope, other event types and library/canvas claims do not receive this exception.

A candidate must have exactly one explicit ProjectCreated and DocumentCreated in order, plus exactly one explicit BlockCreated for the block edit. Creation records must name the selected project/document; they must precede the affected event. The proof examines the complete authenticated prefix through the original generation request, including events between the affected edit and that request. Repeated creation/fork, removal/restoration, attachment/detachment, rehoming and project-state transitions remain rejected even if later events restore the current projection. Explicit scope conflict anywhere in the relevant subject history is rejected. No current projection or fold default supplies missing identity.

The historical identity census conservatively requires available, owner-bound, consistent public/private identities for Project/Document/Block history, and recognizes only the event types covered by this rule. Unknown types, erased or foreign envelopes, implicit creation identities, and unsupported transition histories fail closed. This may refuse an original attempt whose unrelated historical identity rows are unavailable; it does not silently treat unavailable history as proof that no conflicting incarnation exists.

Every relevant producer is independently checked against the actual writer or migration envelope contract, original event metadata/body, sidecar extraction, personal scope, owner, redaction, size and sequence. At most128 producer observations are used within the existing query/read budgets. The complete original history pages are fingerprinted and reread inside the final source rechecks so a same-head, same-byte-count mutation cannot change the absence census undetected. Only lifecycle rows are retained for candidate analysis; history witnesses cover every page.

The returned original payload is unchanged, including NULL sidecar metadata. A successful certificate adds a separate historical proof with its rule, original event sequence, covered historical boundary and origin/evidence event IDs. If any original event remains unavailable, no original bodies or approval evidence are disclosed; the state diagnostic provides only proof status/reason. Ordinary generation, approval matching, Memory/pilot exclusions, rights/retention, bounded response size, final authority/configuration/deadline checks and no-write/no-provider behavior remain intact.

## Validation and scope

The focused suite covers 24 historical candidate cases and 12 source/actual compiled-Worker journeys. Positive omissions are persisted through the real event writer and staging trigger. The positive Worker fixture reaches its original retained approval commit, plan, consent, execution and result chain without backfilling any evidence. Negative compiled-Worker fixtures exercise recreated, rehomed and detached/reattached subjects; remaining cases cover explicit foreign scope, damaged envelopes, wrong owner/redaction, rights/retention, changed authority/configuration, unsupported events and mutation races. The new history witness catches an unrelated historical origin changed without advancing the head or changing the byte count. Inspection assertions require zero writes and zero provider calls.

TypeScript, changed-file lint, generated schema consistency, localization and clean build are checked. Exact results and the new local bundle identity are in `evidence/generation-s1a/historical-proof-verification.json`. Tests use offline fixtures, not a live key. No migrations, grants, provider calls, study activation, routing or accounting-policy changes occurred. Existing unrelated files in main are preserved.

## Remaining authentic prerequisites and smallest decision

The actual original approval chain has not run: Production536 still stops at the three absent-scope rows. Historical source qualification is pending the local proof running on authentic history; current eligibility must then be reported independently by the current authority/rights/source checks. The retained nine records at `rev-1pygpag` remain internally consistent, but internal agreement is not approval provenance, current eligibility or human fidelity acceptance.

**Review the local proof diff and authorize its additional publication if acceptable.** Then repeat the exact authenticated original reader. It will either return the bounded historical-proof refusal, proceed to a precise original approval failure, or provide the complete source/approval certificate. No further reader scaffold or replacement planner is needed for that attempt. If source and approval qualify, the retained planner direction can support the genuine offline current-compiler/provenance-only comparison; preparing that comparison now would skip its explicit prerequisite.

Human fidelity, accounting-policy selection and paid generation authorization remain separate and unselected. No additional production compatibility change was published under this continuation.

[Progress Report](http://127.0.0.1:4187/) · [Production536 release receipt](http://127.0.0.1:4193/s1/reader/s1a/release536.html)
