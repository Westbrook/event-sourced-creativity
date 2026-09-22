# Production storage-readiness follow-up

The first generation-recovery release did not restore live readiness. Its source-level isolated-schema tests passed, but the production bundle failed before the content query. The affected document does not need a format migration.

Bounded administrator diagnostics in Production524 reported a TypeError at the isolated Memory boundary. The compiled dynamic import resolved to the Worker entry (`../index.js`), which exposed only its default export. `readIsolatedMemoryContentBoundary` was consequently undefined. A new test importing the actual compiled Worker reproduced the same failure.

Use a static dependency for the isolation witness so the bundler retains and links the function. This changes module linkage only: exact catalog qualification, all 40 empty Memory tables and their barriers, receipt validation, statement-time witnesses, and database identity fences remain intact. No database repair or user-document mutation is part of this follow-up.

Earlier follow-up commits also added bounded administrator diagnostics and made the creation-form service failure offer **Check service readiness** rather than **Review ideas**. Rechecking cannot submit a paid generation.

Validation before publication:

- The new compiled-Worker regression fails on the prior bundle with the observed TypeError.
- The rebuilt source and compiled Worker both pass readiness, mocked provider generation, output persistence, settlement, authorized reload, and duplicate-run prevention under the actual isolated schema.
- 481 relevant regressions pass, including actual local D1 and privacy/isolation checks.
- 10 toolbar tests pass, including a new creation-form service-check regression (one additional unique test beyond the 481).
- Production build and TypeScript pass.

Release must retain the established 41-migration archive, inactive Memory and study configuration, and existing audience. Deployment success alone is insufficient: verify read-only live readiness for the reported document after publishing. No paid production generation is part of this qualification, so provider acceptance and final live output remain unproven.
