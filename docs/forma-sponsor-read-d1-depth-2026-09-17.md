# Sponsored read proof depth repair — 2026-09-17

The actual local workerd D1 binding rejected the existing sponsored Image/Jobs
lineage assertion with `Expression tree is too large (maximum depth 100)`.
Node's default SQLite limit did not reveal this failure. The original statement
was 4,516 bytes with 22 bindings; its exact SQL is preserved in
`tests/fixtures/sponsor-read-lineage-depth-legacy.sql`.

`worker/experience-sponsor-read-image.ts` now groups the same native lineage
conditions and retained identity conditions into balanced `AND` expressions.
The joins, 89 predicate leaves, their order, and all 22 bound values remain
identical. The final native checks still execute in one database batch. No
authorization predicate, resource limit, financial entry, schema, activation
flag, policy, expiry, refund behavior or read operation changed.

## Focused qualification

Run:

```sh
node --experimental-strip-types --test tests/experience-sponsor-read-image-d1.test.mjs
```

The test uses the existing intercepted Image fixture, copies only its disposable
synthetic database into local Miniflare/workerd D1, and calls the production
Image and Jobs handlers against that binding. Both Node and workerd deny
non-local outbound requests; explicit bucket sentinels deny writes and listing.
The normal native Image JSON read still verifies its original RAM-backed file
with one GET. Jobs performs no media read.

The historical statement still fails at D1 depth 100. The repaired statement
passes and has exactly the same parsed predicate leaves and joins. Positive
Image/Jobs reads execute 72 statements, at most 70 bindings and 25,084 SQL bytes.
A completion sidecar withdrawn immediately before the final native batch is
refused with HTTP 403; all three attempts remain charged. Native database rows
are unchanged across successful reads, excluding the read-attempt ledger.

The first attempt to group only the 18 text-cell checks still failed. Grouping
the entire original lineage predicate and its retained identity predicate fixed
the existing Image/Jobs path. That unsuccessful intermediate approach remains
recorded in the task's evidence logs.

This qualifies the SQL and passive handler integration with local workerd D1.
The JavaScript handler executes in the test process, and the byte object is the
existing synthetic RAM fixture. It is not a hosted provider journey, production
activation, physical-device result, or edge-runtime performance measurement.
The separate adopted-asset adapter has its own route and budget tests.
