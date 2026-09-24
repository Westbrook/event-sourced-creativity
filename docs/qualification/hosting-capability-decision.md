# Hosted capability decision — September 24, 2026

**Decision: no supported autonomous hosted trigger is established.** Independent preparation continues; no schedule, resource, ingress, provider call or external message was created. This is a finite capability finding, not a claim that Sites can never schedule.

The native read-only [baseline receipt](hosting-baseline-receipt.json) confirms v550 / `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`, succeeded deployment `appgdep_6ab573499a108191a2691a137672b93e`, environment revision 16 and unchanged `workspace_all` audience. Its archive hash is `a629abf35cdb357f0affa0c309ebfc0591cfe235249404c97b7ce19ee813be7f`. The latest-source owning task reconciles Git separately. These metadata do not prove deployed schema contents.

## Bounded inspection and supported alternative

Inspected current native tool metadata, Sites hosting skill 0.1.71, `get_site`, saved versions, deployment status, and D1 overview. No callable Sites schedule creation/update/cancellation operation or authoritative schema/export/backup operation is exposed. `get_site` documents optional `automations` and `schedule_request_id`; this fresh response contains neither. Their absence does not mean an empty schedule list. No undocumented endpoint was tried.

The D1 overview returned `DB` and 50 user-table names, with `model_projection.truncated=false` and `omitted_tables=0`. It contains no applied-migration ledger and no CREATE definitions, columns, indexes or triggers. It therefore cannot establish the complete database inventory, despite the projection flags. No production authored/private rows were requested. A guessed `sqlite_master` or migration table name is not accepted as a supported read path.

One named fallback was evaluated: **Google Cloud Scheduler with a dedicated service-account OIDC identity**, HTTPS POST and audience bound to the exact maintenance endpoint. Google documents token generation from the configured client service account. That supplies an identity, but there is **no evidence that the Sites workspace access layer accepts it or grants a route-scoped machine principal**. Consequently this alternative is not qualified, configured or approved. No bypass bearer, browser cookie, shared-token escape hatch, audience change, second compute Worker or desktop heartbeat is an acceptable substitute. [Google HTTP authentication](https://docs.cloud.google.com/scheduler/docs/http-target-auth)

If the hosting owner supports that identity, the smallest alternative is one scheduler job, one dedicated service account, no creative payload, a roughly one-minute cadence, bounded retries and the existing Worker runner. The account needs only permission to wake that route; data authority still comes from D1 enrollment and canonical custody. Google lists $0.10 per job per 31 days beyond the account-level free allocation, with paused jobs still billable. Budget conservatively without assuming a free slot; Sites/D1/R2/log costs are additional and currently unquoted. [Google Scheduler pricing](https://cloud.google.com/scheduler/pricing)

## Exact request for the Sites hosting owner

Ready for the user to send; **not sent**. Recipient is the Sites hosting/platform owner; a named person and response channel have not been supplied.

> For existing Site appgprj_6a7a020e334881919ed8aea0363cb98f, what supported operation configures a persistent roughly once-per-minute trigger for its Worker? Please provide configuration/schema, schedule identity, deployment persistence, runtime limits, cancellation, retry/overlap behavior and run-log access. If native scheduling is unavailable, what documented machine identity can a managed scheduler use through workspace-only Site access, scoped solely to a maintenance wake-up route? Separately, how can we obtain the authoritative D1 applied-migration ledger/schema and an isolated qualification deployment with independent DB, storage, secrets and schedules?

Please attach:

1. Native trigger API/configuration and returned schedule ID, or documented acceptance of Google Cloud Scheduler OIDC (issuer, subject/service account, audience, route-only authorization, expiry/replay semantics). No production route should be added until this contract is known.
2. Read-only, timestamped full D1 schema and applied-migration ledger export, including partially applied/failed deployment state. The export must identify Site, physical database, schema objects and each ledger row/hash without exporting authored row contents.
3. Existing isolated environment IDs, or permission/cost quote for the private test Site described in [environment proposal](hosting-environment-proposal.json). A preview URL alone does not establish independent storage.
4. Supported backup/checkpoint, restore and forward-repair operations for that environment, and a machine-readable physical DB/R2 identity confirmation.
5. Runtime CPU/memory/D1/R2 limits, logging/run receipt access, billing rate/card, schedule cancellation/expiry, and a supported external health-monitor destination/owner.

The next executable action after this answer is to fill the actual resource and identity fields in the proposal, produce the target-numbered manifest from the authoritative ledger, and submit the resulting exact environment/schema/cost request. No general scheduling research is pending. Missing platform answers remain named release gates; manual runner execution cannot close the autonomous-wake gate.
