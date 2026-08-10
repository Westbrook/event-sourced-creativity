import { foldEvents } from "../src/model/events";
import { requireConsent, requireUser } from "./pilot-policy";
import { appendAuditEvent, ensureSchema, readEvents, uuidV7, type WorkerEnv } from "./runtime";

const token = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const hashToken = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const serializeShare = (row: Record<string, unknown>) => ({ shareId: String(row.share_id), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : null, createdAt: String(row.created_at), active: !row.revoked_at && String(row.expires_at) > new Date().toISOString() });

export async function handleShares(request: Request, env: WorkerEnv, shareId = "") {
  const auth = await requireUser(request, env, request.method === "GET" ? "viewer" : "creator"); if (auth.response || !auth.user) return auth.response!; const user = auth.user;
  if (request.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM shares WHERE owner_id=? ORDER BY created_at DESC LIMIT 50").bind(user.userId).all<Record<string, unknown>>(); return Response.json({ shares: rows.results.map(serializeShare) });
  }
  const consent = requireConsent(user); if (consent) return consent;
  if (request.method === "POST") {
    const body = await request.json() as { expiresHours?: number }; const expiresHours = Math.max(1, Math.min(168, Math.floor(Number(body.expiresHours ?? 24))));
    const shareToken = token(); const id = uuidV7(); const createdAt = new Date(); const expiresAt = new Date(createdAt.getTime() + expiresHours * 3_600_000);
    await env.DB.prepare("INSERT INTO shares (share_id,token_hash,owner_id,stream_id,expires_at,revoked_at,created_at) VALUES (?,?,?,?,?,NULL,?)").bind(id, await hashToken(shareToken), user.userId, user.streamId, expiresAt.toISOString(), createdAt.toISOString()).run();
    await appendAuditEvent(env, user.streamId, "user", "ShareLinkCreated", { share_id: id, expires_at: expiresAt.toISOString(), access: "read-only" });
    return Response.json({ share: { shareId: id, token: shareToken, expiresAt: expiresAt.toISOString(), active: true } });
  }
  if (request.method === "DELETE" && shareId) {
    const now = new Date().toISOString(); const result = await env.DB.prepare("UPDATE shares SET revoked_at=? WHERE share_id=? AND owner_id=? AND revoked_at IS NULL").bind(now, shareId, user.userId).run();
    if (Number(result.meta.changes ?? 0) !== 1) return Response.json({ error: "share_not_found_or_revoked" }, { status: 404 });
    await appendAuditEvent(env, user.streamId, "user", "ShareLinkRevoked", { share_id: shareId, revoked_at: now }); return Response.json({ ok: true });
  }
  return new Response("Method not allowed", { status: 405 });
}

export async function handleSharedView(request: Request, env: WorkerEnv, rawToken: string) {
  await ensureSchema(env); if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const row = await env.DB.prepare("SELECT * FROM shares WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?").bind(await hashToken(rawToken), new Date().toISOString()).first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "share_expired_or_revoked" }, { status: 404 });
  const events = await readEvents(env, String(row.stream_id)); const projection = foldEvents(events);
  return Response.json({ share: serializeShare(row), projection: { projectName: projection.projectName, documentTitle: projection.documentTitle, blocks: projection.blocks, outputs: projection.outputs.map(({ id, modelId, variant, sequence }) => ({ id, modelId, variant, sequence })), latestCompile: projection.latestCompile } });
}
