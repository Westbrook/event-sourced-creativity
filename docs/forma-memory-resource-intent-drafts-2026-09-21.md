# Private resource intent drafts — 2026-09-21

Implemented locally, not deployed. The actual Library and Canvas activity assistant
can return up to three optional next-question drafts in the already approved
provider response. Each is a bounded plain-text question, not an action, a claim
of current intent, an endorsement or independent preference evidence.

## Native integration and privacy

The exact structured response contract is included in the retained cost/input
approval. Ordinary and profile assistant contracts are unchanged; old resource
receipts remain readable. Invalid completions do not publish; independently
verified usage is still settled without automatic provider retry. Suggestions
share the existing private result, source lineage and retirement rules.

Choosing a suggestion fills only an empty resource question field. It cannot
overwrite a draft, dispatch a request, extend the original private lease, create
an authored event or approve spending. Expiry, blur, navigation and privacy
withdrawal clear the private view. The existing separate quote/approval remains
required before submitting the chosen or edited question. Four locales are wired.

## Verification

- 43 native resource execution/accounting cases pass, including six invalid draft
  receipt variants and personal/shared Library/Canvas publication.
- 336 provider/client checks pass at final source.
- 10 actual built-app synthetic browser journeys pass in English and Arabic;
  narrow Arabic Canvas rendering inspected. Script-like text stays literal.
- TypeScript, changed-source lint and production build pass; existing build
  chunk-size warnings remain.
- The independent frozen dead68f1 runtime run completed 2,824/2,836 tests. Its
  12 failures were obsolete race-injection hooks, not executed privacy races.
  Updating those hooks to the real reserved/submitting transaction boundaries
  makes all 12 focused cases pass, with no provider dispatch after late cohort
  assignment. A full current-source rerun remains required; that frozen run is
  not represented as a full pass.

No migration, provider call, enrollment, hosted schedule or deployment occurred.
Private Output/live-preview and remaining integrated qualification remain assigned
in the [completion matrix](forma-memory-completion-matrix-2026-09-20.md).
