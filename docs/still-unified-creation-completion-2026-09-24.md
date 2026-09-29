# Still creation completion — finding, repair and qualification ledger

Status: local implementation verified; disabled release preparation; **not release ready**.

## Verified baseline

On September 24 the native Sites tools reported latest v546, source `e56390576d8fe878c066a0faeaecfefd3062bc91`, deployment `appgdep_6ab519cb515481918b81575ccf48c7eb` succeeded. Environment revision 16 contains no creation configuration keys. A fresh Sites source fetch returned exactly that SHA. The isolated branch `codex/still-creation-completion` in `/private/tmp/still-creation-completion-20260924` preserves N6/N7; original main at d8255c6d and its three unrelated untracked proposals are untouched. Core creation files have no diff between d8255c6d and this baseline.

All six supplied executable audit probes reproduced on this baseline, using locally injected services/SQLite. Evidence is in `/private/tmp/still-creation-completion-evidence`. No live inference, provisioning, migration application or activation.

## Finding-to-fix-to-test checklist

A passing helper does not close a workflow. Earlier evidence remains historical; the rows below track this completion pass.

| Finding | Repair status | Required/current evidence |
| --- | --- | --- |
| Derived incomplete-Idea issues | Implemented; commit/reload workflow verified locally | Interpretation → edit → review → commit → reload |
| Exact selected @ targets/occurrences | Implemented; commit/reload workflow verified locally | Distinct equal labels, repeated target, invalid organizer and commit |
| Durable accepted corrections after input edits | Implemented; commit/reload workflow verified locally | Remove → edit → reinterpret; explicit Undo |
| Late interpretation/preview publication | Implemented; local Worker integration passes | `creation-delivery-recovery.test.mjs`: discard/revision/pointer/redaction races roll back without orphan bodies; actual preview discard transaction |
| Interrupted interpretation | Implemented; local Worker integration passes | Same identity terminalizes after 30-second lease; explicit new attempt commits and receipt reloads. No exactly-once inference claim |
| Recovered receipt journals | Implemented; controller verification | Recovered save clears draft, commit and interpretation pointers; next New is fresh |
| Full draft rescue/actionable errors | Implemented; commit/reload workflow verified locally | Include review edits, decisions and source; render current server issues |
| Correction event bounds | Implemented; commit/reload workflow verified locally | Exact-bound variation/partial/merge through commit; 512/513 preserved |
| Overlapping merge validity | Implemented; commit/reload workflow verified locally | Deduplicated use proof through commit/fold |
| Document removal approvals | Implemented; commit/reload workflow verified locally | Real approval hashes remain valid for unchanged Ideas |
| Focused split/provenance | Implemented; commit/reload workflow verified locally | Unrelated content/approvals retained through commit |
| Container-title removal mentions | Implemented; commit/reload workflow verified locally | Impact review and explicit repair |
| Withdrawn/private-redacted source eligibility | Implemented; authenticated Worker lifecycle tests pass | Authenticated Worker refresh → search; before dispatch and hydration denials |
| @Document constituents | Implemented; local UI/controller/Worker checks | Exact selected roots, no adoption of later members |
| Reviewed-Idea @ and / tools | Implemented; local UI/controller/Worker checks | Browser input/review/ref authorization and undo |
| Initial partial reuse | Implemented; local UI/controller/Worker checks | Partial/whole choice, independent provenance, source unchanged |
| Confirmed passage replacement | Implemented; local UI/controller/Worker checks | Exact range/highlight, explicit acceptance, undo, stale rejection |
| Account relevance/coverage | Implemented; multi-partition regression passes | 21+ Project permutations, no false definitive no-match |
| Targeted invalidation | Implemented; actual SQLite triggers verified | Attention-only events do not invalidate; relevant mutations do |
| Autonomous indexing/expiry/cleanup | Implemented; local scheduled and provider lifecycle tests pass | Durable continuation, expiry renewal, deletion/orphan lifecycle |
| Normal navigation capability | Implemented; local qualification; deployed gate open | Authoritative feature capability; rollback retains old routes |
| Operational metrics | Implemented; local qualification; deployed gate open | Coverage/queue age/failure/recovery without creative text |
| Candidate migration/release package | Implemented; local qualification; deployed gate open | Current release sequence, preservation and rollback checks |
| Local browser/access/performance | Local checks; human/live latency gates open | Three entries, keyboard/IME, narrow layouts/help; measured budgets |
| Deployed/provider/human qualification | Gated, not executed | Actual Fetcher/D1/AI/Vectorize bindings, held-out fidelity/relevance/latency, screen-reader completion, deployed smoke/recovery/rollback |

