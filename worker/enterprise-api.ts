import { cancelProjectActorJobs, projectProviderSubmissionBlockers } from "./document-jobs-api.ts";
import { failConsequentialExecution, reconcileConsequentialUsage } from "./consequential-consent.ts";
import { unsettledProviderSubmissionSql } from "../src/model/provider-submission";
import { ensureOrganizationKey, openOrganizationPayload, organizationEncryptionConfigured, OrganizationCryptoUnavailable, sealOrganizationPayload } from "./organization-crypto.ts";
import { hasCapability, POLICY_VERSION, releaseBudget, releaseCostBudget, type PilotUser } from "./pilot-policy.ts";
import { projectContextCookie, recordOrganizationAudit } from "./project-access.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { migrateLegacyEventPayloads } from "./event-privacy-migration.ts";
import { uuidV7, type WorkerEnv } from "./runtime.ts";

const sha256 = async (bytes: string | Uint8Array) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", (typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes) as Uint8Array<ArrayBuffer>)),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("");

const base64 = (bytes: Uint8Array) => {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
};

const bytesFromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const MAX_INLINE_RECOVERY_BYTES=1_500_000;
const MAX_RECOVERY_PAYLOAD_BYTES=48*1024*1024;
const denied = () => Response.json({ error: "access_denied" }, { status: 403 });
const observedSource = (request: Request) => request.headers.get("oai-authenticated-user-id") && request.headers.get("oai-authenticated-user-email")
  ? "openai-workspace"
  : request.headers.get("cf-access-authenticated-user-email")
    ? "cloudflare-access"
    : "local-development";

async function securityPosture(env: WorkerEnv, organizationId: string, request: Request) {
  const policy = await env.DB.prepare("SELECT * FROM organization_security_policies WHERE organization_id=?").bind(organizationId).first<Record<string, unknown>>();
  const activeKeys = await env.DB.prepare("SELECT key_id,version,status,created_at,retired_at FROM organization_key_versions WHERE organization_id=? ORDER BY version DESC LIMIT 25")
    .bind(organizationId).all<Record<string, unknown>>();
  let domains: string[] = [];
  try { domains = policy && Array.isArray(JSON.parse(String(policy.allowed_domains_json))) ? JSON.parse(String(policy.allowed_domains_json)) as string[] : []; } catch { domains = []; }
  return {
    policy: {
      authenticationSource: String(policy?.authentication_source ?? "any"),
      allowedEmailDomains: domains,
      requireMfa: Boolean(policy?.require_mfa ?? false),
      encryptionMode: String(policy?.encryption_mode ?? "platform-unverified"),
      maxSessionMinutes: Number(policy?.max_session_minutes ?? 480),
      version: Number(policy?.version ?? 0),
      updatedAt: policy?.updated_at ? String(policy.updated_at) : null,
    },
    observedSignInSource: observedSource(request),
    domainOwnershipVerified: false,
    enterpriseFederationVerified: false,
    mfaAttestationAvailable: false,
    provisioning: "local-token-endpoint-only",
    encryption: {
      recoverySnapshots: organizationEncryptionConfigured(env) ? "application-aead-aes-gcm-256" : "not-configured",
      primaryDatabaseAndObjectStorage: "not-application-encrypted",
      storageEncryptionIndependentlyVerified: false,
      externalCustomerManagedKeys: false,
      rootProvider: organizationEncryptionConfigured(env) ? "environment-development-root" : "not-configured",
      keys: activeKeys.results.map((key) => ({ id: String(key.key_id), version: Number(key.version), status: String(key.status), createdAt: String(key.created_at), retiredAt: key.retired_at ? String(key.retired_at) : null })),
    },
  };
}

async function saveSecurityPolicy(request: Request, env: WorkerEnv, actor: PilotUser, organizationId: string) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const current = await securityPosture(env, organizationId, request);
  const source = String(body.authenticationSource ?? current.policy.authenticationSource);
  if (!["any", "openai-workspace", "cloudflare-access", "local-development"].includes(source)) return Response.json({ error: "valid_identity_source_required" }, { status: 400 });
  if (source !== "any" && source !== observedSource(request)) return Response.json({ error: "owner_identity_policy_lockout" }, { status: 409 });
  if (body.requireMfa === true) return Response.json({ error: "verified_mfa_attestation_unavailable" }, { status: 409 });
  const requestedDomains = body.allowedEmailDomains === undefined ? current.policy.allowedEmailDomains : body.allowedEmailDomains;
  if (!Array.isArray(requestedDomains) || requestedDomains.length > 20 || requestedDomains.some((domain) => typeof domain !== "string" || !/^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))) {
    return Response.json({ error: "valid_email_domain_allowlist_required" }, { status: 400 });
  }
  const domains = [...new Set(requestedDomains.map((domain) => String(domain).toLowerCase()))].sort();
  if (domains.length && !domains.includes(actor.email.toLowerCase().split("@").at(-1) ?? "")) return Response.json({ error: "owner_identity_policy_lockout" }, { status: 409 });
  const encryption = String(body.encryptionMode ?? current.policy.encryptionMode);
  if (!["platform-unverified", "snapshot-envelope"].includes(encryption)) return Response.json({ error: "required_storage_encryption_unavailable" }, { status: 409 });
  if (encryption === "snapshot-envelope" && !organizationEncryptionConfigured(env)) return Response.json({ error: "organization_encryption_root_unavailable" }, { status: 409 });
  const sessionMinutes = Number(body.maxSessionMinutes ?? current.policy.maxSessionMinutes);
  if (!Number.isSafeInteger(sessionMinutes) || sessionMinutes < 5 || sessionMinutes > 480) return Response.json({ error: "valid_identity_session_duration_required", maximumMinutes:480 }, { status: 400 });
  if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.policy.version) return Response.json({ error: "security_policy_version_conflict", version: current.policy.version }, { status: 409 });
  const now = new Date().toISOString();
  const ownerGuard=`EXISTS(SELECT 1 FROM organizations governed
    JOIN organization_memberships owner ON owner.organization_id=governed.organization_id AND owner.user_id=governed.owner_user_id
      AND owner.role='owner' AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
    JOIN users identity ON identity.user_id=owner.user_id AND identity.consent_version=?
    WHERE governed.organization_id=? AND governed.owner_user_id=? AND governed.status='active')`;
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO organization_security_policies(organization_id,authentication_source,allowed_domains_json,require_mfa,encryption_mode,max_session_minutes,version,updated_by_user_id,updated_at)
      SELECT ?,?,?,0,?,?,1,?,? WHERE ${ownerGuard}
      ON CONFLICT(organization_id) DO UPDATE SET authentication_source=excluded.authentication_source,
        allowed_domains_json=excluded.allowed_domains_json,encryption_mode=excluded.encryption_mode,max_session_minutes=excluded.max_session_minutes,
        version=organization_security_policies.version+1,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at
      WHERE organization_security_policies.version=? AND ${ownerGuard}`)
      .bind(organizationId,source,JSON.stringify(domains),encryption,sessionMinutes,actor.userId,now,
        POLICY_VERSION,organizationId,actor.userId,current.policy.version,POLICY_VERSION,organizationId,actor.userId),
    env.DB.prepare(`UPDATE organizations SET updated_at=? WHERE organization_id=? AND owner_user_id=? AND status='active'
      AND EXISTS(SELECT 1 FROM organization_security_policies updated WHERE updated.organization_id=organizations.organization_id
        AND updated.version=? AND updated.updated_at=? AND updated.updated_by_user_id=?)`)
      .bind(now,organizationId,actor.userId,current.policy.version+1,now,actor.userId),
    env.DB.prepare(`UPDATE project_context_sessions SET revoked_at=? WHERE organization_id=? AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM organizations changed WHERE changed.organization_id=project_context_sessions.organization_id
        AND changed.owner_user_id=? AND changed.updated_at=?)
      AND EXISTS(SELECT 1 FROM organization_security_policies updated WHERE updated.organization_id=project_context_sessions.organization_id
        AND updated.version=? AND updated.updated_at=? AND updated.updated_by_user_id=?)`)
      .bind(now,organizationId,actor.userId,now,current.policy.version+1,now,actor.userId),
    env.DB.prepare(`UPDATE shares SET revoked_at=? WHERE revoked_at IS NULL AND share_id IN(
      SELECT scope.share_id FROM share_scopes scope JOIN organization_projects project
        ON project.organization_id=? AND project.project_id=scope.project_id AND project.owner_user_id=scope.owner_id
    ) AND EXISTS(SELECT 1 FROM organizations changed WHERE changed.organization_id=? AND changed.owner_user_id=? AND changed.updated_at=?)
      AND EXISTS(SELECT 1 FROM organization_security_policies updated WHERE updated.organization_id=?
      AND updated.version=? AND updated.updated_at=? AND updated.updated_by_user_id=?)`)
      .bind(now,organizationId,organizationId,actor.userId,now,organizationId,current.policy.version+1,now,actor.userId),
    env.DB.prepare(`UPDATE organization_provisioning_credentials SET status='revoked',revoked_at=?
      WHERE organization_id=? AND status='active' AND revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM organizations changed WHERE changed.organization_id=organization_provisioning_credentials.organization_id
          AND changed.owner_user_id=? AND changed.updated_at=?)
        AND EXISTS(SELECT 1 FROM organization_security_policies updated
          WHERE updated.organization_id=organization_provisioning_credentials.organization_id AND updated.version=?
            AND updated.updated_at=? AND updated.updated_by_user_id=?)`)
      .bind(now,organizationId,actor.userId,now,current.policy.version+1,now,actor.userId),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1 || Number(results[1]?.meta.changes ?? 0) !== 1) return Response.json({ error: "security_policy_version_conflict" }, { status: 409 });
  await cancelProjectActorJobs(env, actor, { organizationId });
  await recordOrganizationAudit(env, organizationId, actor, "OrganizationSecurityPolicyUpdated", "security-policy", organizationId, { version: current.policy.version + 1, domainCount: domains.length, maxSessionMinutes: sessionMinutes });
  return Response.json(await securityPosture(env, organizationId, request), { headers: { "set-cookie": projectContextCookie(request, "", 0) } });
}

async function tenantRetentionHealth(env: WorkerEnv, organizationId: string) {
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN held=0 THEN 1 ELSE 0 END),0) AS pending_count,
    COALESCE(SUM(CASE WHEN held=1 THEN 1 ELSE 0 END),0) AS held_count,
    MIN(CASE WHEN held=0 THEN expires_at ELSE NULL END) AS oldest_expired_at FROM (
    SELECT content.expires_at AS expires_at,
      CASE WHEN (
        scope.classification='governed-evidence' AND EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=scope.organization_id AND policy.legal_hold=1)
        OR EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=scope.organization_id AND hold.status='active'
          AND (hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=scope.project_access_id OR hold.scope_kind='content' AND hold.resource_id=scope.content_id))
      ) THEN 1 ELSE 0 END AS held
    FROM private_content_retention_scopes scope JOIN private_content content ON content.content_id=scope.content_id
      AND content.redacted_at IS NULL AND content.kind!='document-artifact' AND content.expires_at<=?
    WHERE scope.organization_id=?
    UNION ALL
    SELECT revision.expires_at AS expires_at,
      CASE WHEN EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=revision.organization_id AND policy.legal_hold=1)
        OR EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=revision.organization_id AND hold.status='active'
          AND (hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=revision.project_access_id OR hold.scope_kind='artifact' AND hold.resource_id=revision.artifact_id))
        THEN 1 ELSE 0 END AS held
    FROM artifact_revisions revision WHERE revision.organization_id=? AND revision.redacted_at IS NULL AND revision.expires_at<=?
  )`).bind(now,organizationId,organizationId,now).first<{pending_count:number;held_count:number;oldest_expired_at:string|null}>();
  return{pendingCount:Number(rows?.pending_count??0),heldCount:Number(rows?.held_count??0),oldestExpiredAt:rows?.oldest_expired_at??null};
}

async function schedulerEvidence(env: WorkerEnv, tenantBacklog: number) {
  const scheduled = await env.DB.prepare("SELECT trigger_kind,status,started_at,finished_at,error_code FROM retention_sweep_runs WHERE trigger_kind='scheduled' ORDER BY started_at DESC LIMIT 1")
    .first<{ trigger_kind: string; status: string; started_at: string; finished_at: string | null; error_code: string | null }>();
  const age = scheduled ? Date.now() - Date.parse(scheduled.finished_at ?? scheduled.started_at) : Number.POSITIVE_INFINITY;
  const state = !scheduled ? "unobserved" : scheduled.status === "failed" ? "failed" : scheduled.status === "running" && age > 900_000 ? "stalled"
    : scheduled.status === "running" ? "running" : age > 86_400_000 ? "overdue" : tenantBacklog > 0 ? "backlogged" : "healthy";
  return {
    state,
    hostingScheduleVerified: false,
    schedulerConfigured: false,
    lastScheduledAt: scheduled?.started_at ?? null,
    lastCompletedAt: scheduled?.finished_at ?? null,
    errorCode: scheduled?.error_code ?? null,
    note: "A local scheduled handler exists; no hosted cron schedule or no-traffic execution has been independently configured.",
  };
}

