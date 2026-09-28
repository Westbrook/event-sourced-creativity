# P5 R11 — diagnostic deployed; authentication gate; version 2 restored

The exact saved and natively admitted version 3 successfully deployed privately. The single page navigation showed **Log in to access** with **Continue with ChatGPT**. No sign-in link was clicked, no new authentication flow was initiated and no catalog call was sent. Normal work stopped under the accepted authentication condition. Exact saved version 2 restoration returned terminal **succeeded** at 2026-09-28T17:27:56.510452+00:00. Version 3 is retained in history and is not currently served; its schema diagnostic is not exposed by restored version 2.

## Checks and receipts

- [Local identifier/ledger checks](local-validation.json): identifiers copied from native R10 receipts; project/version/source relationships validated before arguments were submitted. Durable ledger recording tested on a temporary copy, including fsync/read-back, normal/recovery limits and overflow rejection. The real ledger stayed at 20 through the tests.
- [Plan](execution-plan.json), [fresh preflight](preflight.json): owner-private audience and environment revision 0/empty entries matched. Fresh site latest saved version remains 3. Exact immutable admitted version/source/archive relationship reused from R10; no fresh remote source fetch or get-version call. No source push, rebuild or new version save.
- [Successful diagnostic deployment](deployment.json), [browser observation](browser-observation.json), [successful version 2 restoration](restoration.json). Both deployment responses were terminal, so no status polling was needed.
- [Ledger](request-ledger.json): 25 charged / 12 unused overall. This continuation used four normal reservations and one recovery reservation; all were durably recorded and read back before sending. Cumulative R8 action consumption is 14 normal and two recovery, with amended recovery ceiling four. The two late R10 preflight entries remain disclosed. Native/browser underlying HTTP and previous authentication traffic remain unmeasured.

The cumulative total is now 25, so **normalStop25 leaves zero normal reservations**, even though the catalog read was not attempted and other action-specific slots remain. Recovery slots cannot fund normal work. Two of the newly authorized recovery reservations were unused; successful restoration requires no further request.

## Next action

The owner can authenticate in the retained private Site tab. This is an authentication prerequisite, not a request for source credentials or an unmanaged host. Before another agent deployment/read attempt, explicitly amend the normal suballocation within the existing 37 allowance, accounting for preflight, deployment, page access, one catalog read and restoration checks; do not silently reset total25 or borrow recovery. New authentication traffic must remain honestly disclosed where unmeasured. There is no automatic retry or expiry renewal.

No raw hosted catalog exists, so no missing/extra/changed-definition diff or justified hosted schema remedy can yet be prepared. The local `__drizzle_migrations` reproduction remains a hypothesis. The exact diagnostic candidate and prior 21 focused checks remain intact; no previous 29/266 test suite was repeated.

No Start, steps, Stop/Cleanup, run creation, new fixture, new migration, normalization, rearm, provider request or production Forma change occurred. Original N10H state and future cleanup obligations remain; its last row evidence is R7 and was not reread here. Option B finite-resource exposure at unknown prices and indefinite private retention since2026-09-25T21:04:00Z remain owned by westbrook.johnson@reve.art. Restoration erases neither source/version history nor database/schema/empty bucket resources. No cost-free or automatic removal claim. Preserve October1 2026 00UTC expiry, P2 gates,847/six exclusions and separate actual-Forma identity/schema/holds/custody/financial qualification. P5 stays open.