## Recovery repair evidence and limits

Atomic publication now asserts the active draft revision, exact protected-content pointer, unexpired content, custody and authorization. Interpretation also checks captured source state and the live operation lease. Discard terminalizes pending operations and clears their content pointers in its erasure transaction. An expired interpretation becomes a retained failed result; a new explicit attempt may execute again. The client journals only draft/revision/operation identifiers and keeps pending responses distinct from organizer failure. A successful recovered commit clears all journals.

Workflow tests use the actual Worker and disposable SQLite plus an injected organizer. They establish deterministic lifecycle behavior, not cloud D1 timing or real-model execution. Deployment qualification remains required.

## Correction workflow repair

The controller/Worker workflow suite now completes eight delivery regressions through review, commit and history reload (or rejection before writes for invalid selected identities and reintroduced removals). The focused suite plus existing correction/interpreter/controller checks passes 50 tests. TypeScript and scoped ESLint pass. Evidence: `workflow-tests.log`, `correction-typecheck.log`, `correction-lint.log` in the completion evidence directory.

Current validation derives incomplete-content errors from the edited graph. Exact selected identities are checked independently of organizer instructions at interpretation and review/commit. Clearing the active plan preserves the last server-acknowledged correction baseline. Removal checks include Project/Document titles with explicit repair controls. Correction event bounds are recomputed; overlapping merged uses have disposition proof; unchanged Idea approval hashes exclude unrelated Document uses. Split proposals operate on the edited Idea only, retain its identity as a composition, preserve unrelated approval and add provenance to extracted children. Full rescue JSON includes source, graph, decisions and review state.

These are injected-provider/local SQLite results. Semantic removal detection beyond exact identities/spans and human evaluation of split usefulness remain fidelity qualification, not automated proof of model behavior.

## Retrieval and lifecycle repair

All authorized partition pools are merged before the global 24-candidate hydration budget; relevance and deterministic identity ordering prevent early Projects from monopolizing it. Full pools and unindexed partitions disclose partial coverage. An equally ranked individual Idea wins over its incidental container. Canonical resource visibility and live private-payload checks exclude withdrawn/redacted/expired source content before indexing and hydration. Relevant event triggers are replaced on schema repair; attention-only events and derived snapshot insertion do not invalidate them.

Durable jobs resume staged 32-record pages without additional typing or history reconstruction per page. Scheduled work rehydrates current principal, consent, permission epoch and custody; identity policies requiring an observed authentication context fail closed. Renewal replaces expiring protected bodies and resets semantic acknowledgement. Cleanup removes superseded/expired local bodies and calls the provider deletion endpoint for tombstones. Provider expiry sweeps delete lease-specific vector IDs without damaging renewed records.

Evidence: `creation-search-delivery.test.mjs`, `creation-search-index.test.mjs`, `creation-provider-service.test.mjs`, `creation-corpus-search.test.mjs` and `creation-search-performance.test.mjs`; focused search/candidate qualification passed 43 tests. These use real local Worker/SQLite and injected learned providers. First-build history cost, deployed scheduled execution, async vector physical deletion and crash-created remote orphan cleanup still require deployed qualification.

## Interaction completion

The rich editor exposes explicit Document constituent checkboxes, and reviewed Idea bodies use the same @ and / extensions. Newly named Ideas remain incomplete until edited/reviewed; Format commands create nonexclusive preferred Outputs without triggering generation. Initial partial reuse stores an independent exact excerpt and provenance, preserves the saved source, and survives undo/redo/reload. Passage replacement is revision-bound and explicitly confirmed; unique exact source-backed text can be suggested, while ambiguous/unmatched text requires user selection. Nothing outside the accepted range is removed.

Reviewed saved references are reauthorized and their full included dependencies disclosed. Recovery rehydrates the exact previously selected versions; changed sources require explicit refresh and renewed affected review. Reference selection unions source manifests instead of losing earlier selections. Repeated declarations may define one Idea while retaining exact inline occurrence identity.

`creation-delivery-workflows.test.mjs` exercises these with actual review/commit/history reload. `tests/browser/still-unified-creation.test.mjs` adds normal navigation, Document constituent selection, reviewed @/Format editing and initial partial/passage preview with undo/redo/reload; the adjacent help suite preserves N6/N7 and review state. These verify local interactions, not organizer fidelity. The complete gate/action table is in `still-unified-creation-release-2026-09-24.md`.
