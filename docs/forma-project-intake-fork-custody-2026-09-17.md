# Ordinary intake preserves forked Document identities

An ordinary project intake creates a new Project and Document in one atomic
batch. Its historical ID collision check already rejects a prior
`DocumentCreated` with the requested Document ID. It must also reject a prior
`DocumentForked`, because both events establish the canonical Document identity.

The previous guard omitted the fork constructor. A native fork followed by
removal could therefore be reused by an otherwise valid intake with a new
Project ID. The server acknowledged the intake, and the native reducer replaced
the same Document ID's Project, title and origin while making it visible again,
without a `DocumentRestored` event. The old immutable event rows survived, but
the projected identity was replaced. This was reproduced through the actual
native handler with a synthetic same-owner SQLite fixture; it is not a claim of
cross-account access or an accidental collision in the form's UUID generator.

The repair adds `DocumentForked` to the two historical constructor predicates
inside the existing atomic root-receipt assertion. It changes no bindings,
permission checks, event grammar, provider behavior or reducer semantics.
The current batch remains excluded from its own collision check. A conflicting
historical constructor fails the existing assertion and rolls back the complete
new intake, including private envelopes and child receipts.

Exact receipt recovery remains unchanged. A legitimately committed intake can
still be checked or retried by its original identity after its Document is later
removed; returning its historical receipt does not restore that Document or
create replacement resources. The new check applies to attempted fresh
creation, at the same transaction boundary as the original collision guard.

Focused tests use actual session, event and intake handlers, real SQLite
transactions, native event privacy sidecars and the native reducer. They cover
fork identity reuse, ordinary constructor collision and valid original receipt
recovery. Network, provider and media operations are forbidden in the fixture.
No production data, schema, financial hold, policy activation or permission is
changed by qualification.

The baseline failure is retained at
`/private/tmp/forma-intake-fork-collision-20260917.log`, with its exact script and
source-hash provenance alongside it. Follow-up validation and independent review
are recorded in `/private/tmp/forma-project-intake-fork-evidence/`. This repair
does not claim to qualify unrelated intake, generation or Context transfer work.
