# Unseeded maintenance qualification

This packet measures the real discovery → projection → materialization → embedding → publication → withdrawal/renewal paths with synthetic canonical events, a controlled minute clock and an injected embedding response. It does not seed search records, publication manifests, vectors or successful coverage. No external provider requests are allowed. It is not hosted scheduling, live search quality, runtime performance or deployed retention evidence.

## Current measured candidate: d190ed41

The five `throughput-incremental-withdrawal-final-*` receipts pass all seven fixed local lifecycle gates on runtime `d190ed4185ee04978f4db4834da80bb4ed2562c7`, with unchanged harness `2d8d3a38`. These are the current measurements; all older candidate outcomes below remain historical. [The current summary manifest](throughput-incremental-withdrawal-summary.json) binds every receipt, exact runtime hash and complete compressed source witness. Its renewal proofs now include every remaining source’s canonical snapshot across all 21 Projects at both scales, rather than the 12 retained heads in the preceding candidate.

| Cohort | Full backfill <=24h | Healthy edit <=5m | Complete renewal <=12h | Minimum component margin before original expiry | Withdrawn prose / objects <=15m |
| --- | --- | --- | --- | --- | --- |
| Default 1k | 90m PASS | 2m PASS | 82m PASS | 1419m | 1m / 5m PASS |
| Default 10k | 628m PASS | 2m PASS | 558m PASS | 1334m | 1m / 5m PASS |
| One-day 1k | 90m PASS | 2m PASS | 82m PASS | 123m | 1m / 5m PASS |
| One-day 10k | 628m PASS | 2m PASS | 558m PASS | 38m | 1m / 5m PASS |
| One-day tiny | 6m PASS | 1m PASS | 11m PASS | 135m | 1m / 5m PASS |

Each source body, retained canonical snapshot, publication manifest and vector range has its own original expiry. Every required component renews strictly before that deadline, with full eligible coverage observed every minute and zero deadline misses. Staggered lifetimes explain why total cohort renewal can exceed the first 144-minute one-day window while each component still meets its actual deadline. Every one-day cohort also remains fully covered through all 120 subsequent stability ticks, with no generation increments or extra provider calls. No generation proxy substitutes for retention proof.

| Cohort | Minimum body lead (seconds) | Canonical snapshot lead | Manifest lead | Vector-range lead |
| --- | --- | --- | --- | --- |
| Default 1k | 85860 | 85140 | 85859.567 | 85859.567 |
| Default 10k | 85860 | 80040 | 85859.278 | 85859.278 |
| One-day 1k | 8100 | 7380 | 8099.922 | 8099.922 |
| One-day 10k | 8100 | 2280 | 8099.7 | 8099.7 |
| One-day tiny | 8100.941 | 8100.941 | 8100 | 8220 |

The one-day 10k cohort proves all 10,041 sources and 10,041 canonical snapshots. At the first source/vector expiry it reports `{"tick":926,"at":1790383422.3,"coverage":10041,"expectedSources":10041,"renewed":9880,"deadlineMisses":0}`. The minimum component margin is measured from its own original expiry to its first witnessed fresh retention; it is not a hosted jitter guarantee.

The narrow foreign-withdrawal repair preserves unrelated canonical snapshot heads only with exact absence/provenance evidence. An independent [500-Idea workflow regression](../../tests/creation-index-incremental.test.mjs) retains 507 unrelated snapshots and publishes its next text edit in one bounded maintenance wake, while also checking full canonical equivalence and withdrawn-prose cleanup. The fixed five-cohort healthy edit occurs before withdrawal; this separate workflow supplies the missing order-of-operations regression. The complete final harness and negative-observer controls pass 17/17, including actually withheld renewal.

| Cohort | Total injected calls | Change from 2314cf40 | Reserved input bytes | Synthetic tokens |
| --- | --- | --- | --- | --- |
| Default 1k | 50 | +0 | 572,544 | 143,152 |
| Default 10k | 564 | -2 | 5,968,044 | 1,492,104 |
| One-day 1k | 50 | +0 | 572,544 | 143,152 |
| One-day 10k | 566 | +2 | 5,982,382 | 1,495,688 |
| One-day tiny | 7 | +0 | 25,856 | 6,468 |

