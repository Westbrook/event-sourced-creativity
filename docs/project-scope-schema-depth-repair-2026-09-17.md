# Project-scope schema assertion depth repair

Native project synchronization with structured Memory origins could fail before copying any scope because its integrity assertion exceeded the local workerd D1 expression-depth limit of 100. The 33,117-byte failing statement had two schema snapshot bindings; its recorded SHA-256 was `3740323b8920622d11b93ec740c1b91cc129aaf7f5c5bd5266497d7fc12a2c82`.

`nativeStructuredOriginMinimizedCondition` now combines its same 51 ordered operands in a balanced AND tree. That conjunction has at most six levels instead of 50. The byte-based identifier checks, JSON CASE guards, NULL rejection, exact schema witnesses, residue checks, result envelopes, and transactional bookends remain unchanged. Both project synchronization query shapes receive the change through the existing shared predicate. The full-schema assertion is now 33,289 bytes with the same two bindings.

The focused regression test exercises actual pinned Miniflare/workerd D1 using disposable local storage and forbids external requests. It covers native rebuild and the four-read fast path with absent/full structured Memory schemas, schema drift after observation, and final-bookend drift during both scope-copy and activation batches. A failed final bookend rolls back its own batch; previously committed chunks remain committed. It also compares the historical predicate from commit `8baaccd1744f1399f402ddd03ae9e9d0c2d3ad9c` against the current export on reference SQLite, then evaluates the current predicate on actual D1 for both allowed aliases across malformed, NULL, JSON, and UTF-8 boundary cases. The historical builder is embedded with exact SQL hashes so this check also runs from shallow clones and exported source trees.

Run from the repository:

```sh
node --experimental-strip-types --test tests/project-scope-schema-depth-d1.test.mjs
node --experimental-strip-types --test tests/output-native-project-scope.test.mjs tests/output-retained-witness.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js worker/memory-native-origin.ts tests/project-scope-schema-depth-d1.test.mjs
```

The actual D1 test requires permission to listen on loopback. No hosted service, schema activation, provider request, publication, or database-limit change is involved. Canonical minimized headers are exercised through the production lifecycle, six answer/manifest body or custody-row resurrections remain rejected, and production triggers reject dependency resurrection. Whole-file lint reports the pre-existing unused `db` in `prepareNativeDocumentJobOriginRetentionStep`; the changed function introduces no lint finding.