async function assurance(request: Request, env: WorkerEnv, actor: PilotUser, organizationId: string) {
  const [retention, security, packageCount, taskCount, recovery,restoration] = await Promise.all([
    tenantRetentionHealth(env, organizationId),
    securityPosture(env, organizationId, request),
    env.DB.prepare("SELECT COUNT(*) AS count FROM organization_context_packages WHERE organization_id=? AND status='active'").bind(organizationId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM project_review_tasks WHERE organization_id=? AND status='pending'").bind(organizationId).first<{ count: number }>(),
    env.DB.prepare("SELECT snapshot_id,created_at FROM organization_recovery_snapshots WHERE organization_id=? AND status='available' ORDER BY created_at DESC LIMIT 1").bind(organizationId).first<{ snapshot_id: string; created_at: string }>(),
    env.DB.prepare("SELECT drill_id,created_at FROM organization_recovery_drills WHERE organization_id=? AND status='isolated-rollback-verified' ORDER BY created_at DESC LIMIT 1")
      .bind(organizationId).first<{drill_id:string;created_at:string}>(),
  ]);
  const scheduler = await schedulerEvidence(env, retention.pendingCount);
  const controls = [
    { id: "tenant-access", status: "implemented", summary: "Active exact-organization membership and project-specific authorization are enforced." },
    { id: "identity-policy", status: security.policy.version ? "implemented" : "partial", summary: "Allowed email domains and observed upstream identity source can be enforced; domain ownership, SSO, and MFA remain unverified." },
    { id: "context-packages", status: "implemented", summary: "Tenant-owned immutable context packages retain explicitly licensed original source bytes, verified evidence, and version-specific project bindings." },
    { id: "independent-review", status: "implemented", summary: "Assigned review binds the reviewer, exact artifact revision, and content digest." },
    { id: "targeted-automation", status: "implemented", summary: "Deterministic in-app review reminders cannot authorize provider spending or external delivery." },
    { id: "retention-scheduling", status: scheduler.hostingScheduleVerified ? "implemented" : "partial", summary: "A bounded local scheduled handler and receipts exist; hosted scheduling remains unconfigured." },
    { id: "legal-holds", status: "implemented", summary: "Organization, project, content, and artifact holds prevent governed cleanup or tenant deletion." },
    { id: "snapshot-encryption", status: organizationEncryptionConfigured(env) ? "implemented" : "pending", summary: organizationEncryptionConfigured(env) ? "Recovery snapshots use AES-GCM with per-tenant wrapped keys and tenant-bound associated data." : "An environment-owned 32-byte root is required before encrypted snapshots can be created." },
    { id: "primary-storage-encryption", status: "unverified", summary: "Existing primary D1 payloads and R2 objects are not application-encrypted; platform encryption has not been independently attested." },
    { id: "tenant-deletion", status: "partial", summary: "Exact tenant records and objects can be locally erased, while immutable operational envelopes, platform backups, and other devices remain disclosed exceptions." },
    { id: "disaster-recovery", status: recovery ? "partial" : "pending", summary: restoration?"An isolated staged restoration was verified and automatically rolled back; production failover and external backup replication remain unverified.":"Encrypted snapshots and integrity-verification drills are available; staged restoration must still be verified and production failover remains unavailable." },
    { id: "enterprise-federation", status: "unverified", summary: "No independently verified customer SSO, MFA, or SCIM provider is connected." },
    { id: "project-custody", status: "partial", summary: "Packages are tenant-owned, but project history and original media still depend on an individual project custodian." },
    { id: "independent-assurance", status: "unverified", summary: "SOC 2, ISO, DPA, penetration testing, accessibility attestation, and contractual recovery commitments require external evidence." },
  ];
  const blockers = controls.filter((control) => control.status !== "implemented").map((control) => control.id);
  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    retention,
    scheduler,
    identity: security,
    packages:{activeCount:Number(packageCount?.count??0),sourceFileCustody:"tenant-owned-verified-r2-copies"},
    reviews: { pendingCount: Number(taskCount?.count ?? 0), delivery: "in-app-only" },
    recovery: { lastSnapshotAt: recovery?.created_at ?? null, replicatedBackupVerified: false, isolatedRestoreVerified:false,isolatedRollbackRestoreVerified:Boolean(restoration),productionTenantRestoreAvailable:false,lastIsolatedRollbackRestoreAt:restoration?.created_at??null },
    controls,
    enterpriseReady: blockers.length === 0,
    enterpriseBlockers: blockers,
    viewerRole: actor.access.organizations.find((organization) => organization.organizationId === organizationId)?.role ?? "member",
  };
}

const EXPORT_DETAIL_KEYS = new Set(["version", "blockCount", "changedBlockCount", "domainCount", "maxSessionMinutes", "reviewDueHours", "reminderHours", "participantCapMicrousd", "organizationCapMicrousd", "maxParticipants", "evidenceDays", "processedCount", "resourceCount", "durationMs"]);

async function assuranceExport(request: Request, env: WorkerEnv, actor: PilotUser, organizationId: string) {
  const report = await assurance(request, env, actor, organizationId);
  const rows = await env.DB.prepare("SELECT audit_id,action,resource_kind,resource_id,detail_json,occurred_at FROM organization_audit_events WHERE organization_id=? ORDER BY occurred_at DESC LIMIT 250")
    .bind(organizationId).all<Record<string, unknown>>();
  const audit = rows.results.map((row) => {
    let details: Record<string, unknown> = {};
    try { details = JSON.parse(String(row.detail_json)) as Record<string, unknown>; } catch { details = {}; }
    const safe = Object.fromEntries(Object.entries(details).filter(([key, value]) => EXPORT_DETAIL_KEYS.has(key) && (typeof value === "number" || typeof value === "boolean")));
    return { id: String(row.audit_id), action: String(row.action), resourceKind: String(row.resource_kind), resourceId: String(row.resource_id), detail: safe, occurredAt: String(row.occurred_at) };
  });
  return Response.json({ ...report, audit }, { headers: { "content-disposition": `attachment; filename="forma-assurance-${organizationId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json"`, "cache-control": "private, no-store" } });
}

async function handleHolds(request: Request, env: WorkerEnv, actor: PilotUser, organizationId: string, holdId = "") {
  if (request.method === "GET" && !holdId) {
    const rows = await env.DB.prepare("SELECT hold_id,scope_kind,resource_id,reason,status,created_by_user_id,created_at,released_at FROM organization_legal_holds WHERE organization_id=? ORDER BY created_at DESC LIMIT 100")
      .bind(organizationId).all<Record<string, unknown>>();
    return Response.json({ holds: rows.results });
  }
  if (request.method === "POST" && !holdId) {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const scope = String(body.scope ?? "organization");
    const resourceId = scope === "organization" ? organizationId : String(body.resourceId ?? "").trim();
    const reason = String(body.reason ?? "").trim().slice(0, 300);
    if (!["organization", "project", "content", "artifact"].includes(scope) || !resourceId || !reason) return Response.json({ error: "valid_legal_hold_required" }, { status: 400 });
    if(scope!=="organization"){
      let projectAccessId=scope==="project"?resourceId:"";
      if(scope==="content"){
        const retained=await env.DB.prepare(`SELECT scope.project_access_id FROM private_content_retention_scopes scope
          JOIN private_content content ON content.content_id=scope.content_id AND content.redacted_at IS NULL
          WHERE scope.organization_id=? AND scope.content_id=? LIMIT 1`)
          .bind(organizationId,resourceId).first<{project_access_id:string}>();
        projectAccessId=retained?.project_access_id??"";
      }
      if(scope==="artifact"){
        const artifact=await env.DB.prepare(`SELECT project_access_id FROM project_resource_scopes
          WHERE organization_id=? AND resource_kind='artifact' AND resource_id=? LIMIT 1`)
          .bind(organizationId,resourceId).first<{project_access_id:string}>();
        projectAccessId=artifact?.project_access_id??"";
      }
      if(!projectAccessId||!hasCapability(actor,"project.read",{organizationId,projectAccessId}))return denied();
    }
    const id = uuidV7();
    const now = new Date().toISOString();
    try{
      const inserted=await env.DB.prepare(`INSERT INTO organization_legal_holds(hold_id,organization_id,scope_kind,resource_id,reason,status,created_by_user_id,created_at,released_at)
        SELECT ?,?,?,?,?,'active',?,?,NULL WHERE EXISTS(SELECT 1 FROM organizations governed
          JOIN organization_memberships authorized ON authorized.organization_id=governed.organization_id
            AND authorized.user_id=? AND authorized.role IN('owner','administrator') AND authorized.status='active'
            AND authorized.accepted_at IS NOT NULL AND authorized.revoked_at IS NULL
          JOIN users identity ON identity.user_id=authorized.user_id AND identity.consent_version=?
          WHERE governed.organization_id=? AND governed.status='active')
          AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion
            WHERE deletion.organization_id=? AND deletion.status IN('pending','partial','processing','completed'))`)
        .bind(id,organizationId,scope,resourceId,reason,actor.userId,now,actor.userId,POLICY_VERSION,organizationId,organizationId).run();
      if(Number(inserted.meta.changes??0)!==1)return Response.json({error:"organization_deletion_in_progress"},{status:409});
    }catch{return Response.json({error:"organization_deletion_in_progress"},{status:409});}
    await recordOrganizationAudit(env, organizationId, actor, "OrganizationLegalHoldCreated", "legal-hold", id, { scope });
    return Response.json({ holdId: id, scope, resourceId, status: "active", createdAt: now }, { status: 201 });
  }
  if (request.method === "DELETE" && holdId) {
    const now = new Date().toISOString();
    const updated = await env.DB.prepare("UPDATE organization_legal_holds SET status='released',released_at=? WHERE hold_id=? AND organization_id=? AND status='active'")
      .bind(now, holdId, organizationId).run();
    if (Number(updated.meta.changes ?? 0) !== 1) return new Response("Not found", { status: 404 });
    await recordOrganizationAudit(env, organizationId, actor, "OrganizationLegalHoldReleased", "legal-hold", holdId);
    return Response.json({ holdId, status: "released", releasedAt: now });
  }
  return new Response("Method not allowed", { status: 405 });
}

