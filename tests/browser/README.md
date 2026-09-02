# Native keyboard and browser-zoom regression checks

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
