import { hasCapability, requireConsent, requireUser } from "./pilot-policy.ts";
import { readProjectRequestContext } from "./project-access.ts";
import { ensureSchema, type WorkerEnv } from "./runtime.ts";

/** Deliver durable, event-triggered follow-up only to the exact active project recipient. */
export async function handleProjectNotifications(request: Request, env: WorkerEnv): Promise<Response> {
  await ensureSchema(env);
  const principal = await requireUser(request, env, "viewer", { account: "principal" });
  if (principal.response || !principal.user) return principal.response ?? Response.json({ error: "authentication_required" }, { status: 401 });
  const selected = await readProjectRequestContext(request, env, principal.user);
  if (selected.response) return selected.response;
  const project = selected.context;
  if (!project || !hasCapability(principal.user, "project.read", { organizationId: project?.organizationId ?? "", projectAccessId: project?.projectAccessId ?? "" })) {
    return Response.json({ error: "project_context_required" }, { status: 403 });
  }
  const now = new Date().toISOString();
  if (request.method === "GET") {
    const scope=[project.projectAccessId,project.organizationId,project.projectId,principal.user.userId,now] as const;
    const [rows,counts]=await Promise.all([env.DB.prepare(`SELECT notification_id,kind,artifact_id,document_id,message,created_at,read_at
      FROM project_notifications WHERE project_access_id=? AND organization_id=? AND project_id=? AND recipient_user_id=? AND expires_at>?
      ORDER BY(read_at IS NULL) DESC,created_at DESC,notification_id DESC LIMIT 1000`).bind(...scope).all<Record<string, unknown>>(),
      env.DB.prepare(`SELECT COUNT(*) AS total_count,COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END),0) AS unread_count
        FROM project_notifications WHERE project_access_id=? AND organization_id=? AND project_id=? AND recipient_user_id=? AND expires_at>?`)
        .bind(...scope).first<{total_count:number;unread_count:number}>()]);
    return Response.json({ notifications: rows.results.map((row) => ({ id: String(row.notification_id), kind: String(row.kind), artifactId: row.artifact_id ? String(row.artifact_id) : null, documentId: row.document_id ? String(row.document_id) : null, message: String(row.message), createdAt: String(row.created_at), readAt: row.read_at ? String(row.read_at) : null })),
      totalCount:Number(counts?.total_count??0),unreadCount:Number(counts?.unread_count??0) }, { headers: { "cache-control": "private, no-store" } });
  }
  if (request.method !== "PATCH") return new Response("Method not allowed", { status: 405 });
  const consent = requireConsent(principal.user);
  if (consent) return consent;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "same_origin_required" }, { status: 403 });
  let body: { notificationId?: unknown };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "notification_id_required" }, { status: 400 }); }
  const id = typeof body.notificationId === "string" ? body.notificationId.trim() : "";
  if (!id) return Response.json({ error: "notification_id_required" }, { status: 400 });
  const updated = await env.DB.prepare("UPDATE project_notifications SET read_at=? WHERE notification_id=? AND project_access_id=? AND organization_id=? AND project_id=? AND recipient_user_id=? AND expires_at>? AND read_at IS NULL")
    .bind(now, id, project.projectAccessId, project.organizationId, project.projectId, principal.user.userId, now).run();
  return Number(updated.meta.changes ?? 0) ? Response.json({ acknowledged: true, readAt: now }) : Response.json({ error: "notification_not_found" }, { status: 404 });
}
