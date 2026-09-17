# Still developer console

Open **More → Developer console → Go**, or add `developer` to the `/still` query string. The **Decisions** button opens the design-system Drawer. Escape or Close dismisses it; **Exit developer mode** removes the flag and clears the in-memory traces.

The console shows:

- Current controls, including content selections, picker options, native media groups, disabled state, and primitive variant/size.
- The applied decision separately from the latest response. Focus preservation, changed event heads, stale positions, and format interaction can prevent a response from being applied.
- Every registered action, current eligibility, exclusions, selection limits, rubric scores, confidence, full supplied distributions, and signed ranking adjustments.
- The separate format-fit composition, creative questions sent, and event/context coverage. No raw event text or credentials are included in diagnostics.

Scores and probabilities refer to Jev's question rubrics, not click likelihood. Confidence describes concentration. Final ranking values include local rules and are not probabilities. Missing or invalid distributions are marked unavailable. Fallback policy values and simulated providers are labeled separately. The first ordinary suggestion is currently primary by position, not by a confidence threshold.

`POST /api/still/decision` returns diagnostics only for `developer: true`. It uses the same authenticated, retained, authorized event scope as ordinary decisions. The flag changes diagnostic visibility only. Traces are ephemeral; inspecting decisions adds no creative events and never executes a recommendation. The existing endpoint cooldown still applies.

Tests: `tests/still-diagnostics.test.mjs` and `tests/still-diagnostics-api.test.mjs`, alongside the existing Still suite. `tests/still-context-preview.mjs` provides an isolated real-Worker preview with explicitly simulated Jev answers and no external provider network access. The separate user-data preview at port 5174 must not be reset to run these checks.
