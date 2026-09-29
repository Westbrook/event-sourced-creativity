# Native block revision bindings — 2026-09-19

Status: local feature-branch implementation; not a production deployment or activation.

## Implemented

New Creator derivation captures supplement document-level actions with private,
versioned block bindings when the exact native block history is available. Both
personal and governed native event writers are covered. The binding includes an
actor-partitioned resource identity, observed revision, native event-chain hash
and complete supporting-event dependencies. No block body is sent to the
provider or presented as an original human quotation.

The bounded certifier checks native private envelopes, explicit document/project
placement, event and resource custody, compensation, duplicate declarations,
synthetic markers and current lifecycle. It measures source size before reading
bodies and repeats that bound in the body query. A late growth cannot bypass
measurement. Historical property edits do not rewrite older versions; moves,
replacement, erasure and custody changes invalidate the proof. Publication
includes the same native witness, and supporting events from before the job
window are included in immediate privacy inverses.

Missing, ambiguous, unsupported or oversized interpretations remain explicitly
unresolved. The original descriptive document action is not promoted into
block-specific evidence. Limits are 32 distinct target blocks, 256 supporting
rows and 192 KiB of native payload bytes per capture. Capture remains bounded;
this is not a lifetime reconstruction.

New manifests carry `provenance.blockBindings.version = 1`. Legacy manifests are
revalidated using their original descriptor contract; stored data is not
rewritten, their retention is not renewed, and they do not acquire block
identity by being read. No migration, external service, credentials, provider
spend, scheduling registration, consent or UI change is required for this slice.

## Exact limits and remaining work

The revision certifies native block fields, not dereferenced attachments,
structural relationships, a semantic understanding of the block or a preference.
Only explicit document-local placement is certified. Library/canvas resources,
reuse/reference edges, nested project ancestry and governed artifact evidence
remain native integration work. Saved block descriptors are never an access
grant: consumers must retain the native capture and replay its current proof.
Automatic profile, suggestion and autocomplete consumers remain separate work.

## Verification

Native API writer tests cover personal and governed custody. Synthetic native
and isolated D1 tests cover exact replay, older supporting events, erasure,
compensation, rehome, ID replacement, private custody changes, later unrelated
writes, malformed metadata and capacity. Provider responses used in publication
tests are mocked; no production or real user data is used. Exact final test
counts and build receipts are recorded in the continuation handoff.
