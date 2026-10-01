# Native keyboard and browser-zoom regression checks

Current E7 membership is recorded in [E7 title and optional localized controls](#e7-title-and-optional-localized-controls).
Earlier journey summaries and numerical snapshots below retain their original
phase context; they do not define the current project membership.

## Current scheduling rules

Run types and relevant source/runtime tests before browser setup. Follow
[the validation guide](../../docs/validation.md) for current developer regression
selection. Historical full-baseline/phase sequences below document acceptance
at that time; they do not prohibit focused local regressions or require replay
of unchanged accepted journeys. Changed shared behavior still needs all affected
consumers and any explicitly required release/acceptance evidence.

Group compatible standalone configs with, for example,
`FORMA_A11Y_SYNTHETIC_NETWORK=1 FORMA_BROWSER_CONFIGS=output-footer,context-return-reading pnpm test:browser`.
This keeps one owned server for the batch, requires a matching build receipt for
`--built` fixtures, and locks that output while it is consumed. Mixed source/built
servers on one origin fail. Existing account previews retain their prerequisites;
a listening port alone never establishes safe ownership or artifact identity.

Ordinary shared-fixture tests reuse one Chromium per worker with a fresh context
per test; cookies, globals and storage stay isolated. True zoom retains a fresh
persistent profile and actual extension zoom. Default workers remain one for
shared/account lanes. Calibration-only 1/2/4-worker observations are not evidence
that every account or zoom lane can run concurrently. Keep required traces.

`pnpm test:still-toolbar:browser` runs only the browser half after matching unit
coverage; both toolbar commands now keep one identified synthetic Vite server
for their batch and retain its dependency cache. No mutable account data is shared.

Run these against the existing local Forma preview and its normal, already
onboarded local account. The suite reuses `doc-atmosphere` and its five saved
articles: four creative decisions and the existing legacy output. It does not seed/reset the database, accept onboarding terms, save a
draft, create a project, upload content, or start generation.

If dependencies, bundled Chromium and the current build/preview are already
ready, set the retained-archive inputs below and run `pnpm test:a11y`.
Otherwise, perform only the missing setup below. Rebuild after application
changes before crediting a replay to those changes.

```sh
pnpm install
pnpm exec playwright install chromium
pnpm validate:fast
pnpm build
# Keep this running in another terminal (or reuse the existing preview):
pnpm start --host 127.0.0.1 --port 4178 --strictPort
pnpm test:a11y
```

`FORMA_A11Y_BASE_URL` may select another existing loopback HTTP origin.
`FORMA_A11Y_HEADED=1` makes the separate test browser visible. No test attaches to
the user's browser, reads their profile, or copies authentication cookies.

The ordinary viewport projects cover 1280×900, 320×800, and 844×390. The separate
200% lane uses `viewport: null`, bundled Chromium, and a test-only Manifest V3
extension. It calls `chrome.tabs.setZoom` for the exact owned test tab, reads
`getZoom`/settings back, and checks the resulting layout width/height, pixel
ratio, and unscaled visual viewport against that browser's own 100% baseline.
Zoom is reapplied after navigation; a new temporary profile is removed after
every test. `Emulation.setPageScaleFactor` is pinch/visual scaling, not a
substitute for desktop layout zoom. Changing device scale factor alone is not
a substitute either.

The Document journey tests native Tab, Shift+Tab, Enter and Escape through
Review → Original request → Keep editing → Discard → Clear. The Projects
journey adds actual Space toggles, retained source/permission/recipe entries,
Back, Escape/reopen, and explicit discard. The Account test checks native
`popover`/`popovertarget` activation and focus return; inline disclosures remain
ordinary `details`/`summary`, not overlay menus. Tests assert the resulting
active control without injecting focus or scrolling it into place.
Two additional navigation journeys exercise the narrow Assistant's own focus
and hovered position as Tab reaches neighboring controls, and the short
Document rail's Expand, first navigation link, and Escape return. The native
delivery-field arrival is checked before filling it, so input helpers cannot
stand in for keyboard reveal.

The Project Contents journey opens the real new-document dialog, checks the
initial name-field focus, and traverses both Close controls and the unactivated
Create button. Close and Escape must return to the opener and discard only the
unsent name; saved documents and the route remain unchanged. Text ranges,
logical gutters, Close clearance, target sizes, and same-row footer heights
are measured in the actual modal. The four ordinary geometries are supplemented
by real Arabic at 320px and French at 200% zoom, with translated labels and
computed direction checked. No document is created. Original-operation recovery
remains unobserved by this read-only journey, not implicitly passed.

The Library sibling uses one genuine project archive retained after a separately
authorized local UI export. Export appends an `ObjectExported` audit event, so
preparation is outside this read-only suite and must never run automatically.
Reuse those exact private bytes on every subsequent run; do not commit the
archive, copy it into the checkout, fabricate one, or export again on missing
setup. Set both inputs to the retained absolute path outside the checkout and
the SHA-256 recorded independently when that authorized file was captured:

```sh
FORMA_A11Y_IMPORT_ARCHIVE="/absolute/private/path/forma-project.json" \
FORMA_A11Y_IMPORT_ARCHIVE_SHA256="<independently-recorded-64-character-sha256>" \
pnpm test:a11y
```

The test rechecks disk bytes and the browser-selected File independently. Missing
inputs fail setup, not skip. Native Tab reaches the real file input; selecting
the existing file exercises Forma's local parse only, not a server upload or
native file-picker certification. The preview's Close and unactivated Import
controls, layout, Close/Enter and Escape are measured in all six PC profiles.
Close/Enter and Escape must restore the actual native file INPUT, with its
unique direct file-button LABEL providing measured visible focus paint. One
following native Tab must reach the existing Export button without activating
it. Opener and return checks retain native-input identity and focus; no label
is falsely asserted to be active. No Import or Export is activated;
submitted-original recovery remains explicitly unobserved.

The network guard aborts all non-read application requests and external HTTP
requests except the application's exact existing Google Fonts stylesheet and
its Manrope/DM Mono font files. These allowlisted public font reads are recorded.
English and French must select the loaded Manrope typeface. Arabic must use its
actual locale, RTL direction, and the application's intentionally declared
system-font stack; it is not forced into Manrope or accepted merely for being
RTL. Computed font-policy evidence does not certify every platform glyph.
Optional engagement/performance telemetry is also
aborted, but reported separately rather than misclassified as an authoring
attempt. The one POST-shaped read exception is the existing Quick Edit
`resume` query: only its exact read-only action/body shape is admitted and
recorded. Preview, apply, dismiss and all generation actions remain blocked.
Unexpected mutations fail the test. No successful responses are
fabricated. Service workers are blocked for application pages so they cannot
bypass interception. These are read-only *user workflows*: an ordinary server
GET may still perform its established session/housekeeping work.

Results, per-transition screenshots, geometry, and traces are written under
`outputs/a11y` (git-ignored). Retries are disabled; a failure is not erased by an
automatic retry. Preserve that directory before a subsequent run when the
receipt is needed for phase review.

Read results by project: `calibration` validates the test machinery, not an
application workflow. The main projects run five journeys at four
layout/zoom settings; two additional projects check narrow and short-rail
navigation, and two check the translated Project Contents dialog and Library
preview. Inspect every failed test's details even when no geometry failure
stage is listed; an empty geometry list is not a test pass.

Per-transition PNGs use the owned test context's CDP `Page.captureScreenshot`
without a CSS-pixel clip. This avoids cropping genuinely zoomed tabs. Every
capture checks physical image dimensions against layout size and pixel ratio,
and confirms unchanged layout, zoom and native focus. CDP is used for capture,
not to imitate browser zoom or attach to the retained user browser.

The geometry observer is independently calibrated on real browser DOM. It
checks active focus, solid outline bounds, scrollport clipping, native top
layers, explicit overlay intersections and finite hit samples. Unsupported
paint/geometry is reported as unassessed, never silently accepted. In the
configured 100%/200% Chromium lanes, explicitly round client corners can be
resolved only by a conservative whole-envelope containment proof; reported
clip bounds are never enlarged. Calibration retains genuine curve clipping,
fractional padding-edge overshoot and unsupported corner/scrollbar cases.
The opt-in native file-input proxy accepts only an enabled, connected, fully
transparent file input inside its unique directly associated file-button label.
The INPUT must really be active and focus-visible; the LABEL's body, outline,
clipping and overlay evidence uses the same strict geometry engine. Calibration
rejects an inactive input, a mismatched native label owner, and a clipped label
ring. This is not a general inactive-target or proxy-focus exception.
For other,
unfocused controls, the check covers foreign-overlay obstruction, not full
paint conformance: rounded clipping is retained in the report but does not
fail when its conservative box cannot meet any known overlay. Focused controls
and critical copy keep strict geometry checks; unknown filter/transform paint
and uncertain overlap are not excused. Calibration
fixtures are not Forma acceptance evidence. Pixel contrast, screen-reader
announcements, closed shadow trees, native pickers, decorative shadows and
browser chrome still need separate coverage and periodic assistive-technology
review. This suite removes routine human keypress/zoom assistance; it does not
claim complete accessibility conformance.

Primary references: [Playwright keyboard](https://playwright.dev/docs/api/class-keyboard),
[extension testing](https://playwright.dev/docs/chrome-extensions), and
[Chrome tabs zoom](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom).

## Conditional Workspace Settings observation

The additive Settings case reuses the six existing EN/FR/AR geometry profiles;
the current full-suite snapshot is 43 tests, retaining all previous 37 cases
and all 11 calibrations. Keep the existing genuine Library archive variables
when running the full suite. Do not select only Settings or replace its real
account/organization data with a fixture.

The actual authenticated main-document bootstrap or the app’s observed account
GET, together with the successful workspaces GET and native Manage link,
determines whether one organization can be traversed. The initial-session
observer reads only the original owned navigation response or its same-navigation
GET. It does not fetch authentication, inspect storage/private Store state,
insert scripts, or attach the private HTML/session payload.
Without a readable organization,
the test result is **landing only**: every organization task is explicitly
UNOBSERVED in the E1 coverage annotation and settings-native-coverage receipt.
A green test without that receipt is not evidence of Settings task coverage.
Authorized native task links and named GET Refresh are the only activated
Settings controls. The first existing editable Members table role select is
focused and left with Tab only; no arrows, selection change or mutation.

Native field values and policy snapshots stay in browser memory. Attachments
contain only equality, ownership/field descriptors and counts, not raw private
form values, invitation URLs or provisioning tokens. Existing unsent work is
preserved and prevents departure; no draft is manufactured for coverage.

Refresh has no prescribed focus-return destination. Its original native
trigger and actual post-read focus are compared without repair. Any movement
is explicitly REVIEW REQUIRED in annotations/receipts, not a self-selected
focus pass; adjudicate it before accepting the E1 slice even if the test
completed. All expressly chosen native targets retain the existing strict
focus/ring/clipping/overlay checks, true browser zoom and whole-viewport
captures. The test is not a settings-save, popup, AT or production pass.

## Conditional native Document View disclosure

The additive View case belongs after the original E3 View18/24/25/27
baseline/runtime/replay sequence, its whole dependent-file replays, and a new
application build. It does not replace those gates. None of the preceding
43 native cases is migrated or removed. The full unfiltered snapshot becomes
49 tests: 11 calibrations, seven journeys in each of four main geometries,
four journeys in each of the existing AR/FR profiles, and the two navigation
journeys. Keep both genuine Library archive inputs for the full run.

The test enters the existing Document through its canonical public /focus
route. It does not activate the focus-mode toggle or write a storage preference.
Actual session permissions distinguish the normal authored View disclosure
from a real reader's Document plus Read/Present presentation. A reader result explicitly
records View-menu coverage as UNOBSERVED, not as a disclosure pass.

Native Tab traverses the existing Write/Shape/Present shortcuts without
activation, then opens View with Enter. All seven ordinary native view links
retain their real hrefs, translated names and current-Document marker. They
are traversed, including reverse Tab, without activating another view.
Escape must close the native panel and return to the exact trigger while
Document focus mode remains active. Reopening and selecting the already
current Document must only dismiss the panel. The native panel/trigger/link
identities, URL/history length, raw field values and five saved articles must
remain unchanged. Values stay in memory; receipts emit equality/descriptors.

The same strict focus, outline, clipping, overlay, text-range, 44px floor,
true-browser-zoom and physical-viewport capture checks are reused. An open
native popover intentionally covers its background: every chosen target
inside it remains strictly checked, but that background is not claimed
unobscured. Closed-state checks retain the existing all-visible-control overlay
check. No test-side focus or scroll repair is added. Coarse-pointer/Chat fit,
other-view navigation, modifier/new-tab behavior, AT and production remain
separate observations, not implied passes.

The R4 epilogue follows every original author stage. It reopens View, reaches
the last native view link with Tab, then presses Tab once to the existing
direct Add context button without activating it. Its exact identity, native
focus and full body/outline visibility remain strict. Compact icon-only text
is intentionally hidden, so no new visible-text requirement is imposed there.

If the real panel stays open on that outside control, Escape must close only
View: the same outside native button, focused Document, URL/history, raw fields
and five articles must remain. If native Tab already closes the panel, the
receipt explicitly marks outside-open Escape UNOBSERVED; it does not press
Escape in the closed state or claim that branch passed. Both branches preserve
custody and use actual visible-focus captures. No test, project, helper,
runtime or matrix is added beyond the same six View memberships.

## Coarse Studio Assistant and current close return

This addition runs one ordinary read-only journey in two new 320×800 projects:
English and Arabic, with the existing Chromium context's opt-in touch support.
The full unfiltered snapshot is 51: every preceding 49 case and all 11
calibrations remain. Keep the same genuine Library archive inputs; no archive
is created, re-exported, imported, or substituted by this addition.

The browser must actually report coarse primary pointer, no primary hover,
and touch support. Rendered measurements must prove a 48×48 current native
launcher, inset focus ring, clear hit samples, the logical-end Studio cell and
its gap from the original navigation scrollport. The native View trigger is
focused without opening or activating it, checking reveal after reservation.
Configuration flags alone are not evidence of those outcomes.

Native Enter opens the existing enabled Assistant and observes its actual
same-route history GET. The intended native message field receives focus;
nothing is typed, sent, selected or approved. Native reverse Tab reaches Close,
then Enter must return to the current native launcher in the same Panel owner.
A second opening followed by Escape checks the other existing close action.
Opening removes the old launcher node: the test checks the new current native
button, not an invented promise to refocus a detached original element.
Workspace title/fields/articles, route/history, and the actual unchanged
Assistant input value are compared in memory. No dirty draft is manufactured;
an empty initial value is not evidence of a dirty-draft lifecycle.

The existing network guard is unchanged. Send, Review, Accept, specialist,
generation, and other writes are never activated. The existing history GET
cannot buy work, but its server path may perform schema setup or park existing
unsigned legacy tasks; it is not universally DB-write-free. Root-owned source
and task/provider/bookend evidence must retain that qualification.

Closed-state checks retain all-visible-control overlay checks. While the
nonmodal Assistant is open, chosen native targets remain strict without
claiming the intentionally covered background is unobscured. Captures use the
same calibrated observer and whole physical viewport mechanism. This is real
Chromium rendering under emulated coarse-pointer media, not physical-device,
touch-tap, coarse 200%-zoom, all Assistant states, AT, or production coverage.

## Ordinary Library and Settings copy clearance

This additive baseline uses two new cases in each of the existing wide,
EN320, shallow, true EN200, AR320 and true FR200 profiles: twelve added
memberships. It preserves all preceding cases, helpers and eleven calibrations.
Recount the actual full matrix at integration, including any Project Contents
header, E7 or E4 additions; twelve is a delta, not a fixed final suite total.
Run the whole current suite and retain every prerequisite failure.

At the 2026-09-03 current-context preparation, committed E6a plus the pending
Project Contents header baseline contains 57 default memberships: eleven
calibrations and 46 application cases. This ordinary-copy packet yields 69:
eleven calibrations and 58 application cases. The four main profiles each
contain ten cases and the Arabic/French recovery profiles each contain seven;
the two navigation and two coarse Assistant cases remain unchanged. These
are source-derived memberships, not a test-list or passing-run receipt.
The optional isolated E5 and E6 projects remain opt-in and outside this count.
Earlier 49/51/55 totals below describe their retained packet preimages.

Settings follows the existing native name → unactivated Create → name path.
Library reuses the same independently pinned private archive, genuine local
preview, unactivated Import, Close → exact native file input → one native Tab
to unactivated Export. Neither Create, Import, Export nor Ask is activated.
The actual authenticated session/workspaces reads and public current controls
establish scope; no account, organization, field value or application state is
seeded. Normal server GET housekeeping remains outside a zero-DB-write claim.

That genuine-account premise and the earlier ordinary network description
apply only when finite synthetic transport is disabled. With the separately
qualified `FORMA_A11Y_SYNTHETIC_NETWORK=1` transport on the exclusive source
preview, the real application consumes explicit immutable personal-author
declarations. Its marked session response and fixture attachments establish
synthetic renderer/native-behavior evidence, not authentication, permission,
live account, Delivery-source or organization-task evidence. No API response
forwards to a server; public fonts/static source remain separately guarded.
The independently pinned retained archive is still required and remains
genuine; this mode does not authorize creating or exporting a replacement.
The transport and Project Contents qualification must precede this baseline.

The read-only copy observer measures only current ordinary page-header
eyebrows/headings/direct introductions, Settings landing card headings/direct
empty paragraphs, visible Library section-heading copy, and the current
Library lifecycle section's direct scope and conditional status paragraphs. It keeps native
text-node Range fragments, ancestor clips, current fixed Ask bounds, computed
fill and finite native hit order separate. A Range box is not a glyph-ink mask.
Opaque Ask with an observed top hit inside a visible fragment is sampled
obstruction evidence; uncertain paint order or unsupported geometry cannot pass.
Raw overlap without that proof also cannot silently pass. Current native
controls/critical regions are retained as a separate diagnostic inventory,
not reassigned as ordinary text or certified by this new collector.

Only the previously calibrated fractional borderless/native-no-layout-gutter
clip branch is recognized here. Border/gutter precision outside that branch,
rounded clips, transforms, filters and other unsupported paint remain explicit
UNASSESSED; there is no new epsilon, clipping relaxation or replacement of the
existing strict native-focus observer. Two observations 250ms apart and whole
physical viewport captures retain actual focus/geometry without repair.
Four originally affected profiles and wide require a visible primary target.
The shallow control may record a naturally offscreen primary as UNOBSERVED;
it still checks all actually visible ordinary fragments and never credits the
offscreen heading/paragraph as clear. Empty/style-hidden copy and ancestor
clipping cannot borrow that control-only disposition.
Library lifecycle presence and per-sample visible-fragment counts are recorded
separately. An absent or nonvisible paragraph remains UNOBSERVED, not a scope,
permission, glyph-ink or whole-paragraph clearance claim; all original copy
verdicts and complete native/custody tails remain required. These observations
are at the existing Export stage, not earlier Import-focus frames.

Field values, article content and copy custody are compared in browser memory.
Original native/label focus, 44px floors and return checks complete before the
copy verdict. Existing typography, zoom, privacy and conservative network guards
remain unchanged. Screenshots support review, not standalone certification.
This baseline is not a runtime repair, glyph/contrast/AT certification,
submitted-import recovery, organization-task pass, or whole-surface acceptance.

## Optional isolated E5 presentation-renderer probes

These four separately named fixture cases are **not genuine account or
populated-workflow coverage**. They reuse the original
`presentation-responsive.fixture.html/.mjs` two-item synthetic presentation,
actual SharedView, actual DocumentArtifacts, and actual
FormaCanvasApplication → CanvasApplication classes. No handwritten viewer
toolbar substitutes for those owners. Shared public-locale chrome, real share
tokens, permission issuance, review/export, providers, AT and production are
outside this fixture's scope.

Root must separately have the existing source development server on loopback
4180; the built genuine-app preview remains on 4178. The fixture project uses
`FORMA_E5_SOURCE_BASE_URL` (default `http://127.0.0.1:4180`); they do not replace
the original project's `FORMA_A11Y_BASE_URL`. Enable their membership explicitly:

```sh
FORMA_A11Y_ISOLATED_E5=1 pnpm test:a11y
```

At this packet's preimage the original 51-case suite contains 11 calibration
and 40 app-flow cases. The four isolated cases make 55:
Shared, Document and Canvas at French true desktop 200%, plus Canvas at English
844×390. One isolated project declares those four explicit profile rows with
test.describe/test.use geometry; there is no grep, name filter or skipped case.
Without the flag, every original project selection remains unchanged.
Use the normal complete source/finite gates before interpreting native results;
the new optional probes are not a replacement for those gates or the original 51-case suite.

The opt-in fixture declares its synthetic session/events through the real
Store's public signals before mounting. Its only synthetic successful reads are
the exact shared-projection GET, empty Document preserved-candidate GET,
and Canvas event-poll GET. All other fixture fetches reject. Known
observational telemetry is aborted without any successful
ACK. A second context-wide guard, installed before navigation, aborts and fails
every API/method bypass. No read or write reaches the account/API server; no
provider or server DB is used. Real Canvas IndexedDB/schema and localStorage
activity is allowed only within the existing fresh temporary browser profile;
this is not a claim of zero browser-local writes. The declared legacy fixture
session has no permissionEpoch, so native presence admission is not covered.

Entry and return always use the actual current native button. Canvas card
transforms and paint containment remain untouched: the unchanged observer's raw
entry/return result is attached with explicit UNASSESSED_ENTRY_GEOMETRY, never
counted as a clearance pass. Strict modal controls stop at the real :modal
boundary and retain all default overlays; Canvas Focus/Close additionally
assess the exact current sibling header. More actions are opened and traversed
without executing them, and the Shared reading toggle is exercised without
claiming reading-region glyph/fit certification. Normal/focused controls,
Escape, Close, original source, native fields, current owner and invoker, and
forbidden requests remain asserted. Layout boxes/ranges and screenshots are
separately timed diagnostics, not a same-frame or complete-paint certificate.


## E7 title and optional localized controls

After the retained E7 title appendix, the default unfiltered suite contains
**73 cases** with the isolated E5/E6 and supplemental E7 flags absent: eleven
calibrations, eleven cases in each of four main profiles, seven in each AR/FR
recovery profile, two navigation cases and two coarse Assistant cases. This is
source membership, not a passing-run receipt. All earlier E6 cases and strict
observers remain; earlier numerical snapshots above describe their own phases.

The added English title journey runs in the four existing main profiles. It
reaches the actual display Rename button, enters the current native name input,
retains unsent Unicode text, and activates Cancel. Native traversal reaches the
returned display control; no automatic Cancel focus-return promise is inferred.
It checks the full retained title, normal word wrapping, useful compact title
width, header gutters, the actual 44px Rename body and visible target, and the
existing toolbar ownership. The original title, route and five saved articles
must survive. No saved rename is submitted.

After that complete 73-case baseline/candidate cycle, the optional
`FORMA_A11Y_E7_CONTROLS=1` project adds eight memberships: two native journeys in
each of these four complementary profiles.

| Profile | Actual configured geometry |
|---|---|
| English coarse | 390×844, context touch support |
| French true 200% | `viewport: null`, 838×884 window, existing per-tab browser zoom 2 |
| Arabic coarse | 320×800, context touch support and RTL |
| Japanese | 768×900, declared Japanese font policy |

Use the already qualified source-preview finite-transport environment, including
its existing `FORMA_A11Y_SYNTHETIC_NETWORK=1`, assigned exclusive loopback
`FORMA_A11Y_BASE_URL` and independently pinned retained archive inputs. Add the
supplement flag to that environment:

```sh
FORMA_A11Y_E7_CONTROLS=1 pnpm test:a11y
```

The full unfiltered total is **81**, retaining all 73 cases. An eight-case
selection does not replace that gate. The optional isolated E5/E6 projects are
outside these totals; recount if enabling another project. The original English
title case is unchanged, and these representative profiles do not establish
every locale/width/pointer combination.

The supplementary Rename journey traverses the actual labelled input, Cancel
and unactivated Save name before canceling. It retains native form/control/label
associations, exact raw input and original title/source custody. The Clear-filter
journey selects the existing `collection-studio` / `studio-launch` through the
native project rail, retains its document membership and raw Library query,
then activates only the direct Library collection-filter Clear button. It
observes the empty → selected → cleared filter and unchanged source/view/route.
Clear removes its own button; actual post-action focus is recorded, then native
search reachability is checked. No filing, collection edit, import/export,
generation, rights or saved rename action is activated. Existing finite
transport declarations are reused without new source data or a new harness.

Both journeys retain strict native focus/ring/hit/overlay checks, including the
topbar, genuine zoom and unchanged whole-viewport captures. Complete native
button label ranges, ordinary-word fit, current supporting text size and
same-rendered-row peer heights are observed separately. These E7 owners retain
the declared 44px floor; a 48px coarse override is not declared for them. Coarse
profiles must actually report coarse primary pointer and positive touch support.
This is Chromium context evidence, not a physical-device or AT result.

The Japanese opener requires the exact source-preview `styles.css` Japanese
CSSOM rule and its computed body/`--sans`/`--forma-font-family` stack: Hiragino
Sans, Yu Gothic, Noto Sans CJK JP, ui-sans-serif, system-ui, sans-serif. It also
requires `document.fonts.ready`, loaded font-set status and a positive check for
that declared stack. This retains permitted system fallback without identifying
the installed face used for each glyph. Existing English/French loaded-Manrope
and Arabic declared-system-stack requirements remain unchanged. No contrast,
individual-glyph, backend permission, whole-surface or accessibility-conformance
claim follows from membership or a green control test.

## Still toolbar motion

`pnpm test:still-toolbar` runs the focused unit cases and real-app fixture suites
in Chromium, Firefox and WebKit. Use `pnpm test:still-toolbar chromium` for a
bounded iteration. The repository pins Playwright1.62.1; install its matching
engines with `pnpm exec playwright install chromium firefox webkit` if absent.
Use the declared Node/pnpm versions and the lockfile in CI/container runs.

The Vite fixture has an OS-temporary cache per server and synthetic page data;
all `/api` calls are intercepted. No live account, generation or retained archive
is needed. Browser tests cover final-action gating, waiting/fallback, recovery,
More/Back focus and compact midpoint, Find action dismissal, page effects,
background completion, narrow layout, interruption during opening/paging,
mid-transition resize and reduced-motion changes, and disconnect/reconnect.
Animation snapshots must remain absent from the accessibility tree while the
real controls are inert; the live tab-navigation control group is restored once.

`still-toolbar-geometry.test.mjs` verifies the compact loading circle on mobile,
including a return from actions, and samples actual opening frames at mobile and
wide widths. It checks surface and button bounds against the final native
controls and verifies that live painting begins only after snapshots retire.

The same command also runs `still-toolbar-zoom.test.mjs` when Chromium is
selected. It reuses the shared native zoom helper and test-only extension in a
fresh temporary profile with `viewport: null`. Receipts verify `getZoom() === 2`,
halved layout dimensions, doubled DPR, and visual scale 1. The cases exercise
More/Back and Find action focus, narrow overflow access, and zoom changes during
opening/paging. It uses actual browser zoom, with no CSS zoom or pinch emulation.
Run just this lane with `node --import tsx --test tests/browser/still-toolbar-zoom.test.mjs`.

`still-toolbar-keyboard.test.mjs` runs native Tab/Shift+Tab/Enter journeys in all
three engines. It checks forward/reverse toolbar order and focus indicators,
More/Back focus restoration, and both Escape and the dialog close control for
Find action. Dismissal preserves page two and does not request replacement
actions. The same journey runs with reduced motion enabled before page load;
observed construction animations must be short opacity fades. The interruption
suite separately checks enabling reduced motion during an active transition.
These are routine automated regressions, not a recurring manual checklist.

`still-toolbar-orientation.test.mjs` covers a settled four-button Projects toolbar
at landscape → portrait → landscape, after actual paging with retained pointer
focus, native keyboard focus, and no toolbar focus. Chromium/WebKit use touch;
desktop Firefox uses native mouse input because its emulated tap emits pointer
events without activating the button. It checks buttons against the toolbar
frame, preserves the current page and decision request count, and checks focus
retention or transfer to overflow. The touch fixture waits for the page change
before accepting a ready toolbar; engines may dispatch tap-generated clicks at
different points.

Playwright WebKit is not the Safari application. Native 200% zoom is automated
in Chromium only; no WebKit viewport resize or CSS scaling is reported as Safari
browser zoom. The routine 200% regression is the automated Chromium lane;
a Safari-specific zoom check is a targeted compatibility spot-check, not a
recurring substitute for that lane. Remaining manual integration checks are:

- VoiceOver on Safari and a screen reader on another supported browser: hear one
  meaningful loading/waiting/ready announcement; never hear snapshot buttons.
- Physical iPhone/iPad touch and orientation changes, including long labels.
  Controls remain visible, reachable and correctly ordered.

Record engine/OS/AT versions and observations; passing WebKit does not establish
that these physical/manual checks passed.
