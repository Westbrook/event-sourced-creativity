# P5 Sites R1 — disabled release decision

**Local disabled release prepared. Managed deployment and the paid comparison remain no-go.** The user selected the existing Sites target on September 25, 2026. This successor leaves the sealed P1–P4 and initial P5 artifacts intact.

Target: existing Forma Sites `appgprj_6a7a020e334881919ed8aea0363cb98f`, https://forma-creative-studio.reve-ai-0869.chatgpt.site. Read-only metadata still identifies active v550, source `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`, owner role and workspace-wide audience. No new hosting resource, version, environment, schema, principal, secret or grant has been created. Preserve that audience. GKE remains separately owned and unselected.

## Exact release

See `archive-receipt.json` for the 23,347,082-byte local archive and SHA-256, and `release-envelope.json` for every built module, asset, source and review-artifact hash. Source stays in `codex/forma-p5-live-comparison`; no source push or Site save has occurred. Future publication must push the reviewed source, use the unchanged archive and validate the saved/deployed version receipt. If packaging is repeated, its new bytes require a new envelope and review.

The archive includes **only the existing held 41 migrations from v494**. The installed Sites packaging script overlays the entire source `drizzle` directory; using it directly on this checkout would defeat that release policy. `package-generation-p5-sites.mjs` stages the verified build and hosting manifest without that overlay, invokes the same local plugin packager, unpacks the archive and verifies the held set again. This is a local archive, not a native publish receipt. A future workflow must preserve this exact set and must not silently rebuild with the wider source migrations.

No study schema is in the archive. `schema-additive.sql` is a separate, unapproved 49-object final-schema candidate. It creates no identity/evidence/approval/financial row, does not DROP or ALTER anything, and refuses existing study object names. It matches the P2 supplied/P4 schema contracts exactly in local SQLite. This candidate cannot be used until the owner verifies current schema dependencies, absence of conflicting study objects, migration history and the supported atomic execution path. Never run the historical fixture upgrade on a used database. No runtime endpoint installs DDL.

## Runtime changes

All routes are exact POST commands below `/api/internal/generation-study/`; unknown actions return 404 and responses are private/no-store. The Worker intercepts the namespace before ordinary authoring and excludes it from the unrelated general retention sweep.

| Route | Only permitted command / authority |
| --- | --- |
| `approval` | Existing P4 preview/commit/status contract: opaque proposal selection, exact displayed hash and explicit decision. Approval switch defaults off. |
| `execute` | `proposalId`, `arm` baseline/treatment. Separate execution switch defaults off. Existing P2 host performs exact guards and durable original dispatch. |
| `observe` | Proposal/arm plus existing safety/fidelity/finding/evidence reference and explicit resume. The actual human must supply the observation. |
| `recover` | Proposal/arm selects original retained PNG, private binary response; existing two-read bound applies. |
| `reconcile` | Proposal/arm consumes already-entered trusted original billing evidence. It cannot upload charges, assert verification or accept a substitute operation. |
| `stop` | Proposal only; terminal stop. No resume/unlatch route. |
| `cleanup` | Proposal/arm, after expiry; existing one-attempt original object and per-operation evidence deletion. |
| `cleanup-proposal` | Proposal only, after expiry; delete due owner-private preview, typed financial bodies and supplied copies, including abandoned previews. Immutable decisions, evidence references, policies, charges, reconciliation, intent and holds survive. |

The command surface rejects extra fields, raw proposal/policy/evidence/grant payloads and oversized non-approval bodies. Existing P4 approval has its own bounded parser. Existing principal/origin, project/impersonation, Memory, schema and financial guards remain authoritative. An execution exception returns `dispatchState: inspect_original_operation`, never an invented zero-spend assertion.

