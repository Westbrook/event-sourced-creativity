# Forma native slideshow: live rendering and benchmark gap notes

Date: 2026-08-23  
Status: **two official 12-slide Forma presentations were successfully rendered from the real executive document** after a narrowly scoped worker fix. The first failed attempt cost $0; the two completed OpenAI requests settled at **$0.052952** and **$0.044384**, totaling **$0.097336**. Both official outputs remain in the Forma document.

## Comparison objects

- External benchmark: `docs/forma-responsive-product-strategy-2026-08-23.pptx`, a fully rendered, independently inspected, 23-slide editable presentation with speaker notes, source citations, stakeholder quotes, responsive-product scorecards, device layouts, and a staged delivery plan.
- Native document: **10 — Executive Opportunity — Slide-by-Slide Presentation Narrative**, in **Forma Everywhere — Adaptive Creative Workbench — 2026-08-23**; document ID `df775088-e5e8-48b5-8ef9-f4e41b93137c`.
- The native document already contains three authored context decisions with an explicit 12-slide outline, exact scores, role-agent stakeholder quotations, and slide-by-slide speaker guidance. Sister documents describe 14 device-experience slides and 16 implementation/trust slides.
- Comparison is between an externally orchestrated, editable 23-slide benchmark and Forma's actual in-product document-to-slides adapter. It is not a claim that the benchmark was produced inside Forma.

## Verified before generation

### 1. Native rendering is genuinely model-backed, not a deterministic slide renderer

The authenticated product path is **open document → Your results → Create output → Slides → Use my settings → Create slides**. A new native slide artifact cannot be produced through a supported deterministic local rendering or import action. Submitting the request queues a durable document job, invokes the configured OpenAI Responses provider, and reserves up to **$1.00** and **32,000 tokens**. A bounded model-repair request may also be attempted if the first response fails validation.

This is different from viewing, editing, and exporting an already-existing in-app slide artifact: those later presentation operations can be rendered locally. A previously created external PPTX does not become an official Forma slide artifact just because it is opened or copied into the repository.

Evidence: `src/components/document-artifacts.ts:41`, `src/state/store.ts:934`, `worker/document-jobs-api.ts:903`, `worker/document-jobs-api.ts:953`, `worker/document-jobs-api.ts:967`, and `worker/openai-adapter.ts:425`.

### 2. Manual production has a 12-slide ceiling; managed production misreads this 12-slide document as only two slides

The real **Number of slides** selector exposes only **4, 6, 8, 10, and 12**. The visible initial selection after choosing Slides was **4**, even though the selected authored document explicitly describes 12 slides.

Consequences:

- The existing 23-slide benchmark cannot be reproduced through one **manual** native document presentation.
- The sibling 14-slide device narrative and 16-slide implementation narrative cannot preserve their complete authored structure in a single **manual** native output.
- The 12-slide executive narrative only fits if the user discovers and changes the initial four-slide setting.
- Manual production does not automatically derive the requested slide count from authored document structure.

The separate **Use a structured production workflow** option is not inherently limited to 12 slides: its editorial planner can paginate larger productions into eight-slide provider batches. However, on this exact explicitly authored 12-slide document, its visible preflight reads **“2 context-led slides · up to $1.00 reserved.”** The authored slide-by-slide narrative is distributed across three context blocks, and the planner derives slide count from materialized claims/context groups rather than the 12 explicitly numbered slide instructions. The managed dialog offers no visible slide-count override. Therefore the supposedly more advanced native workflow would discard or collapse approximately ten intended slide positions before generation.

A managed production that actually derived 23 eligible slide scenes could reserve up to $3 across three planner pages, but this is theoretical for the current source: the real authenticated preflight predicts only two slides. Source: `src/model/managed-production.ts:436`, `src/model/managed-production.ts:510`, and `worker/managed-production.ts:142`.

Evidence: live authenticated rendering-dialog inspection; `src/components/document-artifacts.ts:101`.

### 3. The action does not disclose its provider or spending implications in the slide dialog

The visible **manual** Slides dialog lists output kind, manual versus structured production workflow, slide count, optional Audience, optional Tone, and **Create slides**. It did not display the provider, model, token estimate, up-to-$1 reservation, likely cost, or a clear statement that authored context would be transmitted to an external model provider. By contrast, the **managed** workflow visibly discloses **“up to $1.00 reserved”** for its two-slide plan, but still does not identify the external provider/model or explain why ten explicitly authored slide positions disappeared.

