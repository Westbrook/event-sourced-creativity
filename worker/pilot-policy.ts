import { appendAuditEvent, ensureSchema, uuidV7, type WorkerEnv } from "./runtime";

export const POLICY_VERSION = "pilot-2026-08-10";
export type PilotRole = "admin" | "creator" | "agent" | "viewer";
export type PilotUser = { userId: string; email: string; displayName: string; role: PilotRole; consentVersion: string | null; consentedAt: string | null; streamId: string };

const roleRank: Record<PilotRole, number> = { viewer: 0, agent: 1, creator: 2, admin: 3 };
const intEnv = (value: string | undefined, fallback: number) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback; };

function decodeName(request: Request) {
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (!encoded || request.headers.get("oai-authenticated-user-full-name-encoding") !== "percent-encoded-utf-8") return "";
  try { return decodeURIComponent(encoded); } catch { return ""; }
}

function identityFromRequest(request: Request) {
  const url = new URL(request.url);
  const oaiId = request.headers.get("oai-authenticated-user-id");
  const oaiEmail = request.headers.get("oai-authenticated-user-email");
  const accessEmail = request.headers.get("cf-access-authenticated-user-email");
  if (oaiId && oaiEmail) return { userId: oaiId, email: oaiEmail.toLowerCase(), displayName: decodeName(request) || oaiEmail.split("@")[0] };
  if (accessEmail) return { userId: `access:${accessEmail.toLowerCase()}`, email: accessEmail.toLowerCase(), displayName: accessEmail.split("@")[0] };
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return { userId: "dev-local-creative", email: "creative@local.forma", displayName: "Local creative" };
  return null;
}

export async function requireUser(request: Request, env: WorkerEnv, minimum: PilotRole = "viewer") {
  await ensureSchema(env);
  const identity = identityFromRequest(request);
  if (!identity) return { response: Response.json({ error: "authentication_required" }, { status: 401 }), user: null };
  const now = new Date().toISOString();
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  const adminEmails = new Set((env.FORMA_ADMIN_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const initialRole: PilotRole = adminEmails.has(identity.email) || Number(count?.count ?? 0) === 0 ? "admin" : "creator";
  await env.DB.prepare("INSERT OR IGNORE INTO users (user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES (?,?,?,?,NULL,NULL,?,?)").bind(identity.userId, identity.email, identity.displayName, initialRole, now, now).run();
  await env.DB.prepare("UPDATE users SET email=?, display_name=?, updated_at=? WHERE user_id=?").bind(identity.email, identity.displayName, now, identity.userId).run();
  const row = await env.DB.prepare("SELECT * FROM users WHERE user_id=?").bind(identity.userId).first<Record<string, unknown>>();
  const user: PilotUser = { userId: String(row?.user_id), email: String(row?.email), displayName: String(row?.display_name), role: String(row?.role) as PilotRole, consentVersion: row?.consent_version ? String(row.consent_version) : null, consentedAt: row?.consented_at ? String(row.consented_at) : null, streamId: `creative:${identity.userId}` };
  if (roleRank[user.role] < roleRank[minimum]) return { response: Response.json({ error: "insufficient_role", required: minimum, role: user.role }, { status: 403 }), user: null };
  return { response: null, user };
}

export function requireConsent(user: PilotUser) {
  return user.consentVersion === POLICY_VERSION ? null : Response.json({ error: "pilot_terms_required", policyVersion: POLICY_VERSION }, { status: 428 });
}

const period = () => new Date().toISOString().slice(0, 7);
const budgetLimits = (env: WorkerEnv) => ({ user: intEnv(env.FORMA_USER_TOKEN_LIMIT, 250_000), workspace: intEnv(env.FORMA_WORKSPACE_TOKEN_LIMIT, 2_500_000) });

async function ensureBudgetRow(env: WorkerEnv, scope: "user" | "workspace", scopeId: string, limit: number) {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO budget_counters (scope,scope_id,period,used_tokens,reserved_tokens,hard_limit_tokens,updated_at) VALUES (?,?,?,0,0,?,?)").bind(scope, scopeId, period(), limit, now).run();
  await env.DB.prepare("UPDATE budget_counters SET hard_limit_tokens=?, updated_at=? WHERE scope=? AND scope_id=? AND period=?").bind(limit, now, scope, scopeId, period()).run();
}

export async function readBudgets(env: WorkerEnv, userId: string) {
  const limits = budgetLimits(env); await ensureBudgetRow(env, "user", userId, limits.user); await ensureBudgetRow(env, "workspace", "forma", limits.workspace);
  const rows = await env.DB.prepare("SELECT scope,used_tokens,reserved_tokens,hard_limit_tokens FROM budget_counters WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma'))").bind(period(), userId).all<Record<string, unknown>>();
  const map = Object.fromEntries(rows.results.map((row) => [String(row.scope), { used: Number(row.used_tokens), reserved: Number(row.reserved_tokens), limit: Number(row.hard_limit_tokens) }]));
  return { period: period(), user: map.user ?? { used: 0, reserved: 0, limit: limits.user }, workspace: map.workspace ?? { used: 0, reserved: 0, limit: limits.workspace } };
}

export async function reserveBudget(env: WorkerEnv, userId: string, tokens: number) {
  const limits = budgetLimits(env); await ensureBudgetRow(env, "user", userId, limits.user); await ensureBudgetRow(env, "workspace", "forma", limits.workspace);
  const now = new Date().toISOString();
  const userResult = await env.DB.prepare("UPDATE budget_counters SET reserved_tokens=reserved_tokens+?,updated_at=? WHERE scope='user' AND scope_id=? AND period=? AND used_tokens+reserved_tokens+?<=hard_limit_tokens").bind(tokens, now, userId, period(), tokens).run();
  if (Number(userResult.meta.changes ?? 0) !== 1) return { ok: false as const, scope: "user" as const };
  const workspaceResult = await env.DB.prepare("UPDATE budget_counters SET reserved_tokens=reserved_tokens+?,updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=? AND used_tokens+reserved_tokens+?<=hard_limit_tokens").bind(tokens, now, period(), tokens).run();
  if (Number(workspaceResult.meta.changes ?? 0) !== 1) {
    await env.DB.prepare("UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-?),updated_at=? WHERE scope='user' AND scope_id=? AND period=?").bind(tokens, now, userId, period()).run();
    return { ok: false as const, scope: "workspace" as const };
  }
  return { ok: true as const, reservationId: uuidV7(), reservedTokens: tokens };
}

export async function settleBudget(env: WorkerEnv, userId: string, reserved: number, used: number) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-?),used_tokens=used_tokens+?,updated_at=? WHERE scope='user' AND scope_id=? AND period=?").bind(reserved, used, now, userId, period()),
    env.DB.prepare("UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-?),used_tokens=used_tokens+?,updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=?").bind(reserved, used, now, period()),
  ]);
}

