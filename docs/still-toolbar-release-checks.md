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
3. Commit the candidate, run `pnpm test:still-toolbar`, typecheck and the production
   build on that exact source. No source changes may follow without rechecking and
   rebuilding. Use the repository's held-migration packager, which packages the
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