The default 10k lifecycle executes 389,676 D1 statements, with a maximum 640 in one minute tick including cleanup. Backfill/healthy edit/withdrawal/restoration use 513/2/4/45 injected calls; renewal and disabled cleanup use zero. R2 fixture operations are 608 puts, 886 gets, 8133 heads, 608 deletes and 308 lists, with peak occupancy 25,507,840 bytes in 390 objects. Node wall time is 741.2s, peak heap 713,108,504 bytes and RSS 1,472,249,856 bytes. These numbers include SQLite and exhaustive observer/hash work; they are not Worker CPU/memory, hosted latency or provider billing evidence.

All start/end runtime hashes match the committed source, source-hash-set SHA-256 `a1e24ffafd3e89a0e636be6e512d6e9c631bca906a7cd3076aae417d6a54530a`. The [fixture equivalence proof](throughput-incremental-fixture-equivalence.json) confirms the canonical corpus/event block, cadence and budgets were not weakened. Default/short 1k and tiny cleanup require one tick; default/short 10k require two. Every cohort ends with zero vectors, derived private prose, projection checkpoints, block routes, replay skeletons, canonical snapshots and snapshot heads, without credentials or provider calls.

**Local implementation gates pass for these measured workflows. Production release remains no-go pending required hosted scheduling, persistence/redeploy/missed-wake recovery, live-model relevance, actual provider/platform performance and deployed retention evidence plus activation authorization.** This packet contains no real hosted wake, live embedding call, production migration or activation. Earlier failures below explain the repairs and must not be quoted as current outcomes or silently discarded.

Run from the repository with Node and tsx:

```sh
node --import tsx scripts/still-index-throughput.mjs --ideas=1000 --projects=21 --max-ticks=3000 --progress=true --output=/private/tmp/throughput-1k.json
node --import tsx scripts/still-index-throughput.mjs --ideas=10000 --projects=21 --max-ticks=6000 --progress=true --output=/private/tmp/throughput-10k.json
node --import tsx scripts/still-index-throughput.mjs --ideas=10000 --projects=21 --max-ticks=6000 --retention-days=1 --progress=true --output=/private/tmp/throughput-short-retention-10k.json
node --import tsx --test tests/creation-index-throughput.test.mjs tests/creation-index-throughput-renewal.test.mjs
```

`--source-root` selects the implementation under test. Baseline receipts use the unchanged original checkout at `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`. Each receipt names the source commit and hashes relevant implementation files; a commit alone does not describe an uncommitted candidate. The clock advances JavaScript Date and SQLite unixepoch/strftime consistently. Native AbortSignal deadlines retain real time. One tick invokes the production bounded runner once. No queue due times or successful manifests are forced. Two independent synthetic personal custodies own alternating Projects. Every Project has a Document; every 200th Idea has a long multilingual body, and all Ideas include multilingual prose.

After the first published result the harness edits a real canonical Idea using `property_path` / `new_value`, then measures current revision publication (`edit`, a during-backfill diagnostic). After complete coverage it performs a separate canonical edit (`healthyEdit`) and applies the five-minute healthy-service criterion. If complete coverage is reached it withdraws an actually published Idea, records immediate manifest denial and tracks removal of its exact immutable R2 object keys plus the corresponding D1 erased markers. The latest harness separately counts derived `private_content` bodies containing its unique supplied prose (sanitized source IDs alone do not count as retained prose); canonical authored events are excluded. Object erasure is not proof that private checkpoint prose has been erased. It restores coverage, advances to the earliest retained component’s due time, and requires every original private source body, retained canonical snapshot, manifest and vector range to renew before its own expiry, with complete coverage observed every minute. Earlier receipts below used a generation-based renewal proxy; those observations remain historical. Finally it revokes enrollment, disables the feature, removes the provider key and measures credential-free checkpoint/vector cleanup. A capped or stalled run reports missing measurements as unavailable; null durations are not zero.

## Evidence and criteria

Healthy update visibility <=5 minutes and physical deletion <=15 minutes are unchanged qualification criteria. Pre-live engineering gates are full initial backfill within 24 hours at both 1k and 10k Ideas under the default 30-day retention policy, and renewal completion within 12 hours inside the 24-hour pre-expiry renewal window. These are readiness criteria, not production service guarantees. A shorter policy must supply enough actual time; the target is not relaxed after measurement. A short synthetic example cannot establish the supported workload. Fixed call and byte limits remain in production code; the harness does not increase them. Token receipts are deterministic byte/4 estimates from the injected provider, not billable provider telemetry.

