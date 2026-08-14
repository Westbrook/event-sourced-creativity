import { appendAuditEvent, ensureSchema, uuidV7, type WorkerEnv } from "./runtime";
import { MICRO_USD_PER_USD } from "./replay-cost";

export const POLICY_VERSION = "pilot-2026-08-10";
export type PilotRole = "admin" | "creator" | "agent" | "viewer";
export type PilotUser = { userId: string; email: string; displayName: string; role: PilotRole; consentVersion: string | null; consentedAt: string | null; streamId: string };

const roleRank: Record<PilotRole, number> = { viewer: 0, agent: 1, creator: 2, admin: 3 };
const intEnv = (value: string | undefined, fallback: number) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback; };
const moneyEnv = (value: string | undefined, fallbackUsd: number) => { const parsed = Number(value); return Math.round((Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackUsd) * MICRO_USD_PER_USD); };

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
const BUDGET_RECONCILIATION_AGE_MS = 5 * 60_000;
type BudgetReservationRow = { reservation_id: string; owner_id: string; stream_id: string; correlation_id: string; operation: string; period: string; reserved_tokens: number; used_tokens: number; status: string; settlement_reason: string | null; created_at: string; settled_at: string | null; updated_at: string };
type BudgetReservationContext = { streamId?: string; correlationId?: string; operation?: string; period?: string; createdAt?: string };

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

export async function reserveBudget(env: WorkerEnv, userId: string, tokens: number, context: BudgetReservationContext = {}) {
  const amount = Math.max(0, Math.floor(tokens)); const limits = budgetLimits(env); const reservationPeriod = context.period ?? period();
  await ensureBudgetRow(env, "user", userId, limits.user); await ensureBudgetRow(env, "workspace", "forma", limits.workspace);
  const reservationId = uuidV7(); const now = context.createdAt ?? new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO budget_reservations (reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_tokens,used_tokens,status,settlement_reason,created_at,settled_at,updated_at)
      SELECT ?,?,?,?,?,?,?,0,'active',NULL,?,NULL,?
      WHERE ?>0
      AND EXISTS (SELECT 1 FROM budget_counters WHERE scope='user' AND scope_id=? AND period=? AND used_tokens+reserved_tokens+?<=hard_limit_tokens)
      AND EXISTS (SELECT 1 FROM budget_counters WHERE scope='workspace' AND scope_id='forma' AND period=? AND used_tokens+reserved_tokens+?<=hard_limit_tokens)`).bind(reservationId,userId,context.streamId??"",context.correlationId??"",context.operation??"provider-operation",reservationPeriod,amount,now,now,amount,userId,reservationPeriod,amount,reservationPeriod,amount),
    env.DB.prepare("UPDATE budget_counters SET reserved_tokens=reserved_tokens+?,updated_at=? WHERE scope='user' AND scope_id=? AND period=? AND EXISTS (SELECT 1 FROM budget_reservations WHERE reservation_id=? AND status='active')").bind(amount,now,userId,reservationPeriod,reservationId),
    env.DB.prepare("UPDATE budget_counters SET reserved_tokens=reserved_tokens+?,updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=? AND EXISTS (SELECT 1 FROM budget_reservations WHERE reservation_id=? AND status='active')").bind(amount,now,reservationPeriod,reservationId),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    const budgets = await readBudgets(env, userId); const userRemaining = budgets.user.limit - budgets.user.used - budgets.user.reserved;
    return { ok: false as const, scope: userRemaining < amount ? "user" as const : "workspace" as const };
  }
  return { ok: true as const, reservationId, reservedTokens: amount, period: reservationPeriod };
}

async function budgetReservation(env: WorkerEnv, userId: string, reservationId: string) {
  return env.DB.prepare("SELECT * FROM budget_reservations WHERE reservation_id=? AND owner_id=?").bind(reservationId,userId).first<BudgetReservationRow>();
}

async function adoptLegacyBudgetReservation(env: WorkerEnv, userId: string, reservationId: string, reservedTokens: number, context: BudgetReservationContext) {
  const now = new Date().toISOString(); const createdAt = context.createdAt ?? now;
  await env.DB.prepare("INSERT OR IGNORE INTO budget_reservations (reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_tokens,used_tokens,status,settlement_reason,created_at,settled_at,updated_at) VALUES (?,?,?,?,?,?,?,0,'active',NULL,?,NULL,?)")
    .bind(reservationId,userId,context.streamId??"",context.correlationId??"",context.operation??"legacy-provider-operation",context.period??createdAt.slice(0,7),Math.max(0,Math.floor(reservedTokens)),createdAt,now).run();
}

export async function settleBudget(env: WorkerEnv, userId: string, reservationId: string, used: number, reason = "provider_usage_recorded") {
  const reservation = await budgetReservation(env,userId,reservationId); if(!reservation)return{settled:false as const,reservedTokens:0,usedTokens:0,status:"missing"};
  const actual = Math.max(0,Math.floor(used)); const now = new Date().toISOString(); const status = actual > 0 ? "settled" : "released";
  const active = "EXISTS (SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status='active')";
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_tokens=used_tokens+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='user' AND scope_id=? AND period=?`).bind(reservationId,userId,reservation.reserved_tokens,reservationId,userId,actual,now,userId,reservation.period),
    env.DB.prepare(`UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_tokens=used_tokens+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=?`).bind(reservationId,userId,reservation.reserved_tokens,reservationId,userId,actual,now,reservation.period),
    env.DB.prepare("UPDATE budget_reservations SET used_tokens=?,status=?,settlement_reason=?,settled_at=?,updated_at=? WHERE reservation_id=? AND owner_id=? AND status='active'").bind(actual,status,reason,now,now,reservationId,userId),
  ]);
  const settled = Number(results[2]?.meta.changes ?? 0) === 1;
  return { settled, reservedTokens: reservation.reserved_tokens, usedTokens: settled ? actual : reservation.used_tokens, status: settled ? status : reservation.status };
}

