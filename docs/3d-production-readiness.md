# 3D production readiness

This candidate is integrated with the E5 and inactive Memory baseline at
`ef20f47cc77990e6acc1540179d95f8cdad2dc5e`. The original 3D implementation is
included directly; its obsolete development parent must not be merged. The
parallel output reliability repair is a separate change and needs an explicit
integration review if accepted main advances.

## Database release prerequisites

The new `0022_output_model3d` migration and the runtime upgrade use the same
guarded SQL statement array. It widens the Output model kind and file-size
checks while preserving table rows, rowids, SQLite value types and known
relationships. Both an upgrade and an already-current schema must pass the
guards. Unexpected declarations, attached objects, dependencies, or staged
objects stop execution before a parent table is dropped.

Before publishing, obtain actual production schema metadata for the three
rebuilt tables and four guarded children, including indexes, triggers and
incoming foreign keys. A reconstructed local schema or the Sites table-name
overview is insufficient. Review production row volume and confirm that the
hosted migration executor runs the entire array in one transaction. Local
`D1Database.batch` rollback evidence does not certify a different deployment
executor. Do not modify production to obtain a qualification result.

The exact migration identity and local historical-receipt compatibility are
documented in [local migrations](local-migrations.md). Previously published SQL
remains unchanged. The earlier unpublished 19-statement local receipt is
accepted only with its exact original identity and a successfully verified
current schema; its history is never rewritten.

## Qualification boundaries

The disposable local D1 test uses Wrangler's pinned Miniflare/workerd binding,
three isolated databases and denied Worker egress. It verifies upgrade, no-op,
large rowids and BLOB values, rejection of an unknown cascading child, and
rollback after all three parent rebuilds have completed. No real account or
production database is used.

Rodin tests use finite provider responses and no paid calls. The adapter's
request contracts, prompt limits, moderation settlement, response identity,
artifact URL policy and retry hints are independently testable from the durable
document-job recovery control plane.

The [synthetic native browser suite](../tests/model3d-native/README.md) covers
the real registered 3D components, full stylesheet cascade, keyboard controls,
PNG capture, compositor focus, output selection, and original-file reveal in
English and Arabic. Its delayed save is explicitly an in-memory fixture port.
It does not replace the existing account/archive-based native suite, durable
persistence qualification or hardware GPU testing.

All ten previously held Source, Scene and private-media test families remain
held, including equivalent behavior in other files. In particular, whole
`model3d-document-jobs`, `model3d-store-integration` and `model3d-generation-ui`
files require the owning task's scope release. Do not substitute filtered tests
or a broad test glob. Preserve the established full native account/archive
gate, its original data and unchanged visibility observer.

Build, localization, generated-component metadata, TypeScript and the explicitly
reviewed whole-file regressions must pass on the candidate. Keep immutable run
receipts with source fingerprints and failures as well as successful reruns.
The final handoff records the candidate commit, current main/production
checkpoint, completed runs and remaining release gates. Publication is a
separate action by the Site owner after those gates are satisfied.
