# Changed action only — P5 catalog diagnostic R8

**Pending. No hosted action has been performed in this continuation.** Existing Option B and retention are accepted; no initial approval intake is reopened.

Approve or decline this changed action: publish the exact R8 diagnostic envelope to the existing owner-private **appgprj_6ab5929a74288191bf37ed429f7a7e20**, invoke **Read catalog once**, preserve its raw receipt and exact offline diff, then restore the already saved **version 2**. Do not invoke Start, any fixed step, Stop or Cleanup.

Envelope `p5-sites-catalog:daef3e10f1bdb5bcc5046127d83e8451ca900f3b7a7c60614dad3b6797ab0d2e`. Worker SHA256 `467a739a2480141e491866831e6e563b4f9a9363fb5dcb58534fbb6cfec5eb30`; archive SHA256 `9a548d7680227a24b630c2ba9b89c08fa7f4706022e5a3cd298cd1ba5d5d5d6e`.

The exact version to publish is bound by [release-envelope.json](release-envelope.json), its complete 231-file source manifest and nine-file deployment archive. Native parent is `1565d8ac8a568bd0b9b7bde789eadc450e384364`; the later pushed commit must match that manifest. Source delta: new `src/catalog.mjs`, changed `src/worker.mjs` and generated `artifact.json`. The only archive payload difference is `dist/server/index.js`. No migration, fixture, application, owner check, binding, audience or Start equality change. All 228 other historical source files remain identical.

The new action exposes only type/name/table/raw SQL definitions to the authenticated owner. It accepts exactly `{"action":"catalog"}` through the existing same-origin POST route, before any run/user-row lookup. One compiled query; no caller SQL, pagination, database writes, provider transport, R2 operations or run creation. Maximum 256 objects;256-byte identifiers;32768-byte SQL per object;262144-byte complete JSON response. Overflow returns an error, never a silently incomplete catalog. It expires at the existing October 1, 2026 00:00UTC deadline. The page adds one explicit button; no automatic query or polling.

## Publication/read accounting

Keep the existing additional 37 ledger: nine reservations charged, 28 unused. Record before each action; do not reset prior unknown authentication traffic. These remain conservative operator reservations, not a measurement of underlying platform/internal HTTP.

| Stage | Maximum further reservations |
|---|---:|
| Verify exact current private target/version/environment against retained receipt | 2 |
| Native source credential, without publish-on-push | 1 |
| Supported source verification/non-force push; bounded transport accounting | 5 |
| Save exact archive, with successful native admission required | 1 |
| Private deploy new saved diagnostic version | 1 |
| Terminal deployment checks, no automatic polling loop | 2 |
| Existing authenticated page reload/navigation allowance | 3 |
| One explicit Read catalog POST | 1 |
| **Normal ceiling:9+16=25 total reservations** | **16** |
| Restore exact saved version2 and verify terminal result, from recovery reserve | **2** |

At most 18 further reservations for this plan leaves 10 of the 37 unused; no cleanup attempt is consumed. Reuse successful receipts, reducing sends when possible. If any stage needs more, encounters new authentication traffic that cannot be bounded, native refusal, audience drift or admission failure: stop normal work, preserve evidence, and perform only the authorized version2 restoration if applicable and possible inside the recovery reserve. No blind retries, changed archive fallback or automatic expansion. When native calls hide HTTP, retain that limitation explicitly. A table listing is not a catalog receipt.

Native Sites tools must be callable again before execution (none are exposed in this turn). If needed, invoke **@Sites in this existing P5 chat** to expose its supported tools; do not reinstall/patch the plugin or use unmanaged credentials. Use the restored supported workflow and existing native source checkout. Credential stays in ephemeral stdin/session memory. Successful native admission follows authorized source push/save; it is not claimed by local packaging.

## Restoration and retention effects

Restore `appgprj_6ab5929a74288191bf37ed429f7a7e20~appgver_f5f7f474cb8c8191a85efe1c9de0f370` (version2) after receipt capture or diagnostic failure. Restoration changes only the served saved version; it does not erase diagnostic source/version history or change the database. If restoration fails, stop and report the exact deployed version; retain the owner-private audience and original expiry, without pretending restoration succeeded.

The database/schema, MEDIA resource and original disabled N10H state remain. There is no P5 run/fixture to clean, and this plan creates none. Original cleanup obligations remain for any later separately reviewed import. Diagnostic source/version history and owner-only schema receipts join the existing indefinite private retention beginning 2026-09-25T21:04:00Z, owned by westbrook.johnson@reve.art until separately reviewed change/deletion. OptionB finite-resource exposure at unknown hosting prices remains; no dollar guarantee or automatic removal.

Approval covers only this publication/read/restoration plan. No schema remedy, canonicalization, migration, retry of Start, rearm, wider fixture, paid call or production Forma change is included. Once the exact hosted differences are captured, return the smallest evidence-backed remedy for separate review if it changes source or schema. P5 remains open; P2 gates, 847/six exclusions, cross-media evidence limits and actual-Forma qualification stay intact.
