# R1 concrete infrastructure dependencies — v3

Prepared locally, not submitted. User authorizes an isolated test release once the target, access and billing authority are established. No migration, external messages/issues, paid inference or production resource changes are included.

## Verified discovery, 24 September 2026

- GitHub API access works as `Westbrook`. `reve-ai/reve-infra` and `reve-ai/vite-model-starter` are readable. Proposed `reve-ai/still-platform-pilot` was not found.
- Current gcloud account is `westbrook.johnson@reve.art`; listing clusters in `reve-prototyping` returned **401 invalid credentials**. No prototron Kubernetes context is configured. Existing dev/production contexts were not used.
- Current supported provisioning is `experiments/proto/bin/proto onboard NAME reve-ai/REPO --disable-debug-agent` in `reve-infra`. This writes local Kubernetes/Terraform changes; its README requires a reviewed infra PR, merge, and maintainer apply of `terraform/reve-prototyping`.
- Prototron is `reve-prototyping`, `us-west1`, cluster `prototron`; registry is `us-west1-docker.pkg.dev/reve-prototyping/prototron`. Existing starter routing directs `/api` to Service `api`, and `/` to `frontend`, through `reve-system/reve-dev`. These source facts do not prove current live access or available allocation.

## Exact remaining actions

1. Refresh the configured GCP login: `gcloud auth login westbrook.johnson@reve.art`. Then verify that account’s read access to the named test project/cluster; do not substitute the currently selected production context.
2. Establish the app repository and namespace. Proposed names are `reve-ai/still-platform-pilot` and `still-platform-pilot`; they are not reserved. Run supported onboarding in an isolated infra checkout, review its IAM/namespace changes, then obtain maintainer apply. No infra PR or message has been sent.
3. Supply **two actual admitted IAP account emails**, the accountable **billing/cleanup owner**, an infrastructure **USD ceiling**, and a test **expiry**. The emails allow a real two-person access/revocation test. Owner/ceiling/expiry bound who pays and who tears down the resources. Supported onboarding does not define these product test choices. Existing approved Reve allocations may satisfy them if identified; no additional charge is presumed authorized.
4. Return the actual IAP backend audience, app origin, runtime/deploy identities, and protection for both web and API backends. Proposed origin is `https://still-platform-pilot.p.reve-dev.com`; it is **not a working URL**. Use `deploy/platform-route.yaml` as the companion route. Admissions must be enforced by IAP and the application; unsigned forwarded email headers are insufficient.
5. Allocate fresh `still_pilot` PostgreSQL storage, `still-core-secrets` and `still-core-admissions` in that namespace. Secrets contain independently generated admin/runtime passwords and a fresh 32-byte base64 encryption root. Exact schema and role initialization is implemented in `core-init.mjs`; no production data import. Preserve secrets/PVC across redeploys.
6. Allocate one empty private GCS bucket with uniform access/public-access prevention, owned by this test environment. Uploads remain disabled, so no runtime object access is needed for R1. No soft-delete/erasure qualification is claimed for future uploaded types.
7. Apply namespace quota, the PostgreSQL NetworkPolicy, and scoped runtime/deploy RBAC, including NetworkPolicy management or platform-managed application of that one object. The supported namespace template already covers deployments/statefulsets/services/configmaps/secrets/PVCs. No batch/worker/Memory permissions are needed for R1.

Steady-state proposed resource requests: 225m CPU, 544Mi memory, one 5Gi RWO PVC; allow API/web rollout surge and initialization overhead. Suggested namespace limits: 2Gi requested memory, 3Gi memory limit, 4 CPU limit, 6 pods, 5Gi storage. They are manifest capacities, **not a price quote or configured spending cap**. Include registry, logs, network and bucket charges in the allocation. Provider budget stays zero.

The app rejects access after the configured expiry. The cleanup owner must then remove test storage and secrets under the approved teardown procedure. This is not a cloud billing auto-shutoff. No production backup/restore or HA claim is made. Do not restore a deleted source from an old database snapshot.

## What is ready

Native PostgreSQL session/creation/review/apply/events, scoped access, encryption, rich Forma editing, reference refresh, sharing/revocation and offered source erasure are implemented. Real browser round-trip and local integration evidence are recorded separately. The production image excludes synthetic login/fixture servers. The R1 workflow and manifest renderer are executable candidate artifacts, pending the values/actions above.

Hosted acceptance still requires real IAP admission/denial, two actual accounts, the same-ID journey, reload/pod restart, conflict/revocation/deletion, deep-link refresh, ordinary redeploy and immutable source/image receipts. Broad worker/indexing and Memory are R2/R3, not R1 prerequisites.