export async function releaseBudget(env: WorkerEnv, userId: string, reservationId: string, options: BudgetReservationContext & { reservedTokens?: number; reason?: string } = {}) {
  if(!await budgetReservation(env,userId,reservationId)&&Number(options.reservedTokens)>0)await adoptLegacyBudgetReservation(env,userId,reservationId,Number(options.reservedTokens),options);
  return settleBudget(env,userId,reservationId,0,options.reason??"provider_operation_failed");
}

export async function releaseBudgetReservationsForCorrelation(env:WorkerEnv,user:PilotUser,correlationId:string,reason:string){
  const legacy=await env.DB.prepare(`SELECT occurred_at,json_extract(payload,'$.reservation_id') AS reservation_id,CAST(json_extract(payload,'$.reserved_tokens') AS INTEGER) AS reserved_tokens,COALESCE(json_extract(payload,'$.operation'),'provider-operation') AS operation,COALESCE(json_extract(payload,'$.period'),substr(occurred_at,1,7)) AS period FROM events reserved
    WHERE stream_id=? AND correlation_id=? AND type='BudgetReserved' AND NOT EXISTS (SELECT 1 FROM events terminal WHERE terminal.stream_id=reserved.stream_id AND terminal.type IN ('BudgetReleased','GenerationUsageRecorded') AND json_extract(terminal.payload,'$.reservation_id')=json_extract(reserved.payload,'$.reservation_id'))`).bind(user.streamId,correlationId).all<Record<string,unknown>>();
  for(const row of legacy.results){const reservationId=String(row.reservation_id??"");const tokens=Number(row.reserved_tokens??0);if(reservationId&&tokens>0)await adoptLegacyBudgetReservation(env,user.userId,reservationId,tokens,{streamId:user.streamId,correlationId,operation:String(row.operation??"provider-operation"),period:String(row.period??period()),createdAt:String(row.occurred_at??new Date().toISOString())});}
  const active=await env.DB.prepare("SELECT * FROM budget_reservations WHERE owner_id=? AND correlation_id=? AND status='active' ORDER BY created_at").bind(user.userId,correlationId).all<BudgetReservationRow>();const released=[] as Array<{id:string;tokens:number;operation:string}>;
  for(const reservation of active.results){const result=await releaseBudget(env,user.userId,reservation.reservation_id,{reason});if(result.settled)released.push({id:reservation.reservation_id,tokens:result.reservedTokens,operation:reservation.operation});}
  return released;
}