This is especially misleading because storyboard/video have more obvious paid-media consent treatment while Slides still runs a paid text-model job. A budget-threshold confirmation can appear later, but the initial action itself is not priced.

Evidence: live authenticated rendering-dialog inspection; `src/components/document-artifacts.ts:43`, `src/state/store.ts:381`, and `worker/events-api.ts:293`.

### 4. The initial creation controls cannot express benchmark-level design intent

Visible manual controls are limited to output kind, production mode, slide count, **Audience**, and **Tone**. The observed dialog provides no visible controls for:

- Theme, design system, typography, palette, logo, master layouts, spacing, visual density, or brand assets.
- Per-slide titles, slide order, layout choice, diagrams, scorecard/table fidelity, or roadmap timeline structure.
- Preserving exact stakeholder quotations, numeric scores, note content, source references, or citations as protected content.
- Binding specific authored blocks to particular slides or declaring which document context must remain verbatim.
- Choosing between faithfully rendering an authored slide-by-slide outline and creatively regenerating its narrative.
- Provider/model selection, reproducible seed, validation strictness, output repair policy, or generation quality tier.
- Importing the existing editable PPTX as a reference or converting it into a native, reviewable Forma presentation.

These are limitations of the observed **initial Slides creation dialog**; post-generation editing and style controls remain to be assessed after an authorized run.

### 5. Authored context already contains useful structure, but fidelity is unproven

The executive document stores slides 1–4, 5–8, and 9–12 across three large authored Direction, Audience, and Message blocks. Its text includes explicit slide headings, the exact **61.125/100** overall score, **39.75/100** phone score, the stable **Projects / Work / Explore / Activity / Deliver** taxonomy, verbatim stakeholder quotations, and the **4–6 week / 12–16 week** roadmap.

The current UI offers no visible preflight showing how those blocks will be assembled for the adapter, whether all source text survives, which instructions have priority, whether the slide count matches the outline, or which exact quotations/numbers/citations must remain unchanged.

Required post-render checks: slide count; one-to-one authored-outline coverage; exact numbers and role attribution; stable destination vocabulary; citations and source notes; stakeholder quotations; phase dates; document/resource identity; visual hierarchy; layout diversity; text overflow; accessibility; independent review state; and editable PPTX/PDF export parity.

### 6. The external benchmark is genuinely editable but is not an Office-chart/image benchmark

Archive inspection confirms the external presentation contains **23 editable slides, 23 editable speaker-note parts, one slide master, and one layout**. It contains **zero embedded charts, raster images, or diagram media**: its score matrix, diagrams, multi-column comparisons, and timelines are carefully arranged editable textboxes and rules. Every slide has a `[Sources]` notes block. Its typography uses Helvetica Neue, with a white/ink composition and one blue accent; body text is at least 16.5pt, ordinary slide titles are 38.25pt, and the cover title is 69.75pt.

This distinction matters: the benchmark's most relevant advantage is precise composition, controllable layout, source-bound notes, and intentional typography, not an ability to embed sophisticated chart/media formats that it does not actually contain.

### 7. Native on-screen visual variety does not survive editable PPTX export

Native Forma presentations support seven semantic layout families—cover, statement, split, columns, metric, timeline, and closing—plus six HTML visual families and four preset palettes. They also provide actual slideshow/list viewing, editable speaker notes, local PDF/PPTX export, basic foreground-contrast selection, right-to-left/localized Office metadata, and a 100-slide export ceiling. Those are real capabilities, not gaps.

However, the editable PowerPoint adapter **flattens HTML bars, diagrams, timelines, and other visual treatments into plain-text label/value content**. Every exported slide receives the same fixed chapter/title/body/bullets/right-hand annotation/footer coordinate structure, regardless of its native semantic layout. The exporter cannot retain the benchmark's custom score matrix, multiple independent content columns, visually distinct quote or comparison compositions, timeline geometry, selective cover/closing compositions, or matched browser-to-PowerPoint visual hierarchy.

The export uses Aptos/Aptos Display and fixed **36pt cover titles, 30pt normal titles, 19pt body, 16.5pt bullets, 17.5pt annotation, and 10.5pt optional footers**. Its slide title and cover hierarchy therefore materially differ from the externally inspected deck. There is no supported image embedding, real Office tables/charts, animation, custom template upload, per-presentation font selection, arbitrary brand palette selection, or non-widescreen aspect ratio in the inspected native adapter.

