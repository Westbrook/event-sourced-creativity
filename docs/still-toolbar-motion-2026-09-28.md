# Still toolbar motion adoption

Implementation branch: `codex/still-toolbar-motion`, based on `25a7a722`.
Selected designs: Cushion shell, Infusion loading, Thread action construction.
The isolated study remains separate. This change does not deploy the app or
activate a new background execution service.

## Delivery contract

Page content renders as soon as available. A toolbar request owns only its
controls and visual timing. The app retains real Lit / En Rêve controls in place;
Thread animates inert, hidden-from-AT snapshots, then hands interaction back to
the real controls after construction settles. These snapshots never execute an
action, submit a form or acquire focus.

- Loading: right 900 ms ease-out; right edge 350 ms; left 750 ms ease-in;
  between cycles 1000 ms. Final actions are sampled at the left endpoint, then
  opening follows after 250 ms. An arrival after that checkpoint waits for the
  next complete gesture, including the full intervening rest.
- Three compact cycles alternate with two `still. waiting…` cycles. Waiting
  expands for 450 ms immediately after the third left; its first right starts
  after expansion. Waiting swipes take 1125 / 937.5 ms. The second left returns
  to compact Loading. The `s` and period remain shared geometry; `till` has a
  10 px feathered reveal.
- Recovery opens only from compact Loading. A failure received during the first
  expanded waiting cycle waits through its second left and the 250 ms pause.
- Jev failure selects local policy. A pending Jev request expires at the 13th
  left checkpoint: 3 loading, 2 waiting, 3 loading, 2 waiting, 3 loading.
  That is 38,550 ms of visible loading time; opening begins 250 ms later.
  The completed close precedes this clock. Pending context still has to finish.
- Initial streamed rankings are not final actions. The delivered set is stable
  until the next meaningful action or current-page generation completion. No
  automatic Jev retry or late response replaces it. Old pending computations
  are detached from the decision cache on cancellation.
- Empty suggestions use permitted `View projects`, or `New project` on Projects.
- Every page-affecting action closes to Loading, including unchanged action sets.
  Browser Back/Forward starts a new destination lifecycle. Find action opening
  and dismissal preserve page two; choosing an action starts its own lifecycle.
- More/Back use left wash while contracting, reach a circle between pages, then
  reconstruct with a right wash. Default opening is 1351.2 ms with a 633.6 ms
  wash; closing is 1040 ms with a 528 ms wash; paging is 1348 ms. Travel wider
  than 640 px scales smoothly to 1.2× at 960 px.
- Reduced motion uses brief fades while retaining readiness checkpoints. Hidden
  time pauses both the logical loading clock and active Web Animations. Resize
  during construction settles safely to the real responsive controls.
- Accepted generation is not tied to this animation controller or the current
  page. Existing job execution and cross-document observation remain in charge.
  Active generation does not hold the toolbar in Loading. A completion relevant
  to the current page starts a fresh action lifecycle, while content is visible.
  Editing workflows are not interrupted by unrelated completion notifications.

## Implementation boundaries

`src/still/motion/coordinator.ts` owns the visual lifecycle and focus handoff.
`thread.js`, `loading.js` and `request-rhythm.js` are the selected study algorithms,
scoped to the production theme. `StillApp` supplies context/decision readiness,
request cancellation and page-effect triggers. Workflow components expose pending
and recovery flags; operation handlers, consent, unconfirmed-write checks and
provider submission rules remain their existing source of truth.

The first relevant job read and selected writing hydration gate toolbar readiness,
not page rendering. Explicit save/request checks retain their existing behavior;
an animation never retries a mutation. Recovery labels name the failed read or
research operation and return destination where those are known.

## Local review

Run `node scripts/preview-still-toolbar-motion.mjs` from the implementation
checkout. It serves the actual Still app with finite fictional data at
`http://127.0.0.1:4331/still/project/p/document/d?progress-report`.
Add `&motion-scenario=long-wait` to observe waiting before the fixture releases
its result. API writes and provider endpoints return a synthetic-review error.
This preview is test infrastructure and is excluded from production entrypoints.
The original study remains on port 4319; the independent Progress Report is 4187.

## Verification

- `tests/still-toolbar-rhythm.test.mjs`: exact checkpoints, easing, waiting morph
  timing, recovery boundary, cancellation, hidden time and late-frame admission.
- `tests/browser/still-toolbar-motion.test.mjs`: real app content timing, narrow
  midpoint, More/Back keyboard focus, Find dismissal, stale responses, history,
  full timeout, background completion and reduced-motion responsive fit.
- `tests/still-decision-cache.test.mjs`: cancellation cannot poison fresh work or
  discard valid completed cache entries.
- Existing Still workflow, output configuration, tooltip and recovery suites.

Physical Safari/iOS and screen-reader listening have not been claimed by these
Chromium checks. Production activation and user acceptance are separate from the
implementation and local test results.

### Verification receipt

Final production build and TypeScript check passed. Lint for every changed
source, fixture and test file passed. Chromium 151.0.7922.34 (Playwright 1.62.1)
passed all 11 production-integration checks. The 25 focused motion, timing and
transport checks passed. Desktop, Waiting and 390 px mobile screenshots were
visually inspected; the mobile page had no horizontal overflow.

The Still unit run passed 437 of 438 tests. Its only failure,
`still-refresh-repair.test.mjs`'s reducer-event inventory assertion, also fails on
the unchanged base checkout. The later added Thread timing case passes separately.
The existing output-configuration and tooltip browser suites pass after resolving
Lit through Vite's module entry (portable across linked worktrees). Existing form
fixtures retain two failures also observed on the unchanged base: the Use idea /
Copy idea label expectation and the missing Review cost expectation. The service
recovery fixture's resize-observer expectation also fails on the unchanged base.
Save-recovery passes.

Repository-wide lint reports errors outside the changed files. The full test
script rebuilt successfully but encountered numerous failures in other application
areas; that broad run was stopped and is **not** a passing full-suite receipt.
These unrelated failures have not been hidden or repaired as part of toolbar work.
No live account, provider execution, migration, deployment or merge was performed.
