# Raw-text slideshow investigation

Investigated August 26, 2026. Document: [pitch context — focused blocks from scratch](http://localhost:5173/document/47f7acb3-95d1-42dd-9a89-6e4fc212414d/pitch-context-focused-blocks-from-scratch).

Implementation status: fixed and verified locally on August 26. All three affected/related documents were regenerated; all 27 new slides pass browser layout checks and source validation. Section 7 records the implementation, actual jobs, costs, and final verification. Sections 1–6 preserve the original investigation baseline and wider prevention proposals.

## Conclusion

The immediate defect is in the viewer's post-render response to overflow. Four of the nine existing slides—1, 5, 6, and 8—render a structured visual artboard, fail a small internal heading measurement, and are then replaced completely by the plain accessibility reader. This happened at a desktop slideshow viewport of 1242×405, above the automatic narrow-view thresholds. The affected artifact is not an unparsed Markdown response or a set of missing slide objects.

Two other problems compound that behavior. The adapter and renderer accept very weak visual compositions as complete, and the managed re-render attempted for this document failed because its whole-deck validation omitted the source contract that permits the deliberately repeated opening/closing promise.

The fastest correction for the existing artifact requires no new provider generation: correct heading space allocation and the live fitting/fallback policy. Better planning and repair contracts are necessary to prevent other text-heavy or degraded slides from being accepted in future.

During the initial investigation, no application code, artifacts, jobs, or source document content were changed. The development server stopped responding after that investigation was paused; the original live findings below were captured before that pause. Investigation then continued using the retained local database, repository code, and tests. The subsequent implementation and live regeneration are recorded in section 7.

## 1. What was actually created and displayed

The completed artifact is 01a03f29-7e7e-764b-bfa9-7bf5499dbd30. Its persisted content has a theme and structured slide data for every position:

| Slide | Persisted layout / visual | Rows | Automatic desktop slideshow | Failing heading section, client → scroll height |
| --- | --- | ---: | --- | --- |
| 1 | cover / hero-type | 0 | Plain reader | 224 → 234px |
| 2 | matrix / matrix | 8 | Visual slide, generic table | None |
| 3 | architecture / architecture | 7 | Visual slide, category cards | None |
| 4 | architecture / architecture | 7 | Visual slide, category cards | None |
| 5 | comparison / comparison | 4 | Plain reader | 137 → 146px |
| 6 | timeline / timeline | 4 | Plain reader | 137 → 146px |
| 7 | personas / personas | 3 | Visual slide, generic table | None |
| 8 | comparison / comparison | 7 | Plain reader | 71 → 78px |
| 9 | closing / hero-type | 0 | Visual slide | None |

On the four affected slides, the failing protected surface was the narrative section containing the heading. The artboard, body grid, aside, and measured table/timeline surfaces fit. Selecting “Slide view” restored the visual artboard. Moving to another affected slide reproduced the automatic substitution.

The reader is a distinct rendering path: it contains a heading, paragraphs, a figure caption, definition lists, source-evidence details, and speaker-note details. It removes the original artboard, palette, typography, visual composition, and slide component. The browser exposed data-slide-posture="reading" and no forma-presentation-slide inside the active viewport.

Several remaining slides are also visually weak, but that is a separate finding. Slides 2, 5, 7, and 8 use the same generic “Dimension / Value” table when displayed visually. Slides 3 and 4 are lists of category labels presented as cards. These are valid HTML/CSS visuals; counting their DOM text or absence of images alone would not establish a defect. The quality problem is whether the composition expresses the intended comparison, relationship, or audience story.

The current source document has since changed, including an added “End user” use case on slide 7. The old artifact's three personas must not be treated as evidence that the original generation lost a fourth persona without comparing its frozen source revision. The UI correctly showed that context had changed.

## 2. The exact display failure chain

1. [PresentationSlide.render](/Users/westbrook/Documents/repos/codex/src/components/presentation-slide.ts:366) normalizes the item, classifies its density, and renders the artboard.
2. The slide measures protected surfaces after an animation frame. Every surface must have positive dimensions and scroll dimensions within one pixel of client dimensions. The selector includes the narrative section itself. See [fit measurement](/Users/westbrook/Documents/repos/codex/src/components/presentation-slide.ts:154) and [protected surface selectors](/Users/westbrook/Documents/repos/codex/src/model/presentation-layout.ts:11).
3. A failed measurement emits presentation-slide-fit with contentFits=false.
4. [The deck's fit handler](/Users/westbrook/Documents/repos/codex/src/components/presentation-deck.ts:55) sets its single visual-overflow flag and requests another render.
5. [The posture policy](/Users/westbrook/Documents/repos/codex/src/model/presentation-view-posture.ts:17) defaults to reading when either the viewport is narrow/short or content overflows.
6. [The next render](/Users/westbrook/Documents/repos/codex/src/components/presentation-deck.ts:326) chooses the reader instead of the visual slide. [The reader implementation](/Users/westbrook/Documents/repos/codex/src/components/presentation-deck.ts:144) produces the raw-looking text structure.

The automatic viewport thresholds are 560×315, so the captured 1242×405 viewport was not the reason for these four transitions.

### Why the heading measurement fails

[The CSS](/Users/westbrook/Documents/repos/codex/src/styles.css:2262) centers intrinsically sized narrative sections and clips their overflow. The default heading line height is 0.98. Comfortable and compact headings retain that line height; dense headings separately use 1.35.

The logical editorial artboard has 864px of content width. The line-box arithmetic closely identifies the issue:

| Heading | Font size × line height × lines | Result |
| --- | --- | ---: |
| Cover | 57.024 × 0.98 × 4 | 223.534px, reported as 224px |
| Regular | 46.656 × 0.98 × 3 | 137.169px, reported as 137px |
| Compact | 36.288 × 0.98 × 2 | 71.124px, reported as 71px |

Those are the exact section heights recorded above. Text extents exceed the tight final line box, but the containing artboard has room. The remaining font-level distinction between glyph bounds and line-box scroll extents should be confirmed with real-font geometry during implementation. The evidence already locates the faulty allocation and the disproportionate fallback response.

Do not fix this by raising the overflow tolerance, ignoring the section, or allowing clipped text to count as success. Allocate space for the text and measure actual region/artboard capacity. Generic shrinking is also the wrong first response: shrinking an intrinsically sized section can retain the same local line-metric mismatch.

Git history places section clipping plus overflow-driven reader replacement in 07a43aa on August 25. Later changes widened the measured surfaces. Commit 8089b30 on August 26 improved dense headings and added adaptive PDF fitting, leaving the comfortable/compact heading path exposed.

### Revision and late-render traps

- [Navigation](/Users/westbrook/Documents/repos/codex/src/components/presentation-deck.ts:87) clears overflow, mounts the next visual slide, and resets an explicit “Slide view” override. The next measurement can therefore replace each affected slide again.
- [Viewport changes](/Users/westbrook/Documents/repos/codex/src/components/presentation-deck.ts:40) clear overflow and retry the visual when the measured size changes. That is another render/measure/replace cycle, not a content repair.
- Fit state is not keyed to artifact revision or content. Item replacement, artifact-key changes, footer changes, and presentation-property changes do not consistently invalidate the old result; see [index and style handling](/Users/westbrook/Documents/repos/codex/src/components/presentation-deck.ts:111).
- The first measurement need not wait for fonts. A later font-ready callback only rechecks a connected slide. Once the reader replaces that slide, the callback cannot recover it; see [font handling](/Users/westbrook/Documents/repos/codex/src/components/presentation-slide.ts:135).
- The live measurement treats an empty set of surfaces as passing because it uses Array.every. A valid rendered artboard should be required.

A repaired artifact can therefore still appear raw if the viewer retains a failed result or has already removed the component that could report recovery.

## 3. Where the adapter permits weak or degraded visuals

### Planning is not yet a slide composition contract

[ProductionScene](/Users/westbrook/Documents/repos/codex/src/model/managed-production.ts:165) has generic action, camera, image-prompt, source, and continuity fields. It does not encode a slide's supported composition, required visual relationships, content roles, or readable copy allocation. Naming information-design roles in a production team does not create those contracts.

[The slides prompt](/Users/westbrook/Documents/repos/codex/worker/openai-adapter.ts:462) explicitly requests CSS-renderable semantic data and says image_prompt is only a visual rationale. The actual artifact includes evocative rationales such as a radial map and audience vignettes, but they are not executed image plans. There is no image-generation failure here: the slides path never promises to render those rationales as assets.

### Schema validity is much weaker than visual success

[The provider schema](/Users/westbrook/Documents/repos/codex/worker/openai-adapter.ts:132) permits 24 bullets of 320 characters, visual.value up to 4,000 characters, zero data rows for every visual kind, and unconstrained body text. [Completeness checks](/Users/westbrook/Documents/repos/codex/src/model/document-artifacts.ts:379) accept any nonempty hero/metric value, or a small set of nonempty labels/values. They do not establish that a relationship was encoded, a comparison has useful axes, or text fits legibly.

[Layout planning](/Users/westbrook/Documents/repos/codex/src/model/presentation-layout.ts:135) computes useful density/overflow reasons but returns the same visible item. It does not recompose the slide, and [artifact validation](/Users/westbrook/Documents/repos/codex/src/model/document-artifacts.ts:528) does not use those layout results as acceptance criteria. In this artifact, dense classification selects slides 2 and 7, while the actual heading failure occurs on 1, 5, 6, and 8.

### Normalization can manufacture a technically valid fallback

[Normalization](/Users/westbrook/Documents/repos/codex/src/model/document-artifacts.ts:272) changes qualitative scorecards into comparisons, category filler into architecture, sparse visuals into hero type, and certain body text into a hero value. [Item normalization](/Users/westbrook/Documents/repos/codex/src/model/document-artifacts.ts:310) can clear the original body after that promotion. These can be honest repairs, but a required graphic can become accepted typography without an explicit record that the planned visual requirement was abandoned.

The original deck's repairs removed duplicate body copy from slides 5, 6, and 8; local normalization also moved copy into the hero fields on slides 1 and 9. Slide 8 changed from a qualitative scorecard to comparison. Removing redundant body copy is reasonable in isolation, but in this case it also leaves a heading-only narrative section susceptible to the line-box defect.

Read paths normalize again, including [content parsing](/Users/westbrook/Documents/repos/codex/src/model/document-artifacts.ts:617) and slide/deck rendering. Future semantic changes to a normalizer can consequently alter the displayed meaning of an already stored artifact without creating a new authored revision. Parsing and deterministic presentation should be distinguished from content-changing migration.

### Several visual types collapse to the same renderer

[Visual dispatch](/Users/westbrook/Documents/repos/codex/src/components/presentation-slide.ts:333) sends comparison, matrix, and personas to [one generic table](/Users/westbrook/Documents/repos/codex/src/components/presentation-slide.ts:254). Architecture and diagram share another renderer; timeline and roadmap share a list. Distinct names in the provider response therefore do not guarantee distinct visual expression.

The editable PowerPoint implementation already has separate comparison/persona cards, matrix grids, timeline connectors, and diagram nodes at [office-documents.ts:270](/Users/westbrook/Documents/repos/codex/src/model/office-documents.ts:270). Its visual vocabulary is useful precedent for browser templates, although its layout implementation should not be copied blindly or allowed to invent relationships absent from the source.

## 4. What happened in the actual repair and re-render attempts

Retained local job and event records establish:

| Attempt | Outcome | Provider calls | Settled cost | Evidence |
| --- | --- | ---: | ---: | --- |
| Original, manual/faithful | Completed 13:42:20 EDT | 2 | $0.153244 | Job 01a03f20-7a69-764d-b451-3744739e9bac; event 14387 |
| Subsequent managed/creative render | Failed 14:10:54 EDT | 5 | $0.272676 | Job 01a03f42-f9fc-7981-96d0-716e13b14ee5; event 14492 |

There are no artifact revisions for this document. The original completion reports 29 issues across two failed stages, then zero final issues and self_healed. The retained diagnostics concern copy/source corrections; they are not a rendered-layout or visual-quality certificate.

[The adapter](/Users/westbrook/Documents/repos/codex/worker/openai-adapter.ts:985) performs initial assessment, at most one paid repair of that request, and another assessment. [Managed production](/Users/westbrook/Documents/repos/codex/worker/managed-production.ts:530) assembles pages, reviews the whole work, regenerates affected pages once, and validates again after final normalization. None of those stages measures the browser's actual layout.

The reconciliation status “pending” is diagnostic bookkeeping, not evidence that a later artifact-fix job will run. [generation-self-healing.ts:99](/Users/westbrook/Documents/repos/codex/worker/generation-self-healing.ts:99) deliberately retains that status even after artifact repair succeeds.

### Confirmed managed re-render bug

The nine-slide managed request is generated as pages of eight and one. [Whole-work validation](/Users/westbrook/Documents/repos/codex/worker/managed-production.ts:489) calls documentArtifactValidationIssues without sourceContract, then separately runs source coverage. That bypasses the [source-authorized repetition exception](/Users/westbrook/Documents/repos/codex/src/model/document-artifacts.ts:498).

This source explicitly requires “Your content. One context. Infinite paths to your target.” at both the opening and closing. Page-local generation accepts it; whole-deck review rejects it as duplicate_deck_copy. After additional repair, the final error is duplicate_deck_copy items.8.body.

The user-reported “Slide 9 · repair attempt 5” diagnostic matches this exact retained job. The fifth response contains slide 9's body as “Your content. One context. Infinite paths to your target.” The reported 502 is assigned by [Forma's validation-error wrapper](/Users/westbrook/Documents/repos/codex/worker/managed-production.ts:221), not evidence of an upstream HTTP 502 from the provider. That wrapper also labels the failure as a provider issue, marks it retryable, and uses the total provider-response count as the displayed attempt number. It does not mean that slide 9 failed five independent repair cycles.

The error presentation should distinguish an application validation/constraint conflict from a failed provider request. Automatically suggesting another paid retry for a deterministic validator inconsistency can repeat the same failure. Preserve the authored promise, correct the validation context, and reassess the retained candidates first.

A read-only replay using all five retained provider responses and a stubbed fetch reproduced the exact terminal failure. Joining the accepted first page with the final corrected closing page produced one issue under generic validation and zero issues when the same output was validated with the full source contract and protected-content/source-grounding options. This is a validation-context inconsistency, not a reason to request more model creativity.

There is a related page-scoping flaw: the closing page's rebuilt outline contains only slide 9. [Placement inference](/Users/westbrook/Documents/repos/codex/src/model/presentation-source.ts:667) can call it the opening, and [repair](/Users/westbrook/Documents/repos/codex/src/model/presentation-source.ts:863) / [validation](/Users/westbrook/Documents/repos/codex/src/model/presentation-source.ts:986) subtract the global offset from an already local array index. The resulting negative index skips the protected message. An in-memory missing-promise test passed with that scoped contract but failed correctly with the full contract. This is separate from the terminal duplicate error, and requires stable global positions/roles through paging.

The replay did not certify the complete compiled-snapshot hash or all independently merged standing constraints. Therefore it demonstrates the bug and a recovery opportunity, not authorization to promote the candidates. Actual recovery must perform every existing integrity and custody check.

### Why editing or recovery is not currently an easy escape

[The edit API](/Users/westbrook/Documents/repos/codex/worker/artifact-api.ts:203) accepts title, body, and notes, not structured layout/visual/data changes. It validates edits using the same structural rules. A heading/body edit can also create new overflow without a new render-fit receipt.

Five paid response candidates remain saved for the failed managed request, but [current no-spend recovery](/Users/westbrook/Documents/repos/codex/worker/document-jobs-api.ts:697) only accepts single-page candidates. A validated multi-page assembly path is needed before this 8+1 result can be recovered without another paid call.

## 5. Prioritized prevention paths

### P0 — Repair display of the existing deck without generation

Correct heading line boxes/space allocation for the actual font and script. Then separate three states: a deliberate reader preference, a viewport too small for readable slide delivery, and a layout failure. A desktop layout failure must not silently replace a supposedly successful slide with text.

Keep an explicit accessible reader. While layout is being repaired, retain a measurable visual surface and report its status; do not regard switching to the reader as successful slide rendering. A “Slide view” workaround is currently only temporary because navigation resets it.

Unify local and shared-view behavior. [The shared viewer](/Users/westbrook/Documents/repos/codex/src/components/forma-shared-view.ts:91) currently reacts to overflow only when the viewport is also narrow, so it can show artwork that the owner view replaces. Simply copying that policy would preserve the artboard but could still leave clipped text; it is not a complete fix.

### P0 — Add a bounded local fitting pass before fallback

Use a shared render-fit service for live slides, verification, and export:

1. Render the audience projection on the canonical 960×540 artboard; wait for fonts/assets and stable nonzero layout.
2. Check text allocation, actual clipping, and effective type size. Report which surface failed and why, rather than only a boolean.
3. Try a bounded sequence of trusted alternatives: corrected line boxes, spacing/region reflow, suitable density, and a semantically equivalent composition variant.
4. Remeasure after each pass. Stop when the slide fits at readable sizes, or retain a reviewable candidate with a specific unresolved issue.

[PDF export already has part of this mechanism](/Users/westbrook/Documents/repos/codex/src/components/presentation-pdf-export.ts:485), but its zoom floor can reach 0.3. Do not reuse that unmodified: fitting at 30% can violate the declared 14px body/12px label minimums. “No overflow” and “readable” are different checks.

Key each measurement by artifact/slide identity, content hash/revision, renderer/layout version, style, locale, font signature, and footer settings. Ignore detached or superseded callbacks. Invalidate results on edits, restores, source refreshes, late font loads, and presentation changes. Preserve explicit reader preference separately.

### P1 — Make managed repair use one source contract

Pass the existing full presentationSources contract into wholeWorkIssues with source-grounding and complete protected-content checks; remove redundant or conflicting parallel checks. Carry global positions and opening/closing roles through page scoping. Repair prompts and prior-copy exclusions must preserve explicitly authorized repetition.

Then support authenticated, no-spend reassessment and assembly of retained page candidates. Check all response IDs, hashes, page coverage, source revision, custody, expiration, theme continuity, and final visual fit. Preserve the original successful artifact; recovered or corrected content must follow the normal audited artifact/revision path.

### P1 — Introduce a typed slide plan and visual acceptance contract

Plan each slide with its source position, audience claim, role, supported template/visual type, required categories/relationships, protected visible text, public attribution, and flexible editorial budget. Use a discriminated visual schema with kind-specific requirements instead of one unconstrained label/value/data shape.

Do not require an image on every slide or reject purposeful typography, quotations, or real tables. Require the visual to fulfill the planned job. A persona slide should not pass merely because three prose rows can be emitted under a personas enum; a diagram should not pass merely because the title and body were relabeled as two nodes. Source-backed category-only diagrams and repeated factual status values must remain valid.

Treat image_prompt consistently: rename it to visual_rationale for semantic-only slides, or add an explicit, authorized asset-production stage with owned media references. A prose image rationale is not proof that an illustration was made.

Record material normalization changes with input/output kind, moved/removed fields, reason, version, and source-preservation checks. Downgrading a required graphic to hero text should become a review issue. Keep read-time parsing non-destructive; make material migrations explicit and versioned.

### P1 — Separate local reflow, semantic revision, and paid regeneration

Route issues to the least expensive appropriate remedy. CSS/geometry defects go to deterministic rendering. Missing visual structure goes to template recomposition or a source-aware slide revision. A genuinely inadequate plan can trigger bounded affected-slide/page regeneration within the existing authorized call/spend ceiling.

Freeze unaffected slides and source assignments. After every repair, reassemble and check the complete deck for order, theme, protected messages, source coverage, deliberate repetition, continuity, and visual fit. Run these checks again after any final normalization/fix-up pass. Page repair must not leave a closing page based on stale preceding content.

Extend the structured edit API deliberately, preserving optimistic concurrency, immutable revision hashes, source authorization, and review invalidation. Keep derived render-only changes distinct from edits to canonical authored content.

### P2 — Make acceptance and telemetry describe the actual result

Track source validity, visual-plan validity, render fit, effective readability, display posture/reason, and repair attempts separately. [Current formatCraft scoring](/Users/westbrook/Documents/repos/codex/src/model/production-evidence.ts:211) can award success based solely on structural validation. It should not imply visual inspection.

Record safe issue codes, dimensions, counts, and version identifiers; do not put private source prose, screenshots, or prompts into general telemetry. Client measurements are diagnostic and must not independently authorize release or bypass source/review checks.

## 6. Guardrails and acceptance tests

The source requires nine slides in authored order. No fitting pass may silently split, add an appendix, renumber, omit a category, move required visible quotations/promises into notes, or invent measurements/relationships. Distinguish protected delivery from compressible editorial prose and private provenance. If those constraints cannot fit legibly, retain the candidate and request a specific constraint change.

Extend existing tests rather than adding a parallel quality system:

- Real-browser responsive fixtures: reproduce the four heading-only failures; assert all nine visual slides remain after fonts settle, with visible glyphs and readable type. Cover comfortable/compact/dense styles, all presets, custom fonts, supported scripts, and genuinely overloaded content.
- Viewer lifecycle: same-index edit after fallback, artifact replacement, style/footer/locale changes, late font loading, rapid navigation, resize/fullscreen, superseded measurement callbacks, and deliberate reader preference. Assert the final displayed component, not only a posture boolean.
- Provider/normalization: required graphic downgraded to hero, fake title/body diagram, valid category-only architecture, legitimate title/quotation slide, repeated zero/status values, material-transform provenance, and idempotence.
- Managed production: the actual nine-slide 8+1 opening/closing promise; missing protected text on page two; affected-page repair preserving unaffected hashes and whole-deck continuity; strict budget/attempt accounting.
- Revision/recovery: structured visual edits, overflow introduced by an edit, stale render receipts, restored old revisions, expired/private source receipts, and safe multi-page candidate recovery.
- Surface parity: local/shared/PDF/PPTX preserve the same audience content and visual purpose. A successful export must not conceal a broken live viewer.

Verification performed during investigation: 96 targeted artifact, slide, layout, posture, and PDF-capture tests passed in the primary investigation; a separate managed/provider replay suite passed 132 tests. These totals overlap and must not be added. Existing tests explicitly expect overflow-triggered reading mode and generic comparison/persona tables. Their success shows a missing acceptance condition, not that the reported behavior is correct.

Recommended acceptance rule: every authored slide preserves its source obligations, fulfills its planned presentation role, and renders legibly. Reading mode remains an accessible option, but cannot mask failed visual delivery.

## 7. Implemented fixes and final verification

The user authorized implementation, regeneration of this deck and related affected decks, and reuse of the configured provider key. The existing application consent, source-access, reservation, call-count, and spending gates were retained. Originals and source documents were not overwritten or deleted. Changes are running in the local development app; no remote deployment or share publication was performed.

### Generation, repair, and recovery

- Adapter version is `2026-08-26-source-aware-render-v4`. Managed pages carry global authored slide numbers without transmitting other pages' private source prose. The final page is correctly recognized as the closing page, including when it contains only slide 9. Gapped authored numbering is resolved by global position, with a numbered-position fallback for older page contracts.
- Page assessment, whole-work review, production evidence, and final normalization consistently use the applicable source contract. The exact authored opening/closing promise survives the late deduplication pass. Its explicit source requirement takes precedence over generic prior-copy exclusions; unrelated repeated copy remains invalid.
- Paid saved-draft and cached/recovered-plan paths revalidate against authorized source context. Invalid retained plans fail closed without silently initiating another paid provider submission. Citation source/anchor/excerpt checks remain active for legacy page-scoped contracts.
- Protected quotations delivered inside structured data rows must still appear completely, with attribution, in readable Markdown and speaker notes. A wholly missing quote retains its targeted source issue instead of unnecessarily turning a single-page repair into deck-wide Markdown repair.
- Exhausted slide-content validation is no longer represented as a retryable upstream HTTP 502. It remains an explicit, nonretryable validation failure with an edit-request action; actual provider transport failures retain their own diagnostics.

### Render and viewer lifecycle

- Comfortable and compact headings now allocate a 1.35 line height for the production font; large hero type uses 1.2. Headings and hero type honor the chosen slide font. The positive-size and one-pixel clipping checks were not weakened.
- Fit measurements carry an opaque render key covering content, layout version, presentation/style/font, slide position/count, footer, compactness, and locale. Superseded animation frames and font callbacks cannot publish stale fit results. Edits, style changes, late fonts, disconnection, and remounting trigger fresh measurements.
- The renderer tries at most two density reflows, without dropping authored rows, truncating quotations, adding slides, or arbitrarily zooming text. Hidden/unrendered artboards remain pending; collapsed required content surfaces count as real failures.
- Desktop overflow does not silently replace the visual artboard with raw-looking reader text. Unresolved overflow remains visible with a localized warning and an explicit reading option. Narrow-view accessibility behavior remains available, and deliberate Read/Slide choices persist through navigation in both local and shared viewers.
- Layout version 2 adds a bounded full-width architecture/diagram arrangement for dense multi-row evidence with a short narrative. Live regeneration exposed an eight-category file-format diagram that required this extra iteration: the half-width region measured 420px high with 488px of content; the full-width arrangement fits all eight categories within approximately 317px. No content was removed.

### Actual regenerated outputs

| Document | New output | Mode | Job | New artifact | Calls | Settled cost |
| --- | --- | --- | --- | --- | ---: | ---: |
| [pitch context — focused blocks from scratch](http://localhost:5173/document/47f7acb3-95d1-42dd-9a89-6e4fc212414d/pitch-context-focused-blocks-from-scratch) | Take 2 · 9 slides | Managed / creative | `01a03f79-07ec-72c3-8094-1c0b8cf63384` | `01a03f79-6cc0-7c48-b41e-d340026acb3f` | 3 | $0.214930 |
| [pitch context](http://localhost:5173/document/4e9b1eec-a4c2-473c-bb54-4b4b237d9b71/pitch-context) | Take 3 · 9 slides | Manual / faithful | `01a03f7f-18d0-7a92-adf2-cadd6bf41401` | `01a03f7f-24bd-79c1-b81f-ab8a0cacb5fa` | 2 | $0.135528 |
| [pitch context — decomposed comparison](http://localhost:5173/document/2d086215-0b54-4ec3-b314-355dac99b019/pitch-context-decomposed-comparison) | Take 2 · 9 slides | Manual / faithful | `01a03f7f-233a-710a-b40b-b74174f3cf52` | `01a03f80-0d9c-76bd-9b92-b1bf30e39a2b` | 2 | $0.147372 |

All three jobs completed. Total new provider usage was **$0.497830 across seven calls**. The managed deck needed one bounded page-local correction and no additional whole-work repair; its final whole-work issues are empty. These charges exclude the earlier historical failed job.

### Verification results

- Visited every slide of each new output in the actual browser viewer, after production fonts loaded: **27/27 fit, 27/27 visual posture, zero failing protected surfaces**. Checked the generated Editorial and Nocturne treatments and inspected screenshots of dense compositions. All three decks visibly retain the exact promise on both slides 1 and 9.
- Rechecked the existing primary artifact under the corrected renderer: **9/9 fit and remain visual**, without changing that stored artifact or requiring a provider call.
- Loaded all three new saved artifacts and their own frozen source snapshots read-only. The final validator reports zero issues with complete source grounding, Combined Context assignment, and protected-content checks. Running final source-aware normalization again also yields zero issues for all three.
- Exercised real browser lifecycle fixtures: genuine overflow stays visual with a warning; restoring the same slide clears the warning and resets density; late font completion produces a new fit receipt; remount followed by narrowing enters reading mode; explicit Slide view survives navigation at that narrow width; explicit Read mode survives navigation. Shared-view Read/Slide navigation was also checked.
- Added targeted regressions for isolated ninth-slide recovery, first-page false-closing rejection, bounded late whole-work repair, source-authorized repetition after normalization, invalid paid-draft recovery without resubmission, legacy citation validation, non-contiguous authored numbering, quote-in-data-row preservation, stale measurement callbacks, font/remount lifecycle, and dense full-width diagrams.
- Final `pnpm test`: production build and localization audit passed; **1,564 tests passed, zero failures**. `pnpm typecheck`, `pnpm lint`, and `git diff --check` passed.

The wider typed-template/editor redesign and multi-page legacy-candidate assembly proposed in section 5 remain future enhancements, not claims of this fix. Browser fit checks do not certify every possible future provider composition or replace human editorial review. Genuine unresolved layouts remain explicitly diagnosed rather than being mislabeled as a successful visual delivery.