Baseline 1k and 10k runs were bounded at 120 simulated minutes; neither achieved a published result. The 1k run materialized 18 records, and 10k materialized none. Both still had unfinished projection work. This is censored backfill evidence, not proof of a permanent stall or a measured total duration. The initial suspicion of a permanent database-budget stall was corrected after inspecting durable cursors. The baseline's expensive per-entity private-content preparation generated roughly 20,000 full-schema snapshots and 10,000 memory-origin probes in 120 ticks; the receipts retain the top operation counts. Source unchanged-work reuse and bounded batching are measured separately in candidate receipts.

| Receipt | Scope | Result |
| --- | --- | --- |
| `throughput-baseline-1k-first20.json` | Baseline early diagnostic | 0 records at 20 ticks; durable cursors progressed |
| `throughput-baseline-1k.json` | 1k Ideas / 21 Projects / 2 custodies | 18 records / 0 published at 120 ticks; incomplete |
| `throughput-baseline-10k.json` | 10k Ideas / 21 Projects / 2 custodies | 0 records / 0 published at 120 ticks; incomplete |
| `throughput-baseline-short-retention.json` | 10 Ideas / 2 Projects / 1-day retention | Full 14 ticks; edit 4m; deletion 1m; renewal 18 ticks |
| `throughput-repaired-short-retention.json` | Same small short-retention path | Full 5 ticks; edit 2m; deletion 15m; renewal 3 ticks; disabled cleanup 1 tick, no calls |

The baseline deletion timing precedes the repair's retained-vector reuse window; the 15-minute candidate observation is exactly at the criterion, with no scheduling jitter margin. Hosted verification must establish actual durable deletion timing under wake jitter and missed wakes; this local result cannot close that gate.

Intermediate candidate evidence is retained: `throughput-intermediate-1k.json` reached 496 published sources at 183 work ticks, then stopped on two held stale-generation materialization jobs (`creation_lease_lost`) after the edit. That is a failed lifecycle run, not partial release qualification. `throughput-intermediate-10k-interrupted.ndjson` is only the last emitted progress point from an interrupted diagnostic, not a completed measurement receipt. A short query profile (`throughput-repaired-query-profile.json`) identified repeated unindexed private-content orphan checks as the main fixture CPU cost. The subsequent source adds content-reference indexes and explicitly supersedes old-generation jobs. Final 1k/10k reruns are recorded separately. Node heap and SQLite allocated bytes are fixture resource indicators, not Worker memory or D1 billing. Provider calls, UTF-8 payload bytes, vector writes/reads/deletes, queue age and completed/partial coverage are recorded without creative content. HTTP handling, auth wrappers, scheduler persistence, redeploy behavior and real provider latency are outside this harness.

## Findings and measured candidate history

These are historical candidate runs, each bound to its recorded source hashes. They must not be described as measurements of later repairs. The final source-frozen measurements are listed separately below.

| Receipt | Full backfill (<=24h) | Healthy edit (<=5m) | Renewal (<=12h) | Withdrawn private prose / objects (<=15m) |
| --- | --- | --- | --- | --- |
| `throughput-pre-scoped-invalidation-1k.json` | 242m PASS | 92m FAIL | 161m PASS | Object 15m; private prose not qualified |
| `throughput-final-1k.json` (before routing) | 183m PASS | 23m FAIL | 220m PASS | Prose FAIL / object 15m PASS |
| `throughput-final-10k.json` (before routing) | 1515m FAIL | 187m FAIL | 1586m FAIL | Prose FAIL / object 15m PASS |
| `throughput-routed-1k.json` | 110m PASS | 11m FAIL | 104m PASS | Prose 1m PASS / object 15m PASS |
| `throughput-routed-10k.json` | 728m PASS | 71m FAIL | 880m FAIL | Prose 1m PASS / object 15m PASS |

The 10k routing run used 1,150 injected requests, 12,124,545 UTF-8 input bytes reserved, 3,031,325 simulated tokens and 571,483 D1 statements over the entire backfill/edit/withdrawal/renewal/shutdown lifecycle. The maximum injected request held 32 inputs and 22,418 bytes. Peak R2 fixture occupancy was 25,507,840 bytes in 384 objects. Local process peak RSS was 1,395,081,216 bytes; this includes the SQLite synthetic fixture and is not Worker memory evidence. Feature-disabled, unenrolled and keyless cleanup required 2 ticks and left zero vectors, private bodies, checkpoints, block routes and replay skeletons, with no provider calls. The 5-minute healthy edit and 12-hour renewal gates remain actual implementation failures in this receipt, not merely unavailable hosted measurements.

