# Forma generation source-contract repair — 2026-08-27

The Slides source contract now distinguishes a short output outline from an authored slide manuscript. Outline titles and coverage instructions are separate from the research passages a slide may cite. Sibling output requirements have boundaries, and the initial request, bounded repair, validation, and managed batches use the same passage assignments.

This is an implementation and deterministic verification result, **not a successful live generation**. No new provider request was made. The original research Document and its historical rejected output were not edited, exported, promoted, or recreated.

## Evidence and diagnosis

The checkout was clean and at the research baseline, `faf107f8ace39fdaf11b28c8e45e6a13b53bd7f1`, before this work. No applicable `AGENTS.md` was found. The four supplied evidence files were read locally; private receipts and rejected draft content have not been copied into this repository.

The frozen source in the supplied receipt reproduced the parser defect without a provider call. The old contract assigned all six slides to the Format block. Its first five inferred passages were short authoring instructions; the final passage was 1,436 characters and included the separate Scene requirements. The final title also retained authoring directions. Under the new parser, the final outline passage is 178 characters, the title contains only its heading, and the sibling specification is absent from both the contract and provider-facing source projection.

| Finding | Evidence and implication |
| --- | --- |
| Authoring ambiguity | An outline and an authored manuscript previously followed the same fidelity path. The supplied brief places shared research outside the Format block and describes two outputs inside it. A general solution needs output boundaries and a separate outline contract. |
| Parser defects | Numbered slide parsing continued to the end of the block. It lacked a boundary for the following output and did not separate an outline heading from its directions. These defects are reproduced from the frozen source. |
| Contract and prompt disagreement | The provider received authorized research alongside instructions to preserve the slide's assigned source, while the contract treated the Format instructions as that source. Repair and acceptance could not consistently express “cover this requirement using these research passages.” Both requests now use that explicit contract. |
| Validator defects found during repair | Group resolution could let a direct block citation borrow another member's passage. Excerpt normalization could erase meaningful numerical punctuation, and quotation validation needed to use the resolved cited passage. New tests cover these defects independently of the historical run. |
| Historical provider compliance remains unknown | The inspected receipt and review cards did not expose the six final rejected excerpt strings. They could have been paraphrases, quotations from a different authorized passage, or invented wording. The confirmed mapping defect does not establish the cause of every final rejection. |

The historical receipt still records two paid calls, $0.135008 settled under the completed run's $1 ceiling, a failed job, and zero accepted outputs. The initial and repair attempts remain separate records within that job. None of those facts is reinterpreted as a delivery success.

## Contract and implementation

The main changes are in `src/model/presentation-source.ts`, with consumers in `worker/openai-adapter.ts`, the manual and managed admission paths, `src/model/managed-production.ts`, and `worker/managed-production.ts`.

1. **Identify the output and its mode.** Explicit output/deliverable headings and named output specifications establish boundaries. Ordinary manuscript subheadings such as “Video” are not automatically output boundaries. Short, positively identified presentation outlines use outline mode; existing authored slides retain manuscript behavior. An explicit source mode or manuscript heading can disambiguate authoring intent. Multiple presentation specifications, duplicate slide numbers, unclear long outlines, and incompatible requested counts fail preflight with actionable issues.
2. **Separate requirements from evidence.** An outline slide has a title, coverage requirements, and permitted passage IDs. Research is split into contiguous passages with source ownership. Format and standing style/production constraints remain instructions, not factual evidence. Explicit slide/group assignments take precedence. Otherwise a conservative lexical match assigns relevant research passages; it does not grant every Document source to every slide. An unresolved slide or an unassigned mandatory passage blocks the request before reservations, job writes, or provider calls.
3. **Use one contract throughout the request.** Both initial and repair prompts receive the same title, coverage, passage, source, and anchor rules. Source projection removes sibling specifications from duplicated text fields and their derived claims, rather than merely hiding them in the outline display. Managed production rebuilds each page from its exact selected slide requirements and evidence, retains global numbering and constraints, and does not add unrelated research by round-robin assignment. Existing authored-deck expansion remains supported; an outline requires explicit coverage for additional slides.
4. **Check grounding and coverage separately.** A citation resolves its block, group, or claim ownership and the slide's permitted passages. Its excerpt must be contiguous source text after bounded punctuation/spacing normalization; separate passages are not concatenated to make a quotation pass. A supplied canonical passage anchor must identify that passage. An actual quote from a different slide's evidence remains a source-assignment failure. Coverage checks the visible audience content against the slide requirement, independently of whether a citation is real.
5. **Retain faithful-mode protections.** Required content, status and negative qualifiers, protected facts, quotations, attribution, and numerical claims remain blocking checks. Numerical comparison preserves signs, percentages, currency, decimals, ratios, ranges, and units; obvious measurement-label swaps fail. Visible cardinal-number equivalence is permitted, but quoted excerpts remain literal. Authored manuscripts retain their existing title and protected-content behavior. A known protected manuscript quotation may occupy a neighboring card in the same authored source block only when its quotation citation truthfully points to the original authored slide.