async function snapshotContents(env: WorkerEnv, actor: PilotUser, organizationId: string) {
  const projects = await env.DB.prepare("SELECT project_access_id,project_id,owner_user_id,status,created_at,updated_at FROM organization_projects WHERE organization_id=?")
    .bind(organizationId).all<Record<string, unknown>>();
  if(projects.results.some((project)=>project.status!=="active"||!hasCapability(actor,"project.read",{organizationId,projectAccessId:String(project.project_access_id)}))){
    return Response.json({ error: "organization_project_custody_access_required" }, { status: 403 });
  }
  const inaccessibleHeld=await env.DB.prepare(`SELECT retention.content_id FROM private_content_retention_scopes retention
    JOIN private_content content ON content.content_id=retention.content_id AND content.redacted_at IS NULL
    WHERE retention.organization_id=?
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes collaborative
        WHERE collaborative.organization_id=retention.organization_id AND collaborative.project_access_id=retention.project_access_id
          AND collaborative.resource_kind='content' AND collaborative.resource_id=retention.content_id
          AND collaborative.visibility='collaborative_output')
      AND(EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=retention.organization_id AND hold.status='active'
        AND(hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=retention.project_access_id
          OR hold.scope_kind='content' AND hold.resource_id=retention.content_id))
        OR retention.classification='governed-evidence' AND EXISTS(SELECT 1 FROM organization_retention_policies policy
          WHERE policy.organization_id=retention.organization_id AND policy.legal_hold=1)) LIMIT 1`).bind(organizationId).first();
  if(inaccessibleHeld)return Response.json({error:"organization_recovery_private_held_evidence_unavailable",message:"Legally held private conversations cannot be silently omitted or exposed in an organization-owner recovery snapshot."},{status:409});
  const statements = [
    env.DB.prepare(`SELECT event.*,secret.private_json,scope.project_access_id,scope.project_sequence,scope.actor_user_id
      FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
      LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
      WHERE scope.organization_id=? AND event.type NOT IN('ChatMessageSent','AssistantReasoned','ContextCompiled') ORDER BY scope.project_access_id,scope.project_sequence`).bind(organizationId),
    env.DB.prepare(`SELECT DISTINCT content.* FROM project_resource_scopes scope JOIN private_content content ON content.content_id=scope.resource_id
      WHERE scope.organization_id=? AND scope.resource_kind='content' AND scope.visibility='collaborative_output' AND content.redacted_at IS NULL
        AND(content.expires_at>? OR EXISTS(SELECT 1 FROM organization_legal_holds hold
          WHERE hold.organization_id=scope.organization_id AND hold.status='active'
            AND(hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=scope.project_access_id
              OR hold.scope_kind='content' AND hold.resource_id=content.content_id
              OR hold.scope_kind='artifact' AND EXISTS(SELECT 1 FROM project_resource_scopes artifact
                JOIN events rendered ON rendered.event_id=artifact.source_event_id
                LEFT JOIN event_private_payloads authored ON authored.private_event_id=rendered.event_id
                  AND authored.owner_id=artifact.owner_user_id AND authored.redacted_at IS NULL
                WHERE artifact.organization_id=scope.organization_id AND artifact.project_access_id=scope.project_access_id
                  AND artifact.owner_user_id=scope.owner_user_id AND artifact.resource_kind='artifact' AND artifact.resource_id=hold.resource_id
                  AND json_extract(COALESCE(authored.private_json,rendered.payload),'$.content_ref')=content.content_id)))
          OR EXISTS(SELECT 1 FROM organization_retention_policies policy
            JOIN private_content_retention_scopes retention ON retention.organization_id=policy.organization_id
              AND retention.content_id=content.content_id AND retention.classification='governed-evidence'
            WHERE policy.organization_id=scope.organization_id AND policy.legal_hold=1))`).bind(organizationId,new Date().toISOString()),
    env.DB.prepare(`SELECT revision.* FROM artifact_revisions revision
      WHERE revision.organization_id=? AND revision.redacted_at IS NULL
        AND(revision.expires_at>? OR EXISTS(SELECT 1 FROM organization_legal_holds hold
          WHERE hold.organization_id=revision.organization_id AND hold.status='active'
            AND(hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=revision.project_access_id
              OR hold.scope_kind='artifact' AND hold.resource_id=revision.artifact_id))
          OR EXISTS(SELECT 1 FROM organization_retention_policies policy
            WHERE policy.organization_id=revision.organization_id AND policy.legal_hold=1))`).bind(organizationId,new Date().toISOString()),
    env.DB.prepare("SELECT * FROM organization_context_packages WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM organization_context_package_versions WHERE organization_id=? AND redacted_at IS NULL").bind(organizationId),
    env.DB.prepare("SELECT * FROM organization_context_package_contents WHERE organization_id=? AND redacted_at IS NULL").bind(organizationId),
    env.DB.prepare("SELECT * FROM organization_context_package_sources WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM project_context_package_bindings WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM project_context_package_members WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM project_review_tasks WHERE organization_id=?").bind(organizationId),
    env.DB.prepare(`SELECT grant_row.* FROM capability_grants grant_row
      JOIN organization_projects project ON project.project_access_id=grant_row.project_access_id
        AND project.organization_id=grant_row.organization_id AND project.status='active'
      JOIN organization_memberships member ON member.organization_id=grant_row.organization_id
        AND member.user_id=grant_row.user_id AND member.status='active'
        AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      WHERE grant_row.organization_id=? AND grant_row.scope_type='project' AND grant_row.status='active'
        AND grant_row.revoked_at IS NULL AND(grant_row.expires_at IS NULL OR grant_row.expires_at>?)`)
      .bind(organizationId,new Date().toISOString()),
    env.DB.prepare("SELECT * FROM project_memberships WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM organization_memberships WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM organization_legal_holds WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT audit_id,organization_id,actor_user_id,action,resource_kind,resource_id,detail_json,occurred_at FROM organization_audit_events WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM project_resource_scopes WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM organization_retention_policies WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM organization_security_policies WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM project_automation_policies WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM pilot_cohorts WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM pilot_participants WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM organization_identity_bindings WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM organization_identity_groups WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM organization_identity_group_members WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM project_migration_states WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM organizations WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT * FROM private_content_retention_scopes WHERE organization_id=?").bind(organizationId),
  ];
  const results = await env.DB.batch<Record<string, unknown>>(statements);
  const names=["events","content","revisions","packages","packageVersions","packageContents","packageSources","packageBindings","packageMembers","reviewTasks","capabilityGrants","projectMemberships","memberships","legalHolds","audit","resources","retentionPolicies","securityPolicies","automationPolicies","pilotCohorts","pilotParticipants","identityBindings","identityGroups","identityGroupMembers","projectMigrations","organizations","retentionScopes"];
  const records = Object.fromEntries(results.map((result, index) => [names[index]!, result.results]));
  for(const revision of records.revisions as Array<Record<string,unknown>>){
    if(await sha256(String(revision.content_json??""))!==String(revision.content_sha256??""))
      return Response.json({error:"organization_recovery_revision_integrity_failed"},{status:409});
  }
  const packageVersions=new Map((records.packageVersions as Array<Record<string,unknown>>).map((version)=>[String(version.version_id),version]));
  const sourceObjects:Array<{resource_kind:string;resource_id:string;owner_user_id:string}>=[];
  for(const content of records.packageContents as Array<Record<string,unknown>>){
    const version=packageVersions.get(String(content.version_id));
    if(!version||String(version.organization_id)!==organizationId||await sha256(String(content.content_json??""))!==String(version.content_sha256??""))
      return Response.json({error:"organization_recovery_context_package_integrity_failed"},{status:409});
    let snapshot:{schema?:unknown;organizationId?:unknown;blocks?:Array<{source?:{objectKey?:unknown}}>};
    try{snapshot=JSON.parse(String(content.content_json)) as typeof snapshot;}catch{return Response.json({error:"organization_recovery_context_package_integrity_failed"},{status:409});}
    if(snapshot.schema!==1||snapshot.organizationId!==organizationId||!Array.isArray(snapshot.blocks))
      return Response.json({error:"organization_recovery_context_package_integrity_failed"},{status:409});
    for(const block of snapshot.blocks)if(block.source){
      if(typeof block.source.objectKey!=="string"||!block.source.objectKey.startsWith(`organization-context/${organizationId}/`))
        return Response.json({error:"organization_recovery_context_package_integrity_failed"},{status:409});
      sourceObjects.push({resource_kind:"organization-context-media",resource_id:block.source.objectKey,owner_user_id:organizationId});
    }
  }
  const media: Array<{ key: string; ownerId: string; contentSha256: string; bytes: string; contentType: string; metadata: Record<string, string> }> = [];
  const resources = records.resources as Array<Record<string, unknown>>;
  const storedResources=[...new Map([...resources.filter((item)=>item.resource_kind==="media"),...sourceObjects].map((resource)=>[String(resource.resource_id),resource])).values()];
  let encodedMediaBytes=0;
  for(const resource of storedResources){
    if (typeof env.MEDIA.get !== "function") return Response.json({ error: "organization_recovery_media_unavailable" }, { status: 409 });
    const object = await env.MEDIA.get(String(resource.resource_id));
    const metadata=object?.customMetadata;
    if(!object||!metadata||(resource.resource_kind==="organization-context-media"?metadata.organizationId!==organizationId:metadata.ownerId!==String(resource.owner_user_id)))return Response.json({error:"organization_recovery_media_integrity_failed"},{status:409});
    const declaredSize=Number((object as {size?:unknown}).size??0);
    if(Number.isFinite(declaredSize)&&declaredSize>0&&encodedMediaBytes+Math.ceil(declaredSize/3)*4>MAX_RECOVERY_PAYLOAD_BYTES)
      return Response.json({error:"organization_recovery_snapshot_too_large",maximumBytes:MAX_RECOVERY_PAYLOAD_BYTES},{status:413});
    const buffer = await new Response(object.body).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    encodedMediaBytes+=Math.ceil(bytes.byteLength/3)*4;
    if(encodedMediaBytes>MAX_RECOVERY_PAYLOAD_BYTES)return Response.json({error:"organization_recovery_snapshot_too_large",maximumBytes:MAX_RECOVERY_PAYLOAD_BYTES},{status:413});
    const digest = await sha256(bytes);
    if (metadata.sha256 && metadata.sha256 !== digest) return Response.json({ error: "organization_recovery_media_integrity_failed" }, { status: 409 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    media.push({ key: String(resource.resource_id), ownerId: String(resource.owner_user_id), contentSha256: digest, bytes: base64(bytes), contentType: headers.get("content-type") ?? "application/octet-stream", metadata });
  }
  const payload = { schema: 1, organizationId, projects: projects.results, records, media };
  const serialized = JSON.stringify(payload);
  if(new TextEncoder().encode(serialized).byteLength>MAX_RECOVERY_PAYLOAD_BYTES)return Response.json({error:"organization_recovery_snapshot_too_large",maximumBytes:MAX_RECOVERY_PAYLOAD_BYTES},{status:413});
  return{serialized,manifest:await recoveryManifest(payload)};
}

async function recoveryManifest(payload:{organizationId:string;projects:unknown[];records:Record<string,unknown[]>;media:Array<{key:string;contentSha256:string}>}){
  const counts=Object.fromEntries(Object.entries(payload.records).map(([name,rows])=>[name,rows.length]));
  const objects=await Promise.all(payload.media.map(async(object)=>({keySha256:await sha256(object.key),contentSha256:object.contentSha256})));
  return{schema:1,organizationId:payload.organizationId,projectCount:payload.projects.length,counts,media:objects,originalMediaIncluded:true,actorPrivateConversationsIncluded:false,personalCompiledPreferencesIncluded:false};
}

type VerifiedRecoveryPayload={schema:number;organizationId:string;projects:unknown[];records:Record<string,unknown[]>;media:Array<{key:string;bytes:string;contentSha256:string}>};
async function verifyIsolatedRollbackRestore(env:WorkerEnv,actor:PilotUser,organizationId:string,payload:VerifiedRecoveryPayload){
  const organizations=payload.records.organizations??[];
  const root=organizations.length===1?organizations[0] as Record<string,unknown>:null;
  if(!root||root.organization_id!==organizationId||root.status!=="active")
    return Response.json({error:"organization_recovery_restore_custody_invalid"},{status:409});
  const memberships=new Map((payload.records.memberships??[]).map((member)=>{const row=member as Record<string,unknown>;return[String(row.user_id),row] as const;}));
  const historicalOwnerId=String(root.owner_user_id??"");
  const owner=memberships.get(historicalOwnerId);
  if(!owner||owner.role!=="owner"||owner.status!=="active"||!owner.accepted_at||owner.revoked_at)
    return Response.json({error:"organization_recovery_restore_custody_invalid"},{status:409});
  const projects=new Map(payload.projects.map((item)=>{const row=item as Record<string,unknown>;return[String(row.project_access_id),row] as const;}));
  if(projects.size!==payload.projects.length||[...projects.values()].some((project)=>{
    const custodian=memberships.get(String(project.owner_user_id));
    return project.status!=="active"||!custodian||custodian.status!=="active"||!custodian.accepted_at||Boolean(custodian.revoked_at);
  }))
    return Response.json({error:"organization_recovery_restore_project_invalid"},{status:409});
  const seen=new Set<string>();
  for(const value of payload.records.events??[]){
    const event=value as Record<string,unknown>;
    const project=projects.get(String(event.project_access_id));
    const order=Number(event.project_sequence);
    const sequenceKey=`${String(event.project_access_id)}:${order}`;
    if(!project||event.stream_id!==`creative:${String(project.owner_user_id)}`||!Number.isSafeInteger(order)||order<1||seen.has(sequenceKey))
      return Response.json({error:"organization_recovery_restore_event_invalid"},{status:409});
    seen.add(sequenceKey);
    try{
      const publicBody=JSON.parse(String(event.payload)) as Record<string,unknown>;
      if(publicBody._private_ref!==undefined&&(publicBody._private_ref!==event.event_id||typeof event.private_json!=="string"))
        return Response.json({error:"organization_recovery_restore_event_invalid"},{status:409});
      const authoritative=typeof event.private_json==="string"?JSON.parse(event.private_json) as unknown:publicBody;
      if(!authoritative||typeof authoritative!=="object"||Array.isArray(authoritative))
        return Response.json({error:"organization_recovery_restore_event_invalid"},{status:409});
      const claimedProject=(authoritative as Record<string,unknown>).project_id;
      if(claimedProject!==undefined&&claimedProject!==project.project_id)
        return Response.json({error:"organization_recovery_restore_event_invalid"},{status:409});
    }catch{return Response.json({error:"organization_recovery_restore_event_invalid"},{status:409});}
  }
  for(const [kind,values] of Object.entries(payload.records)){
    if(!Array.isArray(values))return Response.json({error:"organization_recovery_restore_record_invalid"},{status:409});
    for(const value of values){
      if(!value||typeof value!=="object"||Array.isArray(value))return Response.json({error:"organization_recovery_restore_record_invalid"},{status:409});
      const row=value as Record<string,unknown>;
      if(row.organization_id!==undefined&&row.organization_id!==organizationId)return Response.json({error:"organization_recovery_restore_tenant_invalid"},{status:409});
      const project=row.project_access_id?projects.get(String(row.project_access_id)):undefined;
      if(row.project_access_id&&!project)return Response.json({error:"organization_recovery_restore_project_invalid"},{status:409});
      if(project&&row.project_id!==undefined&&row.project_id!==null&&row.project_id!==project.project_id)
        return Response.json({error:"organization_recovery_restore_project_invalid"},{status:409});
      if(row.source_project_access_id&&!projects.has(String(row.source_project_access_id)))
        return Response.json({error:"organization_recovery_restore_project_invalid"},{status:409});
      if(project&&kind==="resources"&&row.owner_user_id!==project.owner_user_id
        ||project&&kind==="revisions"&&row.owner_id!==project.owner_user_id)
        return Response.json({error:"organization_recovery_restore_custody_invalid"},{status:409});
      if(kind==="content"){
        const owner=memberships.get(String(row.owner_id));
        if(!owner||owner.status!=="active"||!owner.accepted_at||owner.revoked_at)
          return Response.json({error:"organization_recovery_restore_custody_invalid"},{status:409});
      }
    }
  }
  const staged=[...payload.projects.map((row,index)=>({kind:"projects",key:`projects:${index}`,row})),
    ...Object.entries(payload.records).flatMap(([kind,rows])=>rows.map((row,index)=>({kind,key:`${kind}:${index}`,row}))),
    ...payload.media.map((object,index)=>({kind:"media",key:`media:${index}`,row:{key:object.key,contentSha256:object.contentSha256,byteLength:bytesFromBase64(object.bytes).byteLength}}))];
  const statements:D1PreparedStatement[]=[
    env.DB.prepare("CREATE TABLE forma_recovery_rollback_stage(row_kind TEXT NOT NULL,row_key TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,row_json TEXT NOT NULL CHECK(json_valid(row_json)))"),
    env.DB.prepare("CREATE TABLE forma_recovery_rollback_guard(token TEXT PRIMARY KEY NOT NULL)"),
    env.DB.prepare("CREATE TRIGGER forma_recovery_rollback_trigger BEFORE INSERT ON forma_recovery_rollback_guard BEGIN SELECT RAISE(ABORT,'forma_isolated_restore_verified_rollback'); END"),
  ];
  for(let offset=0;offset<staged.length;){
    const chunk:Array<typeof staged[number]>=[];
    let parameterBytes=2;
    while(offset<staged.length&&chunk.length<30){
      const row=staged[offset]!,rowBytes=new TextEncoder().encode(JSON.stringify(row)).byteLength;
      if(rowBytes>1_750_000)return Response.json({error:"organization_recovery_restore_record_too_large"},{status:409});
      if(chunk.length&&parameterBytes+rowBytes+1>1_750_000)break;
      chunk.push(row);parameterBytes+=rowBytes+1;offset+=1;
    }
    statements.push(env.DB.prepare(`INSERT INTO forma_recovery_rollback_stage(row_kind,row_key,organization_id,row_json)
      SELECT json_extract(entry.value,'$.kind'),json_extract(entry.value,'$.key'),?,json_extract(entry.value,'$.row')
      FROM json_each(?) entry`).bind(organizationId,JSON.stringify(chunk)));
  }
  statements.push(env.DB.prepare(`SELECT CASE WHEN (SELECT COUNT(*) FROM forma_recovery_rollback_stage)=?
    AND EXISTS(SELECT 1 FROM forma_recovery_rollback_stage WHERE row_kind='organizations'
      AND json_extract(row_json,'$.organization_id')=? AND json_extract(row_json,'$.owner_user_id')=?)
    THEN 1 ELSE json('organization recovery staging integrity failed') END AS verified`).bind(staged.length,organizationId,historicalOwnerId));
  statements.push(env.DB.prepare("INSERT INTO forma_recovery_rollback_guard(token) VALUES(?)").bind("rollback-and-prove-isolation"));
  try{
    await env.DB.batch(statements);
    return Response.json({error:"organization_recovery_restore_rollback_not_verified"},{status:409});
  }catch(error){
    if(!(error instanceof Error)||!error.message.includes("forma_isolated_restore_verified_rollback"))
      return Response.json({error:"organization_recovery_restore_staging_failed"},{status:409});
  }
  const residual=await env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name IN('forma_recovery_rollback_stage','forma_recovery_rollback_guard','forma_recovery_rollback_trigger')")
    .first<{count:number}>();
  if(Number(residual?.count??0)!==0)return Response.json({error:"organization_recovery_restore_rollback_not_verified"},{status:409});
  return{restoredRecordCount:staged.length,restoredProjectCount:payload.projects.length,verifiedObjectCount:payload.media.length};
}

async function handleRecovery(request: Request, env: WorkerEnv, actor: PilotUser, organizationId: string) {
  if (request.method === "GET") {
    const [snapshots, drills] = await Promise.all([
      env.DB.prepare("SELECT snapshot_id,key_id,manifest_json,content_sha256,status,created_by_user_id,created_at FROM organization_recovery_snapshots WHERE organization_id=? ORDER BY created_at DESC LIMIT 30").bind(organizationId).all<Record<string, unknown>>(),
      env.DB.prepare("SELECT drill_id,snapshot_id,status,duration_ms,restored_record_count,verified_object_count,created_at FROM organization_recovery_drills WHERE organization_id=? ORDER BY created_at DESC LIMIT 30").bind(organizationId).all<Record<string, unknown>>(),
    ]);
    return Response.json({snapshots:snapshots.results,drills:drills.results,snapshotEncryption:organizationEncryptionConfigured(env)?"AES-GCM-256":"not-configured",maximumSnapshotBytes:MAX_RECOVERY_PAYLOAD_BYTES,largeSnapshotsStoredEncryptedInTenantObjectStorage:true,tenantScopedHistoricalPrivacyMigrationAvailable:true,isolatedRestoreAvailable:false,isolatedRollbackRestoreAvailable:true,productionTenantRestoreAvailable:false,replicatedBackupVerified:false});
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "create");
  if(action==="migrate-privacy"){
    if(body.organizationId!==organizationId||body.confirmation!=="MIGRATE_ORGANIZATION_HISTORICAL_EVENT_CONTENT")
      return Response.json({error:"explicit_organization_privacy_migration_confirmation_required"},{status:400});
    const projects=await env.DB.prepare("SELECT project_access_id,status FROM organization_projects WHERE organization_id=?")
      .bind(organizationId).all<{project_access_id:string;status:string}>();
    if(projects.results.some((project)=>project.status!=="active"||!hasCapability(actor,"project.read",{organizationId,projectAccessId:project.project_access_id})))
      return Response.json({error:"organization_project_custody_access_required"},{status:403});
    try{
      const migrated=await migrateLegacyEventPayloads(env,{organizationId,ownerUserId:actor.userId});
      await recordOrganizationAudit(env,organizationId,actor,"OrganizationHistoricalPrivacyMigrationCompleted","organization",organizationId,{resourceCount:migrated.migratedEvents});
      return Response.json({...migrated,organizationId,rowIdentitiesPreserved:true,otherOrganizationsUnchanged:true,historicalBackupsPurged:false});
    }catch(error){return Response.json({error:"historical_migration_failed",message:error instanceof Error?error.message:"Organization historical event migration failed."},{status:409});}
  }
  if(action==="cleanup"){
    const snapshotId=String(body.snapshotId??"");
    if(body.organizationId!==organizationId||!snapshotId||body.confirmation!=="RETRY_ORGANIZATION_RECOVERY_OBJECT_CLEANUP")
      return Response.json({error:"explicit_recovery_cleanup_confirmation_required"},{status:400});
    const pending=await env.DB.prepare("SELECT snapshot_id,key_id,encrypted_payload FROM organization_recovery_snapshots WHERE snapshot_id=? AND organization_id=? AND status='cleanup-pending'")
      .bind(snapshotId,organizationId).first<{snapshot_id:string;key_id:string;encrypted_payload:string}>();
    if(!pending)return Response.json({error:"organization_recovery_cleanup_unavailable"},{status:404});
    let pointer:Record<string,unknown>;
    try{pointer=JSON.parse(pending.encrypted_payload) as Record<string,unknown>;}
    catch{return Response.json({error:"organization_recovery_cleanup_integrity_failed"},{status:409});}
    const objectKey=`organization-recovery/${organizationId}/${snapshotId}.encrypted`;
    if(pointer.schema!==1||pointer.storage!=="organization-r2"||pointer.objectKey!==objectKey||typeof env.MEDIA.delete!=="function"||typeof env.MEDIA.head!=="function"&&typeof env.MEDIA.get!=="function")
      return Response.json({error:"organization_recovery_cleanup_integrity_failed"},{status:409});
    try{
      const current=typeof env.MEDIA.head==="function"?await env.MEDIA.head(objectKey):await env.MEDIA.get(objectKey);
      if(current){
        const metadata=current.customMetadata;
        if(metadata?.organizationId!==organizationId||metadata.snapshotId!==snapshotId||metadata.keyId!==pending.key_id||metadata.purpose!=="organization-recovery-snapshot")
          return Response.json({error:"organization_recovery_cleanup_integrity_failed"},{status:409});
        await env.MEDIA.delete(objectKey);
      }
      const remains=typeof env.MEDIA.head==="function"?await env.MEDIA.head(objectKey):await env.MEDIA.get(objectKey);
      if(remains)return Response.json({error:"organization_recovery_object_cleanup_pending",snapshotId,retryable:true},{status:503});
    }catch{return Response.json({error:"organization_recovery_object_cleanup_pending",snapshotId,retryable:true},{status:503});}
    const removed=await env.DB.prepare(`DELETE FROM organization_recovery_snapshots WHERE snapshot_id=? AND organization_id=? AND status='cleanup-pending'
      AND EXISTS(SELECT 1 FROM organizations governed JOIN organization_memberships owner
        ON owner.organization_id=governed.organization_id AND owner.user_id=governed.owner_user_id
          AND owner.role='owner' AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
        JOIN users identity ON identity.user_id=owner.user_id AND identity.consent_version=?
        WHERE governed.organization_id=? AND governed.owner_user_id=? AND governed.status='active')
      AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion
        WHERE deletion.organization_id=? AND deletion.status IN('pending','partial','processing','completed'))`)
      .bind(snapshotId,organizationId,POLICY_VERSION,organizationId,actor.userId,organizationId).run();
    if(Number(removed.meta.changes??0)!==1)return Response.json({error:"organization_recovery_cleanup_authorization_changed"},{status:409});
    await recordOrganizationAudit(env,organizationId,actor,"OrganizationRecoveryObjectCleanupCompleted","recovery-snapshot",snapshotId);
    return Response.json({snapshotId,status:"removed",objectDeletionVerified:true});
  }
  const restoring=action==="restore";
  if(restoring&&(body.organizationId!==organizationId||body.confirmation!=="RESTORE_ORGANIZATION_SNAPSHOT_TO_ISOLATED_ROLLBACK_STAGE"))
    return Response.json({error:"explicit_isolated_recovery_restore_confirmation_required"},{status:400});
  if (!organizationEncryptionConfigured(env)) return Response.json({ error: "organization_encryption_root_unavailable" }, { status: 409 });
  if (action === "create") {
    if (body.confirmation !== "CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT") return Response.json({ error: "explicit_recovery_snapshot_confirmation_required" }, { status: 400 });
    const contents = await snapshotContents(env, actor, organizationId);
    if (contents instanceof Response) return contents;
    const id = uuidV7();
    const now = new Date().toISOString();
    let encrypted: { keyId: string; ciphertext: string };
    try { encrypted = await sealOrganizationPayload(env, organizationId, id, contents.serialized); }
    catch (error) { return Response.json({ error: error instanceof OrganizationCryptoUnavailable ? error.message : "organization_recovery_encryption_failed" }, { status: 409 }); }
    const digest = await sha256(contents.serialized);
    let storedPayload=encrypted.ciphertext;
    let recoveryObjectKey="";
    const snapshotGuard=`EXISTS(SELECT 1 FROM organizations governed
      JOIN organization_memberships owner ON owner.organization_id=governed.organization_id AND owner.user_id=governed.owner_user_id
        AND owner.role='owner' AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
      JOIN users identity ON identity.user_id=owner.user_id AND identity.consent_version=?
      JOIN organization_key_versions active_key ON active_key.organization_id=governed.organization_id
        AND active_key.key_id=? AND active_key.status='active'
      WHERE governed.organization_id=? AND governed.owner_user_id=? AND governed.status='active')
      AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs removal
        WHERE removal.organization_id=? AND removal.status IN('pending','processing','partial','completed'))`;
    const guardBindings=()=>[POLICY_VERSION,encrypted.keyId,organizationId,actor.userId,organizationId] as const;
    const persist=(status:"staging"|"available")=>env.DB.prepare(`INSERT INTO organization_recovery_snapshots
      (snapshot_id,organization_id,key_id,manifest_json,encrypted_payload,content_sha256,status,created_by_user_id,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${snapshotGuard}`)
      .bind(id,organizationId,encrypted.keyId,JSON.stringify(contents.manifest),storedPayload,digest,status,actor.userId,now,...guardBindings()).run();
    const abandonStagedObject=async()=>{
      try{
        await env.MEDIA.delete(recoveryObjectKey);
        const remains=typeof env.MEDIA.head==="function"?await env.MEDIA.head(recoveryObjectKey):await env.MEDIA.get(recoveryObjectKey);
        if(remains)throw new Error("organization_recovery_object_cleanup_unverified");
        await env.DB.prepare("DELETE FROM organization_recovery_snapshots WHERE snapshot_id=? AND organization_id=? AND status='staging'")
          .bind(id,organizationId).run();
        return false;
      }catch{
        await env.DB.prepare("UPDATE organization_recovery_snapshots SET status='cleanup-pending' WHERE snapshot_id=? AND organization_id=? AND status='staging'")
          .bind(id,organizationId).run().catch(()=>undefined);
        return true;
      }
    };
    if(new TextEncoder().encode(encrypted.ciphertext).byteLength>MAX_INLINE_RECOVERY_BYTES){
      if(typeof env.MEDIA.put!=="function"||typeof env.MEDIA.get!=="function"||typeof env.MEDIA.delete!=="function")
        return Response.json({error:"organization_recovery_object_storage_unavailable"},{status:409});
      recoveryObjectKey=`organization-recovery/${organizationId}/${id}.encrypted`;
      const cipherDigest=await sha256(encrypted.ciphertext);
      storedPayload=JSON.stringify({schema:1,storage:"organization-r2",objectKey:recoveryObjectKey,ciphertextSha256:cipherDigest});
      try{
        const staged=await persist("staging");
        if(Number(staged.meta.changes??0)!==1)return Response.json({error:"organization_recovery_snapshot_unavailable"},{status:409});
      }catch{return Response.json({error:"organization_recovery_snapshot_unavailable"},{status:409});}
      try{
        await env.MEDIA.put(recoveryObjectKey,new TextEncoder().encode(encrypted.ciphertext).buffer,
          {httpMetadata:{contentType:"application/octet-stream"},customMetadata:{organizationId,snapshotId:id,keyId:encrypted.keyId,sha256:cipherDigest,purpose:"organization-recovery-snapshot"}});
        const promoted=await env.DB.prepare(`UPDATE organization_recovery_snapshots SET status='available'
          WHERE snapshot_id=? AND organization_id=? AND status='staging' AND ${snapshotGuard}`)
          .bind(id,organizationId,...guardBindings()).run();
        if(Number(promoted.meta.changes??0)!==1)throw new Error("organization_recovery_snapshot_unavailable");
      }catch{
        const pending=await abandonStagedObject();
        return Response.json({error:pending?"organization_recovery_object_cleanup_pending":"organization_recovery_snapshot_unavailable",retryable:pending,...(pending?{snapshotId:id}:{})},{status:pending?503:409});
      }
    }else{
      try{
        const saved=await persist("available");
        if(Number(saved.meta.changes??0)!==1)throw new Error("organization_recovery_snapshot_unavailable");
      }catch{return Response.json({error:"organization_recovery_snapshot_unavailable"},{status:409});}
    }
    await recordOrganizationAudit(env, organizationId, actor, "OrganizationEncryptedRecoverySnapshotCreated", "recovery-snapshot", id, { resourceCount: Object.values(contents.manifest.counts).reduce((total, count) => total + count, 0) });
    return Response.json({snapshotId:id,keyId:encrypted.keyId,contentSha256:digest,manifest:contents.manifest,encrypted:true,snapshotStorage:recoveryObjectKey?"tenant-encrypted-object":"encrypted-database",createdAt:now,isolatedRestoreAvailable:false,isolatedRollbackRestoreAvailable:true,productionTenantRestoreAvailable:false},{status:201});
  }
  if(!restoring&&(action!=="drill"||body.confirmation!=="VERIFY_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT"))return Response.json({error:"explicit_recovery_drill_confirmation_required"},{status:400});
  const snapshotId = String(body.snapshotId ?? "");
  const snapshot = await env.DB.prepare("SELECT snapshot_id,key_id,manifest_json,encrypted_payload,content_sha256 FROM organization_recovery_snapshots WHERE snapshot_id=? AND organization_id=? AND status='available'")
    .bind(snapshotId, organizationId).first<{ snapshot_id: string; key_id: string; manifest_json: string; encrypted_payload: string; content_sha256: string }>();
  if (!snapshot) return Response.json({ error: "organization_recovery_snapshot_unavailable" }, { status: 404 });
  const started = performance.now();
  let serialized: string;
  let ciphertext=snapshot.encrypted_payload;
  let pointer:Record<string,unknown>|null=null;
  try{const candidate=JSON.parse(snapshot.encrypted_payload) as Record<string,unknown>;if(candidate.storage==="organization-r2")pointer=candidate;}catch{/* Invalid inline envelopes are rejected by authenticated decryption below. */}
  if(pointer){
    const key=String(pointer.objectKey??"");
    if(pointer.schema!==1||key!==`organization-recovery/${organizationId}/${snapshotId}.encrypted`||typeof env.MEDIA.get!=="function")
      return Response.json({error:"organization_recovery_snapshot_integrity_failed"},{status:409});
    const object=await env.MEDIA.get(key);
    if(!object||object.customMetadata?.organizationId!==organizationId||object.customMetadata.snapshotId!==snapshotId
      ||object.customMetadata.keyId!==snapshot.key_id||object.customMetadata.purpose!=="organization-recovery-snapshot")
      return Response.json({error:"organization_recovery_snapshot_integrity_failed"},{status:409});
    ciphertext=await new Response(object.body).text();
    const actual=await sha256(ciphertext);
    if(actual!==String(pointer.ciphertextSha256??"")||object.customMetadata.sha256!==actual)
      return Response.json({error:"organization_recovery_snapshot_integrity_failed"},{status:409});
  }
  try { serialized = await openOrganizationPayload(env, organizationId, snapshotId, snapshot.key_id, ciphertext); }
  catch (error) { return Response.json({ error: error instanceof OrganizationCryptoUnavailable ? error.message : "organization_recovery_decryption_failed" }, { status: 409 }); }
  if (await sha256(serialized) !== snapshot.content_sha256) return Response.json({ error: "organization_recovery_snapshot_integrity_failed" }, { status: 409 });
  let payload:VerifiedRecoveryPayload;
  try { payload = JSON.parse(serialized) as typeof payload; } catch { return Response.json({ error: "organization_recovery_snapshot_integrity_failed" }, { status: 409 }); }
  if(payload.schema!==1||payload.organizationId!==organizationId||!Array.isArray(payload.media)||!Array.isArray(payload.projects)||!payload.records||typeof payload.records!=="object")return Response.json({error:"organization_recovery_snapshot_integrity_failed"},{status:409});
  for(const revision of(payload.records.revisions??[])as Array<Record<string,unknown>>)
    if(await sha256(String(revision.content_json??""))!==String(revision.content_sha256??""))return Response.json({error:"organization_recovery_revision_integrity_failed"},{status:409});
  const packageVersions=new Map(((payload.records.packageVersions??[])as Array<Record<string,unknown>>).map((version)=>[String(version.version_id),version]));
  for(const content of(payload.records.packageContents??[])as Array<Record<string,unknown>>){
    const version=packageVersions.get(String(content.version_id));
    if(!version||String(version.organization_id)!==organizationId||await sha256(String(content.content_json??""))!==String(version.content_sha256??""))
      return Response.json({error:"organization_recovery_context_package_integrity_failed"},{status:409});
  }
  for (const object of payload.media) if (await sha256(bytesFromBase64(object.bytes)) !== object.contentSha256) return Response.json({ error: "organization_recovery_media_integrity_failed" }, { status: 409 });
  let manifest:Awaited<ReturnType<typeof recoveryManifest>>;
  try{manifest=JSON.parse(snapshot.manifest_json) as typeof manifest;}catch{return Response.json({error:"organization_recovery_manifest_integrity_failed"},{status:409});}
  if(JSON.stringify(manifest)!==JSON.stringify(await recoveryManifest(payload)))return Response.json({error:"organization_recovery_manifest_integrity_failed"},{status:409});
  const staged=restoring?await verifyIsolatedRollbackRestore(env,actor,organizationId,payload):null;
  if(staged instanceof Response)return staged;
  const count = Object.values(manifest.counts).reduce((total, value) => total + value, 0);
  const duration = Math.max(1, Math.round(performance.now() - started));
  const id = uuidV7();
  const now = new Date().toISOString();
  const status=restoring?"isolated-rollback-verified":"integrity-verified";
  const recorded=await env.DB.prepare(`INSERT INTO organization_recovery_drills(drill_id,organization_id,snapshot_id,status,duration_ms,restored_record_count,verified_object_count,created_by_user_id,created_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM organizations governed JOIN organization_memberships owner
      ON owner.organization_id=governed.organization_id AND owner.user_id=governed.owner_user_id
        AND owner.role='owner' AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
      JOIN users identity ON identity.user_id=owner.user_id AND identity.consent_version=?
      WHERE governed.organization_id=? AND governed.owner_user_id=? AND governed.status='active')
      AND EXISTS(SELECT 1 FROM organization_recovery_snapshots available WHERE available.snapshot_id=?
        AND available.organization_id=? AND available.status='available')`)
    .bind(id,organizationId,snapshotId,status,duration,staged?.restoredRecordCount??count,payload.media.length,actor.userId,now,
      POLICY_VERSION,organizationId,actor.userId,snapshotId,organizationId).run();
  if(Number(recorded.meta.changes??0)!==1)return Response.json({error:"organization_recovery_restore_authorization_changed"},{status:409});
  await recordOrganizationAudit(env,organizationId,actor,restoring?"OrganizationRecoveryIsolatedRollbackRestoreVerified":"OrganizationRecoveryIntegrityDrillVerified","recovery-drill",id,{durationMs:duration,resourceCount:staged?.restoredRecordCount??count});
  return Response.json({drillId:id,snapshotId,status,durationMs:duration,verifiedRecordCount:staged?.restoredRecordCount??count,
    verifiedObjectCount:payload.media.length,isolatedRestorePerformed:false,isolatedRollbackRestorePerformed:restoring,rollbackVerified:restoring,
    productionTenantMutated:false,objectStorageRestorePerformed:false,replicatedBackupVerified:false});
}

async function handleOwnershipTransfer(request: Request, env: WorkerEnv, actor: PilotUser, organizationId: string) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const targetId = String(body.targetUserId ?? "");
  if (body.confirmation !== "TRANSFER_ORGANIZATION_OWNERSHIP" || !targetId || targetId === actor.userId) return Response.json({ error: "explicit_organization_ownership_transfer_required" }, { status: 400 });
  const sourceProjects = await env.DB.prepare("SELECT COUNT(*) AS count FROM organization_projects WHERE organization_id=? AND owner_user_id=?")
    .bind(organizationId, actor.userId).first<{ count: number }>();
  if (Number(sourceProjects?.count ?? 0) > 0) return Response.json({ error: "project_custody_transfer_required", personallyOwnedProjectCount: Number(sourceProjects?.count ?? 0) }, { status: 409 });
  const targetGuard=`member.organization_id=? AND member.user_id=? AND member.role='administrator' AND member.status='active'
      AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL AND identity.consent_version=?
      AND(binding.binding_id IS NULL OR(binding.status='active' AND binding.revoked_at IS NULL AND binding.subject=identity.user_id))
      AND(security.organization_id IS NULL OR(security.require_mfa=0 AND json_valid(security.allowed_domains_json)
        AND(json_array_length(security.allowed_domains_json)=0 OR EXISTS(SELECT 1 FROM json_each(security.allowed_domains_json) allowed
          WHERE lower(CAST(allowed.value AS TEXT))=lower(substr(identity.email,instr(identity.email,'@')+1))))
        AND(security.authentication_source='any' OR security.authentication_source=COALESCE(binding.authentication_source,
          CASE WHEN identity.user_id LIKE 'access:%' THEN 'cloudflare-access'
            WHEN identity.user_id='dev-local-creative' THEN 'local-development' ELSE 'openai-workspace' END))))
      AND NOT EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=member.organization_id AND cohort.status IN('active','paused')
        AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id AND participant.organization_id=member.organization_id
          AND participant.user_id=member.user_id AND participant.status='active' AND participant.revoked_at IS NULL AND participant.role!='reviewer'))`;
  const target = await env.DB.prepare(`SELECT member.user_id,member.role FROM organization_memberships member JOIN users identity ON identity.user_id=member.user_id
    LEFT JOIN organization_security_policies security ON security.organization_id=member.organization_id
    LEFT JOIN organization_identity_bindings binding ON binding.organization_id=member.organization_id AND binding.user_id=member.user_id
    WHERE ${targetGuard}`).bind(organizationId,targetId,POLICY_VERSION).first<{user_id:string;role:string}>();
  if (!target) return Response.json({ error: "eligible_organization_administrator_required" }, { status: 409 });
  const id = uuidV7();
  const now = new Date().toISOString();
  const changed = await env.DB.batch([
    env.DB.prepare(`UPDATE organizations SET owner_user_id=?,updated_at=? WHERE organization_id=? AND owner_user_id=? AND status='active'
      AND NOT EXISTS(SELECT 1 FROM organization_projects source_project WHERE source_project.organization_id=organizations.organization_id
        AND source_project.owner_user_id=?)
      AND EXISTS(SELECT 1 FROM organization_memberships member JOIN users identity ON identity.user_id=member.user_id
        LEFT JOIN organization_security_policies security ON security.organization_id=member.organization_id
        LEFT JOIN organization_identity_bindings binding ON binding.organization_id=member.organization_id AND binding.user_id=member.user_id WHERE ${targetGuard})
      AND EXISTS(SELECT 1 FROM organization_memberships current_owner WHERE current_owner.organization_id=organizations.organization_id
        AND current_owner.user_id=? AND current_owner.role='owner' AND current_owner.status='active' AND current_owner.revoked_at IS NULL)`)
      .bind(targetId,now,organizationId,actor.userId,actor.userId,organizationId,targetId,POLICY_VERSION,actor.userId),
    env.DB.prepare(`UPDATE organization_memberships SET role='administrator',updated_at=?
      WHERE organization_id=? AND user_id=? AND role='owner' AND status='active'
        AND EXISTS(SELECT 1 FROM organizations transferred WHERE transferred.organization_id=organization_memberships.organization_id
          AND transferred.owner_user_id=? AND transferred.updated_at=?)`).bind(now,organizationId,actor.userId,targetId,now),
    env.DB.prepare(`UPDATE organization_memberships SET role='owner',updated_at=?
      WHERE organization_id=? AND user_id=? AND role='administrator' AND status='active'
        AND EXISTS(SELECT 1 FROM organizations transferred WHERE transferred.organization_id=organization_memberships.organization_id
          AND transferred.owner_user_id=? AND transferred.updated_at=?)`).bind(now,organizationId,targetId,targetId,now),
    env.DB.prepare(`INSERT INTO organization_custody_transfers(transfer_id,organization_id,project_access_id,source_user_id,target_user_id,status,manifest_json,created_at,completed_at)
      SELECT ?,?,NULL,?,?,'completed','{"scope":"organization-administration-only"}',?,?
      WHERE EXISTS(SELECT 1 FROM organizations transferred JOIN organization_memberships successor
        ON successor.organization_id=transferred.organization_id AND successor.user_id=transferred.owner_user_id
          AND successor.role='owner' AND successor.status='active'
        WHERE transferred.organization_id=? AND transferred.owner_user_id=? AND transferred.updated_at=?)`)
      .bind(id,organizationId,actor.userId,targetId,now,now,organizationId,targetId,now),
    env.DB.prepare(`UPDATE pilot_participants SET role=CASE WHEN user_id=? THEN 'owner' WHEN user_id=? THEN 'member' ELSE role END
      WHERE organization_id=? AND user_id IN(?,?) AND status='active'
        AND EXISTS(SELECT 1 FROM organization_custody_transfers transferred WHERE transferred.transfer_id=? AND transferred.organization_id=? AND transferred.status='completed')`)
      .bind(targetId,actor.userId,organizationId,targetId,actor.userId,id,organizationId),
    env.DB.prepare(`UPDATE project_context_sessions SET revoked_at=? WHERE organization_id=? AND principal_user_id IN(?,?) AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM organization_custody_transfers transferred WHERE transferred.transfer_id=? AND transferred.organization_id=? AND transferred.status='completed')`)
      .bind(now,organizationId,actor.userId,targetId,id,organizationId),
  ]);
  if(changed.slice(0,4).some((result)=>Number(result.meta.changes??0)!==1))return Response.json({error:"organization_ownership_transfer_conflict"},{status:409});
  await recordOrganizationAudit(env, organizationId, actor, "OrganizationAdministrativeOwnershipTransferred", "organization", organizationId);
  return Response.json({ transferId: id, organizationId, ownerUserId: targetId, scope: "organization-administration-only", projectCustodyTransferred: false }, { headers: { "set-cookie": projectContextCookie(request, "", 0) } });
}

async function deletionInventory(env: WorkerEnv, organizationId: string) {
  const [projects, media, packages, revisions, privateBodies] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT project_access_id,project_id,owner_user_id FROM organization_projects WHERE organization_id=?").bind(organizationId),
    env.DB.prepare(`SELECT MIN(project_access_id) AS project_access_id,resource_id,MIN(owner_user_id) AS owner_user_id,
      MIN(custody_kind) AS custody_kind,COUNT(DISTINCT owner_user_id) AS owner_count FROM(
        SELECT project_access_id,resource_id,owner_user_id,'project' AS custody_kind FROM project_resource_scopes
          WHERE organization_id=? AND resource_kind='media'
        UNION ALL
        SELECT '' AS project_access_id,CAST(json_extract(block.value,'$.source.objectKey') AS TEXT) AS resource_id,
          content.organization_id AS owner_user_id,'organization' AS custody_kind
        FROM organization_context_package_contents content JOIN json_each(content.content_json,'$.blocks') block
          WHERE content.organization_id=? AND content.redacted_at IS NULL
            AND json_type(block.value,'$.source.objectKey')='text'
        UNION ALL
        SELECT '' AS project_access_id,CAST(json_extract(snapshot.encrypted_payload,'$.objectKey') AS TEXT) AS resource_id,
          snapshot.organization_id AS owner_user_id,'organization' AS custody_kind
        FROM organization_recovery_snapshots snapshot
          WHERE snapshot.organization_id=? AND json_valid(snapshot.encrypted_payload)
            AND json_extract(snapshot.encrypted_payload,'$.storage')='organization-r2'
            AND json_type(snapshot.encrypted_payload,'$.objectKey')='text'
      )GROUP BY resource_id ORDER BY resource_id`).bind(organizationId,organizationId,organizationId),
    env.DB.prepare("SELECT package_id FROM organization_context_packages WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("SELECT revision_id FROM artifact_revisions WHERE organization_id=?").bind(organizationId),
    env.DB.prepare(`SELECT DISTINCT body.private_event_id FROM event_private_payloads body WHERE body.redacted_at IS NULL AND(
      EXISTS(SELECT 1 FROM project_event_scopes scoped WHERE scoped.organization_id=? AND scoped.event_id=body.private_event_id)
      OR EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=?
        AND project.owner_user_id=body.owner_id AND project.project_id=body.project_id))`).bind(organizationId,organizationId),
  ]);
  return { projects: projects.results, media: media.results, packageCount: packages.results.length, revisionCount: revisions.results.length, privateEventBodyCount: privateBodies.results.length };
}

