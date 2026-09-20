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
