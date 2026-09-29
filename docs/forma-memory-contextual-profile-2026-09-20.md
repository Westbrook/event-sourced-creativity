# Contextual profile review and privacy integration

Status: implemented on `codex/forma-memory-foundation`; local qualification only.
This continues the [full native plan](forma-memory-native-continuation-2026-09-18.md#remaining-native-implementation--still-in-scope).
It does not claim that the whole Memory plan is complete or deployed.

## Implemented

### Retained profile reconciliation

The automatic document brief independently revalidates the latest profile result
and up to three older retained results. Exact repeated claims are collapsed only
when text, category, lineage, quotations, action citations and evidence locations
match. Repeated model output is never counted as independent support. Distinct
interpretations remain separate; overlapping lineage is disclosed. Historical-only
notes are labelled historical, not silently promoted to current preferences.

Every displayed item retains its actual source job for saved-reference review.
Only one reference control mounts per source result, avoiding up to 64 duplicate
metadata reads when a retained profile contains many claims.
Current corrections and suppression take precedence across all retained facets.
A missing or withdrawn newest result never permits fallback to an older profile.
An unavailable retained read closes this profile projection instead of hiding a gap.
All source, result, grant, control and elapsed-time deadlines still apply.

This is bounded read-side reconciliation, not lifetime coverage, semantic truth,
a new model call, renewed retention, or recursive training on earlier model prose.

### Native page/block evidence and scope differentiation

`GET /api/memory/derivation/result?jobId=…&resources=1` explicitly negotiates
`memory-evidence-resources-v1`. Each cited original/action index maps to its freshly
validated native evidence location. Document originals remain document-scoped;
canonical page visits and supported native block revisions can be differentiated.
Uncertified pointers never become block/page evidence. Old result/export readers
keep their unchanged, closed-schema contract. The new projection adds no DB calls,
provider dispatch, schema migration, storage or permission grants.

The automatic brief uses this protocol on document views. Current-block evidence
is ordered before current-page evidence and general document context, without
changing citation roles, correction precedence or native authorization. Localized
English/French/Arabic/Japanese disclosure distinguishes **where evidence was
recorded** from whether a preference applies to the entire resource.

### Separate broader context

The brief selects at most one independently eligible source in each of three
existing recall bands: project, project-tree and partition. Local facets remain
first. Each source and purpose is freshly authorized; existing document-only
consent is unchanged. There are at most nine related result requests, no retries
and no alternate source within a failed band. An incomplete catalog is rejected.

The existing relevance weights are displayed as relevance, never confidence:
project `0.7`, tree `0.5 / (1 + distance)`, partition `0.01`. Partition still means
the same actor, owner and organization; this is not cross-owner or public-world
recall. Broader notes are not merged into local assertions or treated as independent
evidence. Each result keeps its actual saved-reference provenance and lifetime.

### Consumption and presentation privacy

The private inspector now shows overlapping 1/7/30/90-day descriptive consumption
windows over its existing certified v5/v6 snapshot. The old 7/30-day helper remains
byte-shape compatible. Counts do not imply reading, attention, preference, complete
history or pre-enrollment collection.

Private result review/export and assistant Memory-derived transcript text clear
when a privacy mutation starts. Pending reads abort and late responses are rejected.
Ordinary chat and unsent drafts are preserved. The assistant's consent controls
remain mounted so their own privacy operation can settle correctly.

Document-palette mutations hold the shared privacy barrier through the entire
response parse. Same-origin browser tabs receive source-free begin/end notices:
only a protocol version, random operation token and phase, never actor/resource
identifiers, quotations, drafts or vector data. Receiver-owned monotonic expiry
and bounded maps prevent a crashed tab from stranding every inspector. Notices
invalidate presentation only; native source checks remain authoritative. This is
not cross-device synchronization or a guaranteed delivery mechanism.

## Verification

- 921 focused client/model/component tests passed, including retained-history
  conflicts, stale results, explicit resource negotiation, all three recall bands,
  cross-tab leases, stalled privacy responses and transcript invalidation.
- 36 native result/brief/behavioral/page/cross-scope tests passed, including personal/governed
  local D1 and unchanged legacy resource contracts. Each tested local brief result
  request stays below 50 D1 operations; native resource metadata adds no DB query.
- The cross-scope suite covers consent, content, hierarchy, schema, target removal,
  lost acknowledgements, newest-result withdrawal and actual local D1. The final
  entry-point bundle also passes for personal and governed targets without a target
  derivation grant. Source purpose consent remains mandatory.
- Typecheck, changed-file lint and production build pass. Existing bundle-size
  warnings remain. Local synthetic browser checks cover English desktop and Arabic
  320px, resource/history disclosure, visibility retirement and a real second-tab
  BroadcastChannel. 12 final browser tests passed; focused scope screenshots are also recorded in the lane handoff.

No real-user content, provider purchase, enrollment, production migration, scheduler
registration, Git push or deployment occurred. Synthetic provider fixture data does
not qualify a real provider or budget.

## Still planned implementation

1. Actual automatic assistant prompt consumption with durable generated-answer
   provenance and complete source withdrawal/forget inverses.
2. Exact-field autocomplete and reversible accept/reject/edit/undo provenance.
3. Longer-term semantic consolidation beyond the bounded retained-result projection.
4. Cross-owner nesting; native Library/Canvas resources; unsupported block histories;
   independently authorized original-source recall through reuse relationships.
5. Remaining ancestry-dependent generated output/index retirement and full integrated
   privacy, request-budget and observability qualification for those consumers.

These are native implementation work, not external-service prerequisites. Hosted
scheduling, PostgreSQL/pgvector HTTP integration, provider/pricing/retention and cap
qualification, production-owner integration and explicit enrollment remain separately
tracked in the [capability To Do](forma-memory-sites-capability-todo-2026-09-18.md)
and [non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md).