export async function releaseBudget(env: WorkerEnv, userId: string, reserved: number) { await settleBudget(env, userId, reserved, 0); }

export async function storePrivateContent(env: WorkerEnv, ownerId: string, kind: "prompt" | "provider-output" | "intent", content: string) {
  const contentId = uuidV7(); const createdAt = new Date(); const days = intEnv(env.FORMA_RETENTION_DAYS, 30); const expiresAt = new Date(createdAt.getTime() + days * 86_400_000);
  await env.DB.prepare("INSERT INTO private_content (content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES (?,?,?,?,?,?,NULL)").bind(contentId, ownerId, kind, content, createdAt.toISOString(), expiresAt.toISOString()).run();
  return { contentId, expiresAt: expiresAt.toISOString() };
}

export async function loadPrivateContent(env: WorkerEnv, ownerId: string) {
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE private_content SET content='',redacted_at=? WHERE owner_id=? AND redacted_at IS NULL AND expires_at<=?").bind(now, ownerId, now).run();
  const rows = await env.DB.prepare("SELECT content_id,content FROM private_content WHERE owner_id=? AND redacted_at IS NULL AND expires_at>?").bind(ownerId, now).all<{ content_id: string; content: string }>();
  return Object.fromEntries(rows.results.map((row) => [row.content_id, row.content]));
}

export async function handleSession(request: Request, env: WorkerEnv) {
  const auth = await requireUser(request, env); if (auth.response || !auth.user) return auth.response!; const user = auth.user;
  if (request.method === "POST") {
    const body = await request.json() as { action?: string; ownershipConfirmed?: boolean; providerProcessingConfirmed?: boolean };
    if (body.action !== "accept_terms" || !body.ownershipConfirmed || !body.providerProcessingConfirmed) return Response.json({ error: "explicit_consent_required" }, { status: 400 });
    const now = new Date().toISOString(); await env.DB.prepare("UPDATE users SET consent_version=?,consented_at=?,updated_at=? WHERE user_id=?").bind(POLICY_VERSION, now, now, user.userId).run();
    await appendAuditEvent(env, user.streamId, "user", "ConsentAccepted", { policy_version: POLICY_VERSION, ownership_confirmed: true, external_provider_processing_confirmed: true });
    user.consentVersion = POLICY_VERSION; user.consentedAt = now;
  } else if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  return Response.json({ user, policy: { version: POLICY_VERSION, accepted: user.consentVersion === POLICY_VERSION, passiveCapture: false, externalAssetsRequireAssertion: true, retentionDays: intEnv(env.FORMA_RETENTION_DAYS, 30), sharing: "private-expiring-revocable" }, provider: { name: "OpenAI Responses API", model: env.OPENAI_MODEL ?? "gpt-5.6-terra", configured: Boolean(env.OPENAI_API_KEY) }, budgets: await readBudgets(env, user.userId) });
}

export async function handleAdminUsers(request: Request, env: WorkerEnv) {
  const auth = await requireUser(request, env, "admin"); if (auth.response || !auth.user) return auth.response!;
  if (request.method === "GET") {
    const result = await env.DB.prepare("SELECT user_id,email,display_name,role,consent_version,consented_at,created_at FROM users ORDER BY created_at").all(); return Response.json({ users: result.results });
  }
  if (request.method !== "PATCH") return new Response("Method not allowed", { status: 405 });
  const body = await request.json() as { userId?: string; role?: PilotRole }; if (!body.userId || !body.role || !(body.role in roleRank)) return Response.json({ error: "valid_user_and_role_required" }, { status: 400 });
  if (body.userId === auth.user.userId && body.role !== "admin") return Response.json({ error: "admin_cannot_demote_self" }, { status: 409 });
  const result = await env.DB.prepare("UPDATE users SET role=?,updated_at=? WHERE user_id=?").bind(body.role, new Date().toISOString(), body.userId).run(); if (Number(result.meta.changes ?? 0) !== 1) return Response.json({ error: "user_not_found" }, { status: 404 });
  await appendAuditEvent(env, auth.user.streamId, "user", "RoleAssigned", { subject_user_id: body.userId, role: body.role }); return Response.json({ ok: true });
}
