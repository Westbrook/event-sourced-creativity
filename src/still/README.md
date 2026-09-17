# Still deep links

Still uses path-based addresses. Every route serves the Still entry point on direct GET or HEAD requests, including refreshes:

- `/still` — projects; `/still/project/:project` — documents.
- `/still/project/:project/document/:document` — a document.
- `…/block/:block` — a selected idea; `…/results` — saved results.
- `…/result/:result` — a result; `…/result/:result/item/:number` — a slide or frame.
- `…/page/:number` — a library page; numbers start at 1.
- `…/create` or `…/create/:format` — format selection or generation review.
- `…/action/:action` — an available editing or context workflow.

Legacy `project`, `document`, and `work` query links convert to canonical paths. Developer and progress-report flags remain query parameters. Project, document, idea, and result links support opening in another tab. Back and Forward restore views; unfinished edits and requests guard navigation. Draft text and generation approvals stay out of URLs. Visiting a creation link opens review without starting generation.

The server rejects malformed routes. After loading authorized events, Still verifies the requested project/document/content relationship; unavailable content never falls back to another document. Tests cover route round trips, legacy links, ownership, pagination, and direct GET/HEAD handling through the built Worker.

# Still developer console

Open **Palette (⌘K) → Developer panel**, or add `developer` to the `/still` query string. On desktop, the panel sits beside the application and can also open in a separate live window. Close removes the flag and clears the in-memory traces.

**Open in window** moves inspection to a separate browser window while the app stays usable. It mirrors the source app's live controls, pending status, decisions and captured exchanges; it starts no data client or automatic extra Jev calls. Explicit developer experiments are relayed through the owner window. **Focus window** focuses the existing window; **Return to panel** closes it and restores panel focus. If pop-ups are blocked, the panel remains usable with a retry message. Browser preferences may open a tab instead of a window.

The window is paired to its opener by exact origin, window identity and a random session token. No snapshots are persisted or broadcast to other tabs. Refreshing the viewer requests the latest snapshot; workspace changes clear previous inspection state. Developer exit or source page closure clears and closes the viewer. A lost connection clears displayed data. Navigating the viewer away clears it before Back/Forward caching; reopen from Still to reconnect.

The console shows:

- Current controls, including content selections, picker options, native media groups, disabled state, and primitive variant/size.
- The applied decision separately from the latest response. Focus preservation, changed event heads, stale positions, and format interaction can prevent a response from being applied.
- Every registered action, current eligibility, exclusions, selection limits, rubric scores, confidence, full supplied distributions, and signed ranking adjustments.
- The separate format-fit composition, creative questions sent, and event/context coverage.
- **Request & response**, collapsed by default, has a **Pass** picker. Each pass pairs its complete serialized request with its own inspected response, request identity, timing and status. Expand object and array branches to traverse every value, including questions. Branches mount only when opened; inspection makes no network calls. Selecting a different decision collapses the inspector.

Scores and probabilities refer to Jev's question rubrics, not click likelihood. Confidence describes concentration. Final ranking values include local rules and are not probabilities. Missing or invalid distributions are marked unavailable. Fallback policy values and simulated providers are labeled separately. Strong evidence and a clear lead can give an action primary emphasis; peers use secondary emphasis and weaker alternatives use smaller ghost controls. Ties, uncertain evidence and fallback suggestions receive equal emphasis. More remains available, and pointer or keyboard interaction freezes the dock until an intentional action.

Four question groups share the first Jev assessment. A conditional second pass examines fuller evidence for up to six authorized destinations, within a shared deadline and a maximum of two provider calls. Failed enrichment preserves the first assessment; failed initial assessment uses local fallback. The panel records skipped and failed passes, evidence, menu adjustments and presentation tiers separately.

`POST /api/still/decision` returns diagnostics only for `developer: true`. It uses the same authenticated, retained, authorized event scope as ordinary decisions. The captured state is the exact JSON sent to Jev, including bounded creative text and history summaries; it is not the full event log. It excludes transport headers and credentials. The response inspector exposes validated rubric fields, not arbitrary provider fields. A request ID and timestamp bind the snapshot to its response. Calls rejected before dispatch have no snapshot; transport failures retain the attempted state and indicate unconfirmed delivery.

The flag changes diagnostic visibility only. Traces are ephemeral, cleared on developer exit, disconnect, or workspace/access changes. Late responses from an earlier developer session are discarded. Inspecting decisions adds no creative events and never executes a recommendation. The existing endpoint cooldown still applies.

# Finding actions and reusing ideas

**More** shows up to three next-ranked actions, plus **Back** and **Palette ⌘K**. Ranking comes from the same decision response, excluding the first toolbar and currently ineligible actions. Missing or zero-usefulness model scores are not promoted. **Palette** opens a design-system modal command palette; ⌘K (or Ctrl+K) toggles it from any screen, including editors. Arrow keys and Enter select an action, Escape closes it, and free-text requests can ask Jev for a step. Opening and dismissing the palette preserves drafts and focus. During IME composition, candidate-navigation and confirmation keys remain with the text input. Commands that would leave unfinished work are blocked. Inferred requests enter a destination or review and never directly execute mutations or downloads.

**Use in…** selects an eligible idea and destination, then reviews the change before saving. Within a document it links the idea into the selected context or composition; across documents it creates an independent copy with its related ideas. Access stays within the current authorized workspace. Saves use canonical Forma events, preserve existing members and recover unconfirmed receipts.