async function initializedAssistantTables(env:WorkerEnv){
  const tables=await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN('assistant_turns','assistant_action_proposals','assistant_specialist_tasks')")
    .all<{name:string}>();
  const present=new Set(tables.results.map(row=>String(row.name)));
  if(present.has("assistant_specialist_tasks")){
    const columns=await env.DB.prepare("PRAGMA table_info(assistant_specialist_tasks)").all<{name:string}>();
    if(columns.results.some(column=>column.name==="result_json"))present.add("assistant_specialist_consent");
  }
  return present;
}

/** The step boundary, not a task label or an executing hold, proves that a signed POST has not happened. */
function unusedAssistantExecutionSql(execution:string,tables:Set<string>){
  const noContradictoryTask=!tables.has("assistant_specialist_tasks")?"":` AND NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks signed_task
    WHERE signed_task.task_id=${execution}.execution_id AND signed_task.actor_user_id=${execution}.actor_user_id
      AND(COALESCE(signed_task.provider_submitted,1)!=0 AND stopped.status!='not-submitted'
        ${tables.has("assistant_specialist_consent")?`OR signed_task.result_json IS NOT NULL AND NOT json_valid(signed_task.result_json)
          OR json_type(CASE WHEN json_valid(signed_task.result_json) THEN signed_task.result_json ELSE '{}' END,'$.rawReceipt') IS NOT NULL`:""}))`;
  return `${execution}.result_ref IS NULL AND ${execution}.status IN('quoted','reserved','failed','uncertain')
    AND(SELECT COUNT(*) FROM consequential_execution_steps counted WHERE counted.execution_id=${execution}.execution_id)=1
    AND EXISTS(SELECT 1 FROM consequential_execution_steps stopped WHERE stopped.execution_id=${execution}.execution_id AND stopped.step_index=0
      AND stopped.token_reservation_id=${execution}.execution_id||':tokens:0' AND stopped.cost_reservation_id=${execution}.execution_id||':usd:0'
      AND stopped.status IN('quoted','reserved','not-submitted') AND stopped.verified_tokens IS NULL AND stopped.verified_microusd IS NULL
      AND stopped.provider_request_id IS NULL ${noContradictoryTask})`;
}

