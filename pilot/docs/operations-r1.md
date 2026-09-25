# R1 operate, redeploy and clean up

## Establish the target

Complete the actions in `infrastructure-request.md`. Use only the allocated prototron namespace/context, never a current production context. The namespace is provisioned by the supported Reve onboarding process; platform-owned IAP, routing, namespace quota, private bucket and NetworkPolicy permission must be ready before app deployment.

Copy `deploy/release.example.json` outside source control and fill the actual values. `spendCeiling` is a string such as `10 USD` only after an owner approves that amount; the example intentionally leaves it unset. `expiresAt` is explicitly `"open-ended"` for this release: no date-based access cutoff. Missing or malformed lifetime configuration still fails validation. An ISO UTC timestamp remains supported for future bounded tests. Neither setting enforces a billing cap. The pinned PostgreSQL 17.9 Alpine image matches tested schema behavior; no pgvector is required.

Create `accounts.json` containing one or more actual admitted IAP operator addresses and their `creator` or `viewer` admission role. Example shape: `[{"email":"ACTUAL_ACCOUNT","role":"creator"}, ...]`. The initializer updates admissions on each rollout. It never auto-accepts product consent. Do not use the local synthetic accounts for hosted acceptance.

Generate fresh credentials without printing them:

```sh
node pilot/deploy/make-secrets.mjs /PRIVATE/NEW_DIRECTORY
kubectl --context=APPROVED_PROTOTRON_CONTEXT -n ALLOCATED_NAMESPACE create secret generic still-core-secrets \
  --from-file=database-admin-password=/PRIVATE/NEW_DIRECTORY/database-admin-password \
  --from-file=database-runtime-password=/PRIVATE/NEW_DIRECTORY/database-runtime-password \
  --from-file=encryption-root=/PRIVATE/NEW_DIRECTORY/encryption-root
kubectl --context=APPROVED_PROTOTRON_CONTEXT -n ALLOCATED_NAMESPACE create configmap still-core-admissions --from-file=accounts.json=/PRIVATE/accounts.json
```

Store credentials under the approved secret-management process and remove temporary files. Do not regenerate the content root for an existing PVC. Root loss makes existing encrypted content unreadable; there is no production recovery claim. No secrets belong in GitHub repository variables, logs, reports or source.

## Release through GitHub

Transfer the candidate to the allocated app repository and establish `development` protection and repository-scoped GitHub OIDC. Configure `REVE_APP_NAME`, `REVE_APP_ORIGIN`, `REVE_DEPLOY_SERVICE_ACCOUNT`, and `STILL_CORE_RELEASE_CONFIG` (non-secret JSON from the completed release configuration). Set `REVE_DEPLOYMENT_ENABLED=true` only when allocation and billing authority are established.

The workflow runs the existing app verification suite plus R1 integration tests, builds the native frontend and both containers, pushes SHA-tagged images, resolves immutable digests, renders the candidate, and serializes deployment. Fresh schema initialization uses the bootstrap account; the running API gets a separate role without DDL privileges. Startup never imports Sites data. Save the workflow deployment artifact containing revision/image refs and rollout output.

The platform route directs `/api` to `api` and all allowed frontend routes to `frontend`. Both must be protected by IAP. Direct unauthenticated API requests and forged unsigned forwarded headers must fail. The API validates official ES256 IAP assertions and the exact audience. The runtime cannot select local keys or synthetic identity.

## Hosted acceptance

1. Sign in with the admitted IAP operator. In Test release controls, create a second app test user. Each user must complete native product consent separately. Keep different users in separate tabs; selection is pinned per loaded tab. Independent IAP admission/denial remains a separate boundary check.
2. Create Project → Document → Idea through Still. Review/approve, reload, and record their IDs and revision.
3. Open that document in Forma using the test controls. Edit its native rich body, including an existing Idea reference. Save, return to Still and reload. Verify same IDs/reference targets/prose.
4. Make overlapping edits; verify the stale writer is rejected and can retain/review their draft. Do not overwrite a newer value merely by refreshing its head.
5. Share to the second principal as viewer (write denied), then editor. Revoke and verify reads/writes fail after reload. Use the generated app test email shown by the controls. The user selector is validated against the verified operator on every request.
6. Try deleting a referenced Idea (denied), delete its referencing source, then delete the original. Verify current private events/drafts/receipts are erased. Upload and derived-storage tests are excluded because those types are unavailable.
7. Restart only the test API pod, reload both deep links, and verify data persists. Deploy the same revision again through the workflow, then record its image/commit receipts and repeat a read/edit.

Readiness and local JWT tests do not substitute for this hosted two-app-user acceptance. Record actual hosted URLs only after the test passes.

App test users are controlled testing personas, not independently authenticated people. Each has its own principal, personal workspace, consent, drafts and grants. The admitted operator can intentionally act as either user. These tests qualify app authorization and do not establish separation between independent Google accounts. Removing the operator admission denies access to every user they control.

## Recovery and cleanup

Compatible redeploys retain the fresh PVC, root and admissions. Revert to an earlier **R1-compatible** image pair by completing a release config with its exact digests and applying the rendered manifest to the same namespace. Keep the current schema and authoritative revocations/deletions. The app-user release requires migration `004-test-users.sql`; recovery images must include it in their migration ledger. Do not roll back to the pre-R1 API or restore an old database snapshot containing deleted sources. If no compatible candidate exists, stop API access and diagnose; do not reset data automatically.

This test remains available without a scheduled expiry. The $200 total ceiling is unchanged; pods/disks incur charges until removed, and deployment must establish cost tracking and a stop procedure within that ceiling. The named cleanup owner must disable deployment, remove only this release’s route/admission/IAM grants and workloads, and deliberately delete its PVC, empty private bucket, secrets and retained image/log artifacts under the approved retention rules. Storage deletion is irreversible; preserve any user-requested export only under separate authorization. Check the billing allocation is no longer accruing resource charges. No scheduled cleanup has been created in this task.
