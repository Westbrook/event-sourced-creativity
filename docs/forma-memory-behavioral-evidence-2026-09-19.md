# Native behavioral evidence and private controls

Continuation of MEM-003 on the isolated feature branch. Not a deployment,
activation, enrollment, provider qualification or scheduling receipt.

## Implemented foundation

The explicit `memory-derivation-candidates-v2` data parser separates exact original
quotations from native action evidence. Action-only candidates may propose next
steps or tentative workflow hypotheses; they cannot establish user decisions or
authored preferences. Native source identities, hashes, scope, time, retention,
lineages and suppression are checked from a data-only snapshot. Action/date
citations are resolved from the verified descriptor, never provider-authored
quotes. Outputs remain unverified hypotheses, not access or spending capabilities.
V1 keeps its original-only quotation contract.

Additive migration **0057_memory_derivation_observation_controls** stores private
user-authored correction/suppression/release controls against retained native
events. Enrollment and event references cascade; source/private-payload/custody
changes, compensation, shortened source retention and Forget remove controls.
Ordinary conversation-segmentation bookkeeping does not release suppression.
Any control change withdraws affected private results and generates existing
terminal native index intents, without changing settled financial records.

The exact 19-object schema is hash-pinned in native and guest-isolation validators,
with Drizzle ORM/snapshot/journal coverage. Installation is schema-only and does
not populate controls, grants, qualifications, jobs or providers. Existing original
controls remain byte-compatible. The existing authenticated inspection/revision
APIs and bounded expiry sweep now also support event-backed controls. After access
loss, only owner metadata is available; correction text is not loaded. Revisions
require an exact compare-and-swap; unknown acknowledgments are not retried.

## Verification

Synthetic-only local qualification: 42 targeted original/observation control tests,
including isolated workerd/D1, rollback, lost acknowledgment, erasure, schema drift,
source-free bounded cleanup and access-loss metadata; 179 migration/parser tests;
30 guest schema-isolation checks. Typecheck, changed-production-file lint,
production build and whitespace checks passed. Build retains existing chunk-size
warnings. No real provider request or user enrollment was made.

## Still implementation work — not an external prerequisite

This foundation does **not** enable the v2 recipe. Remaining work is native
source-descriptor capture and suppression, separately qualified recipe admission,
request formatting and response parsing, durable manifest/result revalidation,
observation-backed result-control targets, and localized action-evidence review.
The end-to-end observation-only job and privacy/request-budget tests must pass
before that recipe can be offered. Existing v1 grants are not silently broadened.

Broader native scope/consumer work remains tracked in the
[native continuation](forma-memory-native-continuation-2026-09-18.md#remaining-native-implementation--still-in-scope).
Unsupported hosted/runtime work stays in the
[capability To Do](forma-memory-sites-capability-todo-2026-09-18.md); neither list is
closed by this foundation.
