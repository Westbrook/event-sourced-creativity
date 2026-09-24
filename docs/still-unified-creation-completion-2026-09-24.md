# Still creation completion — finding, repair and qualification ledger

Status: implementation underway; production disabled; **not release ready**.

## Verified baseline

On September 24 the native Sites tools reported latest v546, source `e56390576d8fe878c066a0faeaecfefd3062bc91`, deployment `appgdep_6ab519cb515481918b81575ccf48c7eb` succeeded. Environment revision 16 contains no creation configuration keys. A fresh Sites source fetch returned exactly that SHA. The isolated branch `codex/still-creation-completion` in `/private/tmp/still-creation-completion-20260924` preserves N6/N7; original main at d8255c6d and its three unrelated untracked proposals are untouched. Core creation files have no diff between d8255c6d and this baseline.

All six supplied executable audit probes reproduced on this baseline, using locally injected services/SQLite. Evidence is in `/private/tmp/still-creation-completion-evidence`. No live inference, provisioning, migration application or activation.

## Finding-to-fix-to-test checklist

A passing helper does not close a workflow. Earlier evidence remains historical; the rows below track this completion pass.

| Finding | Repair status | Required/current evidence |
| --- | --- | --- |
| Derived incomplete-Idea issues | Open | Interpretation → edit → review → commit → reload |
| Exact selected @ targets/occurrences | Open | Distinct equal labels, repeated target, invalid organizer and commit |
| Durable accepted corrections after input edits | Open | Remove → edit → reinterpret; explicit Undo |
| Late interpretation/preview publication | Implemented; local Worker integration passes | `creation-delivery-recovery.test.mjs`: discard/revision/pointer/redaction races roll back without orphan bodies; actual preview discard transaction |
| Interrupted interpretation | Implemented; local Worker integration passes | Same identity terminalizes after 30-second lease; explicit new attempt commits and receipt reloads. No exactly-once inference claim |
| Recovered receipt journals | Implemented; controller verification | Recovered save clears draft, commit and interpretation pointers; next New is fresh |
| Full draft rescue/actionable errors | Open | Include review edits, decisions and source; render current server issues |
| Correction event bounds | Open | Exact-bound variation/partial/merge through commit; 512/513 preserved |
| Overlapping merge validity | Open | Deduplicated use proof through commit/fold |
| Document removal approvals | Open | Real approval hashes remain valid for unchanged Ideas |
| Focused split/provenance | Open | Unrelated content/approvals retained through commit |
| Container-title removal mentions | Open | Impact review and explicit repair |
| Withdrawn/private-redacted source eligibility | Open | Authenticated Worker refresh → search; before dispatch and hydration denials |
| @Document constituents | Open | Exact selected roots, no adoption of later members |
| Reviewed-Idea @ and / tools | Open | Browser input/review/ref authorization and undo |
| Initial partial reuse | Open | Partial/whole choice, independent provenance, source unchanged |
| Confirmed passage replacement | Open | Exact range/highlight, explicit acceptance, undo, stale rejection |
| Account relevance/coverage | Open | 21+ Project permutations, no false definitive no-match |
| Targeted invalidation | Open | Attention-only events do not invalidate; relevant mutations do |
| Autonomous indexing/expiry/cleanup | Open | Durable continuation, expiry renewal, deletion/orphan lifecycle |
| Normal navigation capability | Open | Authoritative feature capability; rollback retains old routes |
| Operational metrics | Open | Coverage/queue age/failure/recovery without creative text |
| Candidate migration/release package | Open | Current release sequence, preservation and rollback checks |
| Local browser/access/performance | Open | Three entries, keyboard/IME, narrow layouts/help; measured budgets |
| Deployed/provider/human qualification | Gated, not executed | Actual Fetcher/D1/AI/Vectorize bindings, held-out fidelity/relevance/latency, screen-reader completion, deployed smoke/recovery/rollback |

## Recovery repair evidence and limits

Atomic publication now asserts the active draft revision, exact protected-content pointer, unexpired content, custody and authorization. Interpretation also checks captured source state and the live operation lease. Discard terminalizes pending operations and clears their content pointers in its erasure transaction. An expired interpretation becomes a retained failed result; a new explicit attempt may execute again. The client journals only draft/revision/operation identifiers and keeps pending responses distinct from organizer failure. A successful recovered commit clears all journals.

Workflow tests use the actual Worker and disposable SQLite plus an injected organizer. They establish deterministic lifecycle behavior, not cloud D1 timing or real-model execution. Deployment qualification remains required.
