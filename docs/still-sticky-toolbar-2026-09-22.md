# Still sticky toolbar

The bottom dock now participates in the flex shell with `position: sticky; bottom: 0`. The shell no longer adds measured bottom padding. The dock reserves its own height, including notifications and safe-area spacing, removing the additional 70px clearance previously added by `measureDock` on long pages.

A shared shell gutter controls the existing 48px desktop, 23px mobile and 32px Developer layout padding. The dock cancels that gutter with negative inline margins, retaining its previous full width. Fixed-position Developer offsets are removed from the stack. Main flex growth and notification height observation remain intact.

Validation: 96 Chromium layout combinations cover four widths (1440, 1024, 390 and 320), Developer layout on/off, six content shapes (empty library, long writing, nested list, image frame, video and editing form), and notifications absent/expanded. Every combination checks top/middle/end scroll positions, full dock/action width, final content clearance and no horizontal overflow. Short empty pages have no extra scrolling. Existing toolbar/density/generation/notification logic checks pass (24 tests).

The older form-toolbar and quiet-notification browser suites retain three pre-existing failing cases (four failures including the parent suite): obsolete reuse/Review cost expectations and a notification fixture missing `libraryOutputs`. The exact failures reproduce with unchanged pre-change CSS. Their assertions were not changed. The remaining five form workflow cases pass. The focused sticky-layout test passes separately, including real expanded notification controls.

This check does not claim exhaustive coverage of every browser, mobile keyboard or content state. The release preserves committed main work and the existing migration allowlist, runtime environment and audience.
