import { migrateLegacyEventPayloads, unsafePublicIdentifierPredicate } from "./event-privacy-migration.ts";
import { requireConsent, requireUser } from "./pilot-policy.ts";
import { readProjectRequestContext } from "./project-access.ts";
import { ensureSchema, type WorkerEnv } from "./runtime.ts";

async function ownedLegacyCount(env: WorkerEnv, userId: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM events WHERE stream_id=? AND json_valid(payload)
    AND(json_extract(payload,'$._private_ref') IS NULL OR ${unsafePublicIdentifierPredicate()})`)
    .bind(`creative:${userId}`).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

/** Explicit customer erasure and administrator-only historical ledger migration. */
export async function handleEventPrivacy(request: Request, env: WorkerEnv): Promise<Response> {
  await ensureSchema(env);
  const authenticated = await requireUser(request, env, "viewer", { account: "principal" });
  if (authenticated.response || !authenticated.user) return authenticated.response ?? Response.json({ error: "authentication_required" }, { status: 401 });
  const actor = authenticated.user;
  if (actor.fictional) return Response.json({ error: "principal_account_required" }, { status: 403 });
  const selected = await readProjectRequestContext(request, env, actor);
  if (selected.response) return selected.response;

  if (request.method === "GET") {
    const [legacy, governed] = await Promise.all([
      ownedLegacyCount(env, actor.userId),
      env.DB.prepare("SELECT COUNT(*) AS count FROM event_private_payloads WHERE owner_id=? AND redacted_at IS NULL").bind(actor.userId).first<{ count: number }>(),
    ]);
    return Response.json({ legacyAuthoredEvents: legacy, governedAuthoredEvents: Number(governed?.count ?? 0), historicalMigrationAvailable: actor.role === "admin", sharedOrganizationContextExcluded: true, backupAndOtherDeviceErasure: "not-verified" });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const consent = requireConsent(actor);
  if (consent) return consent;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "same_origin_required" }, { status: 403 });
  if (selected.context) return Response.json({ error: "personal_privacy_context_required", message: "Leave the shared organization project before changing personal privacy controls." }, { status: 409 });
  let body: { action?: unknown; confirmation?: unknown };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "invalid_privacy_request" }, { status: 400 }); }

  if (body.action === "migrate-historical-events") {
    if (actor.role !== "admin") return Response.json({ error: "administrator_required" }, { status: 403 });
    if (body.confirmation !== "MIGRATE_HISTORICAL_EVENT_CONTENT") return Response.json({ error: "explicit_migration_confirmation_required" }, { status: 400 });
    try { return Response.json({ ...await migrateLegacyEventPayloads(env), rowIdentitiesPreserved: true, browserCachesMustBeRefreshed: true, historicalBackupsPurged: false }); }
    catch (error) { return Response.json({ error: "historical_migration_failed", message: error instanceof Error ? error.message : "Historical event privacy migration failed." }, { status: 409 }); }
  }

  if (body.action !== "erase-personal-authored-context") return Response.json({ error: "unsupported_privacy_action" }, { status: 400 });
  if (body.confirmation !== "ERASE_MY_PERSONAL_AUTHORED_CONTEXT") return Response.json({ error: "explicit_erasure_confirmation_required" }, { status: 400 });
  const remainingLegacy = await ownedLegacyCount(env, actor.userId);
  if (remainingLegacy) return Response.json({ error: "historical_privacy_migration_required", legacyAuthoredEvents: remainingLegacy, message: "An administrator must first migrate historical authored event bodies; erasure would otherwise be incomplete." }, { status: 409 });
  const now = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE event_private_payloads SET private_json='',redacted_at=?
      WHERE owner_id=? AND redacted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=event_private_payloads.private_event_id AND scope.owner_user_id=?)
        AND NOT EXISTS(SELECT 1 FROM organization_projects project WHERE project.owner_user_id=? AND project.status='active'
          AND (project.project_id=event_private_payloads.project_id OR EXISTS(SELECT 1 FROM project_resource_scopes resource
            WHERE resource.project_access_id=project.project_access_id AND resource.organization_id=project.organization_id AND resource.owner_user_id=project.owner_user_id
              AND resource.resource_kind='document' AND resource.resource_id=event_private_payloads.document_id)))`)
      .bind(now, actor.userId, actor.userId, actor.userId),
    env.DB.prepare(`UPDATE private_content SET content='',redacted_at=?
      WHERE owner_id=? AND redacted_at IS NULL AND kind!='document-artifact'
        AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id AND (resource.actor_user_id=? OR resource.owner_user_id=?))`)
      .bind(now, actor.userId, actor.userId, actor.userId),
    env.DB.prepare("DELETE FROM external_content WHERE owner_id=?").bind(actor.userId),
  ]);
  return Response.json({ erasedAuthoredEventBodies: Number(result[0]?.meta.changes ?? 0), erasedTemporaryContent: Number(result[1]?.meta.changes ?? 0), clearedDerivedContent: Number(result[2]?.meta.changes ?? 0), finishedOutputsRetained: true, sharedOrganizationContextRetained: true, uploadedFilesRetained: true, otherDevicesAndBackupsPurged: false });
}
