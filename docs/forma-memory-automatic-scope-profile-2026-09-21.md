# Automatic native scope profiles — 2026-09-21

## Native implementation

`GET /api/memory/scope-profile` reconstructs a private, current-only profile for
an explicitly selected document. It checks native principal/custody, current
consent, each side's recall range, independent original evidence, current result
heads and user corrections. It does not accept client-supplied claims or grant
access based on a stored profile.

The bounded projection selects the target and up to two metadata-ranked peers
before loading bodies. Exact repeated interpretations require at least three
separate human originals across two documents; project-tree, partition and
organization patterns also require two projects. Owner-qualified identities and
independent permissions remain mandatory. Incomplete coverage is explicit;
paraphrases are not silently treated as identical preferences. The existing
separately approved semantic review handles those tentative relationships.

The actual Memory profile panel exposes this review in all four locales. It
shows the selected target, scope, original counts, literal evidence and scheduled
publication status. Opening it does not enroll, call a provider, author content
or initiate a write. Blur, navigation, privacy invalidation and the original
short-lived deadline clear the private view; focus does not reload it.

## Nightly reference publication

Additive local migration `0072_memory_scope_profiles` stores immutable reference
manifests and bounded-work checkpoints. A manifest contains source job hashes,
qualified scope identities and hashes of inferred text, never copies of profile
prose or quotations. Repeating the same publication does not extend retention.
Readers reconstruct and revalidate current sources; an old or restored manifest
cannot replace an unavailable current head.

The existing native scheduled callback rotates one eligible target per invocation,
after independent cleanup and qualified derivation processing. It requires the
literal scheduling/processing flags, the existing actor rollout and explicit
background-purpose enrollment. New source completions/range consent or the daily
maintenance interval make a target due. Ineligible scopes receive metadata-only
backoff so one inaccessible principal cannot starve other work. This publication
step makes no provider request and consumes no AI allowance. Model learning still
uses the separately qualified, activity-gated derivation worker.

Expiry/source retirement cleanup runs even with learning disabled. Personal
erasure joins the existing atomic privacy barrier, checks its complete actor
checkpoint census, removes personal reference metadata and preserves organization
custody. It does not erase deliberately authored outputs or financial receipts.
Missing acknowledgements remain unconfirmed; a fresh retry revalidates sources
without duplicate publication or renewed retention.

## Qualification

Local synthetic SQLite, workerd/D1 and Chromium only. No hosted scheduler was
registered, production migration applied, real user enrolled or provider called.

- Complete scheduled invocation: 24 D1 calls for personal and shared fixtures.
- Complete profile HTTP read: 25 calls; largest coalesced read batch 244 statements
  within the existing 256-statement local bound. These are local capacity
  observations, not hosted limits or hosted qualification.
- Source/range/authority changes, corrections, expiry, partial receipts, schema
  drift, lost responses and personal-versus-organization erasure are exercised.
- Cross-owner organization reads run against both SQLite and genuine local D1.
- The rebuilt English/Arabic browser suite passes 20 journeys, including narrow
  literal evidence, privacy clearing and disabled retired entries. The Arabic
  viewport was visually inspected; the panel remains internally scrollable.
- Client/migration replay checks pass; exact generated snapshot shape is retained.

Final run counts and commit identity are recorded in the continuation handoff.
The preceding full frozen runtime is tracked independently: it does not certify
this newer change. Remaining native consumers and integrated qualification stay
in the [completion matrix](forma-memory-completion-matrix-2026-09-20.md).
Hosted scheduling, external index/provider qualification and release remain in the
[capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
