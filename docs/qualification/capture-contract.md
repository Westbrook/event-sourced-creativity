# Hosted search capture and scoring contract

Status: implemented, locally tested with injected adapters. **No hosted execution, service ingress, provider spend or activation is established by these tools.** The transport adapter is intentionally absent until the hosting owner supplies a supported administrative operation or documented service identity through the existing access layer. A reviewed adapter module is then the sole integration point; there is no public diagnostic route, browser/session/bypass credential fallback, or extra compute Worker.

## Frozen labels and provenance

`loadFrozenQualificationPacket()` in `scripts/score-still-search-qualification.mjs` reads a `frozen-manifest.json` containing `packetId`, `frozenAt`, `heldOut:true`, `tuningConsumed:false`, and `files`. Required files are `corpus`, `heldoutInputs`, `labels`, and `provenance`, each `{path,sha256}`. Paths resolve relative to the manifest. Corpus collections `projects`, `documents`, and `ideas` contain exact `{id,partitionId,custody}`. Query inputs contain `{id,query,scope,allowedIds,permittedPartitions:[{id,custodyId,projectId}]}`. Labels contain `queries:[{id,classification,intended,allowed,intendedPartition,ambiguity}]`; classification is `positive` or `no-match`.

The loader verifies every required file's bytes, distinct producer/reviewer tasks, reviewed corpus/input/label hashes, a decision for every query, the frozen timestamp, and a separate hashed parent task receipt. It binds labels to the frozen input allowlist and exact source custody. The receipt has `kind:'independent-review-receipt'`, `packetId`, `producerTask`, `reviewerTask`, `labelsSha256`, and a distinct `recordedBy`. Provenance has `producer`, `reviewer`, `completedAt`, `reviewedCorpusSha256`, `reviewedInputsSha256`, `labelsSha256`, `decisions:[{id,resolution,ambiguity}]`, and `reviewEvidence:{path,sha256}`. A plain `independentLabeler` string cannot pass. Hashes establish artifact integrity and task-receipt consistency; the operator still audits the actual reviewer/task separation. Agent labels do not establish human fidelity adjudication.

Sixty distinct query texts/IDs are required, with at least forty unambiguous positives and twenty negatives. Ambiguity decisions remain evidence; they are not silently removed from denominators. Preserve rejected v1 evidence when a fresh packet replaces ambiguous cases. Keep tuning inputs separate. **Canary uses a distinct non-held-out manifest with at least five inputs; full capture uses the frozen held-out manifest.** Any tuning based on full held-out outcomes consumes that set; replace it before qualification.

## Approval and transport interface

The executable command is:

```sh
node scripts/still-qualification-capture.mjs \
  /private/authorization.json /private/frozen-manifest.json \
  /private/reviewed-supported-adapter.mjs /private/run.json /private/allowance.json
node scripts/score-still-search-qualification.mjs \
  /private/run.json /private/frozen-manifest.json /private/authorization.json
```

These paths are examples, not provided authorization. The capture checks before importing the adapter:

- Explicit `executionKind:'live-hosted'|'injected'`; missing kind is rejected. `status:'approved'`, `approvedBy`, unexpired `expiresAt`, `productionActivation:false`, `syntheticOnly:true`.
- `isolation:{verified:true,environment,database,storage,receipt:{path,sha256}}`; preview URL alone is insufficient.
- `versions:{environment,source,deployment,representation,embeddingModel,rerankerModel}` and `cohortCorpora:{'1000':sha256,'10000':sha256}`.
- `ingress:{supported:true,kind:'native-administrative-execution'|'documented-machine-identity',identity,operation,credentialClass:'service-identity',capabilityReceipt:{path,sha256}}`.
- Hashed `approvalReceipt` (live: `kind:'qualification-approval'`, `approved:true`, exact grantedBy/environment/source/packetManifestSha256/totalLimit), exact `adapterSha256`, and `packetManifestSha256`. Receipt files must be operator-reviewed evidence; writing an `approved` string is not user authorization.
- `phase:'canary'|'full'`, `totalLimit:{cents,calls,inputTokens,outputTokens}`, positive `perRequestReservation` with the same keys, `samplesPerCohort>=30`, and `concurrency` from 2 through 8. Full capture additionally requires a hashed `canaryPassReceipt` (live: `kind:'qualification-canary'`, `status:'passed'`, exact environment/versions, accountingVerified/cleanupVerified true). Search-only ceiling is at most $25; canary ceiling is at most $5. Those values are upper validation limits, not permission or a cost estimate.

The module exports:

```js
export async function inspectEnvironment({authorization}) {
  // Read through supported machine access; verify independent resources and exact versions.
  return {isolationVerified, versions, database, storage, runtime:'hosted', providerMode:'live'};
}
export async function invokeSearch(request, {authorization,reservation,signal}) {
  // request: {requestId,query,scope,permittedPartitions,corpusSize?,cohort?,concurrencyGroup?}
  // Invoke the existing Worker search through the approved operation and return the
  // content-free observation below, augmented by actual runtime/provider receipts.
}
```

No default network adapter is supplied. Do not implement an invented route or turn a workspace access bypass into service identity. Adapter source hash and capability evidence are reviewed before approval. It must enforce its reservation across every underlying provider request/retry, respect the abort signal, and select the exact frozen cohort corpus. It must not load the label file or fabricate cold/runtime/resource measurements. Capture records client elapsed time from invocation (after the UI debounce boundary); stage measurements and runtime facts come from the actual hosted execution.

