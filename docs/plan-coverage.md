# Forma plan coverage

This ledger reconciles Revision 2.1 of the synthesis/build plan with the kickoff addendum and the adopted pilot baseline. “Operational” means the interaction is server-enforced, appends a durable fact, or derives from those facts. “Evaluation” means the product contract is active but still requires pilot evidence.

| Slice | Status | Implemented evidence | Remaining gate |
|---|---|---|---|
| Phase 0 | Operational | Append-only decision ledger, authenticated identities, admin/creator/agent/viewer roles, consent receipt, configurable policy | Production organization membership and wider access remain pilot operations |
| Phase 1 | Operational | Immutable D1 log, actor permissions, partial batches, stale-sequence checks, authored-wins fold, compensation, collection validation, standalone stream viewer and replay lab | Production Postgres/Timescale topology is outside this Sites slice |
| Phase 2 | Operational | Deterministic context snapshots, citations, server-side OpenAI Responses adapter, structured output, token receipts, hard-cap reservation | A second provider remains future adapter work |
| Phase 3 | Operational | Editable chips/swatches, confidence text, authority labels, compensation semantics, extractor events | Real extractor eval threshold requires selected extractor implementation |
| Phase 4 | Operational | Provenance inspector, context diff, side-by-side comparison, rights receipt at export, region-promotion event seam | Attribution algorithm and influence-taint policy remain open |
| Phase 5 | Operational | Chat proposal → preview → explicit accept/reject; 30-day externalized private content; expected sequence; same committed event vocabulary | Pilot evaluation of proposal quality |
| Phase 5.5 | Operational | Authored nested collection tree, handles, filing/moving, duplicate and cycle validation, family promotion | Multi-membership deliberately absent |
| Phase 6 | Evaluation | Brief as small context document, impression events, accept/ignore/dismiss/blank, cold-start threshold, optional intent, conditions | Real usage must validate the go/no-go gate |
| Phase 7 | Simulation | Inferred family surface, evidence summary, user-only promotion to collection, fixture corpus path | Embedding model and data-rights posture |
| Phase 8 | Gated | Scout report-space scenario, evidence/judgment events, producer permissions, hard budget ceilings | Autonomous execution remains outside the human-in-the-loop pilot |
| Phase 9 | Evaluation | Preference/time folds, condition UI, authority/history semantics, 30-day private-content redaction | Pilot evidence must tune decay semantics |
| Phase 10 | Operational | Reusable library, archive import/export, lossless downloads, expiring revocable read-only share projections | Broader team/community publication remains out of scope |

## Adopted pilot controls

- Identity uses authenticated Sites or Cloudflare Access headers; the first private-site user is bootstrapped as admin and all authorization remains server-side.
- Generation uses OpenAI Responses with `store: false`, a privacy-preserving safety identifier, structured output, and private content references rather than natural language in immutable payloads.
- Budgets reserve capacity before an external call, settle against reported token usage, and fail closed when user or workspace limits are reached.
- Prompt/provider content is redacted after 30 days; events retain only non-sensitive receipts and references.
- Uploads require explicit ownership or license confirmation. Shares are read-only, expire after at most seven days, and are immediately revocable.

## UI affordance audit

All visible buttons now do one of three explicit things: perform an event-backed action, navigate to a real route, or remain disabled with the blocking human decision in its label/tooltip. The prior inert project breadcrumb, account avatar, library links, block handles, swatches, comparison button, export button, output history, command search, inspector controls, and reference upload are operational. Drag affordances have adjacent keyboard move controls and collection filing has command-equivalent buttons.

## Administrative scenarios

- Creative loop: extraction → authored correction → compile → generate → compare → export.
- Asynchronous return: session close → brief/scout report space → judgment → user acceptance → document promotion.
- Concurrent pressure: inert model proposal, commutative actions, stale validation, partial progress, explicit rejection.
- Family promotion: inferred grouping remains separate from the user-authored collection that keeps it.

The replay laboratory can deterministically build 1,000, 10,000, or 50,000 events and replay any projection to any sequence without writing fixtures to D1.
