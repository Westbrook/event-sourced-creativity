# Dormant Audio evidence: acknowledgement and public-return boundary

This successor is limited to `worker/experience-sponsor-audio-evidence.ts`, one new focused test file, and this document. Its parent is frozen `226ef8f74aad85cee22437d63d3c46e10cbfc902`; that seven-file leaf and its prior evidence packet remain unchanged. Audio policy version 8 remains a reservation, with no activation, shared policy extension, new provider call, financial write, permission change, or publication.

## Confirmed defects and repair

The dormant evidence collector used a shared proof helper whose `Array.some` skipped missing array slots and coerced predicate values. A real final SQL batch followed by deletion of one acknowledgement still returned inert evidence from both public readers. The Audio leaf now requires the own array length, every own data slot, `success === true`, no reported error, one own result row, and own integer `current === 1`. Property getters are not evaluated. The shared helper and all SQL predicates are unchanged.

The collector checked Request/DB/source lifetime and deadline internally, but each public reader awaited that private collector and returned without another check. Three nested microtasks scheduled only after the real final SQL batch reproduce cancellation, deadline expiry, Request replacement, and DB replacement between the private reader's final guard and the public continuation. Both public readers now invoke the collector's private, synchronous captured lifetime assertion immediately after that await. The assertion performs no database read or write and is never returned in either public evidence shape. This certifies the observed return boundary, not future validity after return or atomic database-to-client delivery.

## Focused evidence

- Frozen-parent corrected replay: 10 intended failures, comprising two sparse-acknowledgement cases and eight outer-await cases (four faults through each public reader). Actual SQL executes; lifetime cases return its unchanged result. Sparse cases remove only an acknowledgement after actual execution.
- Successor: 12 focused tests pass. Besides those 10 regressions, an aggregate checks 13 malformed acknowledgement shapes (holes, inherited/accessor data, string predicate, missing/false success, error, extra row and proxy length reads); a live control preserves frozen public shapes with no lifetime function.
- Earlier finite timing calibration ran both public readers at depths 1–5. Depths 1 and 2 were already denied by the frozen inner guards; depth 3 was accepted and is the new regression boundary. Depths 4 and 5 occur after the relevant public return and are not acceptance requirements. Calibration is diagnostic, not a passing defect test.
- The first red run also included two invalid Request replacement callbacks: they tried to construct from a consumed Request and emitted uncaught harness errors. That run is preserved as history; those two cases are not evidence. The corrected replay reconstructs the replacement from URL, headers, and the synthetic command body and has no asynchronous harness errors.
- Every focused case traps provider/network, media, assets, and detached work; verifies unchanged database rows, schema and total changes after fixture setup; and verifies absent jobs, grants, slots, provider calls, reservations and sponsor schema. The fixture uses synthetic native intake/prepare data, not a live paid journey.

The previous 8 contract tests, 9 native aggregate tests, strict SQLite capacity evidence and one actual local workerd/D1 test are reused without rerunning them. This change alters no SQL, binding maxima, schema, contract bytes, native request or consent terms, or shared helper. Full TypeScript and scoped lint results, exact source pins, the corrected red and green logs, and the independent source review are recorded in the successor packet.

## Handoff

Packet: `/Users/westbrook/.codex/visualizations/2026/09/17/01a0acf8-4b13-75c0-b520-b444b077515e/audio-sponsor-boundary-successor-20260917`.

Root and the deployment owner must compose and review this successor with the original dormant leaf. This local qualification does not activate sponsored Audio, attest deployed behavior, or complete the original sponsorship integration; the original leaf's future admission/financial/finite-read seams remain separately governed. Ordinary Audio live generation remains accepted and was not repeated.
