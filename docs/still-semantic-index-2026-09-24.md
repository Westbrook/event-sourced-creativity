# Still semantic indexing implementation checkpoint

This continues the accepted September 24 engineering kickoff on published v548 / `f25888a9832d31e1e867bddb82f4f8b651c5e9d2`. Production unified creation and indexing remain disabled. This document is a verification ledger, not an activation approval.

## Architecture

The existing Sites Worker uses `DB`, private `MEDIA`, bounded OpenAI HTTPS embeddings/organization, and custody-separated Jev HTTPS reranking. No additional Worker, Workers AI, Vectorize, or private Fetcher is required. Legacy explicitly configured Fetchers remain compatibility adapters. No Memory or generation behavior is added.

The pinned representation is `openai-small-512-l2-source-v1-utf8passage2048-overlap256-f32le-v1`: `text-embedding-3-small`, 512 dimensions, normalized vectors, little-endian Float32, template v1. Passages preserve exact UTF-16 source offsets and Unicode boundaries, prefer paragraph/sentence boundaries, target approximately 512 tokens through a 2,048-byte window and 256-byte overlap. These are **token estimates**, not an exact tokenizer. Provider reservations conservatively count UTF-8 bytes. Title, kind and type prefix each grounded body passage. Project/Document representations include their complete authored names/titles and deterministic, eligible descendant passages with dependency revisions. Ideas remain independently indexed, with Document locations. A container above the 1 MB transport cap holds with `index_container_capacity`; it is never silently truncated. Individual embedding inputs are capped conservatively at 8,191 UTF-8 bytes (at most that many byte-level tokens), including the prefix.

