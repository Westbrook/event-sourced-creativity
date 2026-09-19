# Rolling descriptive document/block consumption windows

Local continuation of MEM-003. No new source collection, API, storage, provider
call, permission, migration, enrollment, schedule or production change.

## Implemented

The private v5 consumption inspector now offers a collapsed “Views over time”
section with 7- and 30-day windows. Each window shows the document navigation,
artifact viewer and block-control opening records included in the current
verified selection. Repeated openings remain observations; versions of the same
artifact or block count as one distinct resource. Source ordinals remain inside
the separate v5 map and no resource IDs or text are added to the counts.

The pure projection revalidates the strict v5 contract from a data-only snapshot,
uses exact inclusive UTC-duration boundaries, clamps to the enclosing source
window, and inherits the parent deadline. It is not cached, persisted, transmitted,
or separately fetched. Closing/retiring the parent inspector retires these counts.
Empty selection means zero included records, never no activity or complete history.

Localized disclosure in English, French, Arabic and Japanese explains that the two
windows overlap, should not be summed, and do not measure attention, comprehension,
independent uses or total activity. The source selection remains bounded and can
omit unavailable versions; counts are not inferred personal preferences.

## Verification

649 client/control tests and six synthetic-only browser checks passed. New tests
cover exact day edges, repeated openings, revision coalescing, shortened windows,
empty/incomplete selection, scope mismatch, invalid contracts, expiry, duplicate
sources, accessors, no retained mutable input and parent-lease retirement. English
1280px and Arabic 320px viewport captures were visually reviewed. Typecheck,
changed-file lint and production build passed (existing chunk-size warnings).

This completes the additional descriptive rolling inspector view, not the broader
intent-pattern or cross-scope semantic system. Remaining native and external work
stays in the [native continuation](forma-memory-native-continuation-2026-09-18.md#remaining-native-implementation--still-in-scope)
and [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