Each request reserves its full worst-case calls/tokens/cents **before** dispatch. The durable private ledger uses an exclusive process lock, file/directory fsync and atomic replacement. Returned call/token usage is checked against its reservation; missing or excess usage is retained as a failed partial observation and stops later dispatch. This detects an adapter violation after it happens and does not replace server-side prevention. Uncertain attempts stay charged; a timeout stops later requests and preserves partial evidence. A crashed lock requires operator reconciliation of any still-running invocation before removal. Existing output files cannot be overwritten. Budget exhaustion cannot make missing cases disappear from scorer denominators. Capture does not implement a shared dollar limiter covering maintenance, organizer, hosting, scheduler and all other processes: those need the separate approved run-wide accounting/stop mechanism. Per-phase search caps must fit that same total authorization.

## Observation schema

The scorer separately loads the reviewed authorization file and verifies its actual hash, hashed approval/isolation/capability receipts, packet manifest hash, exact versions/cohort hashes and expiry against the run. A run's asserted authorization hash alone cannot pass. A run contains `schemaVersion:2`, `kind:'live-hosted'` only for real hosted/live activity, exact `versions`, `packetId`, `packetHashes`, `authorizationManifestSha256`, `cohortCorpora`, `runStartedAt`, `cases`, and `latencySamples`. Every case contains:

| Field | Required evidence |
| --- | --- |
| `queryId`, `requestId`, `startedAt` | Exact frozen query; globally unique request receipt; start after run start |
| `partitions` | Every permitted partition exactly once: `{id,custody,semanticTop20:[id],coverage:{complete,expected,semantic,lexical}}` |
| `preHydrationShortlist`, `finalTop3` | One global limit of 24 and final limit of 3; exact identities, no titles/snippets |
| `partial`, `timedOut`, `failures`, `definitiveNoMatch` | Explicit status; empty failed/incomplete results are not successful negatives |
| `versions` | Same source/environment/deployment/embedding/reranker/representation as run |
| `authorization` | `{allowed:true,receiptId,policyEpoch}` from actual current authority |
| `providerDisclosures` | Each actual provider call: `{receiptId,custody,partitionIds,sourceIdentities,provider,model}`; empty source list permitted for query embedding; counts agree with usage |
| `stageTimingMs` | Nonnegative `authority`, `semantic`, `lexical`, `hydration`, `rerank`; overlapping service durations may sum beyond wall time |
| `usage` | Actual `receiptId`, `providerCalls`, `inputTokens`, `outputTokens`, `d1Reads`, `d1Writes`, `r2Reads`, `r2Bytes`, `runtimeCpuMs`, `runtimePeakBytes`, `measuredBy:'host-runtime'` |
| `elapsedAfterDebounceMs` | Client-measured request duration; timeout remains a failure |

Library-only `CreationSearchInput.onQualificationTrace` emits semantic candidates/coverage before filtering, the actual shortlist, custody-separated provider-disclosure source IDs immediately before reranking, stage durations, and final/timeout outcome. No raw query, authored body, title or reason is emitted. The ordinary API does not accept the callback or add diagnostics to its response. Normal semantic top-20 and global top-24 selection limits do not mark an otherwise completely indexed search partial; `candidateBounded` is a separate shortlist trace fact. Actual missing coverage, provider failures, incomplete partition enumeration and authority changes still mark search partial and prevent definitive no-match. Trace callbacks cannot alter search behavior. Trace alone is **insufficient**: the adapter must add actual provider usage, deployment/authority/runtime facts and embedding-call receipts. Missing evidence fails scoring.

Each latency sample additionally has `corpusSize:1000|10000`, `cohort:'cold'|'warm'|'concurrent'`, and `execution:{receiptId,instanceId,measuredBy:'host-runtime',corpusSize,corpusSha256,coldStart,coldStartEvidence?,observedConcurrency?,concurrencyGroup?}`. The corpus hash must match the run's authorized frozen cohort. Cold samples require distinct runtime instances with actual cold-start evidence; cache-busting query parameters do not qualify. Concurrent samples require observed concurrency at least two. Usage/execution receipts cannot be reused to inflate sample counts. Node fixture heap and simulated provider latency do not qualify runtime evidence.

## Scoring and remaining gates

Scoring reports unique relevance separately from latency repetition. Every frozen positive/negative remains in the denominator even when no observation exists. Semantic recall@20 is measured inside the intended partition. The report includes each intended partition's positive denominator, semantic hits and recall. Final intended top-three rate must reach 90%; semantic recall@20 must reach the retained 95% engineering criterion in aggregate and in every intended partition; false positives must stay at or below 10% of negatives. Forbidden identities, wrong-partition candidates and cross-custody provider disclosure fail. Incomplete evidence fails even if raw accuracy happens to look good. A valid observed false positive counts against the 10% bar; an incomplete empty negative also fails completeness.

All six 1k/10k × cold/warm/concurrent cohorts require at least thirty observations and p95 at most 2,000 ms. Failed samples remain counted as failures, never dropped to improve p95. The predeclared borderline band is 1,800–2,000 ms: with fewer than sixty observations it requires at least thirty additional observations before accepting that cohort. This does not relax the 2,000 ms limit or authorize more calls. Nearest-rank p95 from thirty observations has sparse tail evidence; no confidence bound is claimed. The scorer reports unavailable/non-finite quantiles as null and cannot pass those cohorts. It does not measure typing latency, schedule delivery, retention, organizer fidelity, browser/screen-reader behavior or rollback. `activationAuthorized` is always false, even for a passing synthetic example. Full release requires the other ledger gates and explicit activation approval.

Raw observations and ledger files are created mode 0600 with a content-free field allowlist. Keep fixture/label/run files within the authorized private environment; do not put creative bodies or raw provider payloads in public logs. The scorer CLI prints metrics, opaque query IDs and error codes only. Reviewers must still inspect transport integrity and the source of runtime receipts: a local JSON assertion is not independent evidence that a host or paid model was actually used.