Speaker notes can carry citations as unstructured text, but the native slide item schema has no dedicated evidence/source/URL field and therefore cannot enforce the benchmark's per-slide citation contract.

Evidence: `src/model/document-artifacts.ts:6`, `src/model/document-artifacts.ts:11`, `src/model/document-artifacts.ts:41`, `src/components/presentation-slide.ts:17`, and `src/model/office-documents.ts:103`.

### 8. The adapter protects source privacy but removes citation-level provenance

The provider request is assembled from the selected document's event-sourced active blocks, relations, and pins; it is not a direct faithful rendering of arbitrary document prose. Prompt policy strips inactive facts plus internal provenance identifiers, source references, hashes, and event IDs, and aliases decision IDs. This is a meaningful privacy boundary, but it also means the model cannot reliably produce exact original block IDs, repository source locations, or URL-linked slide citations from those stripped identifiers.

The required slide schema includes title, body, speaker notes, image direction, context groups, and simple visual payloads. It does **not** define a named quotation speaker, protected verbatim quotation ledger, source/evidence citation, page-by-device matrix, phase owner, measurable release gate, or source-coverage contract. Current validators primarily enforce shape, count, visual eligibility, and duplication; they do not prove every authored slide, exact quote, persona, numeric metric, citation, or roadmap phase survived.

Evidence: `src/state/store.ts:152`, `src/model/prompt-policy.ts:134`, `worker/openai-adapter.ts:113`, and `src/model/document-artifacts.ts:251`.

### 9. Visual payload limits and responsive hiding can erase relevant evidence

The provider schema caps individual slide visuals at five bullet/data points. The native slide format cannot directly represent complete benchmark score matrices, device wireframes, six-goal comparison tables, dependency swimlanes, linked diagrams, logos, screenshots, or arbitrary branded master layouts. Some compact presentation CSS hides bullets beyond the second and color-field points beyond the third, so information that technically exists in the generated slide can still disappear in responsive consumption. Diagram and timeline labels can fall to approximately **6.4–6.72px**, below Forma's documented 10px minimum; some small muted text is selected against only a 3:1 contrast threshold.

> “A slide renderer that swallows its fourth data point is not simplifying the story; it is falsifying the story.” — **Lead Designer role agent**

Evidence: `worker/openai-adapter.ts:120`, `src/model/document-artifacts.ts:6`, `src/styles.css:1997`, `src/styles.css:2004`, `src/styles.css:2019`, `src/components/presentation-slide.ts:7`, and `DESIGN.md:96`.

### 10. Multi-call continuity and repair costs are bounded but not explained to the user

Manual generation can perform a second provider request to repair an invalid model response. Managed production pages its editorial workflow in eight-slide batches, locks the initial theme, and carries a limited continuity window; invalid pages can trigger additional repair work. Its combined markdown output does not necessarily retain all speaker-note or citation detail. The observed UI does not explain the possible extra provider call, guarantee byte-for-byte cross-page quote preservation, or expose a slide-by-slide completeness ledger.

Evidence: `worker/openai-adapter.ts:448`, `worker/managed-production.ts:142`, `worker/managed-production.ts:170`, `worker/managed-production.ts:216`, and `worker/managed-production.ts:248`.

### 11. Presentation controls and long-lived provenance have additional trust gaps

The native slideshow's List/Previous/Next controls have a **2.25rem / 36px** minimum block size, below the strategy's measured 44px touch-target requirement. The inspected presenter does not offer full-screen presentation, slide thumbnails/jump navigation, persistently deep-linked slide selection, presenter-only notes/next-slide preview, or touch-swipe controls. Direct post-generation slide editing is limited to title/content/notes; visual layout and custom per-slide brand treatment are not first-class authoring controls. PDF capture renders the visible slide component and does not include speaker notes. The durable artifact may outlive its exact generation/input evidence because governed evidence expires under organization/default retention settings, so historical presentations can remain after their supporting provider receipt has expired.

Evidence: `src/styles.css:1924`, `src/components/presentation-pdf-export.ts:219`, and `worker/pilot-policy.ts:848`.

## First live native rendering attempt

### Request submitted