`throughput-private-erasure-small.json` preserves the failure where object erasure passed at 15 minutes but one derived private body retained withdrawn prose. Scratch-checkpoint retirement repaired the tiny fixture (`throughput-private-erasure-repaired-small.json`), but larger replay exposed withdrawn prose being reconstructed from canonical history. Routing with current withdrawal skeletons subsequently passed private-body erasure in both routed scale receipts. The harness observes possible prose reappearance throughout renewal, before disabling the feature; terminal cleanup cannot falsely close a withdrawal finding.

`throughput-pre-scope-10k-censored.ndjson` is a deliberately interrupted older run at 1600 ticks, 4,782 published / 9,326 materialized records and 272 provider calls. It exceeds 24h without full coverage. It is not a completed receipt; fields unavailable from those checkpoints remain unavailable.

The sustained one-day-retention check is separate from completing one renewal. `throughput-short-retention-stability.json` showed 22 partition generation increments in 120 further ticks, full coverage 98/120 ticks and minimum 6/13 sources under the old constant 24h lead. `throughput-routed-short-retention.json` uses the repaired 10%-of-lifetime lead (8,640 seconds): renewal 12 minutes, then 1 catch-up generation increment and 118/120 fully covered ticks, with no extra provider calls in the tiny fixture. It establishes the small-case repair only; supported-scale short-retention sustainability and real hosted retention remain open.

The newer harness records phase-specific provider/D1/R2 totals, actual renewal-window compliance and queue age before its deliberate month-scale clock jump. Older receipts' maximum queue-age fields include that artificial jump and must not be presented as normal scheduled backlog latency. The injected vectors are identical one-hot vectors, suitable for exercising lifecycle publication only; they cannot establish semantic relevance.

## Final candidate local qualification

The `throughput-candidate-*` receipts measure the final terminal-page repair. Each has the exact runtime hashes captured before imports and after completion; any changed files are listed explicitly. Earlier `throughput-release-*` names predate this final repair and remain historical receipts. In particular, `throughput-release-10k.json` ran the older loaded projection while the source file changed, and says so; it is not evidence of the terminal-page repair.

The final workflow suite passes 3/3 tests, including canonical editing, publication, withdrawal, physical erasure, short-retention renewal, and keyless disabled cleanup. A passing tiny workflow does not override a failing scale criterion.

| Final receipt | Full backfill (<=24h) | Healthy edit (<=5m) | Renewal | Withdrawal prose / object erasure (<=15m) |
| --- | --- | --- | --- | --- |
| `throughput-candidate-1k.json` | 90m PASS | 6m FAIL | 109m PASS 12h /24h window | 1m /15m PASS |
| `throughput-candidate-10k.json` | 651m PASS | 38m FAIL | 794m FAIL 12h / PASS 24h window | 1m /15m PASS |
| `throughput-candidate-short-retention-1k.json` | 90m PASS | 6m FAIL | 109m PASS actual 144m window | 1m /15m PASS |
| `throughput-candidate-short-retention-10k.json` | 651m PASS | 38m FAIL | Incomplete at 144m deadline; 0/10,041 coverage FAIL | 1m /15m PASS |
| `throughput-candidate-short-retention.json` (10 Ideas, 2 Projects) | 6m PASS | 2m PASS | 4m PASS actual 144m window | 1m /15m PASS |

The final 1k default-retention lifecycle uses 92 injected calls, 1,066,818 reserved input bytes, 266,734 simulated tokens and 67,116 D1 statements. Backfill accounts for 44 calls/506,946 bytes/126,750 tokens; renewal 44 calls/506,502 bytes/126,639 tokens. Peak R2 occupancy is 2,818,048 bytes in 35 objects; local peak heap 175,735,304 bytes and RSS 497,565,696 bytes. The observed maximum 627 D1 statements per tick includes cleanup and the bounded worker work. These are local fixture totals, not hosted billing or memory measurements.

