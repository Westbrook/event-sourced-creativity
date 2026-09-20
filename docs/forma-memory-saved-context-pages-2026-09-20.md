# Saved assistant context and canonical document pages

Local implementation checkpoint; not deployed and no users enrolled.

## Implemented

- An explicit **Keep for assistant** control saves one private, reference-only selection per enrolled target document. Assistant Memory details revalidate and display the original candidate; Remove and Undo use current revision checks. Choosing a note does not send a prompt, alter document content, or spend allowance.
- Native reads and acceptance prove target access, source access, original result bytes and retention, exact enrollment revisions, and any cross-document boundary and hierarchy revision. Source removal, source mutation, access loss, expiry, or changed permission boundaries prevents presentation. The stored reference contains no copied candidate text.
- Metadata-only removal remains available when private content is unavailable or Memory is disabled. Target Forget and source Forget retire references with counted privacy receipts. Existing bounded maintenance removes expired/withdrawn references without reading source bodies; no schedule has been registered.
- Additive migration **0060_memory_derivation_contexts.sql**, current generated schema snapshot, strict schema profiles and guest-schema compatibility. This migration is unapplied to production.
- Canonical document views (document, board, guided, layers, adaptive, editor and chat) have actor/custody/document-scoped identities. New v2 derivation captures preserve exact native page references and distinguish the resource groups sent to the model. URLs, query strings, drafts, focus/dwell signals and private page names are not added to model inputs. Older v2 manifests retain their historical interpretation.
- Governed project viewers can record genuine document-view encounters through a native, atomic access/custody path. Other collaborators receive a restricted placeholder, not the person's activity. Stale project projection, revoked session, malformed inputs and cross-site requests cannot publish a view. Uncertain acknowledgements never cause automatic retries.
- English, French, Arabic and Japanese controls; cancellation and presentation retirement on route/actor/access/source/locale/visibility changes and expiry.

## Verification

Isolated native fixtures and synthetic local browser fixtures only. No live provider calls, hosted scheduling qualification, or production database changes. Local checks: 566 native Memory regressions; 89 migration/snapshot checks plus the dedicated migration0060 preservation check; 44 conversation/schema tests; 36 actual component boundary tests; 11 new client checks; 3 optional guest-schema isolation checks; and 8 purpose/brief/browser checks. The separate saved-context browser matrix passed all 4 cases. Typecheck, changed-file lint and production build pass (existing chunk-size warnings). The independent Progress Report retains exact logs and subsequent checks.

## Still planned

Saved reference review is **not** automatic prompt insertion, a generated semantic answer, or field autocomplete. Those consumers still need durable source-bound publication and exact target edit/undo provenance. Canonical document pages do not establish Library/Canvas-native resource identity or unsupported block histories. Longer-term semantic reconciliation, cross-owner project containment, independent original recall across reuse, immediate persisted ancestry/index retirement and full integration/privacy/request-budget qualification remain tracked in the [native continuation](forma-memory-native-continuation-2026-09-18.md#remaining-native-implementation--still-in-scope).

Provider/adapter qualification, hosted schedule registration, deployment and enrollment remain separate [operational gates](forma-memory-sites-capability-todo-2026-09-18.md#capabilities-not-available-directly-through-the-inspected-sites-tools).

## Page-consumption continuation

The private inspector now explicitly negotiates `memory-consumption-episodes-v6`.
It returns canonical document-page targets and localized per-view counts in the
existing overlapping 7/30-day windows. Older v1–v5 response shapes remain unchanged.
Counts use only the selected, certified, retained observations; they are not a
complete usage ledger, reading-time measurement, preference or independent evidence.
No extra source query, provider request, schedule, stored draft, URL or database
migration is introduced. Final native witness replay covers each page label.

Compatibility and UI checks: 692 client/control tests, 8 browser regressions,
and two additional in-view visual checks (English desktop and Arabic 320 px)
passed. Eight late-source/permission tests refuse publication. Typecheck, scoped
lint and build passed. All 575 selected native Memory regressions passed, including the actual isolated-D1 page read and its complete HTTP-request budget assertion (at most 50 operations).

## Transactional reference retirement and immediate UI clearing

Boundary changes/resets, project hierarchy revisions, source-result withdrawal,
and claim correction/suppression now delete affected saved references in the
same native transaction. Boundary and hierarchy changes preserve same-document
references and the independently retained source result. Claim controls retire
all references for their affected source enrollment and purpose. Exact schema,
inventory, direct-write and terminal-absence assertions prevent partial success;
an acknowledgement lost after commit is reported as unknown, never retried.
Removal uses metadata only and does not hydrate source bodies, charge allowance,
or require Memory to be enabled. Native authentication still applies.

The browser invalidates automatic briefs, saved-context presentation and other
open cross-scope previews when a privacy-affecting request starts. Concurrent
requests keep that barrier closed until all settle; stale reads cannot repopulate
notes. Automatic consumers then obtain fresh native proofs, while explicit
inspectors require another deliberate read. Remove also clears its own saved
notes before waiting for the response. The barrier is a UI lifetime mechanism,
not authorization, cross-device notification or a replacement for server checks.

These changes need no additional migration. Other source/access changes still
have native read-time rejection and bounded maintenance; this checkpoint does
not claim universal synchronous deletion, generated-answer provenance or field
autocomplete implementation.

Retirement verification: 594 selected native regressions passed. After the
whole-request budget correction, 29 focused native checks and one actual isolated
D1 acceptance/reset check passed. The four personal/shared and free/paid rich
history cases use 36–50 complete HTTP database operations without reducing their
admitted history. Another 322 client/component/containment checks, eight
purpose/brief browser regressions, four saved-context pending-dismissal checks,
and four cross-scope browser checks passed. Typecheck, scoped lint and build pass;
the build retains existing chunk warnings. All data was isolated and synthetic.

### Manual inspector mutation lifetime

The manual semantic inspector now hides candidate and correction text while its
purpose/claim mutation is pending. Once that request settles, both views are
cleared even for an uncertain outcome; stale content does not return when the
busy state ends. Read-only inspection and exact revision checks are unchanged.
This follow-up passes 684 existing client/control/component tests and two
English/Arabic browser cases that hold the real withdrawal request open, then
exercise confirmed and uncertain responses. Typecheck, lint and build pass.
