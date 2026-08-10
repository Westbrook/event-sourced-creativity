# Forma plan coverage

This ledger reconciles Revision 2.1 of the synthesis/build plan with the kickoff addendum. “Operational” means the interaction appends to the durable D1 stream or derives from it. “Simulation” means the product contract and UI work without an external paid/model dependency. “Gated” means an addendum §2 human decision intentionally blocks activation.

| Slice | Status | Implemented evidence | Remaining gate |
|---|---|---|---|
| Phase 0 | Operational | Append-only decision ledger, event classification, collection shape, envelope fields, adapter registry events | Five human-required decisions remain recorded, not assumed |
| Phase 1 | Operational | Immutable D1 log, actor permissions, partial batches, stale-sequence checks, authored-wins fold, compensation, collection validation, standalone stream viewer and replay lab | Production Postgres/Timescale topology is outside this Sites slice |
| Phase 2 | Simulation | Deterministic context snapshots, citations, adapter versions, compute metadata, lossless download | Two model providers and spend ceiling |
| Phase 3 | Operational | Editable chips/swatches, confidence text, authority labels, compensation semantics, extractor events | Real extractor eval threshold requires selected extractor implementation |
| Phase 4 | Operational | Provenance inspector, context diff, side-by-side comparison, rights receipt at export, region-promotion event seam | Attribution algorithm and influence-taint policy remain open |
| Phase 5 | Operational | Chat proposal → preview → explicit accept/reject; externalized command content; expected sequence; same committed event vocabulary | Real chat model provider |
| Phase 5.5 | Operational | Authored nested collection tree, handles, filing/moving, duplicate and cycle validation, family promotion | Multi-membership deliberately absent |
| Phase 6 | Evaluation | Brief as small context document, impression events, accept/ignore/dismiss/blank, cold-start threshold, optional intent, conditions | Real usage must validate the go/no-go gate |
| Phase 7 | Simulation | Inferred family surface, evidence summary, user-only promotion to collection, fixture corpus path | Embedding model and data-rights posture |
| Phase 8 | Gated | Scout report-space scenario, evidence/judgment events, producer permissions, budget-exhaustion semantics | Phase 6 gate and human budget ceilings |
| Phase 9 | Gated | Preference/time event folds, condition UI, authority/history semantics | Phase 6 gate, decay tuning, legal posture |
| Phase 10 | Partial | Reusable-block library, output library, archive import/export, recipe/output/full-graph downloads | Shared links require personal/team/community scope |

## UI affordance audit

All visible buttons now do one of three explicit things: perform an event-backed action, navigate to a real route, or remain disabled with the blocking human decision in its label/tooltip. The prior inert project breadcrumb, account avatar, library links, block handles, swatches, comparison button, export button, output history, command search, inspector controls, and reference upload are operational. Drag affordances have adjacent keyboard move controls and collection filing has command-equivalent buttons.

## Administrative scenarios

- Creative loop: extraction → authored correction → compile → generate → compare → export.
- Asynchronous return: session close → brief/scout report space → judgment → user acceptance → document promotion.
- Concurrent pressure: inert model proposal, commutative actions, stale validation, partial progress, explicit rejection.
- Family promotion: inferred grouping remains separate from the user-authored collection that keeps it.

The replay laboratory can deterministically build 1,000, 10,000, or 50,000 events and replay any projection to any sequence without writing fixtures to D1.
