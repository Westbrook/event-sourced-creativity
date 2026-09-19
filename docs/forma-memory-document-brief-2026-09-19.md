# Automatic document Memory brief

Feature branch only, 2026-09-19. No migration, production deployment, enrollment,
provider call, budget change or hosted scheduling registration.

## Delivered path

The document workspace now has an automatic, read-only re-entry brief for an
already enrolled user with active recall and separately qualified purpose grants.
Rolling summaries, tentative profile patterns and suggestions remain separate
facets. It reads the latest retained result for each eligible purpose through the
existing authenticated native APIs; it never falls back to an older result when
that newest read fails. Disabled or missing consent does not fetch private bodies.

Explicit corrections appear before model notes. Corrected/suppressed lineages
cannot also appear as model claims, and a partial correction inventory blocks the
entire brief. Released controls do not recreate retired results. The card labels
unverified claims and conflicting citations, exposes quoted support/counterevidence,
and preserves the original bounded-history disclosure. English, French, Arabic
and Japanese copy and generated component documentation are included.

The brief is ephemeral and read-only. It does not write events, apply text, enroll,
call a provider, insert context into an assistant prompt or persist a local cache.
It makes no claim that viewing a note is independent preference evidence. Its
lease is bounded by every source/consent/control deadline and at most 60 seconds;
clock rollback cannot extend it. Account, authorization, route, document revision,
source ownership, custody, locale, hidden-page, pagehide, blur and disconnect
boundaries clear private presentation. Expiry clears content without polling;
focus inside expired content returns to Refresh only while the same owner remains.

## Native read-path correction

Whole HTTP integration found that shared paid originals can legitimately leave an
unrelated project index behind. The previous metadata GET used an authoring
projection reader, which synchronized custody and retired existing results.
Memory GETs now use bounded native document-identity/current-custody reads instead.
They do not hydrate the whole project, repair an index or weaken the native source
reader. Original principal, session, scope, enrollment and current lifecycle
assertions are still replayed in the response batch. Authoring/mutation paths keep
their existing authority preparation. A read-only preparation has no source-head
capability for enrolling or executing work.

## Verification

- 584 existing/new client and manual-control checks; 20 actual-component finite
  ownership/visibility/expiry/focus checks pass.
- Four personal/shared × free/paid native HTTP bundle cases pass with genuine
  three-window originals and mocked derivation responses. All five presentation
  requests are GETs and individually remain below 50 D1 calls. Events, private
  event payloads, custody indexes, result bodies and dependencies are unchanged by
  presentation. Native correction priority and recall withdrawal pass; usage and
  provider-call counts remain unchanged by reading.
- Six native final-boundary faults (document removal, session revocation, changed
  principal/custody, false proof and database swap) withhold the result inventory.
- Four synthetic whole-app browser checks pass: existing manual controls plus the
  automatic brief in English and 320-pixel Arabic. Full-viewport captures were
  visually reviewed; no overflow or executable markup was observed. Visibility
  withdrawal clears the card and denied rereads do not restore it.
- Typecheck, changed-file lint and production build pass, with existing build
  chunk warnings. The large runtime test file retains its pre-existing lint
  baseline; full native regression counts are recorded in the continuation handoff.

## Still planned, not disguised as completion

This closes automatic **document-local presentation**, not automatic assistant
prompt integration, autocomplete/accept/reject/undo provenance, cross-document or
cross-scope recall, nested scope identity, longer-term/cross-producer semantic
reconciliation, external indexing or hosted qualification. An HTTP read lease is
not durable authority for a saved answer or authored edit. Those consumers must
carry source inverses and explicit origin into their own atomic publication path.
See the [native continuation](forma-memory-native-continuation-2026-09-18.md).
