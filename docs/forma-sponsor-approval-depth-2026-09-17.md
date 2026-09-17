# Sponsor approval proof: D1 expression depth

The dormant approved-campaign loader could reject a valid canonical actor before any work was admitted because its transaction-time payer proof exceeded the database expression-depth limit. The exact failing `output_atomic_assertions` INSERT was reproduced against the exported synthetic schema and bindings in bundled local workerd/D1. This is local backend evidence, not a production database execution.

`sponsorApprovalAssertion` now evaluates the complete approval conditions and the unchanged `PRINCIPAL_WITH_ACCESS_SQL` as sibling materialized relations. Their join retains the exact ten-field payer snapshot comparison. Every original approval, eligibility, optional issuer, role, consent and policy predicate remains; parameter order, SQLite value types and the expiry deadline are unchanged. The full proof still runs inside the same atomic write. It is not replaced by a successful earlier read or a cached principal.

The change does not alter principal/access-policy SQL, account ownership, native custody, known-cost settlement, schema installation or public routes. It activates no sponsor campaign and grants no financial authority. Original incurred-cost accounting continues to use its separate persisted financial proof.

## Qualification

- Eight focused actual SQLite tests run the real loader and atomic assertion statements with expression depth limited to 100. They cover captured payer drift, computed access fields at fixed timestamps, eligibility versus issuer authority, revocation, current actor consent, exact policy bindings and rollback when authority changes inside the transaction.
- Four existing changed-path tests pass for approval/replay, changed terms, issuer refusal and monotonic revocation.
- An independent local workerd/D1 probe reproduces the original depth failure against the exact 283-object/109-table synthetic schema and original bindings. The equivalent paired-relation candidate succeeds with `passed=1`; financial counters remain unchanged and foreign-key checks pass. A separate local scalar probe establishes the bundled backend's depth-100 limit. These checks used no network egress or real accounts.
- TypeScript and scoped lint checks accompany the frozen source receipt. No unrelated provider journey was repeated.

The ten snapshot fields are covered by drift cases. The missing bound payer and explicit consent gate also explain their respective refusals; those two cases are not claimed to isolate a JSON-array position. The fixed-timestamp computed-field cases specifically verify that the complete retained access snapshot still matters.

The original failed query, failed nested-only materialization candidates and successful sibling-relation candidate remain in the evidence packet. The initial local probe's recorder setup error was corrected separately and is not classified as a product defect.

## Separate remaining work

The new pre-job intake-read allowance remains an independent, unactivated increment. Its retained attempt and disclosure queries require their own full engine qualification. This dependency fix does not imply that those reads, a public sponsor entry, a campaign policy or sponsored launch are complete.
