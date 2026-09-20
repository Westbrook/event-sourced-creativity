# Memory-assisted specialist consumer — implementation checkpoint

Local branch implementation, not deployment, enrollment, provider qualification,
or closure of the [full completion matrix](forma-memory-completion-matrix-2026-09-20.md).

## Implemented

- An explicit **Include accepted Memory in a new quote** control binds an
  independently authorized saved semantic context to the existing specialist
  consent flow. Quoting does not reserve money or call a provider. The exact
  provider request, tentative interpretation, source relevance and current
  document context are included in the private approval preview and price bound.
- Native opaque source handles supply the final source/target/schema/ancestry
  guards at quote publication, dispatch, raw receipt, canonical result and
  historical disclosure. Browser metadata does not authorize these operations.
- Additive migration `0061_memory_derivation_consumers` retains immutable origin
  and private-copy inverses. Source withdrawal, context dismissal/replacement,
  enrollment retirement and expiry retire dependent content. Negative ancestry
  survives body deletion/retyping; it cannot be relabeled as original evidence.
- Semantic results remain separately labeled, read-only specialist results. They
  do not overwrite the original free answer or apply document edits. Model
  actions are suppressed until downstream edit provenance is implemented.
- Actual usage remains recorded after in-flight access/source withdrawal.
  Lost raw/canonical acknowledgements recover without another provider request.
  Canonical content, inverse registration and execution linkage commit together.
- Historical UI delivery uses finite monotonic leases. Blur, page hiding,
  expiry, clock anomalies and privacy invalidation clear private presentation
  without deleting an unsent draft. English, French, Arabic and Japanese labels
  distinguish these results from original-source results.

## Verification and limitations

- 133 finance/specialist/semantic runtime checks passed.
- 63 existing native source/conversation/context checks passed.
- 142 existing/new erasure, withdrawal and revocation checks passed.
- 488 host, saved-context, derivation-client and source-adapter checks passed.
- Eight whole-app browser checks passed with synthetic responses: saved-context
  review plus historical semantic-result blur/expiry in English and narrow Arabic.
- Eight local D1 cases exercise personal/shared quote, once-only dispatch, canonical
  retention and privacy inverses. Synthetic provider only; no real enrollment or
  API expenditure. D1 cascade acknowledgements use same-transaction `changes()`
  assertions rather than mistaking recursive trigger writes for direct writes.
- Typecheck and changed production-file lint pass; build passes with existing
  large-chunk warnings. The full panel placement suite still has unrelated
  upstream fixture/source drift: the same 55 failing test names reproduce against
  the unmodified HEAD panel. Those failures are not counted as passing tests.

**Capacity is not closed.** Request-local negative guard compilation reduces
redundant schema calls without caching positive authorization. The new paid
consumer remains above the conservative <50 binding-call target on quotation
and execution. Retrieval is within that target. Whole hosted invocation limits,
maximum-history latency and multi-task feed capacity are not qualified by these
small local cases.

## Remaining native implementation

1. Finish whole-request capacity and source-freshness qualification, including
   maximum-size retained history and concurrent historical tasks.
2. Add dependent semantic follow-up conversations and Chat Studio consumption.
   Current negative ancestry deliberately refuses to recast a prior semantic
   result as original conversation evidence; it is not complete conversation
   coverage and must not silently substitute the earlier free answer.
3. Complete exact-field autocomplete, durable edit/output/index ancestry,
   longer-term profile consolidation/promotion, and remaining resource/zoom
   coverage in the full completion matrix. This checkpoint does not defer them
   to external services.

External provisioning, hosted scheduling qualification, production-owner
integration/deployment and affirmative enrollment remain separately tracked in
[the Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md) and
[the operational checklist](forma-memory-nonimplementation-work-2026-09-17.md).

## Capacity follow-up

The retained consent and execution now share a native read. Read-only derivation
admission batches bounded job/reference metadata and binds qualification/parent
metadata to the grant read; every exact authority and source predicate still runs
in the final transaction. Replaying an already settled exact provider receipt
observes both ledgers without rewriting them. Different provider receipt IDs
conflict even when their amounts match; inconsistent/partial ledgers still use
reconciliation rather than a cached success.

Verified: 574 native Memory runtime checks, 200 finance/specialist checks, eight
new metadata/settlement fault cases, TypeScript and changed-file lint. These
reduce database work but do not yet close whole-invocation capacity qualification.