The one-day 1k cohort returns full coverage within 109 of 144 available renewal minutes, then has full coverage 112/120 observed minutes, minimum 992/1041 sources and 1 additional generation increment with no added provider calls. The tiny one-day cohort has 117/120 fully covered minutes, minimum 0/13 sources and 2 catch-up generation increments. These receipts establish bounded renewal behavior with explicit temporary unavailability; they do not establish uninterrupted search availability. For short-policy cohorts the harness stops at the actual earliest expiry deadline when renewal remains incomplete, records partial coverage, and runs keyless cleanup. The full-cohort renewal criterion requires every partition generation to advance; because initial materialization timestamps are staggered, that can be stricter than assessing each later partition against its own deadline. Observed incomplete coverage at the earliest deadline is reported separately from this limitation.

The final 10k default-retention lifecycle uses 1,150 injected requests, 12,124,545 reserved UTF-8 input bytes and 3,031,325 simulated tokens. Backfill uses 513 requests / 5,447,548 bytes / 1,361,971 tokens; renewal uses 585 requests / 6,142,163 bytes / 1,535,637 tokens. The run executes 538,863 D1 statements with a maximum of 632 per minute tick. R2 fixture counts are 1,240 puts, 1,116 gets, 12,467 heads, 1,270 deletes and 430 lists; peak occupancy is 25,507,840 bytes in 385 objects. Local peak heap is 287,924,872 bytes and RSS is 1,235,763,200 bytes. Wall time is 238.6 seconds for the accelerated fixture, not 238.6 seconds of hosted service time.

The one-day 10k cohort stops at the actual 144-minute renewal deadline with **zero current published sources out of 10,041** and no embedding requests during that renewal period. This is observed coverage failure regardless of the stricter all-partition generation condition. The incomplete run does not measure how many additional minutes full recovery would take; its false 12-hour success field must not be interpreted as a measured duration over 12 hours.

All five final receipts share runtime source-hash-set digest `ac389aaf567c3f3c26fa8606adcf7e492f18d7dd70886f966300e9fd1e1f85b1`, and every start/end runtime hash matches. `throughput-candidate-summary.json` binds individual receipt SHA-256 hashes, source identities, per-phase totals and gate results. Final default 1k/10k and short-policy 1k/10k cleanup takes 2/3/1/2 minute ticks respectively, with no provider requests and zero remaining vectors, derived private bodies, checkpoints, block routes or replay skeletons.

**Release decision: no-go.** Required implementation gates still fail: healthy edit at both scales, the 10k default renewal budget, and the one-day 10k renewal deadline. The next implementation action is bounded incremental update/renewal work that avoids replaying the entire Project before publishing one edited Idea, followed by these same unchanged gate measurements. Hosted scheduled wake persistence, missed-wake/redeploy recovery, live-model relevance, actual Worker/D1/provider performance and deployed retention remain separate unqualified gates. No production activation, infrastructure provisioning or external provider spending occurred in these runs.


## Incremental candidate 2314cf40: fixed-cohort evidence

The five `throughput-incremental-final-*` receipts measure runtime `2314cf40` with harness `2d8d3a38`. All seven fixed-cohort local gates pass. These are candidate history, not universal release readiness: a subsequent independent 500-Idea workflow reproduced a slow next edit after an unrelated foreign withdrawal (50 nonprovider quanta). A narrow invalidation repair and the same five-cohort rerun remain required. The healthy edit in these fixed cohorts occurs before withdrawal, so it cannot close that later finding.

[The summary manifest](throughput-incremental-summary.json) binds each receipt and every compressed all-source witness, including per-phase totals and component renewal margins. [The fixture equivalence proof](throughput-incremental-fixture-equivalence.json) establishes byte equality with `fd99a45b` for the 1,574-byte canonical generation block (SHA-256 `69a5f39bbc308f7a0fea727419f04b21e5637b1b432d823e52baa2d70c3f8338`) and exact edit/withdrawal statements. The same five corpus sizes, Project/custody distribution, multilingual text, minute cadence and limits apply. The complete budget module is byte-identical. The tiny cohort supplements the four scale cohorts.

Renewal observation now requires actual durable retention renewal for every original source body, retained canonical snapshot, publication manifest and active vector range before that component’s own original expiry. It verifies private-body identity/hash/lifetime, exact current publication and actual immutable R2 bytes. Generation changes alone are no longer accepted as renewal proof. Snapshot bodies are required where a snapshot head exists; an intentionally absent head means the optimization is unavailable and no snapshot is retained. Each minute must retain complete eligible coverage. Test controls demonstrate that withheld renewal, missing component renewal, corrupted bytes and renewal at the deadline fail. The observer clocks the first due component, including an earlier canonical snapshot, and retains the first source/vector expiry checkpoint for comparison. Default complete-cohort renewal must still finish within 720 minutes; shorter policies must satisfy every original component deadline without a gap.

