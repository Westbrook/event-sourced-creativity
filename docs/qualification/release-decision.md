# Still hosted qualification — release decision

**NO-GO for production activation.** Local preparation and repairs are distinct from hosted qualification. No paid provider run, new hosted resource, schedule, schema application or feature activation is authorized or performed by this packet. Required unavailable evidence remains a gate.

## Exact baseline and candidate state

The fresh native [baseline receipt](hosting-baseline-receipt.json) verifies production v550 / `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`, succeeded deployment `appgdep_6ab573499a108191a2691a137672b93e`, environment revision 16 and unchanged `workspace_all` audience. Archive SHA-256 is `a629abf35cdb357f0affa0c309ebfc0591cfe235249404c97b7ce19ee813be7f`. That is the published disabled implementation; it is not a publication of subsequent qualification work.

The runtime candidate is committed through `3786dc53379567dd6c9f16e6d0bf9ea0cacf9794` on `codex/still-hosted-qualification`. Scoped implementation commits, in order: `a93dbd1d`, `3c71eee3`, `738b612a`, `f259212c`, `a0edb97f`, `ec2a14d3`, `bd57baaf`, `3786dc53`. Qualification tools are committed as `6c600508` and browser synchronization as `2094797f`; these and subsequent evidence commits do not change this packaged runtime. Local main is still `c28af5fe`; no remote is configured, and no push, merge, Sites save or deployment occurred.

The [disabled archive receipt](disabled-archive-receipt.json) records a clean detached build of that exact runtime: raw tar SHA-256 `7cbb34c7ab99f584b6e59b5cc85a675b869b20951e949a2222fab51c450d248b`, 45,351,936 bytes / 622 files; Worker SHA-256 `afbf3c0a5a0b5d08bb69d005a04abfad8790c56a42a478bf09718d15095ba5be`. It contains exactly the held 41 migrations and no candidate SQL or qualification entry. It has **not been published**. No schema-enabled archive is approved. The held policy remains in force; v547 must never be deployed. The archive's policy baseline v494 is historical migration-policy metadata, not the current published baseline.

The [verification ledger](verification-2026-09-24.md) records final local checks and their limits. This is a tested engineering checkpoint and an explicit no-go decision, not completed release qualification.

## Evidence decision ledger

| Gate | State at this checkpoint | Evidence and remaining decision |
| --- | --- | --- |
| Current lineage | PASS, read-only baseline | Native v550/source/deployment/archive receipt; final candidate identity recorded separately |
| Supported schedule and isolated target | UNAVAILABLE | Finite [hosting decision/request](hosting-capability-decision.md); no schedule operation or accepted route-scoped machine identity established; no isolated target IDs allocated |
| Authoritative schema compatibility | LOCAL REHEARSAL PASS / HOSTED UNAVAILABLE | 10/10 checks; 107 additive statements / 94 added objects; six partial-prefix recoveries converge. [Manifest](schema-candidate-manifest.json) digest `fbc89dffdc95b4f039db733a465941499093b7dc35c985f89b5b935561aa5743`. Actual complete ledger/definitions, target journal numbers and hosted backup/restore still absent |
| Local throughput and lifecycle | FAIL — required implementation gates | [Final source-frozen receipts](throughput-2026-09-24.md): 1k/10k backfill90m/651m passes24h; healthy edit6m/38m fails5m; default10k renewal794m fails12h. One-day10k renewal has0/10,041 current sources at144m deadline. Prose/object erasure1m/15m and keyless terminal cleanup pass locally;15m has no wake-jitter margin |
| Frozen relevance preparation | PREPARED, not live-qualified | Synthetic60-query packet, separately authored agent labels and hash-bound provenance. No private production rows or model outputs used to label. A label string alone does not establish independence |
| Live relevance and disclosure | UNAVAILABLE | >=40 positive/>=20 negative held-out queries, >=90% top3, <=10% false positives, >=95% per-partition recall@20, zero forbidden disclosures still require authorized live capture |
| Hosted responsiveness/resource economics | UNAVAILABLE | >=30 cold/warm/concurrent observations at each 1k/10k size, actual cold/runtime provenance, <=2s after-debounce p95 and<=100ms typing evidence; old injected samples do not close this |
| Hosted lifecycle/retention/authority | UNAVAILABLE | Real update<=5min/deletion<=15min, backfill/renewal sustainability, private media denial, restart/late-write/orphan erasure and cross-deployment authority remain unwitnessed |
| Organizer fidelity | UNAVAILABLE | 32 frozen organizer inputs prepared; >=30 live outputs with named human adjudication of invention/omission/constraints required |
| Human accessibility | UNAVAILABLE | Existing browser automation retained; screen-reader tool/platform/reviewer journeys remain open |
| Hosted recovery/rollback | UNAVAILABLE | Hosted lost-response/two-tab/discard/flags and schema-failure/restore/cleanup-preserving rollback receipts absent |
| Cost and authorization | NO AUTHORIZATION | [Itemized proposed allowance](cost-estimate.json), $25 total/$5 canary proposal. All-provider lifetime/canary reservation implemented and locally tested; actual hosted enforcement, host/Jev account terms and named owners unresolved |
| Production activation | NO-GO | Production remains disabled; exact later pilot authorization required even after all technical gates pass |

The ledger intentionally distinguishes a passing local check from a passing hosted release gate. The completed local receipt cannot convert absent hosted/human evidence into a pass. Local freshness and renewal failures also block paid scale qualification; authorization alone cannot make this release ready. Preserve failed measurements alongside repaired reruns.

## Concrete remaining requests and next executable actions

1. **Implementation owner:** implement bounded incremental updates and renewal that avoid replaying/rematerializing an entire Project before publishing one edited Idea, preserving authority/identity and erasure fences. Rerun the same frozen 1k/10k and one-day retention gates without raising paid limits or relaxing criteria. This engineering requirement is open.
2. **Sites hosting/database owner (person/channel needed):** answer the exact request in [hosting-capability-decision.md](hosting-capability-decision.md), including schedule or documented machine identity, independent physical resources, authoritative schema/ledger, backup/restore and applicable tariff. Next action: fill actual IDs and produce the target-bound manifest; do not repeat generic scheduler research.
3. **User/billing owner:** review the completed target manifest, named credentials/reuse choice and [authorization request](authorization-request.md). Approve only an exact bounded isolated canary after aggregate reservation/host cost controls are verified. Next action: run the separate development canary; stop on uncertainty. Scheduling need not block separately authorized manual paths, but manual evidence never closes autonomy.
4. **Qualification operator and human reviewers (names needed):** perform the full frozen live/cohort/lifecycle package and record the exact environment/model/fixture/command/run identities; adjudicate organizer and screen-reader journeys. Next action after passing canary: execute full held-out capture without tuning and keep failures in denominators.
5. **User/pilot and rollback owner:** only after all required gates pass, review the proposed one-custody 24-hour pilot in [operating runbook](operating-runbook.md). No pilot, notification, follow-up schedule or production activation has been created.

Current incremental paid-provider calls and known paid-provider spend for preparation are zero. Hosted scheduling, live search quality, hosted performance and retention are **not verified**. No hosted resources were created by this packet; this is not a claim that a hosted cleanup exercise passed.
