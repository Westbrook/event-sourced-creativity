# Native relationship version bindings — 2026-09-19

Status: local feature branch; no deployment, enrollment, schedule registration or
external provider call.

## Implemented

With migrations0050 and0055 present, Creator derivation captures can certify a
native document-local relationship together with both endpoint block revisions.
Personal and governed native writers are supported. Every binding records the
observed link/unlink state, relationship kind, actor-partitioned identities,
revision hashes and all supporting event IDs. Block or relationship prose does
not become an original human quotation or an inferred preference.

Certification checks exact native public/private envelopes, explicit scope,
current relationship custody, current endpoint placement/custody, compensation,
synthetic markers and ambiguous declarations. Both endpoints must independently
resolve inside the already-authorized document. A relationship is not permission
to read another document, project, library or canvas. Unavailable or unsupported
interpretations remain explicitly unresolved while preserving the original
descriptive document action.

The relation field is versioned separately in the private manifest. Reads of
older manifests keep their original contract, without adding relationship
meaning or renewing retention. Fresh relation bindings require both lifecycle
profiles; removing either cannot downgrade an existing binding into authority.
Supporting endpoint events from before the processing window are now complete
privacy inverses. Erasure, movement or custody changes withdraw dependent
results and their queued index intents. A later ordinary property edit does not
rewrite a historical endpoint revision.

## Bounded rolling integration

The native three-window reader now captures resource evidence as one bounded
union. Each historical window retains its independent native grant/source
witness. Only the identical enrollment's document identity is shared. Private
intermediate captures are never returned before the aggregate proof succeeds;
all source statements remain in the final atomic publication proof.

This removes repeated resource/document reads and intermediate replays, not
privacy checks or history windows. Isolated authenticated inspection measured:

| Three-window case | Database calls |
| --- | ---: |
| Original-only, free | 40 |
| Original-only, paid | 43 |
| Block/relationship-rich, free | 46 |
| Block/relationship-rich, paid | 49 |

The conservative gate is strictly fewer than 50. These are synthetic native
qualification results, not hosted capacity measurements. Relation capture is
bounded to 16 relationship IDs, 64 historical relation rows and 64 KiB of native
payload bytes. Endpoint capture retains the block revision bounds. Payload size
is checked again inside the full-row query to reject late growth before hydration.

## Still open

Library/canvas resources, cross-document reuse and reference closures, nested
project ancestry, governed artifacts and automatic downstream consumers remain
native implementation work. This slice does not deliver cross-scope semantic
search, learned autocomplete or a complete lifetime profile. External vector
services, hosted scheduling qualification and actual enrollment remain separately
tracked operational boundaries.

## Verification

Native personal/governed writers, link/unlink semantics, exact endpoint versions,
older source inverses, source erasure, move/custody changes, ambiguous metadata,
capacity and isolated D1 are tested. Deferred historical read races are tested
against late original erasure and document replacement. Broader derivation
regression, typecheck, lint and build receipts are maintained in the continuation
handoff. All provider responses in publication tests are mocked.
