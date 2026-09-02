# Synthetic native 3D qualification

Run the whole separate suite from the candidate checkout:

```sh
pnpm exec playwright test --config=playwright.model3d-native.config.mjs
```

The configuration owns an unused loopback port 4181 and refuses to reuse an
existing server. It serves the current checkout with a plain Vite configuration;
the Sites and Cloudflare plugins and application Worker do not start. An already
installed matching Chromium is required. The suite uses a fresh browser context,
empty storage state, software WebGL, and the ordinary CSS system-font fallback.
It never signs in, reads an existing profile, copies user data or starts a provider.

The source-server configuration pins Vite 8.0.13 and its exact client SHA-256.
Vite's `server.ws: false` disables its server socket, while a narrowly scoped
pre-transform removes the pinned client's single tooling `transport.connect`
call. The genuine CSS insertion runtime remains intact. Version, bytes or
transformation mismatches fail startup; application code, browser WebSockets,
page errors and the strict network guard are unchanged.

The full `src/styles.css`, `src/design-system.css`, and
`src/responsive-foundation.css` cascade precedes the components' own CSS. Fixture
styles place the mount point only. No product control, focus, modal or overflow
style is replaced. The tested owners are the actual registered Model3dViewer,
ReferenceCompositionEditor and ReferenceCompositor, Workspace, and
DocumentArtifacts classes, using the actual Store with declared synthetic
session/events/content. No initialize/load/authentication path runs.

Workspace uses the source shell's structural chain:
`.app-shell.application-creative > main#main-content > forma-creative-application > forma-workspace`.
The middle custom tag is unregistered scaffolding; the fixture fails before
connecting it if the import graph registers the real application. The source
shell's posture calculation supplies `compact` at 320 x 800 and `expanded` at
1280 x 900, both with `data-short-height="false"` and workbench layout intent.
Product CSS owns the bounded main/pane sizes and bottom navigation clearance.
The original route has no `/focus` suffix, storage starts empty, and the actual
StudioModeNav keeps document focus off. No preference or html flag is forced.
The fixture does not instantiate the full account shell, its global header or
primary navigation controls. That evidence belongs to the separate account-shell
native suite; these checks cover the actual Workspace in its structural layout.

Seven whole-file cases run in both English at 1280 × 900 and Arabic at 320 × 800:
model preset/capture; Escape and Close ownership; pending save focus restoration;
layer boundary/removal peers; Workspace model context choice in both empty and
populated documents; original-file keyboard reveal; and the seven-kind output selection rail. Long authored labels
and filenames are retained in both languages. Keyboard actions use native Tab,
Enter, arrows and Escape. Test code never repairs focus, scroll, CSS or dialogs.
On opening the compositor, initial native focus must belong to the modal; native
Tab then reaches Close. No unsupported assumption is made that `showModal()`
must prefer Close over Chromium's keyboard-scrollable modal card.
The one Workspace case visits two separately declared finite surfaces. The
populated surface contains one synthetic direction block; both retain and check
the exact original Add context element through model choice and Escape. Each
surface attaches initial/final custody and network receipts before navigation;
the browser network/error guard remains cumulative across both visits.

Only `Store.saveReferenceComposition` has a synthetic application-method port.
It receives the real editor's bitmap and ownership guard, remains pending, then
applies three explicitly in-memory fixture events before resolving. This tests
the canonical-update/render timing and native dialog opener behavior. It does
not claim upload, server acknowledgment, durable persistence or provider evidence.

The fixture fetch port has no real fetch fallback. The Playwright network guard
independently permits only source/dependency GETs and three authored binary media
assets. It blocks public font imports and all undeclared requests, including
mutations, WebSockets and unexpected downloads. Forbidden attempts fail the run;
known font fallback is recorded separately. No successful write response is faked.

The application fetch port separately declares the exact empty presentation
candidate list. On the two Workspace surfaces it also declares one initial
`POST /api/workspace/quick-edit` with the exact JSON body containing only
`action: "resume"` and the synthetic project/document IDs, returning `status:
"none"`. This existing mount-time lookup reads a retained review; it is not a
preview, approval or mutation. Extra fields, operation IDs, different actions,
queries, methods and repeated requests fail the guard. One exact document GET
for Output requirements returns a complete synthetic empty snapshot; the real
Store must admit it as ready. Requirements, plans, assets, results and grants
remain absent. Each state retains this metadata with its custody attachment.
These declarations do not claim server persistence, provider readiness or a
successful write, and do not relax the independent browser network guard.

The existing `measureFormaFocusVisibility` observer is imported unchanged. Its
failures and unassessed geometry remain failures; its tolerances are unchanged.
JSON receipts and viewport screenshots are emitted for the named focus targets,
plus request/custody snapshots. These finite checks are not exhaustive paint,
glyph fitting, assistive technology, GPU, browser, production or account evidence.
They do not replace the separately governed account/archive native suite or its
held-domain boundaries. These cases do not execute Scene or document-job
dismiss/retry, policy-primary, private-media recovery, or paid generation paths.
