# Still toolbar release checks

The release check is offline. It does not read a live account, issue credentials,
fetch/push source, deploy, modify access or run SQL. Publication remains the native
Sites workflow, under the current release authorization. Python3 is needed only
for safe tar inspection; application runtime and browser tests remain Node-based.

1. Read the current Site and terminal deployment receipt through Sites. Identify
   the **actually live** saved version and source commit; the latest saved version
   may be a rolled-back qualification release. Preserve the audience and runtime
   configuration. Do not infer the live baseline from the remote branch tip.
2. In a clean release checkout, reconcile the requested source onto that live
   baseline, preserving Git history. Review the exact changed paths and record a
   plan outside the checkout. Do not populate the allowlist blindly from a diff.
   The baseline need not be an ancestor: hosted history may include a later
   reverted qualification branch. Only the explicitly reviewed tree delta passes.
3. Commit the candidate. On that exact source, run `pnpm validate:fast` first,
   then focused toolbar units/browser coverage (`pnpm test:still-toolbar`) and
   `pnpm build` once. If the unit cases already passed on matching inputs in the
   Node graph, use `pnpm test:still-toolbar:browser` for the remaining browser lane.
   Reuse a matching qualified build; do not clean it just to repeat a command.
   Source changes invalidate affected checks/build evidence and must be reverified
   before packaging. Documentation-only changes do not invalidate runtime behavior
   but the release source/archive comparisons still need the exact candidate. Use the repository's held-migration packager, which packages the
   verified build rather than copying unqualified source migrations over it:

   ```sh
   node --experimental-strip-types scripts/package-disabled-memory-release.mjs /absolute/release.tar
   pnpm release:verify /absolute/release-plan.json /absolute/release.tar
   ```

   Example plan shape (substitute verified full SHAs and the exact Site ID):

   ```json
   {
     "projectId": "<existing Site project ID>",
     "baselineCommit": "<full live source SHA>",
     "candidateCommit": "<full candidate HEAD SHA>",
     "allowedPaths": ["src/still/motion/", "tests/still-thread-timing.test.mjs"]
   }
   ```

   Use exact file paths or directory prefixes ending in `/`. Include only the
   reviewed source/docs/tests/tooling changes. Unexpected changes, dirty source
   (including untracked files), a different project, changed hosting configuration
   or changed migration policy fail the check. Keep unrelated local proposals in
   their original checkout; do not delete them to satisfy release preparation.
4. Push exact source through the Sites workflow and save its inspected archive.
   Retain the native saved version's structured JSON outside the checkout. Before
   deploying, bind its source and archive receipt back to the inspected package:

   ```sh
   pnpm release:verify /absolute/release-plan.json /absolute/release.tar /absolute/saved-version.json
   ```

   The check compares every archive file with `dist`, verifies the held migrations
   and Worker/manifest presence, and reproduces the Sites-normalized tar hash,
   count and size. Tar metadata and ordering may differ from the upload's raw
   hash; content may not. Links, traversal, duplicate members and candidate SQL
   are rejected. A mismatch is a release stop, not permission to overwrite a
   saved version or relax the migration policy.
5. Deploy the exact saved version with unchanged audience. Record the terminal
   native deployment receipt and update the main/report handoff. If another
   publication occurred meanwhile, reconcile again rather than restoring an old
   version over it. The offline check cannot establish current hosted state or
   prevent another publisher from acting after a receipt was read.

`node --import tsx --test tests/site-release-preflight.test.mjs` exercises this
check against fictional Git/build fixtures, altered Workers, unexpected source,
unsafe archives, mismatched saved receipts and extra migrations. No production
fixture or database is required.

## Still 0074 source-journal qualification

The explicit `migrationSourceJournalTransition` plan object permits only the
pinned `still-action-outcomes-0074` source-journal extension. Copy its exact
`kind`, `before`, `after`, and `sql` values from
`scripts/lib/still-migration-journal.mjs`. The check binds both journal byte
hashes, the exact appended SQL, every historical SQL file and a policy edit
that replaces only `sourceJournalSha256`. All other policy bytes, hosting
configuration, the 41 packaged SQL files and their journal remain unchanged.
Absent or mismatched qualification remains a release failure.

The Memory repair generator validates that one extension but still generates
from its original 72-entry journal prefix. Its historical 31-migration repair
manifest must remain byte-identical. This qualification does not activate held
Memory migrations or package 0074. Still's ordinary server bootstrap creates
its four empty additive tables and four indexes; collection initially required explicit scoped opt-in. The 0075 follow-up below
changes that preference contract to account-wide default-on saving with opt-out. Native publication authorizes this bootstrap effect, independently
of paid evaluations, actual-data exports or a real-user study.

## Still 0075 durable user settings qualification

The `still-user-settings-0075` transition separately pins the exact 73-to-74-entry
source journal append. Copy `STILL_USER_SETTINGS_JOURNAL_TRANSITION` from
`scripts/lib/still-migration-journal.mjs` into the release plan. Qualification
checks both historical journal prefixes, both Still SQL hashes and every existing
SQL file; only the source-journal hash changes in the held-migration policy.
The packaged 41 SQL files and original 31-migration Memory repair manifest remain
unchanged. Unreviewed active SQL, unrelated policy edits and altered historical
migrations still fail.

The additive server bootstrap creates the durable `still_user_settings` table.
It does not populate or overwrite an account choice. Authorized context reads
record by default when there is no explicit account opt-out. Disabling saving
persists independently from expiring history and deletes personal diagnostic
rows across scopes; it does not change creative events or remembered goals.
See the [goal/settings contract](still-goal-settings-actions.md).