- Exact document: **10 — Executive Opportunity — Slide-by-Slide Presentation Narrative** (`df775088-e5e8-48b5-8ef9-f4e41b93137c`).
- Exact action: **Create output → Slides → Use my settings → 12 → Create slides**.
- Audience: `Product, design, engineering, accessibility, and enterprise decision-makers`.
- Tone: `Evidence-backed; preserve exact scores, source facts, stakeholder quotes, and the authored 12-slide structure`.
- Explicit user authorization: one OpenAI-backed Forma document render with a reservation of up to **$1**; the user separately expressed willingness to authorize bounded retries.
- Result: **no completed presentation output**; the document exposes one failed generation attempt.

### P0: Internal event-store collision is mislabeled as a transient provider failure

The normal results surface states:

> Slides: The provider connection was interrupted
>
> No terminal account or request block was reported. It is reasonable to retry.

Expanding **Technical details** reveals the actual cause:

```text
Reason: D1_ERROR: UNIQUE constraint failed: events.event_id:
SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)
Provider status: 500
```

This is an internal event-store primary-key collision, not evidence of an interrupted OpenAI provider connection. Labeling it as a provider status hides the real affected subsystem, while asserting that a retry is reasonable risks repeating a non-transient write-integrity defect and incurring unnecessary metered work. This failure also aligns with the independently observed stale-sequence/duplicate-project/duplicate-document defects in the earlier reporting exercise.

Read-only inspection of the live event and budget records proved the precise sequence:

1. The job ran from `2026-08-24T00:13:46.784Z` through `00:13:46.859Z`, a total of **75ms**.
2. `DocumentRenderRequested` committed at stream sequence **9647** and `BudgetReserved` committed at **9648**.
3. The staged-write trigger performs additional insert/delete work, so the live D1 result's change metadata is not exactly one despite the write having succeeded.
4. `appendEvents` incorrectly requires every staged result to satisfy `meta.changes === 1`; it therefore retries the same already committed event objects and IDs, violating the `events.event_id` primary key.
5. The actual OpenAI planner call occurs only after that initial append, so execution never reached the provider.
6. `BudgetReleased` committed at sequence **9649**. The token ledger records **32,000 reserved / 0 used / released**; the dollar ledger records **1,000,000 microusd reserved / 0 used / released**.

No OpenAI request occurred, no provider response exists, and **no money was spent** on this failed attempt. Relevant implementation: `worker/runtime.ts:54`, `worker/runtime.ts:528`, `worker/runtime.ts:557`, `worker/events-api.ts:422`, and `worker/events-api.ts:429`.

**Applied repair:** both staged event-write success checks in `worker/runtime.ts` now treat a **positive** affected-change count as success, rather than incorrectly demanding exactly one. Zero-change stale-head writes remain rejected; D1 batches remain atomic, private payloads remain protected, and client-event receipts remain idempotent. A new regression reproduces Miniflare's trigger-inclusive four-change accounting, verifies each event ID commits exactly once, verifies stale writes do not commit, and verifies receipt idempotency. The focused suite passes **17/17** tests; the existing route/presentation/responsive suites additionally pass **36/36**.

Required acceptance: event IDs remain unique across project creation, document creation, queued jobs, and completion/failure receipts; event-write errors are surfaced as **internal persistence failures**, never attributed to an external provider; retry is offered only after safe idempotency/recoverability classification; authorized spend is reserved/released or precisely disclosed.

### P0: “Complete input receipt” is unavailable immediately after a failed run

Clicking **Inspect inputs** on the fresh failure opens **Failed generation inputs** and explains:

> Only the surviving job and event receipt is available; private inputs expired or were not captured for this earlier failure.

The same dialog still displays **Complete input receipt** and **Partial failure receipt** simultaneously. This was inspected immediately after the very first failure, so expiration alone cannot credibly explain the missing evidence; the failure apparently predates durable capture or prevents receipt persistence.

Consequences: the end user cannot establish which authored context, audience, tone, slide count, provider request, token reservation, or model response actually reached the adapter, nor whether money was spent. This blocks the precise source-to-slide quality comparison requested for the exercise.

Required acceptance: every accepted metered generation has an actor-scoped, truthful, immediately inspectable request receipt, source hash, exact settings, reservation/spend state, causal failure stage, and provider-request disposition—even if the downstream event-store write fails.

## Completed native presentation comparison

