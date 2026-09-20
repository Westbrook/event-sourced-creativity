# Memory guidance in Chat Studio — 2026-09-20

Status: implemented on the local Memory branch; not deployed or enrolled.

Chat Studio now offers an explicit read-only guidance mode in its existing conversation pane. It embeds the canonical Creator assistant, with one composer and no competing floating launcher. A saved Memory reference must be explicitly selected in specialist review; the separate paid consent is still required. The actual specialist prompt, bounded follow-up history and durable source retirement use the existing native consumer pipeline. Opening guidance alone does not purchase or dispatch a provider operation.

The ordinary creative draft is retained when switching modes. Guidance drafts, pending work and reviews prevent accidental dismissal. Navigation preloads the admitted view component before retiring the old view, avoiding an empty Chat route. Guidance cannot execute document proposals or creative tools. The legacy creative-edit/live-preview path does **not** yet use semantic Memory: generated edits and downstream output ancestry remain tracked in the completion matrix.

Private recalled views retire on blur, expiry and privacy boundaries. English, French, Arabic and Japanese mode labels explain the distinction. Narrow Arabic layout, native View navigation, draft restoration and escaped historical replies are browser-tested.

## Verification

- 12/12 browser journeys: saved context plus Document/Chat historical semantic results, English/Arabic, blur/expiry; synthetic network only.
- 23/23 Chat native-port journeys, including draft ownership, explicit mode change and admitted route-module loading.
- 41/41 selected integrated native runtime tests, including personal/shared Chat prompt delivery, separate consent, follow-up ancestry and source withdrawal; mock provider only.
- 77/77 additional host recall/semantic/privacy checks and 89/89 client regressions before the final route preload.
- Production build, TypeScript and changed-product lint passed. Existing build chunk warnings remain.
- Broader view suite: 33/35 pass. The two narrow-grid source expectations fail identically on an isolated HEAD archive, unrelated to Memory guidance. Two context-creation source assertions also reproduce on that baseline. Existing panel suite retains its previously reproduced 55 baseline failures. These are not claimed as passing qualification.

No migration, external service, real provider request, production deployment or user enrollment was performed. Hosted capacity and the rest of the native matrix remain open.