/** Repairs reservations whose event has no terminal settlement and whose server job is no longer active. */
export async function reconcileFailedBudgetReservations(env: WorkerEnv, user: PilotUser, now = Date.now()) {
  await ensureSchema(env); const cutoff = new Date(now-BUDGET_RECONCILIATION_AGE_MS).toISOString();
  const legacy = await env.DB.prepare(`SELECT reserved.event_id,reserved.correlation_id,reserved.occurred_at,
      json_extract(reserved.payload,'$.reservation_id') AS reservation_id,
      CAST(json_extract(reserved.payload,'$.reserved_tokens') AS INTEGER) AS reserved_tokens,
      COALESCE(json_extract(reserved.payload,'$.operation'),'image-generation') AS operation,
      COALESCE(json_extract(reserved.payload,'$.period'),substr(reserved.occurred_at,1,7)) AS period
    FROM events reserved
    WHERE reserved.stream_id=? AND reserved.type='BudgetReserved' AND reserved.occurred_at<=?
      AND json_extract(reserved.payload,'$.reservation_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM events terminal WHERE terminal.stream_id=reserved.stream_id AND terminal.type IN ('BudgetReleased','GenerationUsageRecorded') AND json_extract(terminal.payload,'$.reservation_id')=json_extract(reserved.payload,'$.reservation_id'))
    ORDER BY reserved.occurred_at ASC LIMIT 200`).bind(user.streamId,cutoff).all<Record<string,unknown>>();
  for(const row of legacy.results){const reservationId=String(row.reservation_id??"");const reservedTokens=Number(row.reserved_tokens??0);if(!reservationId||reservedTokens<=0)continue;await adoptLegacyBudgetReservation(env,user.userId,reservationId,reservedTokens,{streamId:user.streamId,correlationId:String(row.correlation_id??""),operation:String(row.operation??"image-generation"),period:String(row.period??period()),createdAt:String(row.occurred_at??new Date(now).toISOString())});}
  const active = await env.DB.prepare(`SELECT * FROM budget_reservations reservation
    WHERE reservation.owner_id=? AND reservation.status='active' AND reservation.created_at<=?
      AND NOT EXISTS (SELECT 1 FROM document_jobs job WHERE job.owner_id=reservation.owner_id AND job.status IN ('queued','running') AND job.correlation_id=reservation.correlation_id)
    ORDER BY reservation.created_at ASC LIMIT 100`).bind(user.userId,cutoff).all<BudgetReservationRow>();
  let released = 0;let count=0;
  for(const row of active.results){
    const settlement=await releaseBudget(env,user.userId,row.reservation_id,{reason:"orphaned_failed_reservation_reconciled"});
    if(!settlement.settled)continue;
    released+=settlement.reservedTokens;count+=1;
    await appendAuditEvent(env,user.streamId,"worker:policy","BudgetReleased",{reservation_id:row.reservation_id,reserved_tokens:settlement.reservedTokens,reason:"orphaned_failed_reservation_reconciled",operation:row.operation,automatic_reconciliation:true},row.correlation_id||uuidV7());
  }
  return { releasedTokens: released, reservationCount: count };
}

export type CostBudgetSnapshot = { usedMicrousd: number; reservedMicrousd: number; limitMicrousd: number; remainingMicrousd: number };
const costBudgetLimits = (env: WorkerEnv) => ({ user: moneyEnv(env.FORMA_USER_COST_LIMIT_USD, 10), workspace: moneyEnv(env.FORMA_WORKSPACE_COST_LIMIT_USD, 100) });

async function ensureCostBudgetRow(env: WorkerEnv, scope: "user" | "workspace", scopeId: string, limitMicrousd: number) {
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO cost_budget_counters (scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at) VALUES (?,?,?,0,0,?,?)").bind(scope, scopeId, period(), limitMicrousd, now).run();
  await env.DB.prepare("UPDATE cost_budget_counters SET hard_limit_microusd=?,updated_at=? WHERE scope=? AND scope_id=? AND period=?").bind(limitMicrousd, now, scope, scopeId, period()).run();
}

export async function readCostBudgets(env: WorkerEnv, userId: string) {
  const limits = costBudgetLimits(env);
  await ensureCostBudgetRow(env, "user", userId, limits.user);
  await ensureCostBudgetRow(env, "workspace", "forma", limits.workspace);
  const rows = await env.DB.prepare("SELECT scope,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma'))").bind(period(), userId).all<Record<string, unknown>>();
  const map = Object.fromEntries(rows.results.map((row) => {
    const usedMicrousd = Number(row.used_microusd); const reservedMicrousd = Number(row.reserved_microusd); const limitMicrousd = Number(row.hard_limit_microusd);
    return [String(row.scope), { usedMicrousd, reservedMicrousd, limitMicrousd, remainingMicrousd: Math.max(0, limitMicrousd - usedMicrousd - reservedMicrousd) } satisfies CostBudgetSnapshot];
  }));
  const empty = (limitMicrousd: number): CostBudgetSnapshot => ({ usedMicrousd: 0, reservedMicrousd: 0, limitMicrousd, remainingMicrousd: limitMicrousd });
  return { period: period(), currency: "USD" as const, user: map.user ?? empty(limits.user), workspace: map.workspace ?? empty(limits.workspace) };
}