### Confirmed completed outputs and actual spend

| Measure | Native output A, recommended | Native output B | External benchmark |
| --- | --- | --- | --- |
| Durable artifact ID | `01a03126-27c6-77d5-a77c-0a7d5218e24e` | `01a03127-22a6-7179-bc21-57c12c2ca098` | Repository PowerPoint; not a native Forma artifact. |
| Requested document / count | Same executive document; exactly 12 slides. | Same executive document; exactly 12 slides. | 23 deliberately composed slides. |
| Model | `gpt-5.6-terra` | `gpt-5.6-terra` | External authoring workflow. |
| Actual settled cost | **$0.052952** | **$0.044384** | Already produced; not part of native generation billing. |
| Provider usage | 2,464 input + 4,002 output = **6,466 tokens**. | 2,464 input + 3,288 output = **5,752 tokens**. | Not directly comparable. |
| Theme / style | Editorial; custom dusk-warm palette. | Nocturne; different dark palette. | Helvetica Neue, deliberate Forma-blue system, intentional dark closing. |
| Slide titles / order | All 12 explicitly authored narrative beats, in the intended order. | All 12 narrative beats, with more title paraphrasing. | 23 designed sections spanning the broader study. |
| Speaker notes | All 12 slides have notes; all four authored stakeholder quotes survive there. | All 12 slides have notes; two authored closing quotations are absent even from notes. | All 23 slides have notes and `[Sources]` evidence blocks. |
| Context-to-slide bindings | None: every `context_group_ids` array is empty. | None: every `context_group_ids` array is empty. | External notes cite concrete source paths/URLs. |

Two distinct provider jobs were accepted for the same document/settings; they began approximately **64.2 seconds apart** and ran sequentially. The event ledger does not identify separate browser sessions/initiators. Identical completed requests are not deduplicated, so no claim is made about who initiated the second submission. Actual combined spend remained below even a single $1 reservation and no reservation remains active.

### What native Forma did well

- Both presentations genuinely exist as durable document outputs inside Forma, not merely as externally generated files.
- Both produced the requested **12 slides**, all **12 speaker-note fields**, and the intended ordered strategic narrative.
- Both retained the five stable destinations, four principal device postures, 4–6 week and 12–16 week timelines, visible slide numbering, coherent deck-wide themes, and editable PPTX/PDF actions.
- Native composition uses seven semantic layout families across the decks and real HTML bars, timelines, diagrams, and quote/hero treatments.
- Output A preserves all four source stakeholder quotations verbatim in its speaker notes and preserves privacy/review constraints, although those quotes are not visible in the actual slideshow.
- Successful retained receipts expose the complete frozen source context, exact request settings, model, original submitted provider prompt, and a project/document-scoped input record.

### P0: Exact source-score semantics changed across identical requests

Output A displays **61.13 / 100** on the visible slide and retains the exact **61.125** only in speaker notes. Output B displays both values, but reverses their meaning:

```text
Overall six-goal score: 61.13 / 100
Display score: 61.125 / 100
```

The authored source explicitly says the exact overall score is **61.125/100**, displayed as **61.13**. Output B's labels are therefore factually backwards even though both numbers are present. No current slide validation detects this semantic reversal.

### P0: A six-goal scorecard is structurally impossible; a legacy PDF path truncates further

Both native outputs create only **five score bars** for six evaluated goals because the provider schema and normalization cap `visual.data` at five items. The governed creative-loop **79.50** score has no chart row in either deck. The five visible bars mathematically average only **57.45**, not the claimed six-goal **61.125**; the headline becomes independently verifiable only after adding the hidden sixth goal. In output A, 79.50 survives in a text bullet; in output B it is assigned to a bars visual's `value` field, which the browser renderer ignores, so the value is absent from the visible native slideshow altogether.

The **current browser-driven Download PDF action** captures the actual HTML slide, so it faithfully preserves whatever five chart rows the browser shows and also preserves the absence of the sixth row. It produces searchable, tagged-accessible PDF text over rasterized slide artwork but does not include speaker notes. Separately, the older/programmatic PDF-layout model slices bar/timeline/diagram points to **four**; if that model is used directly rather than the current browser-capture path, it can additionally omit **58.75** and reduce a five-destination diagram to four drawn destinations. These two PDF paths must not be conflated.

