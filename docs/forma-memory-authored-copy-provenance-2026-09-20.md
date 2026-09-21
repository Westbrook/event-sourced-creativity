# Memory attribution through native authored copies

Approved context reuse and document duplication now preserve the non-destructive
`memory_authored_version: 1` marker on newly authored copied blocks. They derive
that marker from the authorized source block's canonical event IDs, never from
mutable block properties or an unverified pointer. Repeated copies retain it.

The exact marker is included before hashing the human-review plan. Applying an
older unmarked plan against a now-marked source fails as a stale preview; an
approval is never silently repaired. Existing native source/custody/permission
proofs and atomic authoring receipts remain the publication authority.

Only negative attribution is copied. No private Memory body, turn/execution ID,
read capability or erasure dependency is added. Deliberately copied authored text
remains after the originating private Memory is withdrawn. The destination must
still be independently authorized by the ordinary authoring path.

Assistant context recognizes marked creation events after reload and in later
copies. Observation normalization and the native palette-profile reader also
exclude explicitly marked authored events from independent preference evidence.
This does not claim access to an inaccessible original or close original-source
semantic recall across reuse relationships.

## Verification

- 48 model/context/observation checks pass, including repeated approved context
  copies and refusal to infer authority from an unknown source or mutable marker.
- 57 native document-duplication API checks pass, including the actual new
  personal/shared/collaborator preview-and-commit paths, capacity, proof races,
  source drift, access denial and uncertain receipt recovery.
- 10 native context-approval/future-prompt regression checks pass.
- TypeScript and changed-source lint pass. Build verification is recorded with
  the commit checkpoint; no deployment, provider request or enrollment.

Broader work stays in the [completion matrix](forma-memory-completion-matrix-2026-09-20.md).