/** Reuse the persisted amounts. A task status or a canonical pointer alone does not prove both ledgers are settled. */
function settledAssistantExecutionSql(execution:string){
  return `EXISTS(SELECT 1 FROM consequential_execution_steps present WHERE present.execution_id=${execution}.execution_id)
    AND NOT EXISTS(SELECT 1 FROM consequential_execution_steps verified WHERE verified.execution_id=${execution}.execution_id AND(
      verified.status!='settled' OR typeof(verified.verified_tokens)!='integer' OR verified.verified_tokens<0
      OR typeof(verified.verified_microusd)!='integer' OR verified.verified_microusd<0
      OR NOT EXISTS(SELECT 1 FROM budget_reservations tokens WHERE tokens.reservation_id=verified.token_reservation_id AND tokens.owner_id=${execution}.actor_user_id
        AND tokens.status='settled' AND tokens.used_tokens=verified.verified_tokens)
      OR NOT EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=verified.cost_reservation_id AND cost.owner_id=${execution}.actor_user_id
        AND cost.status='settled' AND cost.used_microusd=verified.verified_microusd)))`;
}
function legacyAssistantBlockedSql(task:string,tables:Set<string>){
  return `(${tables.has("assistant_specialist_consent")?task+".result_json IS NOT NULL OR ":""}${task}.status IN('needs-review','reconciling')
    OR COALESCE(${task}.provider_submitted,1)!=0 AND ${task}.status NOT IN('completed','reconciled')
    OR ${task}.status='running' AND EXISTS(SELECT 1 FROM cost_budget_reservations cost
      WHERE cost.reservation_id=${task}.cost_reservation_id AND cost.owner_id=${task}.actor_user_id AND cost.status='executing')
    OR ${task}.status NOT IN('queued','running') AND NOT(${task}.status='canceled' AND ${task}.error_code='organization_deleted' AND ${task}.provider_submitted=0
      AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations stopped_cost WHERE stopped_cost.reservation_id=${task}.cost_reservation_id AND stopped_cost.owner_id=${task}.actor_user_id AND stopped_cost.status='executing'))
      AND(EXISTS(SELECT 1 FROM budget_reservations tokens
      WHERE tokens.reservation_id=${task}.token_reservation_id AND tokens.owner_id=${task}.actor_user_id AND tokens.status='active')
      OR EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=${task}.cost_reservation_id AND cost.owner_id=${task}.actor_user_id AND cost.status IN('active','executing'))))`;
}
function noAssistantSubmissionGuard(organizationId:string,tables:Set<string>){
  const legacy=tables.has("assistant_specialist_tasks")?`NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE task.organization_id=?
    AND NOT EXISTS(SELECT 1 FROM consequential_executions signed WHERE signed.execution_id=task.task_id AND signed.actor_user_id=task.actor_user_id AND signed.operation='assistant-specialist')
    AND ${legacyAssistantBlockedSql("task",tables)}) AND `:"";
  const tokens=noAssistantTokenReservationGuard(organizationId,tables);
  return{sql:legacy+`NOT EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.organization_id=? AND execution.operation='assistant-specialist'
    AND NOT(${unusedAssistantExecutionSql("execution",tables)}) AND NOT(${settledAssistantExecutionSql("execution")})) AND ${tokens.sql}`,bindings:[...(tables.has("assistant_specialist_tasks")?[organizationId,organizationId]:[organizationId]),...tokens.bindings]};
}
function orphanAssistantReservationSql(reservation:string,kind:"tokens"|"usd",tables:Set<string>){
  const column=kind==="tokens"?"token_reservation_id":"cost_reservation_id";
  const noTask=tables.has("assistant_specialist_tasks")?`AND NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE task.${column}=${reservation}.reservation_id
    AND task.actor_user_id=${reservation}.owner_id AND task.organization_id=scoped.organization_id)`:"";
  return `(${reservation}.operation LIKE 'assistant:%' OR ${reservation}.operation LIKE 'assistant-specialist:%'
      OR ${reservation}.correlation_id LIKE 'assistant:%' OR ${reservation}.correlation_id LIKE 'assistant-specialist:%')
    ${noTask} AND NOT EXISTS(SELECT 1 FROM consequential_execution_steps step JOIN consequential_executions execution ON execution.execution_id=step.execution_id
      WHERE step.${column}=${reservation}.reservation_id AND execution.actor_user_id=${reservation}.owner_id
        AND execution.organization_id=scoped.organization_id AND execution.operation='assistant-specialist')`;
}
function noAssistantTokenReservationGuard(organizationId:string,tables:Set<string>){
  return{sql:`NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes scoped JOIN budget_reservations tokens ON tokens.reservation_id=scoped.reservation_id AND tokens.owner_id=scoped.actor_user_id
    WHERE scoped.reservation_kind='tokens' AND scoped.organization_id=? AND tokens.status='active' AND ${orphanAssistantReservationSql("tokens","tokens",tables)})`,bindings:[organizationId]};
}
async function organizationAssistantTokenReservationBlockers(env:WorkerEnv,organizationId:string,tables:Set<string>){
  const rows=await env.DB.prepare(`SELECT tokens.reservation_id,tokens.operation FROM project_budget_reservation_scopes scoped
    JOIN budget_reservations tokens ON tokens.reservation_id=scoped.reservation_id AND tokens.owner_id=scoped.actor_user_id
    WHERE scoped.reservation_kind='tokens' AND scoped.organization_id=? AND tokens.status='active' AND ${orphanAssistantReservationSql("tokens","tokens",tables)} LIMIT 100`)
    .bind(organizationId).all<{reservation_id:string;operation:string}>();
  return rows.results.map(row=>({reservationId:String(row.reservation_id),operation:String(row.operation)}));
}
function unprotectedExecutingReservationSql(tables:Set<string>){
  return `NOT EXISTS(SELECT 1 FROM consequential_executions execution JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id
    WHERE execution.operation='assistant-specialist' AND execution.organization_id=scoped.organization_id AND execution.actor_user_id=cost.owner_id
      AND step.cost_reservation_id=cost.reservation_id AND ${unusedAssistantExecutionSql("execution",tables)})`;
}
function noExecutingReservationGuard(organizationId:string,tables:Set<string>){
  return{sql:`NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes scoped JOIN cost_budget_reservations cost ON cost.reservation_id=scoped.reservation_id AND cost.owner_id=scoped.actor_user_id
    WHERE scoped.reservation_kind='usd' AND scoped.organization_id=? AND (cost.status='executing' AND ${unprotectedExecutingReservationSql(tables)} OR cost.status='active' AND ${orphanAssistantReservationSql("cost","usd",tables)}))`,bindings:[organizationId]};
}
async function organizationAssistantSubmissionBlockers(env:WorkerEnv,organizationId:string,tables:Set<string>){
  const legacy=tables.has("assistant_specialist_tasks")?`SELECT task.task_id,task.status FROM assistant_specialist_tasks task WHERE task.organization_id=?
    AND NOT EXISTS(SELECT 1 FROM consequential_executions signed WHERE signed.execution_id=task.task_id AND signed.actor_user_id=task.actor_user_id AND signed.operation='assistant-specialist')
    AND ${legacyAssistantBlockedSql("task",tables)} UNION ALL `:"";
  const status=tables.has("assistant_specialist_tasks")?"COALESCE((SELECT task.status FROM assistant_specialist_tasks task WHERE task.task_id=execution.execution_id AND task.actor_user_id=execution.actor_user_id),execution.status)":"execution.status";
  const rows=await env.DB.prepare(legacy+`SELECT execution.execution_id AS task_id,${status} AS status FROM consequential_executions execution
    WHERE execution.organization_id=? AND execution.operation='assistant-specialist' AND NOT(${unusedAssistantExecutionSql("execution",tables)})
      AND NOT(${settledAssistantExecutionSql("execution")}) LIMIT 100`)
    .bind(...(tables.has("assistant_specialist_tasks")?[organizationId,organizationId]:[organizationId])).all<{task_id:string;status:string}>();
  return rows.results.map(row=>({taskId:String(row.task_id),status:String(row.status)}));
}
async function organizationExecutingReservationBlockers(env:WorkerEnv,organizationId:string,tables:Set<string>){
  const reservations=await env.DB.prepare(`SELECT scoped.reservation_id,cost.operation FROM project_budget_reservation_scopes scoped
    JOIN cost_budget_reservations cost ON cost.reservation_id=scoped.reservation_id AND cost.owner_id=scoped.actor_user_id
    WHERE scoped.reservation_kind='usd' AND scoped.organization_id=? AND (cost.status='executing' AND ${unprotectedExecutingReservationSql(tables)} OR cost.status='active' AND ${orphanAssistantReservationSql("cost","usd",tables)}) LIMIT 100`)
    .bind(organizationId).all<{reservation_id:string;operation:string}>();
  return reservations.results.map(reservation=>({reservationId:String(reservation.reservation_id),operation:String(reservation.operation)}));
}
// Share one allowance across preflight accounting and admitted cancellation. Successful work
// leaves existing steps/tasks/ledgers terminal, so the next explicit retry never starts over.
const ASSISTANT_DELETION_REQUEST_LIMIT=24;
type AssistantDeletionWork={remaining:number};
function releasedAssistantReservationsSql(actor:string,tokenId:string,costId:string){
  return `NOT EXISTS(SELECT 1 FROM budget_reservations released_tokens WHERE released_tokens.reservation_id=${tokenId}
      AND(released_tokens.owner_id!=${actor} OR released_tokens.status!='released' OR typeof(released_tokens.used_tokens)!='integer' OR released_tokens.used_tokens!=0))
    AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations released_cost WHERE released_cost.reservation_id=${costId}
      AND(released_cost.owner_id!=${actor} OR released_cost.status!='released' OR typeof(released_cost.used_microusd)!='integer' OR released_cost.used_microusd!=0))`;
}
function unfinishedUnusedAssistantSql(execution:string,tables:Set<string>){
  const taskPending=tables.has("assistant_specialist_tasks")?`OR EXISTS(SELECT 1 FROM assistant_specialist_tasks unfinished_task
    WHERE unfinished_task.task_id=${execution}.execution_id AND unfinished_task.actor_user_id=${execution}.actor_user_id
      AND(unfinished_task.status!='canceled' OR COALESCE(unfinished_task.error_code,'')!='organization_deleted'))`:"";
  return `${unusedAssistantExecutionSql(execution,tables)} AND(${execution}.status!='failed'
    OR EXISTS(SELECT 1 FROM consequential_execution_steps unfinished_step WHERE unfinished_step.execution_id=${execution}.execution_id AND unfinished_step.status!='not-submitted')
    ${taskPending} OR NOT(${releasedAssistantReservationsSql(execution+".actor_user_id",execution+".execution_id||':tokens:0'",execution+".execution_id||':usd:0'")}))`;
}
function unusedLegacyAssistantSql(tables:Set<string>){
  return `provider_submitted=0 ${tables.has("assistant_specialist_consent")?"AND result_json IS NULL":""}
    AND NOT EXISTS(SELECT 1 FROM consequential_executions signed WHERE signed.execution_id=assistant_specialist_tasks.task_id AND signed.actor_user_id=assistant_specialist_tasks.actor_user_id)
    AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=assistant_specialist_tasks.cost_reservation_id AND cost.owner_id=assistant_specialist_tasks.actor_user_id AND cost.status='executing')`;
}
function unfinishedLegacyAssistantSql(tables:Set<string>){
  return `(status IN('queued','running') OR status='canceled' AND error_code='organization_deleted') AND ${unusedLegacyAssistantSql(tables)}
    AND(status!='canceled' OR NOT(${releasedAssistantReservationsSql("assistant_specialist_tasks.actor_user_id","assistant_specialist_tasks.token_reservation_id","assistant_specialist_tasks.cost_reservation_id")}))`;
}
async function assistantDeletionPending(env:WorkerEnv,organizationId:string,work:AssistantDeletionWork,error:string,jobId?:string){
  if(jobId)await env.DB.prepare("UPDATE organization_deletion_jobs SET status='partial',updated_at=? WHERE job_id=? AND organization_id=? AND status IN('pending','partial','processing')")
    .bind(new Date().toISOString(),jobId,organizationId).run();
  // The native deletion caller treats any 2xx as completion; retain its explicit retry flow.
  return Response.json({...(jobId?{jobId}:{}),status:"partial",error,retryable:true,
    assistantCleanup:{attempted:ASSISTANT_DELETION_REQUEST_LIMIT-work.remaining,requestLimit:ASSISTANT_DELETION_REQUEST_LIMIT},
    immutableOperationalMetadataRetained:true},{status:503});
}
async function reconcileOrganizationAssistantUsage(env:WorkerEnv,organizationId:string,work:AssistantDeletionWork){
  const verified=await env.DB.prepare(`SELECT execution.execution_id,execution.actor_user_id,MIN(step.updated_at) AS attempted_at
    FROM consequential_executions execution JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id
    WHERE execution.organization_id=? AND execution.operation='assistant-specialist' AND step.status='usage-recorded'
      AND step.step_index=0 AND step.token_reservation_id=execution.execution_id||':tokens:0' AND step.cost_reservation_id=execution.execution_id||':usd:0'
      AND typeof(step.verified_tokens)='integer' AND step.verified_tokens>=0 AND typeof(step.verified_microusd)='integer' AND step.verified_microusd>=0
      AND(SELECT COUNT(*) FROM consequential_execution_steps counted WHERE counted.execution_id=execution.execution_id)=1
    GROUP BY execution.execution_id,execution.actor_user_id ORDER BY attempted_at,execution.execution_id LIMIT ?`)
    .bind(organizationId,work.remaining).all<{execution_id:string;actor_user_id:string}>();
  for(const execution of verified.results){
    work.remaining--;
    // Only verified-usage metadata rotates: a broken ledger in the oldest chunk cannot starve
    // later exact receipts. No usage, price, provider state, or private evidence is rewritten.
    await env.DB.prepare(`UPDATE consequential_execution_steps SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE execution_id=? AND status='usage-recorded' AND typeof(verified_tokens)='integer' AND verified_tokens>=0
        AND typeof(verified_microusd)='integer' AND verified_microusd>=0
        AND EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=consequential_execution_steps.execution_id
          AND execution.actor_user_id=? AND execution.organization_id=? AND execution.operation='assistant-specialist')`)
      .bind(execution.execution_id,execution.actor_user_id,organizationId).run();
    try{await reconcileConsequentialUsage(env,execution.actor_user_id,execution.execution_id);}catch{/* Exact receipt/hold remains; final deletion guards stay authoritative. */}
  }
  return Boolean(await env.DB.prepare(`SELECT 1 AS pending FROM consequential_executions execution
    JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id
    WHERE execution.organization_id=? AND execution.operation='assistant-specialist' AND step.status='usage-recorded' LIMIT 1`).bind(organizationId).first());
}
async function cancelUnsubmittedOrganizationAssistantTasks(env:WorkerEnv,organizationId:string,tables:Set<string>,work:AssistantDeletionWork){
  const signed=await env.DB.prepare(`SELECT execution.execution_id,execution.actor_user_id FROM consequential_executions execution
    WHERE execution.organization_id=? AND execution.operation='assistant-specialist' AND ${unfinishedUnusedAssistantSql("execution",tables)}
    ORDER BY execution.updated_at,execution.execution_id LIMIT ?`).bind(organizationId,work.remaining).all<{execution_id:string;actor_user_id:string}>();
  for(const row of signed.results){
    work.remaining--;
    await failConsequentialExecution(env,row.actor_user_id,row.execution_id,"organization_deleted");
    if(tables.has("assistant_specialist_tasks"))await env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='canceled',error_code='organization_deleted',updated_at=?,completed_at=?
      WHERE task_id=? AND actor_user_id=? AND organization_id=? AND status!='completed'
        AND EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=assistant_specialist_tasks.task_id
          AND execution.actor_user_id=assistant_specialist_tasks.actor_user_id AND execution.result_ref IS NULL AND execution.status='failed'
          AND ${unusedAssistantExecutionSql("execution",tables)})`)
      .bind(new Date().toISOString(),new Date().toISOString(),row.execution_id,row.actor_user_id,organizationId).run();
  }
  if(tables.has("assistant_specialist_tasks")){
    const rows=await env.DB.prepare(`SELECT task_id,actor_user_id,cost_reservation_id,token_reservation_id FROM assistant_specialist_tasks
      WHERE organization_id=? AND ${unfinishedLegacyAssistantSql(tables)} ORDER BY updated_at,task_id LIMIT ?`)
      .bind(organizationId,work.remaining).all<{task_id:string;actor_user_id:string;cost_reservation_id:string;token_reservation_id:string}>();
    for(const row of rows.results){
      work.remaining--;
      const now=new Date().toISOString(),stopped=await env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='canceled',error_code='organization_deleted',updated_at=?,completed_at=?
        WHERE task_id=? AND actor_user_id=? AND organization_id=? AND ${unfinishedLegacyAssistantSql(tables)}`)
        .bind(now,now,row.task_id,row.actor_user_id,organizationId).run();
      if(Number(stopped.meta.changes??0)===1){await releaseCostBudget(env,row.actor_user_id,row.cost_reservation_id);await releaseBudget(env,row.actor_user_id,row.token_reservation_id,{reason:"organization_deleted"});}
    }
  }
  const legacy=tables.has("assistant_specialist_tasks")?` OR EXISTS(SELECT 1 FROM assistant_specialist_tasks WHERE organization_id=? AND ${unfinishedLegacyAssistantSql(tables)})`:"";
  return Boolean(await env.DB.prepare(`SELECT 1 AS pending WHERE EXISTS(SELECT 1 FROM consequential_executions execution
    WHERE execution.organization_id=? AND execution.operation='assistant-specialist' AND ${unfinishedUnusedAssistantSql("execution",tables)})${legacy}`)
    .bind(organizationId,...(tables.has("assistant_specialist_tasks")?[organizationId]:[])).first());
}