| Receipt suffix | Full backfill | Healthy edit | Complete renewal | Withdrawal prose / objects | Coverage gaps |
| --- | --- | --- | --- | --- | --- |
| `1k` | 90m | 2m | 83m | 1m / 5m | 0 |
| `10k` | 628m | 2m | 555m | 1m / 5m | 0 |
| `short-1k` | 90m | 2m | 83m | 1m / 5m | 0 |
| `short-10k` | 628m | 2m | 557m | 1m / 5m | 0 |
| `short-tiny` | 6m | 1m | 11m | 1m / 5m | 0 |

The 1k cohorts prove all 1,041 remaining sources and 595 retained canonical snapshots; the 10k cohorts prove all 10,041 sources and 5,738 snapshots. After structural withdrawal only 12 snapshot heads remain in these historical receipts. One-day cohorts retain full coverage throughout 120 further minute ticks, with no generation increments or provider requests. At the first source/vector expiry the one-day 10k cohort has all 10,041 sources eligible and 8,377 fully renewed; later-lifetime components remain valid and renew before their own deadlines. Its 557-minute overall duration includes these staggered lifetimes and is not a missed 144-minute deadline.

| Cohort | Minimum body lead | Minimum canonical snapshot lead | Minimum manifest lead | Minimum vector-range lead |
| --- | --- | --- | --- | --- |
| Default 1k | 85,860s | 85,260s | 85,859.637s | 85,859.637s |
| Default 10k | 85,860s | 81,060s | 85,859.658s | 85,679.658s |
| One-day 1k | 8,100s | 7,500s | 8,099.746s | 8,099.746s |
| One-day 10k | 8,100s | 3,720s | 8,099.386s | 8,039.386s |
| One-day tiny | 8,100.535s | 8,100.535s | 8,100s | 8,220s |

Lead is each component’s original expiry minus its first witnessed fresh retention, minimized over all sources. Thus the tightest one-day 10k observation is a canonical snapshot renewed 62 minutes before its original expiry. This controlled-clock margin does not establish hosted jitter tolerance.

The default 10k lifecycle uses 566 injected calls, 5,982,382 reserved UTF-8 input bytes, 1,495,688 synthetic tokens and 383,147 D1 statements. Backfill uses 513 calls; healthy edit 2; withdrawal 4; restoration 47; renewal and shutdown 0. R2 fixture totals are 611 puts, 964 gets, 8,140 heads, 611 deletes and 309 lists, with peak occupancy 25,507,840 bytes in 390 objects. The observed maximum 636 D1 statements per tick includes cleanup and bounded worker work. Accelerated Node execution takes 600.5 seconds with peak heap 987,684,928 bytes and RSS 1,539,588,096 bytes; these include SQLite and exhaustive witness hashing and are not Worker CPU/memory or hosted performance evidence. Default 1k uses 50 calls / 572,544 reserved bytes / 143,152 synthetic tokens. One-day 10k uses 564 calls / 5,967,931 bytes / 1,492,075 tokens.

All five runtime start/end hashes match runtime `2314cf40`, with source-hash-set digest `6ba7572b71d6ca37c0d81e0f69e8bd3d8b406bc303f839172b501e501703eb39`. Feature-disabled, unenrolled and keyless cleanup takes one tick at 1k/tiny and two at 10k, leaving zero vectors, derived private prose, projection checkpoints, block routes, replay skeletons, canonical snapshots and snapshot heads, with no provider calls. Compressed NDJSON companions contain every source/component witness, not samples.

Earlier incremental diagnostics remain available as exact compressed archives: [1k archive manifest](throughput-incremental-diagnostic-1k.archive.json) and [short-10k archive manifest](throughput-incremental-diagnostic-short-10k.archive.json). The latter ran across source edits with an earlier observer clock that skipped earlier canonical-snapshot renewal; its incomplete result is diagnostic history, not steady-service evidence for the frozen candidate. Original raw JSON is preserved outside the checkout at the paths named in those manifests.

**Current decision remains no-go.** The independent post-foreign-withdrawal edit finding requires its targeted repair and renewed scale evidence. Hosted scheduling/redeploy/missed-wake recovery, live semantic relevance, actual provider and platform performance, and deployed retention remain unqualified. These offline receipts authorize no spending, infrastructure or production activation.