There is no new Output-block feature, general fallback to all Document sources, or relaxation of faithful mode. Source projection does not mutate the saved Document.

### Assumptions and limits

Automatic relevance and coverage checks are conservative lexical checks, not semantic proof. They are designed to reject uncertain mappings instead of guessing. Unusually phrased research or requirements may need explicit source groups/assignments or clearer headings. A long brief that does not clearly identify itself as an outline or manuscript can require author clarification. Mandatory evidence is checked at passage level so assigning one paragraph does not silently discard another required paragraph from the same block.

## Private diagnostics and adjacent fixes

Actor-authorized rejected-draft details now distinguish source authorization/assignment, excerpt grounding, and anchor validity. They show the submitted excerpt and the resolved source passage inside the existing private review surface, with explicit truncation flags. The validator and diagnostic display share the resolver. These fields are not added to job-list summaries, public logs, audience exports, or provider requests. No new copy, export, or promotion action was added. Audience HTML, PDF, and PPTX projections remove internal canonical passage IDs.

Activity reports the latest provider attempt for each page while preserving the full attempt history. The receipt label makes clear that the displayed settled job cost includes all calls. Project overview now counts the same project-scoped failures as Activity, rather than only review items. Its route also loads the bounded, authorized job history needed for that count; private input hydration remains disabled. A real-store regression covers navigation from Document to Project, where an active-only fetch had previously replaced the failed job with an empty list. Existing server authorization and the 120-job history bound are unchanged.

Scene had a separate disclosure problem, not the Slides mapping defect. The server already enforced an application cap. The composer now explains provider/model, included source text, written-Scene-only scope, maximum calls including repairs, the application spending ceiling, and possible charges on failure. Manual Scene discloses one initial call, at most two total calls, and a $1 ceiling. Managed Scene discloses its batch-dependent ceiling and at most four calls per batch. The new receipt flag accurately states that the application cap applies. No billing setting, permission, cap enforcement rule, or historical receipt was changed.

## Compatibility and migration

New contracts use schema version 2, and the presentation adapter is versioned `2026-08-27-output-outline-evidence-v5`. Existing version-1 authored contracts remain readable and validated through the compatibility path. There is no database or saved-Document migration.

A source-validation rejection produced by an older adapter remains review-only even if a new contract could assess it differently. Automatic certification and direct recovery of those historical rejected drafts are blocked. This prevents the repair from silently turning an old paid rejection into an accepted output. Recovery of an already accepted response whose persistence failed remains supported under its existing rules. Neither kind of recovery was requested during verification.

## Verification

Build and test scripts were inspected before execution. Because the build cleans generated output and regenerates assets, it ran in an isolated source copy under `/private/tmp`, without the live local database, private environment files, or the original build output. Only lockfile-pinned dependency downloads were approved. Provider API key variables were cleared for the build and regression run, and the complete test run installed a default network-denial stub; individual provider tests used deterministic mocks.

| Check | Result |
| --- | --- |
| TypeScript typecheck | Passed |
| ESLint | Passed |
| Custom-element manifest consistency | Passed; original manifest unchanged |
| Localization validation | Passed for all configured locales |
| Isolated production build | Passed; bundle-size warnings only |
| Full repository test suite | **1,808 passed; zero failed, canceled, or skipped** |

Regression coverage includes shared research plus a short outline, mixed Slides/Scene specifications, title extraction, ambiguous authoring, explicit assignments, mandatory passages, legitimate and invalid excerpts, false anchors, cross-block group resolution, claim ownership, changed numerical values and units, invented quotations, existing authored decks, and source projection. Real adapter tests exercise acceptance and one bounded repair with mocked provider responses, including settled cost on rejection. Real admission tests prove that unresolved evidence fails both submission boundaries before reservations or writes. Managed tests exercise a nine-slide deck in batches of eight and one, with stable global assignments. Project and private-review tests cover loading, authorization, attempt counts, safe summaries, and historical recovery guards.

Read-only browser checks on the existing local app verified the six clean outline titles, the Scene disclosure, and Project overview's corrected **1 Needs you** count. The original Document still showed eight context blocks and zero outputs. Composer dialogs were canceled; no Create, Retry, recovery, dismissal, source-save, export, or publish action was taken. The original receipt's SHA-256 checksum was unchanged after verification.

No paid live test was authorized or performed. The original six rejected excerpts remain unavailable in the inspected historical evidence. A future generation test needs fresh approval of the exact source scope, provider/model, maximum calls including repair, and aggregate spending ceiling. A live success claim additionally requires an accepted artifact and inspection of its content, citations, layout, and available export; none is claimed here.