export async function reserveCostBudget(env: WorkerEnv, userId: string, requestedMicrousd: number, options: { maximumMicrousd: number; allowUserOverage: boolean }) {
  const amount = Math.max(0, Math.floor(requestedMicrousd));
  if (!amount || amount > Math.floor(options.maximumMicrousd)) return { ok: false as const, scope: "authorization" as const };
  const limits = costBudgetLimits(env); const now = new Date().toISOString();
  await ensureCostBudgetRow(env, "user", userId, limits.user); await ensureCostBudgetRow(env, "workspace", "forma", limits.workspace);
  const userBefore = await env.DB.prepare("SELECT used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=? AND period=?").bind(userId, period()).first<Record<string, unknown>>();
  const projectedUser = Number(userBefore?.used_microusd ?? 0) + Number(userBefore?.reserved_microusd ?? 0) + amount;
  const userQuery = options.allowUserOverage
    ? env.DB.prepare("UPDATE cost_budget_counters SET reserved_microusd=reserved_microusd+?,updated_at=? WHERE scope='user' AND scope_id=? AND period=?").bind(amount, now, userId, period())
    : env.DB.prepare("UPDATE cost_budget_counters SET reserved_microusd=reserved_microusd+?,updated_at=? WHERE scope='user' AND scope_id=? AND period=? AND used_microusd+reserved_microusd+?<=hard_limit_microusd").bind(amount, now, userId, period(), amount);
  const userResult = await userQuery.run();
  if (Number(userResult.meta.changes ?? 0) !== 1) return { ok: false as const, scope: "user" as const };
  const workspaceResult = await env.DB.prepare("UPDATE cost_budget_counters SET reserved_microusd=reserved_microusd+?,updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=? AND used_microusd+reserved_microusd+?<=hard_limit_microusd").bind(amount, now, period(), amount).run();
  if (Number(workspaceResult.meta.changes ?? 0) !== 1) {
    await env.DB.prepare("UPDATE cost_budget_counters SET reserved_microusd=MAX(0,reserved_microusd-?),updated_at=? WHERE scope='user' AND scope_id=? AND period=?").bind(amount, now, userId, period()).run();
    return { ok: false as const, scope: "workspace" as const };
  }
  return { ok: true as const, reservationId: uuidV7(), reservedMicrousd: amount, userOverageMicrousd: Math.max(0, projectedUser - Number(userBefore?.hard_limit_microusd ?? limits.user)) };
}

export async function settleCostBudget(env: WorkerEnv, userId: string, reservedMicrousd: number, usedMicrousd: number) {
  const now = new Date().toISOString(); const reserved = Math.max(0, Math.floor(reservedMicrousd)); const used = Math.max(0, Math.floor(usedMicrousd));
  await env.DB.batch([
    env.DB.prepare("UPDATE cost_budget_counters SET reserved_microusd=MAX(0,reserved_microusd-?),used_microusd=used_microusd+?,updated_at=? WHERE scope='user' AND scope_id=? AND period=?").bind(reserved, used, now, userId, period()),
    env.DB.prepare("UPDATE cost_budget_counters SET reserved_microusd=MAX(0,reserved_microusd-?),used_microusd=used_microusd+?,updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=?").bind(reserved, used, now, period()),
  ]);
}

export async function releaseCostBudget(env: WorkerEnv, userId: string, reservedMicrousd: number) { await settleCostBudget(env, userId, reservedMicrousd, 0); }

export async function storePrivateContent(env: WorkerEnv, ownerId: string, kind: "prompt" | "provider-output" | "intent" | "condition" | "critique" | "adaptive-intent" | "adaptive-structure" | "chat-user" | "chat-assistant" | "ideation-prompt", content: string) {
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
  await reconcileFailedBudgetReservations(env,user);
  return Response.json({ user, policy: { version: POLICY_VERSION, accepted: user.consentVersion === POLICY_VERSION, passiveCapture: false, attentionCapture: { available: true, defaultOn: false, retentionDays: 14, rawInputCapture: false }, externalAssetsRequireAssertion: true, retentionDays: intEnv(env.FORMA_RETENTION_DAYS, 30), sharing: "private-expiring-revocable" }, provider: { name: "OpenAI Responses + Image APIs", model: env.OPENAI_IMAGE_MODEL ?? "gpt-image-2", plannerModel: env.OPENAI_MODEL ?? "gpt-5.6-terra", configured: Boolean(env.OPENAI_API_KEY) }, budgets: await readBudgets(env, user.userId) });
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