The production configuration module is empty. Flags alone cannot enable a run. A configured successor permits one compiled actual proposal, account/region and key/project fingerprints; evidence remains in private storage under authentic issuers. Dispatch checks the credential and project fingerprints against both compiled selection and each arm's typed account evidence, then pins those values for that request. The existing transport now forwards the selected OpenAI project header. No actual credential was read to prepare this release. Fixture markers and hashes cannot establish truth; actual configuration requires a new reviewed source/bundle/runtime envelope.

## Hosting owner qualification request — exact remaining facts

Read `owner-evidence-request.md`. Current native tools establish only metadata, logical DB/MEDIA bindings and hidden secret presence. They provide no physical D1/bucket identity, arbitrary schema-query/installation surface, disposable binding selector or intercepted hosted transport. The returned database overview is insufficient to prove the full schema or absence of study tables. The plugin documentation establishes platform behavior, not observations on these particular resources.

The owner must identify a **supported disposable fixture on this existing target/runtime** without granting access to real-user data or live provider transport. Its edge must supply genuine trusted identity, and its D1/R2 bindings must have verified physical identities. No such fixture was assumed or provisioned. The exact managed rehearsal release and resource cost decision cannot be finished until that path is known; an empty-config production deploy by itself would not qualify it.

## Costs, coexistence and lifecycle

No new financial obligation was incurred. The disabled bundle carries no study authority and creates no study data. Hosting deployment/build, D1 queries/storage and R2 storage/operations may have costs; their payer/allocation and limit accounting remain unverified. Full local resource measurements from the initial P5 envelope are historical pre-integration measurements, not current managed limits. The wrapper adds authentication/policy/account reads; do not reuse those old totals as exact current invocation costs. D1 batch query accounting and actual request/CPU/memory ceilings require managed measurement.

All actual private expiries and financial-retention funding must be reviewed separately. The existing study deadline remains **October 1, 2026, 00:00 UTC**. Cleanup observes deletion only at the application storage API; mock disappearance is not a provider/backup erasure guarantee. Deletion failure uses existing one-shot accounting and needs a separately scoped recovery, never an automatic retry. Accounting records remain for the approved financial lifetime, which has not been supplied. Browser/download copies need an owner disposition too.

## Deployment, disable and rollback order

1. Obtain owner schema/resource/isolation receipts and finish the exact rehearsal decision, including cost authority. No target writes yet.
2. Review this disabled archive and any separately sealed fixture/schema successor. Obtain explicit publication/schema/resource authorization before source push, version save or installation. Do not infer it from target selection.
3. Preserve default-off flags; record current applied migrations and environment revision. Sites applies migrations before Worker upload and may leave applied schema after deployment failure. Never infer schema rollback from version rollback.
4. After authorized disabled deployment, compare exact source/archive/version/environment receipts. Qualify default-off plus the separate disposable intercepted fixture against `hosted-checklist.json`. No capability probe or moderation request goes to a live provider.
5. Only after managed qualification and authentic operating evidence: compile/reseal a real configuration, present exact private preview, and obtain separate financial decision and finite execution authority. No treatment until actual baseline observation/resume and original settlement/funded lifecycle.
6. To stop purchases, set execution off; set approval off to prevent new commits. Preserve the configured recovery-capable Worker and all original identity/financial metadata. Routes for reconcile/recovery/expiry cleanup remain available with flags off. Do not revert to v550 after a purchase if that would remove original recovery. Before any purchase, a supported rollback to original v550 is possible after owner validation; optional added schema still remains and must not be dropped as rollback.

## Verification and limits

`verification.json` records 266 fresh focused tests, build/typecheck/lint, exact optional schemas, additive coexistence/rollback and 16 built-Worker local workerd responses. Full pair tests use local SQLite, mocked objects and intercepted fetch; fixtures that exercise `actual` parsing still contain explicitly synthetic issuers and terms. Local workerd checks exercise the real compiled Worker with no DB/storage bindings and outbound denial. Neither is managed Sites/D1/R2/edge qualification.

No live pair ran. Preparation has a staged disabled artifact; managed rehearsal preparation, deployment qualification, actual financial acceptance, run completion and cleanup settlement remain incomplete.