# Verification

Tests: `tests/still-console-window.test.mjs`, `tests/still-diagnostics.test.mjs`, `tests/still-diagnostics-api.test.mjs`, `tests/still-next-actions.test.mjs` and `tests/still-next-actions-api.test.mjs`, alongside the existing Still suite. `tests/still-context-preview.mjs` provides an isolated real-Worker preview with explicitly simulated Jev answers and no external provider network access. The separate user-data preview at port 5174 must not be reset to run these checks.

Toolbar emphasis compares only visible suggestions, including More. One primary is allowed when the strongest score is at least 2.4/3, confidence at least 0.70, probability mass for useful ratings (2 or 3) at least 0.80, and score lead at least 0.30. The leader can appear anywhere in the menu; order is unchanged. Missing/invalid evidence and close ties remain secondary. These are rubric judgments, not click probabilities. The console shows thresholds and each rendered control’s reason.

# Decision lab and action density

**On the page limit** previews 3–12 action controls (default 5). Project listings, document context blocks, result cards and content interactions do not spend this budget. Toolbar pagination and More/Back/Palette do. Browse pages can therefore show their full recommended action set alongside their content. The setting is local, resets when developer mode closes or becomes unavailable, and does not call Jev. The next normal decision includes it as `state.current.actionLimit`. Larger densities append eligible scored alternatives to the initial menu; the original selection policy remains visible in diagnostics.

The Decision lab explains eligibility, rubric scores, policy adjustments, initial/final selection, current emphasis and the strongest available alternative. **What did Jev know?** links to exact captured state paths and distinguishes included, empty and absent evidence. Included is not a completeness claim; coverage objects explain known omissions.

**Freeze** captures both applied/latest diagnostics and on-page controls. The app keeps running; **Live detail** below the lab remains live. Up to 20 captures stay in panel memory, cleared on document/workspace changes or panel closure. Annotate intended action, unhelpful/missing actions and expected evidence, then export JSON or Markdown notes. Full exports contain creative text and exact captured request bodies with inspected response fields; transport credentials and headers are never attached. **Metadata only** uses an allowlist of IDs, numeric scores and lifecycle metadata, omitting creative text, question instructions, scope identities and annotations. Compare captures (or a capture against live) to inspect changes in state, questions, scores, controls and density; diffs report overflow beyond 300 changed paths.

**Local emphasis replay** adjusts thresholds using captured visible actions without affecting the toolbar or making a request. **Isolated Jev experiment** copies a captured pass into editable JSON. Only Run experiment dispatches a fixed-model, authenticated, bounded request through `POST /api/still/experiment`; it neither fetches additional private content nor creates events, generations or jobs. Its inspected result and a local first-pass menu replay stay in the lab and are included in full exports. Connection enrichment is not replayed. Edited candidate descriptions never grant eligibility.

Additional checks: `tests/still-decision-lab.test.mjs`, `tests/still-experiment-api.test.mjs`, and paired-window command tests.

Still’s component palette lives in `theme.css`, scoped to the app and developer console. Semantic tokens inherit through component shadow roots and into the detached console. Primary uses dark olive with white text; secondary uses a warm neutral surface and restrained border; ghost stays transparent with a lighter border. Hover and keyboard focus use the same warm palette. Vendor tokens and Forma’s theme are unchanged.

# En Reve control preference

Use the supplied `/design-system` En Reve elements before native or locally recreated controls. Still vendors the built module closure with `scripts/vendor-still-primitives.mjs`; do not customize vendor implementations. Apply the shared Still semantic theme and public component APIs, slots and Parts.

Forms use `en-select` with `en-select-option`, `en-checkbox`, `en-search-input`, `en-number-field`, `en-text-field` and `en-textarea`. The parent select owns its value; descriptors have no selected state. Read `en-change.detail.proposed` for accepted selections/toggles and `en-input.detail.value` for editable drafts. Preserve disabled state, review boundaries, IME handling and current permission checks. Developer diagnostics inspect the public hosts and authored option descriptors.

Use `en-switch` for the proposed client-side Flags controls and `en-tooltip` for future onboarding explanations; these primitives are included in the vendor closure. This migration does not enable onboarding or make new model calls.

The current palette uses `en-dialog`, with same-root native combobox/listbox semantics for the application-owned asynchronous Jev search. The supplied `en-command-palette` currently exposes a finite local catalog and no public query-change contract; do not reach into its private shadow state to implement Jev lookup. Adopt it when its public contract supports the existing interaction. Native links, media controls and lazy disclosure trees retain their semantic behavior.

## Image provider

New Still jobs use the configured OpenAI GPT-image model (default `gpt-image-2`) for image generation and image reference edits, including image stages in rendered artifacts. Job admission saves `stillImageProvider: "openai"` server-side and applies that policy to readiness, pricing, and execution. Existing jobs without the marker retain their original provider/recovery behavior. Forma’s image default and the audio, video, and 3D providers remain independent.

## Create-page choices

The unselected `/create` page offers the top three available formats, an En Reve Menu containing the remaining formats in the same Jev order, and Back. Before Jev responds (or if it is unavailable), a stable local order keeps every format accessible without implying model confidence. Selecting a format opens the existing review and cost/consent flow; it never generates immediately. Pointer activation or keyboard focus freezes the choices so a delayed response cannot reorder a menu being used. The full `rankedFormats` response retains lower-fit and unscored eligible formats; diagnostics distinguish those from strong suggestions.