Evidence: `worker/openai-adapter.ts:133`, `src/model/document-artifacts.ts:167`, `src/components/presentation-slide.ts:19`, and `src/model/presentation-pdf.ts:54`.

### P0: Authoritative stakeholder quotations are omitted or visibly truncated

The selected source contains four verbatim role-attributed quotations: two Product Owner quotations, one Market Researcher quotation, and one Lead Designer quotation.

- Output A preserves **4/4** in collapsed speaker notes but displays **0/4** as visible slideshow quotes.
- Output B displays the Market Researcher quote accurately, but splits the **161-character** Product Owner differentiation quote across a hero `value` field and a secondary `data` item. The hero renderer ignores `data`, leaving the visible quote truncated at **“traceable, editable”** with no visible closing quotation or remaining sentence.
- Output B omits both closing quotations—including the requested Lead Designer statement—from slide content and speaker notes; the quotations still exist in separate retained artifact Markdown that the slideshow does not display or export as speaker notes.
- The schema caps hero visual values at **120 characters** and ordinary bullet values at **160 characters**, making this exact attributed 161-character stakeholder quotation impossible to preserve as one visible supported value.

Evidence: `worker/openai-adapter.ts:125`, `worker/openai-adapter.ts:131`, and `src/components/presentation-slide.ts:19`.

### P0: Slide visuals, speaker notes, hidden Markdown, and exports disagree about the same story

Each generated artifact separately retains a slide sequence and a prose `content_markdown` narrative. Output A's **3,478-character** Markdown contains all four authored quotations, and all four also survive its slide speaker notes. Output B's **2,700-character** Markdown contains the complete Product Owner differentiator and both closing quotations, while its actual slideshow truncates or omits all three; conversely, its accurate visible Market Researcher quotation is absent from its Markdown.

Thus the same slide may identify one speaker in its rendered presentation while the separately retained Markdown contains a different role's quotation. The slide viewer does not render that Markdown, the Slides output has no Download Markdown action, and the missing quotations do not reappear in PDF or speaker notes. The information has not vanished from all storage, but it is stranded in a parallel edit-only representation and cannot be trusted to describe the slideshow the audience actually sees.

### P0: Model-generated source-like assignments are fabricated and then silently discarded

The completed actor-visible provider receipt is **21,103 characters**, including an **11,147-character** exact submitted prompt and three frozen authored source facts. It proves the prompt includes all 12 authored slide positions, all four exact stakeholder quotations, all six scores, and every navigation destination.

For output B, the model returned source-like assignments that align with the authored text blocks:

```text
slides 1–4  → decision_1
slides 5–8  → decision_2
slides 9–12 → decision_3
```

Output A instead generated the three authored block-handle strings. In both cases the prompt had supplied **zero legitimate Combined Context group IDs** and explicitly instructed the model not to invent a key when no group applied. The generated strings are therefore invalid as formal group identifiers even though they happen to mirror meaningful source-block structure.

Forma's validation records them privately as **unknown assignments**, replaces all 12 canonical assignments with empty arrays, and still reports `initial_issues=[]` with **no repair attempted and no user-facing warning**. The result is a double defect: the model fabricates formal provenance keys, and the adapter silently launders 100% invalid lineage into 100% missing lineage instead of preserving explicit block references, rejecting the output, or explaining the loss.

### P1: Identical authored inputs do not guarantee identity, style, quotes, or governance fidelity

Both successful requests used the same document, same audience, same tone, same 12-slide count, same model, and identical **2,464 input tokens**. The authored snapshot, provider input, and submitted instructions were byte-identical:

```text
source snapshot SHA-256: 9171efd2f412bc1468eb97be6451fb83931df649d0aed6d4b912cd1fec2b8473
provider input SHA-256:  e43cc66d1ad82596ef873a4ab9b516d6730bae7389f64f5fc58b47ff4c589e19
instruction SHA-256:     9157bd7410116a1c9b694c5c9d78359e012b708778bd407ed975b1c381f28ade
```

They nevertheless produced different titles, visual structures, themes, output lengths, notes, quotation preservation, and security-language coverage.

Output A uses **41 bullets / 46 visual data rows** and preserves private-job isolation, independent reviewer eligibility, privacy-safe previews, and approval/spend constraints. Output B uses **38 bullets / 39 visual data rows**, omits several of those governance details, reverses the score semantics, truncates its theme string at `amber-`, and loses two authored quotations. There is no manual style lock, protected quotation ledger, protected factual claim list, required source-coverage check, or deterministic seed control.

