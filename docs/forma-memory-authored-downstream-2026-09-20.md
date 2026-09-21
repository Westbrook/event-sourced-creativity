# Authored Memory downstream attribution — 2026-09-20

## Implemented native paths

Canonical Output context now derives non-independent Memory attribution from exact
authorized event history. Both eager and bounded streaming compilers preserve it,
including formally approved Canvas context. Browser-supplied attribution cannot
override native history. Streamed retained-state accounting includes the added
attribution set.

Legacy creative chat supplies the same negative attribution for accepted authored
blocks. Its resulting authored mutations and retained assistant history carry the
marker forward, including a later turn after the original block is removed. The
optional creative preview direction retains the attribution. This carries no
private Memory source ID, retrieval authority or disposable erasure dependency.
The shared provider compiler strips internal chat-turn/marker fields and retains
only the anonymous authorship/non-independent-evidence disclosure.

The existing taste inference path also excludes assisted saved-context facts and
later assisted chip edits. An old cached TasteModelVersioned record cannot
reintroduce those inferences; the derived view is rebuilt from available evidence.
Earlier independent human choices, direct critiques, explicit authored
preferences and retractions remain intact.

## Verification

- 176 model/provider/context/taste regressions passed.
- 2 native personal/shared journeys passed: real exact Memory edit acceptance,
  source-result withdrawal and feature shutdown, then two synthetic paid creative
  chats with durable mutation/history attribution. The second has no surviving
  assisted input block. No real provider calls.
- 56 Output/context/retained-state regressions passed, including the actual native
  Output execution source proof after Memory shutdown.
- TypeScript, changed-source/test lint and production build passed. Native runtime
  test lint retains its same 16 baseline diagnostics; no new diagnostics.
- The full native assistant/Memory suite is running separately. Do not treat this
  checkpoint as a completed full-suite result.

## Not an implicit new Memory consumer

These paths consume **deliberately retained authored work**, not newly retrieved
private profile text. No automatic creative mutation, preview purchase or output
publication of unreviewed private inference was added. They do not complete the
remaining direct semantic creative-output/live-preview integration or unrelated
resource zooms, scheduling and enrollment gates. Continue the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md).
