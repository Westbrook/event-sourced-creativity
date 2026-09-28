# P5 R10 — diagnostic admitted; version 2 restored

Native Sites access is restored. The exact approved R8 source was pushed with publish-on-push disabled and saved as private version 3. Its nine-file archive passed native admission. The diagnostic was **not deployed or invoked**.

I supplied a malformed project ID in the deploy call (the `191` segment was omitted). Native validation rejected it with `INVALID_ARGUMENT` before deployment. This was an agent input error, not evidence that Sites is unavailable. Under the accepted stop-on-refusal rule, normal work stopped without a retry. The authorized recovery deployment of exact saved version 2 returned terminal **succeeded** at 2026-09-28T16:25:57.725066+00:00. That terminal receipt verifies restoration; no extra poll was needed. No hosted catalog receipt or actual missing/extra/changed-definition diff exists yet.

## Evidence

- [Preflight](preflight.json): exact owner-private target, version 2, environment revision 0 with no entries, unchanged sole-owner audience. Supported source open verified the expected parent.
- [Source push](source-push.json): `530960b85f85756b0eee97746090d690fd00aa95` from `1565d8ac8a568bd0b9b7bde789eadc450e384364`; all 231 source payloads match R8; 228 historical files unchanged. No credential persisted or plugin patched.
- [Saved version 3](native-saved-version.json), [native admission](native-admission.json): original sealed gzip unchanged. Native stored tar exactly matches an offline reconstruction using all nine original payloads with normalized tar metadata. This removes directory/PAX metadata, not SQL or source semantics.
- [Deployment input refusal](deployment-refusal.json) and [successful version 2 restoration](restoration.json). Saved version 3 and diagnostic source history remain; restoration does not erase them, database resources or the empty MEDIA resource.
- [Request ledger](request-ledger.json): 20 charged / 17 unused overall; this action used 10 of 16 normal and 1 of 2 recovery reservations. Normal stop is 25, overall limit 37, cleanup limit 5 with zero attempts. Counts are conservative operator bounds, not measured internal HTTP or server-enforced single use. Earlier unknown authentication traffic is not reset.

**Accounting deviation:** local ledger initialization failed with a Python syntax error, but the two planned preflight calls proceeded. Both were accurately recorded afterward, before any further call. This failed the required durable count-before ordering for those two calls; no calls were omitted and no extra allowance was taken. All subsequent reservations were recorded before their actions.

## Remaining work

No catalog read was sent, so the local `__drizzle_migrations` reproduction remains a hypothesis. No evidence-backed hosted schema remedy can yet be selected. The unchanged bounded diagnostic and prior 21 focused checks remain available; the previous 29/266 tests were not repeated. No Start, step, Stop/Cleanup, run creation, user-row query, provider request, new migration, normalization or production Forma change was performed. N10H's last row evidence remains R7; it was not reread in R10.

Stop here under the accepted refusal rule. On a later explicit resume, reuse the admitted saved version 3 rather than pushing or saving again. Recheck drift within the remaining cumulative bounds: at most six normal reservations before this action's 16 ceiling (and total 25 stop), and only one remaining restoration/verification reservation from this action's two. A terminal restoration receipt can serve as verification; a nonterminal result may exhaust that bound and must be reported rather than polled beyond authority. Do not treat a later turn as resetting limits. No automatic retry or expiry renewal.

Accepted Option B unknown-price finite-resource exposure and indefinite private retention from 2026-09-25T21:04:00Z remain owned by westbrook.johnson@reve.art. Diagnostic source/version history persists privately. No automatic deletion or cost-free residue is promised. The October 1, 2026 00:00 UTC expiry, P2 gates, 847/six exclusions, original N10H state and future cleanup obligations remain. Private hosting is not actual-Forma identity/schema/holds/custody/financial qualification. P5 remains open.