async function finalizeDeletion(env: WorkerEnv, actor: PilotUser, organizationId: string, jobId: string, inventory: Awaited<ReturnType<typeof deletionInventory>>) {
  const now = new Date().toISOString();
  const assistantTables=await initializedAssistantTables(env);
  if((await organizationAssistantSubmissionBlockers(env,organizationId,assistantTables)).length||(await projectProviderSubmissionBlockers(env,organizationId)).length
    ||(await organizationExecutingReservationBlockers(env,organizationId,assistantTables)).length||(await organizationAssistantTokenReservationBlockers(env,organizationId,assistantTables)).length)
    throw new Error("provider_submission_in_flight");
  const removed=await env.DB.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status='deleted' THEN 1 ELSE 0 END),0) AS deleted,
    COALESCE(SUM(CASE WHEN status='retained-shared' THEN 1 ELSE 0 END),0) AS retained,
    COALESCE(SUM(CASE WHEN status NOT IN('deleted','retained-shared') THEN 1 ELSE 0 END),0) AS remaining
    FROM organization_deletion_items WHERE job_id=? AND organization_id=? AND resource_kind='media'`)
    .bind(jobId,organizationId).first<{deleted:number;retained:number;remaining:number}>();
  if(Number(removed?.remaining??0)!==0)throw new Error("organization_deletion_resources_remaining");
  const receipt = {
    organizationId,
    jobId,
    completedAt: now,
    removedProjects: inventory.projects.length,
    removedMediaObjects:Number(removed?.deleted??0),
    retainedSharedMediaObjects:Number(removed?.retained??0),
    removedContextPackages: inventory.packageCount,
    removedArtifactRevisions: inventory.revisionCount,
    removedPrivateEventBodies: inventory.privateEventBodyCount,
    immutableOperationalMetadataRetained: true,
    immutableAuditReceiptsRetained: true,
    externalBackupsPurged: false,
    otherDevicesPurged: false,
  };
  const assistantSafe=noAssistantSubmissionGuard(organizationId,assistantTables),costSafe=noExecutingReservationGuard(organizationId,assistantTables);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`SELECT CASE WHEN ${assistantSafe.sql} AND ${costSafe.sql} THEN 1 ELSE json(\'provider_submission_in_flight\') END AS provider_guard`)
      .bind(...assistantSafe.bindings,...costSafe.bindings),
    env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=? AND hold.status='active')
      OR EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=? AND policy.legal_hold=1)
      THEN json('active organization legal hold') ELSE 1 END AS hold_guard`).bind(organizationId,organizationId),
    ...["assistant_action_proposals","assistant_specialist_tasks","assistant_turns"].filter((table)=>assistantTables.has(table))
      .map((table)=>env.DB.prepare(`DELETE FROM ${table} WHERE organization_id=?`).bind(organizationId)),
    env.DB.prepare(`DELETE FROM event_private_payloads WHERE EXISTS(SELECT 1 FROM project_event_scopes scoped
        WHERE scoped.organization_id=? AND scoped.event_id=event_private_payloads.private_event_id)
      OR EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=?
        AND project.owner_user_id=event_private_payloads.owner_id AND project.project_id=event_private_payloads.project_id)`)
      .bind(organizationId,organizationId),
    env.DB.prepare(`UPDATE private_content SET content='',redacted_at=?,expires_at=? WHERE content_id IN(
      SELECT resource_id FROM project_resource_scopes WHERE organization_id=? AND resource_kind='content'
      UNION SELECT content_id FROM private_content_retention_scopes WHERE organization_id=?
    ) AND NOT EXISTS(SELECT 1 FROM project_resource_scopes foreign_resource
      WHERE foreign_resource.resource_kind='content' AND foreign_resource.resource_id=private_content.content_id
        AND foreign_resource.organization_id<>?)
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes foreign_retention
        WHERE foreign_retention.content_id=private_content.content_id AND foreign_retention.organization_id<>?)`)
      .bind(now,now,organizationId,organizationId,organizationId,organizationId),
    env.DB.prepare(`DELETE FROM document_jobs WHERE job_id IN(SELECT resource_id FROM project_resource_scopes WHERE organization_id=? AND resource_kind='job')`).bind(organizationId),
    env.DB.prepare(`DELETE FROM generation_preflights WHERE EXISTS(SELECT 1 FROM project_resource_scopes resource
      JOIN organization_projects project ON project.project_access_id=resource.project_access_id AND project.organization_id=resource.organization_id
      WHERE resource.organization_id=? AND resource.resource_kind='document' AND resource.resource_id=generation_preflights.document_id
        AND generation_preflights.stream_id='creative:'||project.owner_user_id)`).bind(organizationId),
    env.DB.prepare("DELETE FROM artifact_revisions WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_context_package_contents WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_context_package_sources WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_context_package_members WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_context_package_bindings WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_context_package_versions WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_context_packages WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_review_tasks WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_notifications WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_automation_outbox WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_automation_runs WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_automation_policies WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_recovery_drills WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_recovery_snapshots WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_key_versions WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_identity_group_members WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_identity_groups WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_identity_bindings WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_provisioning_credentials WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_security_policies WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_legal_holds WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM private_content_retention_scopes WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_retention_policies WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_budget_reservation_scopes WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM budget_scope_policies WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM budget_counters WHERE scope='workspace' AND scope_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM cost_budget_counters WHERE scope='workspace' AND scope_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM capability_grants WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_invitations WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_context_sessions WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_memberships WHERE organization_id=?").bind(organizationId),
    env.DB.prepare(`DELETE FROM share_scopes WHERE share_id IN(SELECT share.share_id FROM shares share JOIN share_scopes scope ON scope.share_id=share.share_id
      JOIN organization_projects project ON project.organization_id=? AND project.owner_user_id=scope.owner_id AND project.project_id=scope.project_id)`).bind(organizationId),
    env.DB.prepare("DELETE FROM pilot_cost_reservation_scopes WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM pilot_participants WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM pilot_cohorts WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_resource_scopes WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_event_scopes WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM project_migration_states WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_projects WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_memberships WHERE organization_id=?").bind(organizationId),
    env.DB.prepare("DELETE FROM organization_deletion_items WHERE job_id=? AND organization_id=?").bind(jobId,organizationId),
    env.DB.prepare("UPDATE organizations SET name='Deleted organization',status='deleted',updated_at=? WHERE organization_id=? AND owner_user_id=?").bind(now, organizationId, actor.userId),
    env.DB.prepare("UPDATE organization_deletion_jobs SET status='completed',receipt_json=?,updated_at=?,completed_at=? WHERE job_id=? AND organization_id=? AND initiated_by_user_id=?")
      .bind(JSON.stringify(receipt), now, now, jobId, organizationId, actor.userId),
  ];
  await env.DB.batch(statements);
  await recordOrganizationAudit(env,organizationId,actor,"OrganizationTenantDeletionCompleted","deletion",jobId,
    {resourceCount:Number(removed?.deleted??0)+inventory.packageCount+inventory.revisionCount+inventory.privateEventBodyCount});
  return receipt;
}

async function processDeletion(request:Request,env:WorkerEnv,actor:PilotUser,organizationId:string,jobId:string,inventory:Awaited<ReturnType<typeof deletionInventory>>,work:AssistantDeletionWork){
  const claimed=await env.DB.prepare(`UPDATE organization_deletion_jobs SET status='processing',updated_at=?
    WHERE job_id=? AND organization_id=? AND initiated_by_user_id=? AND status IN('pending','partial','processing')
      AND NOT EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=? AND hold.status='active')
      AND NOT EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=? AND policy.legal_hold=1)`)
    .bind(new Date().toISOString(),jobId,organizationId,actor.userId,organizationId,organizationId).run();
  if(Number(claimed.meta.changes??0)!==1)return Response.json({error:"organization_legal_hold_active",jobId},{status:409});
  const assistantTables=await initializedAssistantTables(env);
  try{if(await cancelUnsubmittedOrganizationAssistantTasks(env,organizationId,assistantTables,work))
    return assistantDeletionPending(env,organizationId,work,"organization_assistant_cancellation_incomplete",jobId);
  }catch{return assistantDeletionPending(env,organizationId,work,"organization_assistant_cancellation_incomplete",jobId);}
  if(await reconcileOrganizationAssistantUsage(env,organizationId,work))
    return assistantDeletionPending(env,organizationId,work,"organization_assistant_reconciliation_incomplete",jobId);
  const assistantBlockers=await organizationAssistantSubmissionBlockers(env,organizationId,assistantTables);
  const providerBlockers=await projectProviderSubmissionBlockers(env,organizationId);
  const executingReservations=await organizationExecutingReservationBlockers(env,organizationId,assistantTables),tokenReservations=await organizationAssistantTokenReservationBlockers(env,organizationId,assistantTables);
  if(assistantBlockers.length||providerBlockers.length||executingReservations.length||tokenReservations.length){
    await env.DB.prepare("UPDATE organization_deletion_jobs SET status='partial',updated_at=? WHERE job_id=? AND organization_id=? AND status='processing'")
      .bind(new Date().toISOString(),jobId,organizationId).run();
    return Response.json({jobId,status:"partial",error:"provider_submission_in_flight",assistantTasks:assistantBlockers,documentJobs:providerBlockers,costReservations:executingReservations,tokenReservations},{status:409});
  }
  for (const resource of inventory.media) {
    const item = await env.DB.prepare("SELECT status FROM organization_deletion_items WHERE job_id=? AND organization_id=? AND resource_kind='media' AND resource_id=?")
      .bind(jobId, organizationId, String(resource.resource_id)).first<{ status: string }>();
    if (item?.status === "deleted" || item?.status === "retained-shared") continue;
    const now = new Date().toISOString();
    const key=String(resource.resource_id);
    const foreign=await env.DB.prepare(`SELECT 1 AS present WHERE EXISTS(
      SELECT 1 FROM project_resource_scopes shared WHERE shared.resource_kind='media' AND shared.resource_id=? AND shared.organization_id<>?
    ) OR EXISTS(
      SELECT 1 FROM events personal LEFT JOIN event_private_payloads private_body
        ON private_body.private_event_id=personal.event_id AND private_body.owner_id=? AND private_body.redacted_at IS NULL
      JOIN json_tree(COALESCE(private_body.private_json,personal.payload)) fragment
        ON fragment.type='text' AND(fragment.value=? OR fragment.value=?)
      WHERE personal.stream_id='creative:'||?
        AND NOT EXISTS(SELECT 1 FROM project_event_scopes deleting WHERE deleting.event_id=personal.event_id AND deleting.organization_id=?)
        AND NOT EXISTS(SELECT 1 FROM organization_projects deleting_project WHERE deleting_project.organization_id=?
          AND deleting_project.owner_user_id=? AND deleting_project.project_id=json_extract(COALESCE(private_body.private_json,personal.payload),'$.project_id'))
      LIMIT 1
    ) OR ?<>1`)
      .bind(key,organizationId,String(resource.owner_user_id),key,`/api/media/${encodeURIComponent(key)}`,String(resource.owner_user_id),organizationId,organizationId,String(resource.owner_user_id),Number(resource.owner_count??1)).first();
    if (foreign) {
      await env.DB.prepare("UPDATE organization_deletion_items SET status='retained-shared',attempt_count=attempt_count+1,updated_at=? WHERE job_id=? AND organization_id=? AND resource_kind='media' AND resource_id=?")
        .bind(now, jobId, organizationId, String(resource.resource_id)).run();
      continue;
    }
    try {
      if(typeof env.MEDIA.delete!=="function"||typeof env.MEDIA.head!=="function"&&typeof env.MEDIA.get!=="function")throw new Error("media_delete_unavailable");
      const object=typeof env.MEDIA.head==="function"?await env.MEDIA.head(key):await env.MEDIA.get(key);
      if(object&&(resource.custody_kind==="organization"
        ?object.customMetadata?.organizationId!==organizationId
        :object.customMetadata?.ownerId!==String(resource.owner_user_id)))throw new Error("media_owner_mismatch");
      if(object){
        await env.MEDIA.delete(key);
        const remains=typeof env.MEDIA.head==="function"?await env.MEDIA.head(key):await env.MEDIA.get(key);
        if(remains)throw new Error("media_delete_verification_failed");
      }
      await env.DB.prepare("UPDATE organization_deletion_items SET status='deleted',attempt_count=attempt_count+1,error_code=NULL,updated_at=? WHERE job_id=? AND organization_id=? AND resource_kind='media' AND resource_id=?")
        .bind(now, jobId, organizationId, String(resource.resource_id)).run();
    } catch (error) {
      const code = error instanceof Error && error.message === "media_owner_mismatch" ? "media_owner_mismatch" : "media_delete_failed";
      await env.DB.batch([
        env.DB.prepare("UPDATE organization_deletion_items SET status='failed',attempt_count=attempt_count+1,error_code=?,updated_at=? WHERE job_id=? AND organization_id=? AND resource_kind='media' AND resource_id=?")
          .bind(code, now, jobId, organizationId, String(resource.resource_id)),
        env.DB.prepare("UPDATE organization_deletion_jobs SET status='partial',updated_at=? WHERE job_id=? AND organization_id=?").bind(now, jobId, organizationId),
      ]);
      return Response.json({ jobId, status: "partial", error: code, retryable: true, immutableOperationalMetadataRetained: true }, { status: 503 });
    }
  }
  try{
    const receipt=await finalizeDeletion(env,actor,organizationId,jobId,inventory);
    return Response.json({jobId,status:"completed",receipt},{headers:{"set-cookie":projectContextCookie(request,"",0)}});
  }catch{
    await env.DB.prepare("UPDATE organization_deletion_jobs SET status='partial',updated_at=? WHERE job_id=? AND organization_id=? AND status='processing'")
      .bind(new Date().toISOString(),jobId,organizationId).run();
    const assistants=await organizationAssistantSubmissionBlockers(env,organizationId,assistantTables),reservations=await organizationExecutingReservationBlockers(env,organizationId,assistantTables),tokens=await organizationAssistantTokenReservationBlockers(env,organizationId,assistantTables);
    if(assistants.length||reservations.length||tokens.length)return Response.json({jobId,status:"partial",error:"provider_submission_in_flight",assistantTasks:assistants,costReservations:reservations,tokenReservations:tokens},{status:409});
    return Response.json({jobId,status:"partial",error:"organization_deletion_finalization_failed",retryable:true},{status:503});
  }
}

async function handleDeletion(request: Request, env: WorkerEnv, actor: PilotUser, organizationId: string) {
  const existing = await env.DB.prepare("SELECT job_id,status,inventory_json,receipt_json,created_at,updated_at,completed_at FROM organization_deletion_jobs WHERE organization_id=? AND initiated_by_user_id=? ORDER BY created_at DESC LIMIT 1")
    .bind(organizationId, actor.userId).first<Record<string, unknown>>();
  if (request.method === "GET") {
    const inventory = await deletionInventory(env, organizationId);
    return Response.json({ job: existing, inventory: { projectCount: inventory.projects.length, mediaCount: inventory.media.length, packageCount: inventory.packageCount, revisionCount: inventory.revisionCount, privateEventBodyCount: inventory.privateEventBodyCount }, immutableOperationalMetadataRetained: true, externalBackupsPurged: false, otherDevicesPurged: false });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (body.confirmation !== "DELETE_ORGANIZATION_AND_SCOPED_DATA" || body.organizationId !== organizationId) return Response.json({ error: "explicit_organization_deletion_confirmation_required" }, { status: 400 });
  const held = await env.DB.prepare(`SELECT 1 AS held FROM organization_legal_holds WHERE organization_id=? AND status='active'
    UNION SELECT 1 AS held FROM organization_retention_policies WHERE organization_id=? AND legal_hold=1 LIMIT 1`).bind(organizationId, organizationId).first();
  if (held) return Response.json({ error: "organization_legal_hold_active" }, { status: 409 });
  const assistantTables=await initializedAssistantTables(env),work:AssistantDeletionWork={remaining:ASSISTANT_DELETION_REQUEST_LIMIT};
  if(await reconcileOrganizationAssistantUsage(env,organizationId,work))
    return assistantDeletionPending(env,organizationId,work,"organization_assistant_reconciliation_incomplete",existing?String(existing.job_id):undefined);
  const assistantBlockers=await organizationAssistantSubmissionBlockers(env,organizationId,assistantTables);
  const providerBlockers=await projectProviderSubmissionBlockers(env,organizationId);
  const executingReservations=await organizationExecutingReservationBlockers(env,organizationId,assistantTables),tokenReservations=await organizationAssistantTokenReservationBlockers(env,organizationId,assistantTables);
  if(assistantBlockers.length||providerBlockers.length||executingReservations.length||tokenReservations.length)return Response.json({error:"provider_submission_in_flight",assistantTasks:assistantBlockers,documentJobs:providerBlockers,costReservations:executingReservations,tokenReservations},{status:409});
  let historicalCursor="";
  while(true){
    const historical=await env.DB.prepare(`SELECT event.event_id,event.payload FROM events event
      WHERE event.event_id>? AND json_valid(event.payload)
        AND(EXISTS(SELECT 1 FROM project_event_scopes scoped WHERE scoped.event_id=event.event_id AND scoped.organization_id=?)
          OR EXISTS(SELECT 1 FROM organization_projects owned WHERE owned.organization_id=?
            AND event.stream_id='creative:'||owned.owner_user_id
            AND json_extract(event.payload,'$.project_id')=owned.project_id))
      ORDER BY event.event_id LIMIT 500`).bind(historicalCursor,organizationId,organizationId).all<{event_id:string;payload:string}>();
    for(const event of historical.results){
      try{
        const original=JSON.parse(event.payload) as Record<string,unknown>;
        const marker=original._private_ref;
        if(marker!==undefined){
          if(marker!==event.event_id)return Response.json({error:"historical_privacy_migration_required"},{status:409});
          const visible=publicEventPayload(event.event_id,original,true).payload;
          if(Object.entries(original).some(([key,value])=>!Object.hasOwn(visible,key)||JSON.stringify(value)!==JSON.stringify(visible[key])))
            return Response.json({error:"historical_privacy_migration_required"},{status:409});
        }else if(publicEventPayload(event.event_id,original).privateJson)return Response.json({error:"historical_privacy_migration_required"},{status:409});
      }catch{return Response.json({error:"historical_privacy_migration_required"},{status:409});}
      historicalCursor=event.event_id;
    }
    if(historical.results.length<500)break;
  }
  const inventory = await deletionInventory(env, organizationId);
  if(existing&&["pending","partial","processing"].includes(String(existing.status)))return processDeletion(request,env,actor,organizationId,String(existing.job_id),inventory,work);
  if (existing?.status === "completed") return Response.json({ jobId: String(existing.job_id), status: "completed", receipt: JSON.parse(String(existing.receipt_json ?? "{}")) });
  const id = uuidV7();
  const now = new Date().toISOString();
  const jobGuard="EXISTS(SELECT 1 FROM organization_deletion_jobs claimed WHERE claimed.job_id=? AND claimed.organization_id=? AND claimed.status='processing')";
  const assistantSubmissionGuard=noAssistantSubmissionGuard(organizationId,assistantTables);
  const documentSubmissionGuard=` AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource
    JOIN document_jobs job ON job.job_id=resource.resource_id AND job.owner_id=resource.actor_user_id
    WHERE resource.organization_id=? AND resource.resource_kind='job'
      AND job.status IN('queued','running','committing','failed','partial') AND(${unsettledProviderSubmissionSql("job.result_json")} OR job.kind='render_document' AND(
        json_extract(job.request_json,'$.artifactKind')='slides' AND json_extract(COALESCE(job.result_json,'{}'),'$.presentationProviderSubmission')='pending'
        OR json_extract(job.request_json,'$.artifactKind')='audio' AND json_extract(COALESCE(job.result_json,'{}'),'$.audioProviderSubmission')='pending'
          AND COALESCE(json_extract(COALESCE(job.result_json,'{}'),'$.providerJobId'),'')=''
        OR json_extract(job.request_json,'$.artifactKind')='storyboard'
          AND json_extract(COALESCE(job.result_json,'{}'),'$.storyboardProviderSubmission') IN('pending','confirmed')
        OR json_extract(job.request_json,'$.artifactKind')='video' AND(
          COALESCE(json_extract(COALESCE(job.result_json,'{}'),'$.providerJobId'),'')!=''
          OR json_type(COALESCE(job.result_json,'{}'),'$.productionAnchor') IS NOT NULL
          OR json_extract(COALESCE(job.result_json,'{}'),'$.generationReceipt.provider_request_status') IN('submitted','submission_unknown')
          OR EXISTS(SELECT 1 FROM json_each(COALESCE(job.result_json,'{}'),'$.productionSceneReceipts') scene
            WHERE json_extract(scene.value,'$.status') IN('submitted','completed'))))))`;
  const executingReservationGuard=noExecutingReservationGuard(organizationId,assistantTables);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO organization_deletion_jobs(job_id,organization_id,initiated_by_user_id,status,inventory_json,receipt_json,created_at,updated_at,completed_at)
      SELECT ?,?,?,'processing',?,NULL,?,?,NULL WHERE NOT EXISTS(SELECT 1 FROM organization_legal_holds hold
        WHERE hold.organization_id=? AND hold.status='active')
        AND NOT EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=? AND policy.legal_hold=1)
        AND NOT EXISTS(SELECT 1 FROM organization_recovery_snapshots recovery WHERE recovery.organization_id=? AND recovery.status='staging')
        AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs previous WHERE previous.organization_id=?
          AND previous.status IN('pending','partial','processing')) AND ${assistantSubmissionGuard.sql}${documentSubmissionGuard} AND ${executingReservationGuard.sql}`)
      .bind(id,organizationId,actor.userId,JSON.stringify({projectCount:inventory.projects.length,mediaCount:inventory.media.length,packageCount:inventory.packageCount,revisionCount:inventory.revisionCount,privateEventBodyCount:inventory.privateEventBodyCount}),now,now,organizationId,organizationId,organizationId,organizationId,
        ...assistantSubmissionGuard.bindings,organizationId,...executingReservationGuard.bindings),
    env.DB.prepare(`UPDATE pilot_cohorts SET status='closed',updated_at=? WHERE organization_id=? AND status IN('active','paused') AND ${jobGuard}`)
      .bind(now,organizationId,id,organizationId),
    env.DB.prepare(`UPDATE project_context_sessions SET revoked_at=? WHERE organization_id=? AND revoked_at IS NULL AND ${jobGuard}`)
      .bind(now,organizationId,id,organizationId),
    env.DB.prepare(`UPDATE shares SET revoked_at=? WHERE revoked_at IS NULL AND share_id IN(
      SELECT scope.share_id FROM share_scopes scope JOIN organization_projects project
        ON project.organization_id=? AND project.owner_user_id=scope.owner_id AND project.project_id=scope.project_id
    ) AND ${jobGuard}`).bind(now,organizationId,id,organizationId),
    env.DB.prepare(`UPDATE organization_projects SET status='deleting',updated_at=? WHERE organization_id=? AND status='active' AND ${jobGuard}`)
      .bind(now,organizationId,id,organizationId),
    env.DB.prepare(`UPDATE organization_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND user_id<>? AND status='active' AND ${jobGuard}`)
      .bind(now,now,organizationId,actor.userId,id,organizationId),
  ];
  for(const resource of inventory.media)statements.push(env.DB.prepare(`INSERT INTO organization_deletion_items(job_id,organization_id,resource_kind,resource_id,status,attempt_count,error_code,updated_at)
    SELECT ?,?,'media',?,'pending',0,NULL,? WHERE ${jobGuard}`)
    .bind(id,organizationId,String(resource.resource_id),now,id,organizationId));
  let created:D1Result[];
  try{created=await env.DB.batch(statements);}catch{return Response.json({error:"organization_legal_hold_active"},{status:409});}
  if(Number(created[0]?.meta.changes??0)!==1){
    const racedAssistant=await organizationAssistantSubmissionBlockers(env,organizationId,assistantTables);
    const racedDocuments=await projectProviderSubmissionBlockers(env,organizationId);
    const racedReservations=await organizationExecutingReservationBlockers(env,organizationId,assistantTables),racedTokens=await organizationAssistantTokenReservationBlockers(env,organizationId,assistantTables);
    if(racedAssistant.length||racedDocuments.length||racedReservations.length||racedTokens.length)return Response.json({error:"provider_submission_in_flight",assistantTasks:racedAssistant,documentJobs:racedDocuments,costReservations:racedReservations,tokenReservations:racedTokens},{status:409});
    return Response.json({error:"organization_deletion_conflict"},{status:409});
  }
  await cancelProjectActorJobs(env,actor,{organizationId});
  await recordOrganizationAudit(env, organizationId, actor, "OrganizationTenantDeletionStarted", "deletion", id, { resourceCount: inventory.media.length });
  return processDeletion(request,env,actor,organizationId,id,inventory,work);
}

