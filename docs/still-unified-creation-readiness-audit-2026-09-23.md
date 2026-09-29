# Still unified creation: readiness audit

2026-09-23 · Specification v19 · Ready to implement · Source baseline 68b5f0ab

The canonical specification is `docs/still-unified-creation-plan-2026-09-22.md`. The machine-readable planning fixture is `docs/still-unified-creation-fixtures-2026-09-23.json`. This audit reconciles the original request, subsequent product decisions, current Still model/worker contracts and the public En Reve editor API. It replaces the accumulated open-ended discussion with an implementation contract. It does not authorize implementation or publication by itself.

## Corrected gaps

| Gap or incorrect assumption | Final contract | Specification |
| --- | --- | --- |
| An unapproved item might silently disappear under “Approve selected” | All retained records/uses must be complete, presented and approved at current versions. Unresolved input keeps the draft pending; only explicit Remove/Merge changes retention. No partial commit in v1. | §8 |
| Seeing, completeness and approval were conflated | Store separate version-bound states; changed dependent compositions require renewed review/approval. Bulk approval cannot approve unseen or incomplete versions. | §8 |
| Removing a Document preserved only approved children | Preserve all child proposals, including unfinished ones and their existing status, as Project Ideas. | §10 |
| A local variation could still resolve through the original shared parent | Preview and rewrite the affected dependency paths, creating local parent variations where necessary. Preserve other Documents' identities and meaning. Apply the same discipline to split/merge. | §§7,9–10 |
| Fixed selection implied frozen shared content | Fix selected source-Document root membership. Existing shared Ideas retain ordinary shared edits/dependencies. Source changes during review pause saving, show differences and renew affected approval. | §§5,13 |
| Reuse-only New Idea could create a duplicate or show “0” despite a real change | Review the new attachment with its destination and use count; if nothing changes, offer Open/return. Do not invent a wrapper. | §§3,8 |
| Every review implied three newly created levels | Skip absent levels; existing Project/Document destinations are read-only context. A composition review can cover its disclosed uses without fake new-record cards. | §§2,8 |
| Rich-input failure could fall back to saving only a title | Keep full source and offer retry/manual completion. No content-dropping outage path. | §3 |
| Editor references had no complete persisted/server contract | Use the public RichDocument shape, canonical reference identities and derived text, with pure validation/projection APIs, mutation guards and copy compatibility. | §7 |
| Reference grouping could pull both scenes into every shared participant | Directed scene-to-entity inclusion, deduplicated targets and consistent effective closure in review, commit and generation. Provenance never acts as inclusion. | §§5,7 |
| Current Jev/search was assumed to provide arbitrary-scale semantic lookup | Specify independent lexical/learned candidate generation, bounded authorized hydration/reranking, index coverage, invalidation and degraded states. A learned backend remains explicit implementation work. | §6 |
| Account-wide discovery was confused with a selected-context endpoint | Add a dedicated aggregate read endpoint with per-Project authority and custody/provider partition checks. Preserve Open-only behavior for New Project results. | §§2,6 |
| Slash Output hints had no durable cross-surface meaning | Visible nonexclusive Format preferences, a plural shared helper, chooser integration and explicit selected-Output precedence. No Document output-type field or generation on save. | §11 |
| Existing saved-Document authoring could not authorize a new root | Add a prospective-root creation-plan operation, server compiler, deterministic ID mapping and one transaction/receipt. | §14 |
| Draft privacy, recovery and bounds were underspecified | Actor-private protected drafts, CAS, acknowledged autosave, policy retention, precise payload/event bounds and lost-response recovery. | §§12–14 |
| The White Album example was only an outline | Supply complete supported types/bodies, source evidence, reference occurrences, uses and expected graph closure. Preserve the user's exact wording and unspecified details. | §15 and fixture |

## Original request and decision coverage

| User intent/decision | Implementable behavior |
| --- | --- |
| Similar, understandable creation pages | Shared heading/editor/Save/Back; one local validation message; no mandatory type selector during free writing. |
| Simple names should remain fast | Exact title-only Project/Document save bypasses organization. Title-only Idea opens missing-body/type review. Ambiguity is reviewable and correctable. |
| Find forgotten work while writing | Up to three semantic candidates, with the requested scope per entry; specific Ideas rank ahead of broad Documents where appropriate. No forced three-result list. |
| Open and reuse are distinct | Open preserves the draft and destination. Eligible Use previews the exact passage and substitution, with user-selected occurrences. |
| No adoption across Projects | Enforced for direct use, partial extraction, pasted IDs and dependency expansion. New Project's account-wide discoveries remain Open only. |
| Whole Document inclusion should select its contents | Explicit constituent selection; new Soundtrack members do not appear automatically. Existing selected shared identities keep normal shared behavior. |
| Organize without inventing | Source evidence and coverage ledger; faithful rewording only; no biographies, guessed instruments, new ideas or repaired meaning invented by the model. |
| Supported Idea types, editable suggestions | Infer only from supplied meaning; uncertain type is a review issue. No blanket Direction or new persisted Object type. Object maps to existing Subject/Object study. |
| Free text with @ and / guidance | Inline tokens/typed cues, no sectioned input UI. Stable resolved identities, explicit new declarations, multiword slash aliases and scoped structural cues. |
| Adaptable Documents | One or more preferred Outputs live in Format Ideas; every supported Output remains available. |
| Review Ideas before their containers | Unique Ideas first, Document compositions next, new Project last; source and uses remain visible throughout. Current proposals must all be presented before the final action appears. |
| Edit shared proposals or make local variations | Shared edits affect proposed uses by default; explicit local variations preserve other uses and repair dependent references. |
| Live Jev split insight without coercion | Quiet debounced suggestion; See options previews, Keep as one preserves; only acceptance changes structure. Stale results cannot mutate or redirect work. |
| Remove or merge instead of decline | Review all affected uses/semantic mentions; preserve unaffected meaning and original evidence; prevent removed input from reappearing during reanalysis. |
| Preserve Ideas when removing their container | All Idea proposals survive Document removal, retaining their approval/completeness state. |
| Partial reuse escape hatch | Start with Use only this part for partial matches; independent reviewed Idea and protected provenance. Full shared reuse remains an explicit alternative. |
| Future workflows benefit | Reusable search/range/interpretation/review services; minimal Output integration included. Full Research/Search migration and Memory remain outside this release. |

