# Projection, withdrawal and renewal repairs

The current candidate implements bounded routing, resumable atomic fanout, withdrawal-safe replay metadata and lifetime-relative renewal. Production remains disabled. These are local deterministic checks; hosted throughput, live quality and actual hosting retention remain separately qualified gates.

## Finding → repair → workflow evidence

| Finding | Implemented repair | Evidence |
| --- | --- | --- |
| Every personal Project folded its owner's entire Block history. | A durable metadata-only routing prepass at the frozen canonical head. A keyed lookup skips only proven-foreign complete Block histories. Missing/ambiguous scope, moves, references/relations and legacy identity cases remain conservative. No replay filtering is allowed until routing finishes. | Differential canonical-fold tests cover rehomes, duplicate creations, implicit selection/edit scope and relations; a canonical mutation during the prepass restarts the generation. |
| Non-authoring records consumed projection pages; ordinary pages reloaded all Block checkpoints. | Filter authoring types before the SQL page limit. Read addressed Blocks plus Project/Document/selection state, retaining a complete bounded dependency seed where required. | Canonical fixture with 320 unrelated events and 128 other-Project Ideas; current target state matches authored edits. |
| Other Projects consumed materialization slots. | Filter by target Project inside SQL before LIMIT16. | Other-Project Ideas consume no target slots. |
| Unchanged source bodies and lexical postings were replaced on every edit. | Reuse exact revision/hash bodies only under current custody, retention and atomic transaction guards, outside their renewal window. | Actual edit preserves the separate Idea's content ID; a withdrawal between reuse read and commit rejects the transaction. |
| Repeated optional-cleanup schema preparation consumed maintenance budget. | Reuse the existing execution-local negative-cleanup-SQL preparation. Consuming SQL still checks current negative provenance; retention policy reads remain fresh. | Intermediate 1k/21-Project first-12-tick comparison increased checkpoint writes 726→1,353 while total D1 statements fell 6,697→6,240. Those historical receipts retain their actual source hashes. |
| Broad preservation fanout exceeded one atomic quantum. | Stage the complete deterministic delta across bounded continuations, then atomically promote its pointers. The canonical checkpoint stays unchanged until the last chunk. | Actual Document removal preserving 140 Ideas now publishes all 140 without a held job. Stage tests cover restart, lease expiry, delta mismatch, private-body expiry/redaction, generation change, enrollment revocation and mixed private/skeleton destinations. |
| Removed Block prose reappeared in historical replay checkpoints, even before the final removal event was replayed. | Determine latest removal state during frozen-head routing. Persist only an explicit structural metadata allowlist in `creation_index_replay_skeletons` for currently withdrawn Blocks. Keep historical membership/reference effects; never store their prose, labels or handles in a private checkpoint body. | Every replay continuation is inspected for absence of unique withdrawn prose/labels/handles. A removed parent's earlier reference attachment still preserves its surviving dependency's Project ownership. Restoration replays intact canonical history and republishes complete text. |
| An unfinished different-Project replay could retain an old foreign source after removal, private correction or identity recreation. A shared scope could omit a later owner move/removal. | Invalidate current-generation unfinished same-owner replay on withdrawal/private correction, and on duplicate creation when routing is incomplete or already knows that identity. Before shared replay, scan bounded owner lifecycle metadata as a denial-only overlay. An implicit Created claim requires the exact event in the shared Project scope. | Real append/lease/replay tests reject stale leases on removal, private redaction/deletion and recreation; shared replay denies moves/removals omitted from its scoped history. Completed unrelated Projects and different owners stay unchanged. Restore and explicit return retain complete canonical text. |
| Completed checkpoints retained unnecessary copies. | Atomically remove projection, routing and skeleton scratch when materialization finishes. Revocation, stale-generation and shutdown cleanup also remove scratch metadata. | Completed source publication retains no replay scratch; withdrawal cleanup preserves canonical authored events. |
| Fresh one-day bodies were immediately inside a fixed one-day renewal window. | Renew when remaining lifetime is at most `min(24 hours, max(60 seconds, assigned lifetime / 10))`; use the same boundary for unchanged-body reuse. No existing deadline is extended. | Repeated checks on fresh one-day bodies cause no extra generation or inference; an aged body near its actual deadline renews once and stays stable afterward. |

The initial irrelevant-page and unchanged-body failures reproduce against baseline `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`. The independent unseeded harness retains subsequent failed 1k withdrawal and short-retention measurements. Do not relabel those earlier results as final-candidate passes.

Verification commands:

```
node --import tsx --test tests/creation-index-projection-throughput.test.mjs tests/creation-index-routing.test.mjs tests/creation-index-projection-stage.test.mjs tests/creation-index-lifecycle.test.mjs tests/creation-index-withdrawal-race.test.mjs
npm run typecheck
```

The final integrated local suite includes projection, routing, staging, lifecycle and withdrawal-race workflows. Final suite totals, source fingerprints and controlled-clock 1k/10k measurements belong in the current release ledger. Repeated same-clock unit ticks are not evidence of a fifteen-minute deletion service level.

## Bounds and operational meaning

Bodies remain bounded to 1 MB; complete projection/staged delta state remains bounded to 16 MB. A full dependency seed is capped at 256 bounded reads. Exceeding these bounds produces a visible held capacity error without truncation or false coverage. The former `index_projection_change_capacity` limitation for an otherwise bounded 140-Idea preservation delta has been repaired with durable staging.

Routing and skeleton rows contain structural identities and flags, not withdrawn prose. They retain the historical effects needed to reconstruct surviving Ideas and are deleted after materialization or revocation. Canonical authored events remain intact. Complete shutdown must erase all derived private bodies, vectors and replay metadata.

The five-minute healthy edit, fifteen-minute durable erasure and retention-sustainability criteria remain unchanged. Their final pass/fail status must come from measured receipts on the exact candidate; implementation and local workflow success do not waive those gates.