async function createProvisioningCredential(env: WorkerEnv, actor: PilotUser, organizationId: string) {
  const id = uuidV7();
  const secret = `${uuidV7()}${uuidV7()}`.replaceAll("-", "");
  const token = `forma_provision_${secret}`;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO organization_provisioning_credentials(credential_id,organization_id,token_hash,status,created_by_user_id,created_at,revoked_at) VALUES(?,?,?,'active',?,?,NULL)")
    .bind(id, organizationId, await sha256(token), actor.userId, now).run();
  await recordOrganizationAudit(env, organizationId, actor, "OrganizationProvisioningCredentialCreated", "provisioning-credential", id);
  return Response.json({ credentialId: id, token, createdAt: now, warning: "The provisioning token is shown once and only its SHA-256 digest is stored.", interoperability: "local-scoped-endpoint-only" }, { status: 201, headers: { "cache-control": "private, no-store" } });
}

/** Truthful locally enforceable enterprise boundaries; external assurances are never fabricated. */
export async function handleEnterprise(request: Request, env: WorkerEnv, actor: PilotUser, organizationId: string, path: string[]) {
  const owner = actor.access.organizations.some((organization) => organization.organizationId === organizationId && organization.role === "owner");
  const audits = hasCapability(actor, "workspace.audit.read", { organizationId });
  const manages = hasCapability(actor, "workspace.policy.manage", { organizationId });
  if (path[0] === "assurance") {
    if (!audits || request.method !== "GET") return denied();
    return path[1] === "export" ? assuranceExport(request, env, actor, organizationId) : Response.json(await assurance(request, env, actor, organizationId));
  }
  if (path[0] === "security") {
    if (!owner) return denied();
    if(path[1]==="provisioning-credentials"){
      if(path.length===2&&request.method==="POST")return createProvisioningCredential(env,actor,organizationId);
      if(path.length===2&&request.method==="GET"){
        const rows=await env.DB.prepare("SELECT credential_id,status,created_by_user_id,created_at,revoked_at FROM organization_provisioning_credentials WHERE organization_id=? ORDER BY created_at DESC LIMIT 100")
          .bind(organizationId).all<Record<string,unknown>>();
        return Response.json({credentials:rows.results.map((row)=>({id:String(row.credential_id),status:String(row.status),createdByUserId:String(row.created_by_user_id),createdAt:String(row.created_at),revokedAt:row.revoked_at?String(row.revoked_at):null}))},{headers:{"cache-control":"private, no-store"}});
      }
      if(path.length===3&&request.method==="DELETE"){
        const now=new Date().toISOString();
        const revoked=await env.DB.prepare("UPDATE organization_provisioning_credentials SET status='revoked',revoked_at=? WHERE credential_id=? AND organization_id=? AND status='active' AND revoked_at IS NULL")
          .bind(now,path[2],organizationId).run();
        if(Number(revoked.meta.changes??0)!==1)return Response.json({error:"provisioning_credential_unavailable"},{status:404});
        await recordOrganizationAudit(env,organizationId,actor,"OrganizationProvisioningCredentialRevoked","provisioning-credential",path[2]!);
        return Response.json({credentialId:path[2],status:"revoked",revokedAt:now});
      }
      return new Response("Method not allowed",{status:405});
    }
    if (path[1] === "keys" && path[2] === "rotate" && request.method === "POST") {
      try {
        const key = await ensureOrganizationKey(env, organizationId, true);
        await recordOrganizationAudit(env, organizationId, actor, "OrganizationRecoveryEncryptionKeyRotated", "encryption-key", key.keyId, { version: key.version });
        return Response.json({ keyId: key.keyId, version: key.version, coverage: "encrypted-recovery-snapshots-only" });
      } catch (error) { return Response.json({ error: error instanceof OrganizationCryptoUnavailable ? error.message : "organization_encryption_key_rotation_failed" }, { status: 409 }); }
    }
    if (path.length !== 1) return new Response("Not found", { status: 404 });
    if (request.method === "GET") return Response.json(await securityPosture(env, organizationId, request));
    return request.method === "PATCH" ? saveSecurityPolicy(request, env, actor, organizationId) : new Response("Method not allowed", { status: 405 });
  }
  if (path[0] === "holds") return manages ? handleHolds(request, env, actor, organizationId, path[1] ?? "") : denied();
  if (path[0] === "recovery") return owner ? handleRecovery(request, env, actor, organizationId) : denied();
  if (path[0] === "ownership") return owner ? handleOwnershipTransfer(request, env, actor, organizationId) : denied();
  if (path[0] === "deletion") return owner ? handleDeletion(request, env, actor, organizationId) : denied();
  return new Response("Not found", { status: 404 });
}

export async function handleDeletionReceipts(env: WorkerEnv, actor: PilotUser) {
  const rows = await env.DB.prepare("SELECT job_id,organization_id,status,receipt_json,created_at,updated_at,completed_at FROM organization_deletion_jobs WHERE initiated_by_user_id=? ORDER BY created_at DESC LIMIT 50")
    .bind(actor.userId).all<Record<string, unknown>>();
  return Response.json({ deletions: rows.results.map((row) => ({ ...row, receipt: row.receipt_json ? JSON.parse(String(row.receipt_json)) : null, receipt_json: undefined })) });
}
