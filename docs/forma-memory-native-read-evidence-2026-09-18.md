# Read-only native Memory evidence

Branch-only continuation after the financial execution and recovery slices.
This is source-reader implementation, not durable semantic storage or activation.

## Implemented

- An authenticated actor can receive an internal read-only capability for their
  retained purpose job under fresh native access, recall consent, qualification,
  source membership, schema, custody and lifetime checks.
- An expired execution lease need not be renewed to read its originals. The
  reader leaves the job, attempts, lease token, lease expiry and financial ledgers
  unchanged. It rehydrates original bodies; saved metadata is not read authority.
- Read and execution capabilities are distinct and process-local. Financial
  admission and provider requests require the exact original execution capability
  paired with its source capture. A read capture for the same job cannot be
  substituted, and copied DTOs cannot recreate either capability.
- Source mutation, purpose withdrawal, missing recall consent, schema drift and
  actor mismatch fail closed. Consumers must replay the whole read proof in their
  final read/publication batch and respect its short deadline.

## Local verification

Ten new personal/shared read-evidence cases pass, including an isolated workerd/D1
reader. The targeted combined execution/provider/evidence group passes 42/42.
Typecheck and production build pass, with the existing large-chunk warnings.
The larger native derivation/tenant-erasure regression group passes 204/204
(including the ten new cases).
No actual provider request, enrollment, scheduling registration or deployment ran.

## Remaining integration

There is intentionally no public read endpoint and no semantic-result table in
this slice. The next caller must authenticate the actor before obtaining evidence,
compare the complete saved manifest/dependencies with freshly proven originals,
respect the original retention ceiling, apply durable correction/suppression
state, and include final source/access checks before returning private results.
Persisting model output or validating quotations alone cannot close that work.

See the [native continuation](forma-memory-native-continuation-2026-09-18.md) and
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
