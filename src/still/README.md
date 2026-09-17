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

Open **More → Developer console → Open**, or add `developer` to the `/still` query string. The **Decisions** button opens the design-system Drawer. Escape or Close dismisses it; **Exit developer mode** removes the flag and clears the in-memory traces.

The console shows:

- Current controls, including content selections, picker options, native media groups, disabled state, and primitive variant/size.
- The applied decision separately from the latest response. Focus preservation, changed event heads, stale positions, and format interaction can prevent a response from being applied.
- Every registered action, current eligibility, exclusions, selection limits, rubric scores, confidence, full supplied distributions, and signed ranking adjustments.
- The separate format-fit composition, creative questions sent, and event/context coverage.
- **Request & response**, collapsed by default, has a **Pass** picker. Each pass pairs its complete serialized request with its own inspected response, request identity, timing and status. Expand object and array branches to traverse every value, including questions. Branches mount only when opened; inspection makes no network calls. Selecting a different decision collapses the inspector.

Scores and probabilities refer to Jev's question rubrics, not click likelihood. Confidence describes concentration. Final ranking values include local rules and are not probabilities. Missing or invalid distributions are marked unavailable. Fallback policy values and simulated providers are labeled separately. Strong evidence and a clear lead can give an action primary emphasis; peers use secondary emphasis and weaker alternatives use smaller ghost controls. Ties, uncertain evidence and fallback suggestions receive equal emphasis. More remains available, and pointer or keyboard interaction freezes the dock until an intentional action.

Four question groups share the first Jev assessment. A conditional second pass examines fuller evidence for up to six authorized destinations, within a shared deadline and a maximum of two provider calls. Failed enrichment preserves the first assessment; failed initial assessment uses local fallback. The Drawer records skipped and failed passes, evidence, menu adjustments and presentation tiers separately.

`POST /api/still/decision` returns diagnostics only for `developer: true`. It uses the same authenticated, retained, authorized event scope as ordinary decisions. The captured state is the exact JSON sent to Jev, including bounded creative text and history summaries; it is not the full event log. It excludes transport headers and credentials. The response inspector exposes validated rubric fields, not arbitrary provider fields. A request ID and timestamp bind the snapshot to its response. Calls rejected before dispatch have no snapshot; transport failures retain the attempted state and indicate unconfirmed delivery.

The flag changes diagnostic visibility only. Traces are ephemeral, cleared on developer exit, disconnect, or workspace/access changes. Late responses from an earlier developer session are discarded. Inspecting decisions adds no creative events and never executes a recommendation. The existing endpoint cooldown still applies.

# Finding actions and reusing ideas

**More** accepts a typed request or a choice from the complete eligible action catalog. **Find** resolves a suggestion; **Open** enters its destination or review. Inferred requests never directly execute mutations or downloads.

**Use in…** selects an eligible idea and destination, then reviews the change before saving. Within a document it links the idea into the selected context or composition; across documents it creates an independent copy with its related ideas. Access stays within the current authorized workspace. Saves use canonical Forma events, preserve existing members and recover unconfirmed receipts.

# Verification

Tests: `tests/still-diagnostics.test.mjs`, `tests/still-diagnostics-api.test.mjs`, `tests/still-next-actions.test.mjs` and `tests/still-next-actions-api.test.mjs`, alongside the existing Still suite. `tests/still-context-preview.mjs` provides an isolated real-Worker preview with explicitly simulated Jev answers and no external provider network access. The separate user-data preview at port 5174 must not be reset to run these checks.