D1 holds explicit expiring custody enrollments, policy epochs, daily token limits, canonical partition generations, source pointers, passage completeness, immutable object manifests, members, unique leases, attempt reservations, erasure receipts and run receipts. Direct D1 access deliberately does not opt into replica Sessions; Cloudflare documents that queries without the Sessions API execute on the primary. Atomic write batches recheck database-time leases, generation, canonical principal witnesses and enrollment before publication. Actual Sites runtime consistency remains a hosted qualification item. [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

Private R2 shards are at most 1 MiB and have SHA-256 checksums. The reserved `__still_creation_index/` prefix is denied by generic media and shared-media serving routes; index metadata contains no source prose or titles. Small shards compact within one custody/Project/generation. The pointer swap is atomic in D1 after immutable upload. Retired shared objects are deleted rather than retaining a withdrawn member while waiting for reconstruction. The next generation rebuilds eligible neighbors.

Retrieval scans learned vectors independently of lexical hits; it has no persistent vector cache. Query embedding reuse is request-local and custody/policy scoped. At most four shard buffers/reads and 4 MiB of shard bytes are admitted across the isolate; waiting requests share the same abort deadline. Source passages deduplicate to canonical identities before the 20-per-partition semantic shortlist. The existing lexical20 + semantic20, global hydration24, results3, partitions64, and global 1,600ms search deadline remain. Same-custody reranking divides the single global budget. Canonical revision and authority checks run after I/O, before disclosure and before results return.

## Maintenance and recovery

Canonical content changes insert a transactional discovery outbox and invalidate affected partition generations. Shared resource/private-payload changes and canonical policy changes invalidate current pointers. Initial discovery scans canonical streams in bounded pages; no search visit is required. Discovery, projection, materialization, embedding, publication, compaction, renewal, deletion, and both R2-led and D1-led reconciliation are distinct durable work.

Projection reads at most 32 events / 1 MiB per page and resumes a canonical authoring checkpoint. It reuses `createCreativeEventFold` semantics, including removal, restoration, memberships and relations. Checkpoints contain per-entity private records, not a retained full event array. The current bounded checkpoint load is 16 MB; events/entities above their transport caps produce held work with explicit capacity errors. This is a capacity limit to qualify, not silent omission. Expired partial checkpoints require a new generation.

One tick admits four inference work quanta, at most two embedding calls, 24,000 input bytes per call, 128 KiB of embedding uploads, and 512 D1 operations in the bounded inference environment. It yields before launching work late in its 20-second budget. Cleanup has independent, bounded pages and leases. Every model call has a durable reservation; interrupted billing remains uncertain. Transient failures back off with jitter and Retry-After, capped at fifteen minutes. Permanent failures or eight failed claims hold the job. Operator resume starts a new generation.

The first implementation intentionally favors bounded work over backfill throughput. One source embedding page is processed per embedding claim; a large partition edit currently reprojects that partition. Initial backfill rate and edit-to-publication at 10,000 Ideas must be measured before choosing production queue budgets or claiming the proposed five-minute update target. Increasing paid limits requires authorization.

Immediate denial does not depend on physical erasure completing. Cleanup runs while UI/inference flags are off and without provider credentials; it is an independent scheduled step even if another subsystem fails. Upload intents precede writes, lease loss prevents publication, late completions attempt deletion, and periodic private-prefix reconciliation catches later arrivals after restart. D1-led reconciliation catches missing active objects that an R2 listing cannot reveal. Erasure uses delete followed by head verification. Minimal content-free object receipts remain to prevent resurrection. No remote heap-zeroization or provider-retention claim is made. [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)

## Finding → fix → evidence ledger

| Finding / requirement | Implementation | Verification state |
| --- | --- | --- |
| Mandatory external Fetcher/AI/Vectorize | Same-Worker HTTP adapters, original deterministic organizer validation | Injected HTTP and existing provider tests |
| Semantic candidates tied to lexical pool | Independent exact R2 scan and source deduplication | Zero-overlap fixture; 1k/10k injected capacity pipeline |
| Incomplete long-source coverage | Resumable exact ranges, expected/completed passage counts; no partial publication | Long Unicode and multi-page lifecycle checks |
| Search-driven enrollment / full-history preparation | Mutation outbox, initial discovery, canonical checkpoint pages | Never-searched admission and checkpoint tests |
| Expired worker can publish | Unique lease token + generation + DB time + atomic principal/enrollment fence | Competing claims, expiry, source-change and upload races |
| Shared shard retention | Fenced compaction; retire/delete whole affected shard, rebuild eligible neighbors | Compaction and withdrawal tests |
| Feature-off cleanup / lost credentials | Independent deletion and reconciliation jobs | Credential-free erasure and orphan tests |
| Provider budget and custody | Expiring D1 enrollment and daily reservation; separate reranking boundaries | Injected controls; hosted policy/usage evidence pending |
| Missing objects / stale coverage | Expiry-aware coverage and D1-led object reconciliation | Expiry, corruption-triggered rebuild, missing-object repair and renewal checks |
| Accepted creation interactions | Original controller/review/compiler unchanged except provider adapter | Existing creation suite and search→selection→review→commit→reload |
| Actual hosted wake | Shared `runCreationMaintenance` and native scheduled entry | **Not configured or verified** |
| Real quality / performance / retention | Reproducible local fixtures and qualification package | **Live/hosted/human gates open** |

## Evidence boundaries

Local injected tests establish control flow, exact math, custody defenses and recovery logic. The 1,000/10,000-Idea pipeline seeds completed manifests, includes long sources and 21 Projects and two custody boundaries, and measures cold/warm/concurrent local retrieval. Its provider outputs and authority are fixtures. It is not live quality, deployed latency, browser-after-debounce performance, complete backfill throughput, or hosted resource accounting. The Node heap includes corpus/R2 fixture storage and is not a Worker heap measurement.

At least 50 independently labeled held-out queries remain required: separate positive and no-match denominators; final top-three >=90% on positives, false positives <=10% on negatives, zero authorization leaks, and diagnostic semantic recall@20 (proposed >=95%). The existing >=30-case organization fidelity gate remains. Do not mark these met using implementation-authored expected outputs.

## Schema and release state

`drizzle/candidates/still_semantic_index.sql` is an **unjournaled candidate**, additive to the existing creation candidates. Actual production migration inventory must be reconciled before assigning deployment order. The read-only Sites overview did not expose a migration ledger, so its bounded table list is insufficient to prove applied history. No production migration has been run.

The disabled release policy remains the exact held 41 migrations in `build/memory-migration-release.json`; generic packaging must not copy candidates into the deployable archive. Never deploy v547. Use the repository's disabled-release packager and inspect the actual tar, migration hashes and Worker bytes. A qualification deployment with schema requires a separately authorized exact manifest.

See [the operations runbook](still-semantic-index-operations-2026-09-24.md) for controls, recovery, scheduling prerequisites and outstanding release decisions. Final command results and commit/archive identities will be appended after verification.

## Verified local delivery — September 24

Implementation commit: `c1c867d4` (`Implement same-Worker semantic indexing and fenced maintenance`). Baseline was freshly rechecked as published v548 / `f25888a9`; original checkout's unrelated documents were preserved. Work was isolated on `codex/still-semantic-index`.

- **212/212** creation, Still creation and streamed-fold regression tests pass; the two additional offline qualification-scoring tests also pass. This includes **25** index lifecycle/race/recovery cases and an exact candidate migration rehearsal, applied twice to a disposable shared-custody fixture with canonical/private authored hashes unchanged. This fixture is not an export of production.
- **18/18 per engine** in Chromium, Firefox and WebKit across unified-creation/help browser suites: real UI/controller/Worker and disposable SQLite; providers unconfigured/manual review and clipboard transport injected. Keyboard/modal focus, mobile layouts, localization and review/reload checks pass. Human screen-reader qualification remains open.
- Typecheck, changed production-path ESLint, build and diff whitespace checks pass. The build retains existing large-chunk warnings.
- The compiled Worker runs in **local workerd with native local D1/R2**. Two native scheduled invocations each record three completed index-cleanup jobs and zero provider attempts, erase an orphan, and erase its late reappearance. An intentionally absent unrelated panel table makes the aggregate handler return `exception`, while index cleanup still completes. This is a passing isolation/recovery test, **not** a healthy whole-application scheduled run or hosted scheduling evidence.

Reproduce the command groups from the operations runbook. Earlier harness failures (sandbox loopback restriction, installed browser-version mismatch and missing Miniflare module rules) are diagnostic history, not unresolved product failures.

### Local injected capacity

[Machine-readable samples and stage timings](evidence/still-semantic-capacity-local-2026-09-24.json). Each corpus spans 21 Projects/two custodies, with 4% long multilingual Ideas, 13 searches (one cold, eight warm, four concurrent), and eight concurrent background-maintenance ticks on a separate fixture database. Provider outputs and principal authority are injected; D1 hydration and exact scan are real local implementations. The corpus seeds completed Idea manifests; it does not measure container backfill, full source projection, hosted D1/R2 latency or paid throughput.

| Ideas | Vectors | Vector bytes | Cold ms | p50 ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,160 | 2,375,680 | 29.3 | 32.4 | 194.7 |
| 10,000 | 11,600 | 23,756,800 | 125.4 | 132.0 | 571.2 |

Both runs made 59 injected provider calls including background work; paid calls/cost were **zero**. Recorded Node heaps (124.5/162.7 MB) include retained corpus, SQLite wrappers and the in-memory R2 mock; they are **not Worker memory measurements or proof of 128 MB headroom**. Isolate vector admission remains four buffers / 4 MiB. Stage timings are accumulated local stage durations; parallel partition durations must not be added as end-to-end latency. The hosted <=2s after-debounce target, actual cold/warm/concurrent resource use and cost remain unqualified.

### Disabled archive verification

Prepared `/private/tmp/still-semantic-disabled-c1c867d4.tar`: **622 files, 45,303,808 bytes**, raw SHA-256 `256d77c0ff975b783a4a5f1ece3cc03a3e92769a8f4d55d5cbb95d3ea3c7b03b`. All 41 SQL files plus the held journal match the exact release-policy hashes. No candidate migration is included. Archived Worker bytes match the build (`dist/server/index.js` SHA-256 `c275fa66b71a71dd1f0da7023de15666a458ceb6ecca3d30652797aa2f46faff`). Generic Sites packaging must not replace this qualified archive. Saving/publishing status is recorded in the Progress Report and release handoff; an archive alone is not a deployment.

### Gates still open

Actual supported hosted trigger and repeated tab-closed/redeploy receipts; live independently labeled relevance and 30-case organizer fidelity; hosted latency/resource/cost/backfill throughput; deployed authority consistency, retention and rollback; authoritative production migration inventory and authorized qualification schema manifest; human screen-reader review; explicit production activation. Representation replacement is pinned/fail-closed; a future model requires a separately qualified shadow-generation cutover. Production UI and indexing stay disabled until these gates are satisfied.