### P1: Live accessibility measurements fail the product's own standards

In the actual native presentation dialog, visible numeric score labels measured approximately **7.205px**, below Forma's documented 10px absolute minimum. The **List** and **Slideshow** buttons measured **36px high**, below the 44px minimum used elsewhere in the application. The truncated Product Owner quote also overflows its visible container (`scrollHeight` approximately **87px** versus an **80px** visible height).

By contrast, the same viewer's Close, download, review, and inspection buttons actually measure 44px, so this is a concrete exception rather than a claim that all controls fail.

### P1: Editable PowerPoint exports cannot match on-screen semantics or the external benchmark

The external benchmark contains **536 editable PowerPoint shapes**, all 23 slide-note source blocks, a complete 24-cell stakeholder/goal matrix, and an explicit buyer score of **56.17**. Running Forma's actual PowerPoint adapter in memory on both real artifacts produced two valid editable **12-slide / 12-speaker-note / 61-part PPTX archives**, each with exactly **72 slide textboxes**, **24 notes shapes**, and **zero Office chart, table, diagram, or image objects**. Output A's exported archive is **114,251 bytes**; output B's is **112,141 bytes**. The adapters repeat one fixed geometry and flatten diagrams, bars, and timelines into plain-text annotations instead of retaining editable visual structures.

Both native outputs have **zero `[Sources]` note blocks, zero repository/URL citations, zero source-linked slide assignments, no buyer-score 56.17, and no full 24-cell review matrix**. The selected executive source did not include the buyer score or full matrix, so their absence is expected from this particular document; the export-layout and citation-contract gaps remain genuine.

## Proposed prioritized remediation

1. **P0: truthful preflight.** Show external provider/model, exact source-transmission scope, requested versus inferred slide count, cost reserve and bounded repair exposure. Detect and block the observed **12 explicitly authored slides → 2 managed slides** mismatch unless the user intentionally accepts compression.
2. **P0: faithful outline management.** Parse explicitly numbered slide outlines within authored text blocks, preserve slide ordering, and expose a user-controlled managed slide count from 1 to 100; paginate safely while maintaining an exact continuity ledger.
3. **P1: source-grounded precision.** Add protected quotation objects containing speaker, role, exact quote, source block/line, and integrity hash; protect numeric claims, navigation labels, dates, and phase gates; validate slide-to-source coverage and require useful speaker notes/citations.
4. **P1: real editorial semantics.** Support quoted attribution cards, exact score matrices, six-device comparisons, responsive page-priority tables, phase/owner/dependency timelines, and evidence footnotes without hiding meaningful slide data on compact screens; provide measured 44px controls.
5. **P2: shared canonical scene graph.** Render HTML, accessible PDF, and editable PPTX from one layout-aware representation so diagrams, tables, timelines, cards, typography, and geometry remain meaningfully consistent across viewing and export.
6. **P2: reviewable provenance.** Bind every slide and quotation to eligible sources/revisions, show reviewer-facing coverage evidence, disclose evidence-retention expiry, and preserve principal-scoped approval/export authority.

## Verification outcome and remaining engineering follow-up

1. **Verified:** two real document jobs completed and produced durable 12-slide native Forma outputs for the intended executive document.
2. **Verified:** all 24 actual slide views, 24 speaker-note fields, visual styles, actor-private input receipts, model usage, and release controls were inspected.
3. **Verified:** both native outputs were compared against the authored 12-slide outline and the independently produced 23-slide benchmark; unsupported source content was distinguished from genuine adapter omissions.
4. **Verified:** real native Office export was executed against both artifacts entirely in memory, proving editable PPTX validity, source-note behavior, exact shape counts, and presentation-vs-export divergence without creating extra provider charges.
5. **Verified:** the event-store defect was corrected without changing existing user-authored work; the focused trigger-inclusive regression passes, and the broader event/job/provider suite passes **64/64**.
6. **Still required:** add a realistic 23-beat managed-production regression fixture that yields 23 slides across three provider pages, preserves one coherent theme, covers every authored stakeholder and roadmap phase, retains exact attributed quotations/citations, exposes an honest up-to-$3 preflight, and survives viewer/PDF/PPTX inspection without hidden critical evidence.
