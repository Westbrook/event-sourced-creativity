# P5 R12 — exact catalog difference captured; version 2 restored

The approved saved version 3 deployed privately, one **Read catalog** invocation succeeded, and exact saved version 2 restoration returned terminal **succeeded** at 2026-09-28T17:43:20.842032+00:00. No status polls or read retries were needed. The stale diagnostic browser page was closed after saving its receipt and screenshot. Version 3 remains in private history but is not currently served.

## Actual difference

All **172 expected definitions match exactly**, including type, name, table and raw SQL. Nothing is missing or changed. The catalog contains 174 explicit, non-SQLite-internal objects: 54 tables, 62 indexes, 57 triggers and one view.

| Raw extra object | Original guard behavior |
| --- | --- |
| `__appgarden_migrations` | Not excluded; sole extra definition in the guard's comparison, sufficient to cause `schema_mismatch` |
| `_cf_KV` | Already excluded by the unchanged guard |

The exact migration metadata definition is:

```sql
CREATE TABLE "__appgarden_migrations"(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)
```

`__drizzle_migrations` is absent: the earlier local Drizzle reproduction was a hypothesis, not the hosted cause. The formerly unlisted `project_resource_scopes` and `users` tables are both present and exact. The overview's 50-name result did not establish absence. No SQL whitespace normalization is needed.

[Complete receipt](catalog-receipt.json) · [exact raw and original-guard diff](catalog-diff.json) · [analysis](catalog-analysis.json) · [visible evidence](catalog-visible.png).

The receipt is the complete JSON displayed by the sealed page, which pretty-prints parsed response JSON; it preserves the raw SQL strings but is not a byte-for-byte HTTP-wire capture. One statement / one binding call, **409 D1 rows read**, **zero writes**, zero provider calls and zero R2 operations; allocated DB metric 815104 bytes. The 409 read metric is not the 174 object count. The fixed diagnostic branch does not read run/user rows or create a run.

## Smallest local remedy

[One-expression Worker patch](worker-remedy.patch) requires the exact observed `__appgarden_migrations` definition **in addition to every unchanged D.schema definition**. It retains the original query, preexisting exclusions and full raw equality; no new ignore rule, blanket normalization, migration rewrite or fixture expansion. Missing or altered bookkeeping fails closed too. The change applies to the existing shared preflight used by Start and original cleanup; the original N10H tombstone check remains intact.

[Candidate source](worker-remedy-candidate.mjs) · [immutable local proposal envelope](remedy-envelope.json) · [source manifest](remedy-source-manifest.json) · [focused checks](remedy-validation.json).

Eight focused test groups passed, including 874 rejection cases across every required object and concrete constraint/nullability/unique-index/trigger-body mutations. Tests execute the actual original/candidate preflight functions and unchanged canonical/hash exports against preserved catalog rows and a local synthetic tombstone adapter. Separately, the exact two packaged migrations plus the two observed metadata DDL definitions reproduce all 174 hosted definitions in SQLite. This is local validation, not a compiled Worker/managed rehearsal test. Prior 29/266 tests were not repeated.

The local proposal pins candidate Worker, patch, validation and complete source-input manifest hashes. It is **not a deployable release envelope**: no source was pushed, rebuilt or saved, and no new archive/native admission is claimed. Historical generated artifact metadata is retained only as base evidence. Before a hosted remedy, prepare the matching generated outputs and fully reseal a release, then review that separate changed hosted action. No Start is authorized by this result.

## Accounting and remaining work

[Ledger](request-ledger.json): **31 charged / six unused** against additional37. This continuation used five normal and one recovery reservation. Every new reservation was atomically saved, fsynced and read back before dispatch; local tests verified both allocation ceilings and rejection of over-limit requests. The original two late R10 entries remain explicitly disclosed. Original/user-driven authentication and native/browser internal HTTP remain unmeasured; these are conservative operator reservations, not proof of exact total HTTP. NormalStop30 is exhausted. Two current recovery slots remain unused because restoration returned terminal success; they cannot fund normal work.

Accepted Option B unknown-price finite-resource exposure and indefinite private retention beginning 2026-09-25T21:04:00Z remain owned by westbrook.johnson@reve.art. The schema receipt and diagnostic/source/version history join that retention. Restoration deletes neither history nor database/schema/empty MEDIA resources, and none are represented as cost-free.

No Start, fixed step, Stop/Cleanup, run creation, fixture import, live schema change, migration, normalization, rearm, paid provider request or production Forma change occurred. Original N10H row evidence remains R7; this metadata-only read did not reread its values. Its original disabled state and future cleanup obligations are preserved. Keep October1 2026 00UTC expiry without renewal, P2 gates,847/six exclusions, and separate actual-Forma identity/schema/holds/custody/financial qualification. These catalog/deployment findings apply across media without a generation-quality claim. **P5 remains open.**
