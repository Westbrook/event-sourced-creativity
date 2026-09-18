# Native Memory producers: implementation continuation

Updated **2026-09-18**. This continues [MEM-002](backlog.md#memory), not a claim that
all semantic Memory is complete. The owned branch was merged with local `main`
`282236d` in `b061c9b`; both Memory and incoming sponsor/share privacy guards were
preserved. No deployment, schema installation, spending, enrollment, or schedule
registration is performed by this continuation.

**Historical boundary below:** the 12-pair producer description records the
earlier release. The newer, not-yet-published
[merge-preparation continuation](forma-memory-native-continuation-2026-09-18.md)
extends it to 64 pairs and adds personal/current consumption v2. The canonical
ORM now matches the deployed one-annotation constraint; the zero-annotation
candidate remains separate, unassigned and unapplied.

## Completed-turn capture

The new scheduled producer targets genuine completed Chat Studio turns. It uses
the existing native source-capture proofs and guarded private ledger, retaining
original references without inventing goals, decisions, or preferences. Existing
declarations remain unchanged and `semanticCompleteness` remains false.

The existing literal scheduling flag, Memory actor rollout, current access and
explicit learn/recall/background enrollment all remain required. Publication
rechecks source bodies, identity, custody, enrollment and immutable retention.
Repeated publication and recovery must recognize the original committed history,
not duplicate it or extend its expiry. Unsupported or oversized source inventories
are not converted into an apparently complete recent tail.

This is bounded source capture, **not semantic summarization or rolling rebase**.
The current source contract is queued Chat Studio, not every assistant surface.
Capture currently admits at most **12 complete pairs across two native proof
frames**; the retained ledger remains bounded to 64 revisions. Ordinary
`assistant_turns`, inferred or Memory-generated responses are not reclassified as
queued originals. Capacity/unavailability is reported separately and does not
stall the existing extractive source pass. Already-advanced extractive cursors do
not suppress first capture or subsequent recovery of the separate ledger.

## Explicit schema evolution

[The pending candidate](../db/memory-conversation-capture.pending.sql) changes only
the two structured-ledger annotation-count minima from one to zero. The original
`0032` migration remains untouched. The canonical ORM constraints match the new
candidate; migration assignment and journal/snapshot advancement are a release
integration step. Exact old and evolved schemas are supported;
the automatic reference-only producer requires the evolved schema.

The candidate must execute as **one atomic transaction/batch**, never as separate
committed SQL statements. It refuses unexpected schema/session/dependency state,
preserves existing rows and rowids, validates the exact resulting schema and
checks foreign keys. It is not journaled or automatically installed. Hosted atomic
execution and release migration assignment remain required.

Deploy the dual-schema readers before installing the candidate. Older readers
deliberately reject the evolved schema. Once zero-annotation rows exist, restoring
the old constraint requires a reviewed data/reader rollback; it is not a safe
automatic downgrade.

The guest-image result custody checker recognizes only the exact complete evolved
schema. A zero-annotation ledger referencing an output still participates in
custody checks; zero annotations are not permission to bypass those checks.

## Authoritative artifact-view receipts

The personal artifact viewer captures a stable project/document/revision/hash
binding. The authenticated append path verifies the current retained artifact
bytes and current actor/custody before committing the receipt. Unknown historical
claims, impersonation, unsupported governed writes and mixed exact-view batches
must not become trusted current-view evidence. Source/head/authority changes are
rechecked at publication. Lost or malformed commit acknowledgements are reported
as unconfirmed; the hot instrumentation path does not automatically retry. No
cross-request same-view idempotency or manual-recovery protocol is claimed.

This remains evidence of an explicit artifact view, not comprehension, preference
or aesthetic intent. No additional passive telemetry or enrollment is introduced.
Exact artifact views remain excluded from live Memory source enrollment until the
richer retained-body/lifetime/replay and negotiated consumption contract exists;
fixing `project_id` must not silently activate that unfinished feature. The existing
navigation-only consumption contract is unchanged.

## Verification and remaining work

Final integrated checks and independent reviews completed locally:

| Check | Result |
| --- | --- |
| TypeScript; production build, component metadata and localization | Pass; existing large-chunk warning |
| Client, artifact-view and intent suites | 184/184 pass |
| Focused native Memory, actual recall and scheduled-runner tests | 37/37 pass |
| Guest-result custody inventory | 90/90 pass |
| Schema evolution, including isolated local D1 atomic batch | 13/13 pass |
| Built selected-share and media routes | 13/13 pass |
| Independent migration fault review | All 30 statement-offset failures rolled back; 11 unexpected-state cases refused |

The broader assistant snapshot had 943 passes and 10 failures. Each of those 10
failures was independently reproduced with the same normalized signature on the
untouched merged baseline `b061c9b`; the full baseline suite was not rerun. Changed
files otherwise pass lint, but the assistant test file retains 13 pre-existing
unnecessary-escape errors, identical to that baseline. These failures remain open;
the complete repository test/lint suite is not claimed green.

Checks used isolated local data and fake provider transports; they do not establish
hosted qualification or real-browser acceptance. The native recall tests exercise
personal and shared zero-annotation ledgers, and native Forget retires their private
storage. No provider request, deployment, schema installation or enrollment was
performed. Detailed logs are retained in the independent Memory lane checkpoint's
`continuation-20260918` evidence directory.

The remaining [implementation table](forma-memory-implementation-2026-09-17.md#remaining-source-work)
still includes semantic summary/rebase, broader assistant-turn coverage, inferred
profiles, the native embedding/index lifecycle, nested scopes, rich consumption
projection and learned suggestions. The current shadow index/outbox is synthetic;
adding a drain there would not implement a live semantic index. A native derivation
manifest/consumer and its privacy lifecycle remain implementation, not scheduling.

Release, provider/host qualification, budget measurement, acceptance and explicit
consent remain in the [separate non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md).
