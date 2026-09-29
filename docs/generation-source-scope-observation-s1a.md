# S1a — local scope observation ready for publication review

The bounded reader extension is implemented and verified locally. Production 535 remains unchanged. Its authenticated diagnostic establishes three scope failures among ten required events, but cannot distinguish absent metadata from conflicting values. **All three live classifications remain pending publication and a new authenticated read.** No historical membership exception was implemented without that evidence.

## Retained live finding

Basis: the existing authenticated Production 535 response captured at 2026-09-23 01:09:23 UTC, SHA-256 `3e9b53022b5816e52d2fec1707c55d9592887c1a079bd10235f92d63ea7eb5e7`. Full identities and original bodies remain in existing protected custody. Suffixes below identify the review rows without copying their bodies.

| Original source event | ID suffix | Last authentic lookup result | Absence/conflict/envelope classification |
| --- | --- | --- | --- |
| BlockCreated | 114bf3061397 | Passed scope lookup | Not a rejected event |
| BlockPropertyEdited | 19761efe1330 | Private document and project comparisons failed | Unknown; NULL and different values indistinguishable in v535 |
| BlockPropertyEdited | ae9aef29da64 | Passed scope lookup | Not a rejected event |
| BlockRelationAdded | 0231aa3b3166 | Passed scope lookup | Not a rejected event |
| BlockRelationAdded | ed95b35650da | Passed scope lookup | Not a rejected event |
| BlockCreated | 0622efc18034 | Passed scope lookup | Not a rejected event |
| BlockCreated | 985bfdc7764f | Passed scope lookup | Not a rejected event |
| DocumentCreated | 2c4255e7956b | Passed scope lookup | Not a rejected event |
| DocumentRenamed | 0ce7ea2c8e2e | Private project comparison failed | Unknown; NULL and different values indistinguishable in v535 |
| DocumentRenamed | 2b6baf1c7d75 | Private project comparison failed | Unknown; NULL and different values indistinguishable in v535 |

For the three rejected rows, owner stream, private owner, personal scope, pre-request sequence, redaction and size checks passed. Seven passing lookups are not a complete ten-event certificate or a fresh current eligibility finding.

## Local change and proof boundary

The same `includeSource=1` reader adds state-only `scopeObservations` for server-resolved scope-only failures. It preserves HTTP 409, all existing scope predicates and false review/execution eligibility. No new URL selector, write, provider request, migration invocation or body disclosure is introduced.

Each observation compares event identity, type, sequence, timestamps, actor/client/correlation and schema metadata to the already authenticated history; compares the private JSON to that history; and checks the public envelope against both actual producer projections. The writer projection comes from `publicEventPayload`; the legacy projection reuses the exact SQL expression from the privacy migration. Exporting that pure expression does not run or change migration behavior.

Document/project fields in private payload, public envelope and sidecar are observed as missing, null, empty, matches, different or invalid, without values. Sidecar extraction must agree with a supported producer normalization. Consistent missing/null metadata on BlockPropertyEdited or DocumentRenamed can be labeled `absent_scope_metadata`; explicit different scope is `explicit_conflicting_scope`; inconsistent public/private envelopes or sidecar claims are `inconsistent_producer_envelope`. Empty scope and unsupported absence remain unresolved. A NULL sidecar whose original body claims scope is never legitimate absence; earlier native source-integrity refusal may stop it before classification.

Every observation reports `membershipProven: false`. Envelope compatibility does not identify which historical writer ran. The full preexisting authority, owner/personal, Memory/pilot, rights, retention, bounded history/read/response, source witnesses, and final authority/configuration/deadline checks remain. Observation queries are captured and repeated within that fence. Rejected bodies and mismatching identities do not cross the diagnostic response boundary.

## Producer and historical subject trace

`eventWriteBindings` writes the public envelope and retained original body together; omitted or null scope normalizes to NULL, and empty strings also normalize to NULL. The historical privacy migration copies original JSON fields into nullable sidecar columns, retaining empty text differently, and does not overwrite an already existing sidecar. It can therefore preserve older inconsistencies; migration compatibility must be checked rather than presumed.

Current Still adds document/project fields to Block event writes. That does not establish the producer of the original BlockPropertyEdited event. DocumentRenamed producers can omit project scope. These code facts explain plausible classes, not the class of a live row.

The historical fold overwrites subjects on repeated creation, can use selected/current document or project as a fallback, and changes block membership through attachment, detachment and rehoming. A matching final projection cannot establish original membership at an earlier event. This continuation adds no such inference. Any later rule requires authentic absence and an unambiguous authenticated subject history at that event's sequence, including recreation and project transitions.

## Verification

Eight focused regressions passed: four complete/diagnostic journeys across the source Worker and the actual rebuilt production Worker, plus four real privacy-migration regressions. Each Worker journey uses one synthetic planner/image result with an offline sentinel; inspection adds zero provider calls or writes. Tests cover real-writer omission, explicit null and empty values, explicit foreign scope, inconsistent envelopes, a NULL sidecar with original scope claim, wrong owner/redaction, unsupported event type, recreated/rehomed/detached/attached subjects that remain unavailable, and scope/authority/job-retention/configuration changes after observation capture. Existing complete-reader tests preserve approval producer, rights/expiry/redaction, Memory, owner/project, size and retained-record checks.

The real migration fixture includes a numeric-version filtering difference from the JavaScript writer, proving the diagnostic uses the historical projection rather than falsely labeling that difference inconsistent. TypeScript, changed-file ESLint, localization, generated schema consistency, `git diff --check` and clean Vite build passed. Build reported the existing large-chunk advisory. The fixture preserves the 41-migration boundary and disabled Memory/study behavior. No live schema, grant, audience, configuration or routing changed. See `evidence/generation-s1a/verification.json` for commands and bundle hash.

## Original attempt and approval status

The nine retained private records remain internally consistent at historical revision `rev-1pygpag`: source snapshot/block versions, parsed planner direction, compiler prompt, moderation text and image wire prompt agree. The expiry previously observed is 2026-10-22T22:28:29.898Z; this continuation did not obtain a fresh live retention certificate.

Original approval commit/plan/execution/consent/result lookup has **not run** because the source-event gate still fails. The two approved-context-proposal markers therefore remain claims awaiting their original producer chain. Historical source qualification and current source eligibility are both unavailable. Current identity must be checked separately after historical qualification; internal agreement of retained records does not establish either current eligibility or human fidelity.

No offline C baseline/provenance candidate was prepared because its authentic source/approval prerequisite has not qualified. Human fidelity review and the accounting/lifecycle policy remain existing user decisions; neither was selected. The ordinary app's recorded settlement is not newly certified as a final attributable charge.

## Precise next decision

Review this local extension, then separately authorize publication if desired. Publication is explicitly outside this kickoff, so no deploy was attempted. After an approved release, repeat the same published authenticated reader for the original attempt and retain its Boolean/state response in existing private custody. Genuine absence can justify investigating a narrow historical membership rule; conflict or inconsistent envelopes retain the exact refusal and require a bounded decision, not silent repair or another planner purchase.

[Progress Report](http://127.0.0.1:4187/) · [Retained live diagnosis](http://127.0.0.1:4193/s1/reader/live-read/diagnosis.html)