The six original goals are represented by these behaviors and by the acceptance gates. Extraction count is explicitly not a quality metric: useful independent pieces, preserved relationships, speed and recoverability matter more than fragmentation.

## Decisions versus specification defaults

The user's product decisions remain binding. No rejected sectioned-input design has been restored. The following choices close engineering/product gaps under the user's instruction to work out a complete approach; they are not additional user approvals:

- Final save requires approval of every retained item/use. This resolves “Approve selected” consistently with explicit Remove/Merge and no lost input. Saving only an approved subset is deferred.
- Removing a proposed Document preserves unfinished children as well as approved children. This conservatively extends the explicit preservation decision.
- Reuse-only input can result in one new use or no change, rather than forced duplication.
- Initial technical bounds: 400 ms search debounce, 500 ms split debounce, 20 lexical plus 20 semantic candidates, at most 24 hydrated/reranked candidates, three displayed results, 512 compiled events, 1,000,000 bytes per protected draft/plan envelope, 32 rich-node levels and 10,000 nodes per body.
- Initial quality/performance release targets: at least 30 organization and 50 retrieval cases; 90% held-out unambiguous recall at three; at most 10% no-match false positives; zero authorization leaks; responsive local feedback and measured suggestion latency at 1,000/10,000 indexed Ideas.
- Drafts use server-backed actor-private persistence and current policy retention. Unacknowledged offline text is not promised to survive a reload.

These defaults may be tuned through implementation evidence without changing the no-invention, explicit-review, scope or content-preservation requirements. A material change to those requirements would reopen the corresponding product decision.

## Verification completed for this plan

Three independent reviews covered product/review semantics, model/worker architecture, and retrieval/editor integration. The consolidated specification incorporates their concrete corrections. Source anchors are retained in §18; implementation must recheck them against its checkout before editing.

Static fixture validation passed **63 assertions**: unique identities, exact source spans, supported types/subtypes, public RichDocument-shaped bodies, exact nonempty readable projections, valid reference targets and unique occurrences, acyclic dependency closure, exact Document uses, shared Paul/Jon identities and no cross-scene leakage. The fixture contains **17 new records: one Project, two Documents and 14 unique Ideas**, with 15 reference occurrences. Its **29 acceptance scenarios are specified, not executed feature tests**.

Participant bodies such as “Paul” are grounded by full-scene evidence and the supported Human presence subtype. They extract an identity explicitly present in a scene; they do not manufacture a body for a standalone title-only request. The first-scene instruments remain unspecified, Jon stays Jon, and the second scene does not acquire a new sitting posture or inferred room arrangement.

No live model benchmark, provider call, creative-record write, application test or application change was part of this audit. Schema/source-span checks cannot prove semantic fidelity; model evaluation and human adjudication remain release gates.

## Implementation handoff

**Ready to implement.** There are no unresolved product questions blocking the agreed initial release. Begin with Package A: shared versioned schemas, fixture variants, server validation/compiler and prospective-root authority. Then build durable execution and fixture-driven editor/review in parallel; start learned-index provisioning early. Correction operations, compatible reference consumers and nonexclusive Output integration must be complete before the interpreted path ships.

Release remains conditional on the specification's behavioral, fidelity, access, concurrency, recovery, atomicity, performance and accessibility checks. These are work to execute during implementation, not reasons to leave the plan ambiguous. The v19 handoff above is historical; use the latest specification and subsequent addendum below when continuing implementation.

## v20 addendum: contextual help

The user approved a **How this works** text button beside the introductory description, opening an optional dialog that explains how to use the workflow successfully. This is an additional user-decided requirement; the v19 model/fixture contracts remain unchanged.

Specification §2 now defines placement, visible expectations, the four explanation topics (natural input/Still, @ identity, / intent, Save/review), an entry-appropriate read-only White Album example, and accessible dialog behavior. Package C and §17 include its implementation and acceptance work. The specification remains **Ready to implement**.

A focused independent consistency review clarified:

- Project/Document title-only saves are immediate; a blanket promise that every Save opens review would be incorrect. Private draft autosave is distinct from creating approved content.
- New Project @ declarations are new content only, New Document can select same-Project Documents/Ideas, and New Idea can select same-Project Ideas. The generic @ wording in §4 is now explicit about that scope.
- Help preserves free-text input and optional markers. Output markers express nonexclusive Format preferences and never generate outputs.
- Opening/closing help preserves text, tokens, selection/undo, review position and approval state; it never counts as reviewing a proposal or invokes interpretation. Keyboard, focus, inert background, dismissal, mobile and localized content require verification.

The planning follow-up updates documentation and the Progress Report only. Existing implementation evidence belongs to its own verification ledger; earlier Package C results do not establish completion of this added help requirement. A pending help implementation item records that additional scope without reopening unrelated completed work or clearing existing release blockers. Continue the current implementation from v20 rather than restarting Packages A–F.
