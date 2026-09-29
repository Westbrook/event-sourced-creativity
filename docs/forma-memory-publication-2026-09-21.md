# Native Memory merge and default-disabled publication

**Subsequent repair completed:** production500 now has the verified final schema
for all31 held migrations. See the [hosted repair receipt](forma-memory-schema-repair-2026-09-21.md).
The495/496 account below is historical; the packaging hold remains to prevent
replay through the unqualified original executor, not because schema is partial.

The user explicitly authorized merging and publishing the verified native candidate.
This supersedes the prior local-only release boundary, not activation, enrollment,
external-service or spending gates.

## Source and first attempt

- Local and remote `main` were fast-forwarded from production494's
  `00e23d97431a89a0c8d02e095dafe931e5c16172` to
  `f28e6b19a5940f3305f2925226754b125d217ec1`.
- The current publisher, **Build minimalist Jev creative app**, confirmed no
  active release hold and agreed to avoid concurrent publication.
- Saved version495: `appgprj_6a7a020e334881919ed8aea0363cb98f~appgver_36b8206472488191b03aad485558eb88`.
- Deployment `appgdep_6ab1d116f30081919b477752df78e12c` **failed** with
  `incomplete input: SQLITE_ERROR`. It is not a successful publication receipt.
- A bounded read-only Sites inventory then showed new derivation grants,
  qualifications, cursors, jobs and job-source tables. Grants, qualifications,
  jobs and job sources were each checked and empty. Exact trigger definitions
  and applied-migration receipts are not exposed by those tools. Do not assume
  rollback or certify a complete schema from table names.

The error is consistent with an executor/statement-boundary issue, but the host
provided no failing statement. Neither the exact cause nor a repair is claimed.
No destructive cleanup or blind migration retry was performed.

## Durable migration hold and recovery package

`build/memory-migration-release.json` pins the exact41-entry journal and SQL
hashes from production494. `build/release-migrations.ts` verifies that source
prefix before the normal Vite build packages it. Candidate SQL and the full72-entry
source journal remain unchanged for local testing and later qualification.

The built artifact intentionally contains **only the previously deployed migration
prefix**, not the later Memory migrations. This is default-disabled code delivery,
not schema repair, rollback, activation or proof that the hosted schema is complete.
The source-journal hash prevents a later migration addition from being silently
excluded: its release policy must be explicitly reviewed.

Use this guarded packaging path for this site while the hold remains:

```sh
npm run build
node --experimental-strip-types scripts/package-disabled-memory-release.mjs /absolute/new-output.tar
```

The command rejects held/extra/missing/altered migration files, unsafe build paths
and an existing output archive. **Do not use a generic packager that recopies the
entire source `drizzle/` directory over the built migration manifest.** Do not use
remote-build fallback unless its handling of this hold is qualified. Always push
the exact built source before saving the artifact and deploy only that saved version.

Local validation:104 migration/schema checks and three synthetic partial-schema
smoke cases pass (ordinary session/assistant stay available, Memory stays off,
no enrollment/provider call). TypeScript, explicit non-ignored
changed-file lint, and production build pass. Runtime/frontend source remains the
candidate already covered by2,942 native tests,2,351 Memory checks and116 browser
journeys. Counts overlap. These results do not qualify the hosted migration executor.

## Activation gates retained

Environment revision13 has no Memory activation configuration. Audience remains
`workspace_all`, access revision7, with no external visitors added. No real user,
provider call, schedule, new service or budget authorization is introduced.

Before activation, an appropriately supported host operation must inspect exact
schema and applied receipts, repair/complete the partial candidate installation,
qualify atomic execution and privacy recovery, and only then lift the checked
migration hold. The separate pending conversation/benchmark SQL candidates are
not packaged or applied. Keep selected pgvector adapter/baseline work, hosted
scheduling and explicit user consent in the
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).

## Recovery outcome

The guarded recovery publication **succeeded** at2026-09-22T01:07:12Z:

- Published source on remote `main`: `45fdacfaeda9b12f2b342d2f8a8225a80e6901fc`.
- Production version **496**: `appgprj_6a7a020e334881919ed8aea0363cb98f~appgver_11279f97f09c819197158ef159ca5007`.
- Deployment: `appgdep_6ab1d4ace2ec81919ffccdd7ba7dc0bd`, terminal `succeeded`, no failure message.
- [Production Forma](https://forma-creative-studio.reve-ai-0869.chatgpt.site).
- Saved archive SHA-256: `8f96789022be1520378d189708269a5fc01e2deca5b2e1d514290aa3c8c921b5`;614 normalized files,42,741,760 bytes.
- Post-publication Sites reads confirm environment revision13, no Memory keys,
  `workspace_all` audience, access revision7 and zero external visitors.
- Read-only HTTP smoke: unauthenticated home401; existing Sites dispatch
  credential home200; session401 without a signed-in user cookie.
  This verifies availability/access enforcement, not signed-in Memory acceptance.

The failed495 receipt above is retained. Successful496 publication does **not**
repair or qualify the partially installed Memory schema. All held migrations,
activation, scheduling, user consent and service-dependent work remain tracked.
A subsequent documentation-only commit records this receipt; it is not a different
runtime deployment and does not require publishing a second identical application.
