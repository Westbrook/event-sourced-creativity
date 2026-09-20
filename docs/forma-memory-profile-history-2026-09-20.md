# Retained Memory profile history — 2026-09-20

## Implemented

The real document Memory brief now reviews up to **16 independently authorized
profile results per page**, replacing the four-result ceiling. The explicit
**Review older profile results** control continues through retained history
without accumulating private text across pages. The newest result is reread and
included for comparison on every page. Older pages disclose the intervening gap;
this is not a claim to complete lifetime coverage.

The reconciliation projection now distinguishes current, earlier-only and revised
interpretations using exact native claim identity. It retains each interpretation's
own citations, identifies cited counterevidence, and continues to disclose shared
evidence. Similar wording is not proof of equivalence or contradiction. Repeated
model output is not independent support, and a later interpretation is not an
established fact or an override of a user correction.

The controls and disclosures are localized in English, French, Arabic and
Japanese. Keyboard activation returns focus to the refreshed brief. Scope,
source ownership, authorization, locale, visibility and privacy changes retire
the old lease; navigation and privacy changes reset the history cursor. No draft,
new profile, inference, enrollment, paid request or background task is persisted.

## Privacy and bounds

- Latest-result withdrawal cannot fall back to older hypotheses.
- Every cursor belongs to the existing native inventory contract; every result
  body is independently checked by the native result endpoint.
- Two inventory pages and at most 16 result bodies per review page. The existing
  wall-clock/monotonic lease and earliest source deadline still bound display.
- Repeated cursors/results, expired bodies, cancellation and ownership changes
  fail closed. Each next page discards the preceding lease and private projection.
- Native regression fixtures check each HTTP request remains below 50 D1
  operations, and prove profile review does not write source, finance or event state.

## Verification

- 763 client, component and personal-Memory-control tests passed.
- Nine native automatic-brief integration cases passed, including an 18-result
  profile traversed over multiple review pages, original paid/shared source
  variants, correction priority, withdrawal and no-resurrection behavior.
- Four English/Arabic browser cases passed, including 320px RTL, older-profile
  navigation, keyboard focus, literal rendering of script-like source text,
  source withdrawal and visibility clearing. Two nonbehavioral paging cases
  passed again after the keyboard-scroll refinement. English desktop and Arabic
  320px page-start/end screenshots were inspected; evidence is in the lane handoff.
- TypeScript and production build passed (existing bundle-size warnings).
- Changed source/client/component/browser files lint cleanly. The native runtime
  test file reports the same 15 lint errors on HEAD before these changes. Full
  repository lint reports 229 errors; it is not represented as passing.

## Scope still to implement

This closes retained-history paging and explicit interpretation-change review,
not the complete evolving personal-profile system. Longer-term semantic
consolidation, independently supported broader-scope promotion, durable assistant
and autocomplete consumption, additional resource coverage and downstream
lifecycle integration remain native implementation in the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md). No external
service is required merely to continue that code work.

No migration, main push, production deployment, provider call or real-user
enrollment was performed by this change. Hosted services, qualification and
rollout remain separately tracked in the
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
