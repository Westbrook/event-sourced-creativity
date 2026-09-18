import { PRINCIPAL_WITH_ACCESS_SQL } from "../access-policy.ts";
import { configuredPilotAdmissionGuard, requireExistingHoldAdministrator, pilotExecutionAllowance,
  reserveBudget, reserveCostBudget, claimCostBudgetReservation, settleBudget, settleCostBudget,
  POLICY_VERSION, type BudgetReservationGuard, type PilotUser } from "../pilot-policy.ts";
import type { WorkerEnv } from "../runtime.ts";
import { BenchmarkLedger } from "./ledger.ts";
import { benchmarkPlan, EXPERIMENT_ID, handleMemoryBenchmark, MAXIMUM_MICRO_USD, sha256,
  type BenchmarkDependencies, type BenchmarkEnvironment, type BenchmarkGrant } from "./runner.ts";
import { priceOperation } from "./provider.ts";

/** Default-off native caller. Optional schema is installed explicitly, never from a request. */
export type NativeBenchmarkEnvironment = WorkerEnv & BenchmarkEnvironment & {
  FORMA_MEMORY_BENCHMARK_ACTOR_IDS?: string;
  /** Digest of the exact reviewed integration, including the hold-reconciliation patch. */
  FORMA_MEMORY_BENCHMARK_SOURCE_SHA256?: string;
};
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const same = (left: BenchmarkGrant, right: BenchmarkGrant) => JSON.stringify(left) === JSON.stringify(right);
const deny = (code: string): never => { throw new Error(`memory_benchmark_native_${code}`); };
const reply = (value: unknown, status = 200) => Response.json(value, { status,
  headers: { "cache-control": "private, no-store", vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email" } });
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const snapshotSql = `SELECT json_object('user',user_id,'email',email,'role',role,'consent',consent_version,
  'updated',updated_at,'epoch',permission_epoch,'grants',grants_json,'organizations',organizations_json,
  'projects',projects_json,'policies',identity_policies_json,'canvas',approved_canvas_requirements) AS value
  FROM (${PRINCIPAL_WITH_ACCESS_SQL})`;
type Captured = { user: PilotUser; snapshot: string; guard: BudgetReservationGuard };
type StoredGrant = BenchmarkGrant & { sourceSha256: string; origin: string; createdAt: number };

function admittedRequest(request: Request, env: NativeBenchmarkEnvironment, recovery = false): boolean {
  const url = new URL(request.url);
  return (recovery || env.FORMA_MEMORY_BENCHMARK_ENABLED === "1") && hash(env.FORMA_MEMORY_BENCHMARK_SOURCE_SHA256)
    && url.protocol === "https:" && url.origin === env.FORMA_MEMORY_BENCHMARK_ORIGIN && !url.search
    && !/(?:^|;\s*)(?:forma_impersonation|forma_project_context)=/.test(request.headers.get("cookie") ?? "")
    && (request.method === "GET" || request.method === "POST" && request.headers.get("origin") === url.origin
      && request.headers.get("sec-fetch-site") !== "cross-site");
}

async function capture(request: Request, env: NativeBenchmarkEnvironment, recovery = false): Promise<Captured | null> {
  if (!admittedRequest(request, env, recovery)) return null;
  const { user } = await requireExistingHoldAdministrator(request, env);
  const allowed = new Set((env.FORMA_MEMORY_BENCHMARK_ACTOR_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean));
  if (!user || !allowed.has(user.userId) || user.fictional || user.role !== "admin" || !user.authorizationSnapshot
    || user.billingUserId && user.billingUserId !== user.userId || user.projectExecution
    || user.consentVersion !== POLICY_VERSION) return null;
  // This first candidate has one explicitly personal/self payer; it cannot choose another user,
  // an organization, a managed pilot, or effective impersonation billing from request data.
  const allowance = await pilotExecutionAllowance(env, user.userId);
  if (!allowance.allowed || allowance.pilot !== null) return null;
  const snapshot = await env.DB.prepare(snapshotSql).bind(user.userId).first<{ value: string }>();
  if (!snapshot || typeof snapshot.value !== "string") return null;
  const captured = JSON.parse(snapshot.value) as Record<string, unknown>, original = user.authorizationSnapshot;
  if (captured.user !== user.userId || captured.email !== user.email || captured.role !== "admin" || captured.consent !== POLICY_VERSION
    || captured.updated !== original.updatedAt || captured.epoch !== original.rawEpoch || captured.grants !== original.grants
    || captured.organizations !== original.organizations || captured.projects !== original.projects
    || captured.policies !== original.identityPolicies || captured.canvas !== original.canvasRequirements) return null;
  const admission = configuredPilotAdmissionGuard(env, user);
  const guard = { sql: `EXISTS(SELECT 1 FROM (${snapshotSql}) WHERE value=?) AND (${admission.sql})
    AND EXISTS(SELECT 1 FROM users WHERE user_id=? AND email=? AND role='admin' AND consent_version=?)
    AND NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort
      ON cohort.cohort_id=participant.cohort_id AND cohort.organization_id=participant.organization_id
      WHERE participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL
        AND cohort.status IN ('active','paused','closed'))`,
    bindings: [user.userId, snapshot.value, ...admission.bindings, user.userId, user.email, POLICY_VERSION, user.userId] };
  if (!await env.DB.prepare("SELECT 1 AS current WHERE " + guard.sql).bind(...guard.bindings).first()) return null;
  return { user, snapshot: snapshot.value, guard };
}

const qualificationSql = `SELECT * FROM memory_benchmark_native_qualifications WHERE plan_hash=? AND source_sha256=?
  AND origin=? AND status='qualified' AND qualified_at<=${clock} AND expires_at>${clock}
  AND model_access_verified=1 AND pricing_verified=1 AND retention_verified=1 AND token_bounds_verified=1
  AND native_accounting_verified=1 AND hold_reconciliation_verified=1 AND cleanup_verified=1`;

async function qualification(env: NativeBenchmarkEnvironment, planHash: string) {
  return env.DB.prepare(qualificationSql).bind(planHash, env.FORMA_MEMORY_BENCHMARK_SOURCE_SHA256!,
    env.FORMA_MEMORY_BENCHMARK_ORIGIN!).first<{ qualification_id: string; evidence_sha256: string; expires_at: number }>();
}

function currentGrantGuard(grant: StoredGrant): BudgetReservationGuard {
  return { sql: `EXISTS(SELECT 1 FROM memory_benchmark_native_grants grant_row
    JOIN (${qualificationSql}) qualified ON qualified.qualification_id=grant_row.qualification_id
    WHERE grant_row.experiment_id=? AND grant_row.principal_id=? AND grant_row.payer_id=grant_row.principal_id
      AND grant_row.payer_id=? AND grant_row.plan_hash=? AND grant_row.maximum_micro_usd=10000000
      AND grant_row.period=? AND grant_row.period=strftime('%Y-%m','now') AND grant_row.expires_at=?
      AND grant_row.expires_at>${clock} AND grant_row.revoked_at IS NULL)`,
    bindings: [grant.approvedPlanHash, grant.sourceSha256, grant.origin, EXPERIMENT_ID, grant.principalId,
      grant.payerId, grant.approvedPlanHash, grant.period, grant.expiresAt] };
}

function join(...guards: BudgetReservationGuard[]): BudgetReservationGuard {
  return { sql: guards.map(guard => `(${guard.sql})`).join(" AND "), bindings: guards.flatMap(guard => guard.bindings) };
}

/** Existing native accounting helpers keep their own SQL. Assertions surround their exact
 * transaction; even helpers using statement.run() receive the same guarded atomic batch. */
function guardedEnvironment(env: NativeBenchmarkEnvironment, guard: BudgetReservationGuard, recovery = false): NativeBenchmarkEnvironment {
  const db = env.DB;
  const statementsIssued = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const batch = async <T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    if (!recovery && env.FORMA_MEMORY_BENCHMARK_ENABLED !== "1") deny("disabled");
    const assertion = () => db.prepare(`INSERT INTO memory_benchmark_native_assertions(passed)
      SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END`).bind(...guard.bindings);
    const genuine = statements.map(statement => statementsIssued.get(statement) ?? statement);
    const results = await db.batch<T>([assertion(), ...genuine, assertion(),
      db.prepare("DELETE FROM memory_benchmark_native_assertions")]);
    if (results.length !== statements.length + 3 || results.some(result => result.success !== true)) deny("transaction_unacknowledged");
    return results.slice(1, -2);
  };
  const prepare = (sql: string, values: unknown[] = []): D1PreparedStatement => {
    const statement = db.prepare(sql).bind(...values);
    const wrapped = { bind: (...next: unknown[]) => prepare(sql, next), first: statement.first.bind(statement),
      all: statement.all.bind(statement),
      run: async <T = Record<string, unknown>>() => (await batch<T>([statement]))[0]! } as D1PreparedStatement;
    statementsIssued.set(wrapped, statement);
    return wrapped;
  };
  return { ...env, DB: { ...db, prepare: (sql: string) => prepare(sql), batch } as D1Database };
}

async function readGrant(request: Request, env: NativeBenchmarkEnvironment): Promise<{ grant: StoredGrant; principal: Captured } | null> {
  const principal = await capture(request, env);
  if (!principal) return null;
  const plan = await benchmarkPlan();
  const row = await env.DB.prepare(`SELECT * FROM memory_benchmark_native_grants WHERE experiment_id=?
    AND principal_id=? AND payer_id=? AND plan_hash=? AND revoked_at IS NULL`)
    .bind(EXPERIMENT_ID, principal.user.userId, principal.user.userId, plan.planHash).first<Record<string, unknown>>();
  if (!row || !integer(row.expires_at) || !integer(row.created_at) || row.maximum_micro_usd !== MAXIMUM_MICRO_USD
    || row.expires_at <= Date.now() || row.expires_at - row.created_at > 86_400_000) return null;
  const grant: StoredGrant = { principalId: principal.user.userId, payerId: principal.user.userId, period: String(row.period),
    expiresAt: row.expires_at, approvedPlanHash: plan.planHash, approvedMaximumMicroUsd: MAXIMUM_MICRO_USD,
    qualificationId: String(row.qualification_id), sourceSha256: env.FORMA_MEMORY_BENCHMARK_SOURCE_SHA256!,
    origin: env.FORMA_MEMORY_BENCHMARK_ORIGIN!, createdAt: row.created_at };
  const proof = join(principal.guard, currentGrantGuard(grant));
  return await env.DB.prepare("SELECT 1 AS current WHERE " + proof.sql).bind(...proof.bindings).first() ? { grant, principal } : null;
}

function publicGrant(grant: StoredGrant): BenchmarkGrant {
  const { principalId, payerId, period, expiresAt, approvedPlanHash, approvedMaximumMicroUsd, qualificationId } = grant;
  return { principalId, payerId, period, expiresAt, approvedPlanHash, approvedMaximumMicroUsd, qualificationId };
}

async function exactConfirmation(request: Request, planHash: string): Promise<boolean> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !request.body) return false;
  const reader = request.body.getReader(); let text = ""; let size = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > 512) { await reader.cancel(); return false; } text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
    const match = /^\s*\{\s*"action"\s*:\s*"approve-synthetic-benchmark"\s*,\s*"planHash"\s*:\s*"([a-f0-9]{64})"\s*,\s*"maximumMicroUsd"\s*:\s*10000000\s*,\s*"chargeMyAiAllowance"\s*:\s*true\s*\}\s*$/.exec(text);
    return match?.[1] === planHash;
  } catch { return false; } finally { reader.releaseLock(); }
}

async function confirmGrant(request: Request, env: NativeBenchmarkEnvironment): Promise<Response> {
  const principal = await capture(request, env);
  if (!principal) return reply({ error: "benchmark_not_authorized" }, 403);
  const plan = await benchmarkPlan();
  if (!await exactConfirmation(request, plan.planHash)) return reply({ error: "benchmark_confirmation_invalid" }, 400);
  const qualified = await qualification(env, plan.planHash);
  if (!qualified || !hash(qualified.evidence_sha256)) return reply({ error: "benchmark_qualification_missing" }, 503);
  const now = Date.now(), date = new Date(now), period = date.toISOString().slice(0, 7);
  const expiresAt = Math.min(now + 86_400_000, qualified.expires_at, Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const proof = join(principal.guard, { sql: `EXISTS(SELECT 1 FROM (${qualificationSql}) WHERE qualification_id=? AND evidence_sha256=?)`,
    bindings: [plan.planHash, env.FORMA_MEMORY_BENCHMARK_SOURCE_SHA256!, env.FORMA_MEMORY_BENCHMARK_ORIGIN!,
      qualified.qualification_id, qualified.evidence_sha256] });
  const guarded = guardedEnvironment(env, proof);
  // No replacement grant or reset: the retained ledger itself permits only one lifetime experiment.
  await guarded.DB.prepare(`INSERT INTO memory_benchmark_native_grants
    (experiment_id,principal_id,payer_id,plan_hash,qualification_id,period,maximum_micro_usd,created_at,expires_at)
    SELECT ?,?,?,?,?,?,10000000,?,? WHERE NOT EXISTS(SELECT 1 FROM memory_benchmark_native_grants)`).bind(EXPERIMENT_ID, principal.user.userId, principal.user.userId,
      plan.planHash, qualified.qualification_id, period, now, expiresAt).run();
  const current = await readGrant(request, env);
  if (!current) return reply({ error: "benchmark_grant_unavailable" }, 409);
  return reply({ approved: true, grant: publicGrant(current.grant), syntheticOnly: true, maximumMicroUsd: MAXIMUM_MICRO_USD });
}

type AllowanceInput = Parameters<BenchmarkDependencies["reserveAllowance"]>[0];
type SettlementInput = Parameters<BenchmarkDependencies["settleAllowance"]>[0] & { providerId?: string | null };

async function reservationIdentity(input: AllowanceInput | SettlementInput) {
  return "memory-benchmark:" + await sha256(JSON.stringify([EXPERIMENT_ID, input.grant.principalId,
    input.grant.payerId, input.grant.approvedPlanHash, input.operationId, input.requestHash]));
}

/** Native dependencies are built here, never accepted from an HTTP request or supplied as empty callbacks. */
async function nativeDependencies(request: Request, env: NativeBenchmarkEnvironment): Promise<BenchmarkDependencies> {
  const current = async (expected?: BenchmarkGrant) => {
    const found = await readGrant(request, env);
    if (!found || expected && !same(expected, publicGrant(found.grant))) return deny("authority_changed");
    return { ...found, guarded: guardedEnvironment(env, join(found.principal.guard, currentGrantGuard(found.grant))) };
  };
  const initial = await current();
  // Ledger dispatch claims themselves carry current native identity/grant predicates.
  // Reauthorization at dispatch refreshes these predicates below through guarded DB reads.
  const ledger = new BenchmarkLedger(guardedEnvironment(env, join(initial.principal.guard, currentGrantGuard(initial.grant))).DB);
  return { ledger,
    authorize: async () => { const found = await readGrant(request, env); return found ? publicGrant(found.grant) : null; },
    reserveAllowance: async input => {
      const { grant, guarded } = await current(input.grant);
      if (!hash(input.requestHash) || !integer(input.maximumInputTokens) || !integer(input.maximumOutputTokens)
        || input.maximumInputTokens < 1 || input.maximumMicroUsd !== priceOperation(input.model, input.maximumInputTokens, input.maximumOutputTokens))
        return deny("allowance_input_invalid");
      const id = await reservationIdentity(input), tokenId = id + ":tokens", costId = id + ":usd";
      const tokens = input.maximumInputTokens + input.maximumOutputTokens;
      if (!Number.isSafeInteger(tokens)) return deny("allowance_input_invalid");
      const op = `memory-benchmark:${input.model}`;
      // Store immutable linkage before either reservation so no crash creates an unprotected hold.
      await guarded.DB.prepare(`INSERT INTO memory_benchmark_native_operations
        (binding_id,experiment_id,operation_id,request_hash,principal_id,payer_id,period,model,maximum_tokens,maximum_micro_usd,token_id,cost_id)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memory_benchmark_operations benchmark
          WHERE benchmark.experiment_id=? AND benchmark.operation_id=? AND benchmark.request_hash=?
            AND benchmark.maximum_micro_usd=? AND benchmark.state='reserved' AND benchmark.dispatch_claimed_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM memory_benchmark_native_operations WHERE binding_id=?)`)
        .bind(id, EXPERIMENT_ID, input.operationId, input.requestHash, grant.principalId, grant.payerId, grant.period,
          input.model, tokens, input.maximumMicroUsd, tokenId, costId, EXPERIMENT_ID, input.operationId, input.requestHash, input.maximumMicroUsd, id).run();
      const bound = await guarded.DB.prepare(`SELECT 1 AS bound FROM memory_benchmark_native_operations WHERE binding_id=?
        AND principal_id=? AND payer_id=? AND period=? AND model=? AND maximum_tokens=? AND maximum_micro_usd=?
        AND operation_id=? AND request_hash=? AND token_id=? AND cost_id=? AND verified_tokens IS NULL`)
        .bind(id, grant.principalId, grant.payerId, grant.period, input.model, tokens, input.maximumMicroUsd,
          input.operationId, input.requestHash, tokenId, costId).first();
      if (!bound) return deny("binding_unavailable");
      // Explicit synthetic accounting stream: no creator events or document lifecycle are synthesized.
      const context = { streamId: `memory-benchmark:${grant.principalId}`, correlationId: id, period: grant.period, operation: op };
      const token = await reserveBudget(guarded, grant.payerId, tokens, { ...context, reservationId: tokenId });
      if (!token.ok) return deny("token_allowance_unavailable");
      const cost = await reserveCostBudget(guarded, grant.payerId, input.maximumMicroUsd,
        { ...context, reservationId: costId, maximumMicrousd: input.maximumMicroUsd, allowUserOverage: false });
      if (!cost.ok || !await claimCostBudgetReservation(guarded, grant.payerId, costId)) return deny("dollar_allowance_unavailable");
      if (!await acknowledged(guarded, id, false)) return deny("allowance_unacknowledged");
      return { id, maximumMicroUsd: input.maximumMicroUsd, maximumTokens: tokens };
    },
    settleAllowance: async (input: SettlementInput) => {
      const id = await reservationIdentity(input);
      if (!same(input.grant, publicGrant(initial.grant))) return deny("receipt_grant_changed");
      const { usage } = input;
      if (input.reservation.id !== id || !integer(usage.inputTokens) || !integer(usage.outputTokens)
        || !integer(usage.cachedInputTokens ?? 0) || usage.microUsd !== input.actualMicroUsd
        || priceOperation(input.model, usage.inputTokens, usage.outputTokens, usage.cachedInputTokens ?? 0) !== input.actualMicroUsd)
        return deny("usage_invalid");
      const tokens = usage.inputTokens + usage.outputTokens;
      const receipt = JSON.stringify({ operationId: input.operationId, requestHash: input.requestHash,
        model: input.model, providerId: input.providerId ?? null, inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens ?? 0, microUsd: input.actualMicroUsd });
      // Durable verified usage survives a failure between native token and dollar settlement.
      // Receipt custody follows the original dispatch, including return after expiry/revocation.
      // This records no new spend and never releases a hold; fresh authority is required below
      // before either native settlement. A blocked settlement leaves this recovery evidence.
      await env.DB.prepare(`UPDATE memory_benchmark_native_operations SET verified_tokens=?,verified_micro_usd=?,usage_receipt_json=?
        WHERE binding_id=? AND payer_id=? AND model=? AND request_hash=? AND maximum_tokens=? AND maximum_micro_usd=?
          AND ?>=0 AND ?<=maximum_tokens AND ?>=0 AND ?<=maximum_micro_usd
          AND (verified_tokens IS NULL OR verified_tokens=? AND verified_micro_usd=? AND usage_receipt_json=?)
          AND EXISTS(SELECT 1 FROM memory_benchmark_operations benchmark WHERE benchmark.experiment_id=memory_benchmark_native_operations.experiment_id
            AND benchmark.operation_id=memory_benchmark_native_operations.operation_id AND benchmark.request_hash=memory_benchmark_native_operations.request_hash
            AND benchmark.state IN('reserved','uncertain') AND benchmark.dispatch_claimed_at IS NOT NULL)`)
        .bind(tokens, input.actualMicroUsd, receipt, id, input.grant.payerId, input.model, input.requestHash,
          input.reservation.maximumTokens, input.reservation.maximumMicroUsd, tokens, tokens,
          input.actualMicroUsd, input.actualMicroUsd, tokens, input.actualMicroUsd, receipt).run();
      const observed = await env.DB.prepare("SELECT 1 AS exact FROM memory_benchmark_native_operations WHERE binding_id=? AND verified_tokens=? AND verified_micro_usd=? AND usage_receipt_json=?")
        .bind(id, tokens, input.actualMicroUsd, receipt).first();
      if (!observed) return deny("usage_unacknowledged");
      const { grant, guarded } = await current(input.grant);
      await settleBudget(guarded, grant.payerId, id + ":tokens", tokens, "memory_benchmark_verified_usage");
      await settleCostBudget(guarded, grant.payerId, id + ":usd", input.actualMicroUsd);
      if (!await acknowledged(guarded, id, true)) return deny("settlement_unacknowledged");
      return { confirmed: true };
    },
  };
}

async function acknowledged(env: NativeBenchmarkEnvironment, id: string, settled: boolean): Promise<boolean> {
  const state = settled ? "token.status='settled' AND cost.status='settled' AND token.used_tokens=native.verified_tokens AND cost.used_microusd=native.verified_micro_usd"
    : "token.status='active' AND cost.status='executing' AND token.used_tokens=0 AND cost.used_microusd=0";
  return Boolean(await env.DB.prepare(`SELECT 1 AS acknowledged FROM memory_benchmark_native_operations native
    JOIN budget_reservations token ON token.reservation_id=native.token_id AND token.owner_id=native.payer_id
    JOIN cost_budget_reservations cost ON cost.reservation_id=native.cost_id AND cost.owner_id=native.payer_id
    WHERE native.binding_id=? AND token.period=native.period AND cost.period=native.period
      AND token.reserved_tokens=native.maximum_tokens AND cost.reserved_microusd=native.maximum_micro_usd
      AND token.correlation_id=native.binding_id AND cost.correlation_id=native.binding_id
      AND token.operation='memory-benchmark:'||native.model AND cost.operation=token.operation AND (${state})`).bind(id).first());
}

export async function handleNativeMemoryBenchmark(request: Request, env: NativeBenchmarkEnvironment): Promise<Response> {
  const path = new URL(request.url).pathname;
  const recovery = ["/api/internal/memory-benchmark/reconcile", "/api/internal/memory-benchmark/release-undispatched"].includes(path) && request.method === "POST";
  if (!recovery && env.FORMA_MEMORY_BENCHMARK_ENABLED !== "1") return reply({ error: "benchmark_disabled" }, 404);
  if (!admittedRequest(request, env, recovery)) return reply({ error: "benchmark_not_authorized" }, 403);
  try {
    if (path === "/api/internal/memory-benchmark/approval" && request.method === "POST") return await confirmGrant(request, env);
    if (path === "/api/internal/memory-benchmark/reconcile" && request.method === "POST") return await reconcileVerifiedUsage(request, env);
    if (path === "/api/internal/memory-benchmark/release-undispatched" && request.method === "POST") return await releaseUndispatched(request, env);
    if (path !== "/api/internal/memory-benchmark" || !["GET", "POST"].includes(request.method)) return reply({ error: "benchmark_request_invalid" }, 400);
    return await handleMemoryBenchmark(request, env, await nativeDependencies(request, env));
  } catch { return reply({ error: "benchmark_native_unavailable" }, 503); }
}

/** A stopped experiment's original unclaimed operation is the only zero-charge evidence.
 * Missing provider receipts after a dispatch claim can never enter this path. */
async function releaseUndispatched(request: Request, env: NativeBenchmarkEnvironment): Promise<Response> {
  const principal = await capture(request, env, true);
  if (!principal) return reply({ error: "benchmark_not_authorized" }, 403);
  if (request.body !== null) return reply({ error: "benchmark_release_body_invalid" }, 400);
  const plan = await benchmarkPlan();
  const query = `SELECT native.*,CASE WHEN token.reservation_id IS NULL THEN 0 ELSE 1 END AS token_present,
    CASE WHEN cost.reservation_id IS NULL THEN 0 ELSE 1 END AS cost_present,
    token.status AS token_status,cost.status AS cost_status,disposition.binding_id AS disposed
    FROM memory_benchmark_native_operations native
    JOIN memory_benchmark_native_grants grant_row ON grant_row.experiment_id=native.experiment_id
    JOIN memory_benchmark_experiments experiment ON experiment.experiment_id=native.experiment_id
    JOIN memory_benchmark_operations operation ON operation.experiment_id=native.experiment_id AND operation.operation_id=native.operation_id
    LEFT JOIN memory_benchmark_native_dispositions disposition ON disposition.binding_id=native.binding_id
    LEFT JOIN budget_reservations token ON token.reservation_id=native.token_id
    LEFT JOIN cost_budget_reservations cost ON cost.reservation_id=native.cost_id
    WHERE native.experiment_id=? AND native.principal_id=? AND native.payer_id=?
      AND grant_row.principal_id=native.principal_id AND grant_row.payer_id=native.payer_id AND grant_row.plan_hash=?
      AND grant_row.period=native.period AND experiment.plan_hash=grant_row.plan_hash AND experiment.period=native.period
      AND experiment.principal_id=native.principal_id AND experiment.payer_id=native.payer_id AND experiment.status='halted'
      AND operation.request_hash=native.request_hash AND operation.maximum_micro_usd=native.maximum_micro_usd
      AND operation.state IN('reserved','uncertain') AND operation.dispatch_claimed_at IS NULL AND operation.dispatch_claim_token IS NULL
      AND operation.actual_micro_usd IS NULL AND operation.result_json IS NULL AND operation.payload_purged_at IS NULL
      AND native.verified_tokens IS NULL AND native.verified_micro_usd IS NULL AND native.usage_receipt_json IS NULL
      AND (token.reservation_id IS NULL OR token.owner_id=native.payer_id AND token.period=native.period
        AND token.stream_id='memory-benchmark:'||native.principal_id AND token.correlation_id=native.binding_id
        AND token.operation='memory-benchmark:'||native.model AND token.reserved_tokens=native.maximum_tokens AND token.used_tokens=0
        AND (token.status='active' OR token.status='released' AND disposition.binding_id IS NOT NULL))
      AND (cost.reservation_id IS NULL OR cost.owner_id=native.payer_id AND cost.period=native.period
        AND cost.stream_id='memory-benchmark:'||native.principal_id AND cost.correlation_id=native.binding_id
        AND cost.operation='memory-benchmark:'||native.model AND cost.reserved_microusd=native.maximum_micro_usd
        AND cost.workspace_id='forma' AND cost.allow_user_overage=0 AND cost.used_microusd=0
        AND (cost.status IN('active','executing') OR cost.status='released' AND disposition.binding_id IS NOT NULL))
      ORDER BY operation.ordinal DESC LIMIT 1`;
  const values = [EXPERIMENT_ID, principal.user.userId, principal.user.userId, plan.planHash];
  const selected = await env.DB.prepare(query).bind(...values).first<Record<string, unknown>>();
  if (!selected) return reply({ error: "benchmark_no_dispatch_proof_unavailable" }, 409);
  const id = String(selected.binding_id), tokenPresent = Number(selected.token_present), costPresent = Number(selected.cost_present);
  const exact = { sql: `EXISTS(SELECT 1 FROM (${query}) WHERE binding_id=? AND token_present=? AND cost_present=?)`,
    bindings: [...values, id, tokenPresent, costPresent] };
  const guarded = guardedEnvironment(env, join(principal.guard, exact), true);
  const authorityHash = await sha256(principal.snapshot);
  // Presence is captured before the atomic tombstone. Its insertion permanently blocks
  // delayed reservations, cost claims, provider dispatch and invented usage receipts.
  await guarded.DB.prepare(`INSERT INTO memory_benchmark_native_dispositions
    (binding_id,kind,principal_id,authority_sha256,token_was_present,cost_was_present,recorded_at)
    SELECT ?,'verified-not-dispatched',?,?,?,?,${clock}
    WHERE NOT EXISTS(SELECT 1 FROM memory_benchmark_native_dispositions WHERE binding_id=?)`)
    .bind(id, principal.user.userId, authorityHash, tokenPresent, costPresent, id).run();
  const dispositionProof = { sql: `EXISTS(SELECT 1 FROM memory_benchmark_native_dispositions WHERE binding_id=?
    AND principal_id=? AND kind='verified-not-dispatched' AND token_was_present=? AND cost_was_present=?)`,
    bindings: [id, principal.user.userId, tokenPresent, costPresent] };
  const releaseEnv = guardedEnvironment(env, join(principal.guard, exact, dispositionProof), true);
  if (tokenPresent) await settleBudget(releaseEnv, principal.user.userId, String(selected.token_id), 0, "memory_benchmark_verified_not_dispatched");
  if (costPresent) await settleCostBudget(releaseEnv, principal.user.userId, String(selected.cost_id), 0);
  const final = await env.DB.prepare(query).bind(...values).first<Record<string, unknown>>();
  if (!final || final.binding_id !== id || final.disposed !== id || final.token_present !== tokenPresent || final.cost_present !== costPresent
    || tokenPresent && final.token_status !== "released" || costPresent && final.cost_status !== "released") return deny("release_unacknowledged");
  const current = await capture(request, env, true);
  if (!current || current.snapshot !== principal.snapshot || current.user.userId !== principal.user.userId) return deny("authority_changed");
  return reply({ nativeUnusedHoldsReleased: true, operationId: selected.operation_id,
    tokenHold: tokenPresent ? "released" : "never-reserved", dollarHold: costPresent ? "released" : "never-reserved",
    providerDispatched: false, experimentResumed: false });
}

/** Reconcile only known charges of this original self-paying experiment. This does not
 * authorize provider execution, revive an expired grant, or reset the stopped experiment. */
async function reconcileVerifiedUsage(request: Request, env: NativeBenchmarkEnvironment): Promise<Response> {
  const principal = await capture(request, env, true);
  if (!principal) return reply({ error: "benchmark_not_authorized" }, 403);
  // An exact empty body is intentional: there is no caller-selected operation, amount or payer.
  if (request.body !== null)
    return reply({ error: "benchmark_reconciliation_body_invalid" }, 400);
  const plan = await benchmarkPlan();
  const query = `SELECT native.* FROM memory_benchmark_native_operations native
    JOIN memory_benchmark_native_grants grant_row ON grant_row.experiment_id=native.experiment_id
    JOIN memory_benchmark_experiments experiment ON experiment.experiment_id=native.experiment_id
    JOIN memory_benchmark_operations operation ON operation.experiment_id=native.experiment_id AND operation.operation_id=native.operation_id
    WHERE native.experiment_id=? AND native.principal_id=? AND native.payer_id=? AND grant_row.principal_id=native.principal_id
      AND grant_row.payer_id=native.payer_id AND grant_row.plan_hash=? AND experiment.plan_hash=grant_row.plan_hash
      AND experiment.principal_id=native.principal_id AND experiment.payer_id=native.payer_id
      AND operation.request_hash=native.request_hash AND operation.dispatch_claimed_at IS NOT NULL
      AND native.verified_tokens IS NOT NULL ORDER BY operation.ordinal DESC LIMIT 1`;
  const values = [EXPERIMENT_ID, principal.user.userId, principal.user.userId, plan.planHash];
  const row = await env.DB.prepare(query).bind(...values).first<Record<string, unknown>>();
  if (!row) return reply({ error: "benchmark_verified_usage_unavailable" }, 409);
  if (typeof row.usage_receipt_json !== "string" || row.usage_receipt_json.length > 4096) return deny("receipt_unavailable");
  const receipt = JSON.parse(row.usage_receipt_json) as Record<string, unknown>;
  if (receipt.operationId !== row.operation_id || receipt.requestHash !== row.request_hash || receipt.model !== row.model
    || !integer(receipt.inputTokens) || !integer(receipt.outputTokens) || !integer(receipt.cachedInputTokens)
    || receipt.inputTokens + receipt.outputTokens !== row.verified_tokens || receipt.microUsd !== row.verified_micro_usd
    || priceOperation(String(row.model), receipt.inputTokens, receipt.outputTokens, receipt.cachedInputTokens) !== row.verified_micro_usd)
    return deny("receipt_invalid");
  const exact = { sql: `EXISTS(SELECT 1 FROM (${query}) WHERE binding_id=? AND usage_receipt_json=? AND verified_tokens=? AND verified_micro_usd=?)`,
    bindings: [...values, String(row.binding_id), row.usage_receipt_json, Number(row.verified_tokens), Number(row.verified_micro_usd)] };
  const guarded = guardedEnvironment(env, join(principal.guard, exact), true);
  await settleBudget(guarded, principal.user.userId, String(row.token_id), Number(row.verified_tokens), "memory_benchmark_verified_usage");
  await settleCostBudget(guarded, principal.user.userId, String(row.cost_id), Number(row.verified_micro_usd));
  if (!await acknowledged(guarded, String(row.binding_id), true)) return deny("settlement_unacknowledged");
  // Recheck the original request identity before disclosing its charge receipt after awaits.
  const final = await capture(request, env, true);
  if (!final || final.snapshot !== principal.snapshot || final.user.userId !== principal.user.userId) return deny("authority_changed");
  return reply({ nativeUsageSettled: true, providerDispatched: false, experimentResumed: false });
}

/** Host's authenticated maintenance lifecycle calls this independently of benchmark enablement.
 * Expiry purges synthetic outputs, never accounting rows or the one-time ceiling tombstone. */
export async function purgeExpiredNativeMemoryBenchmark(env: WorkerEnv): Promise<{ purged: boolean }> {
  const ready = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name IN('memory_benchmark_experiments','memory_benchmark_operations','memory_benchmark_assertions')")
    .first<{ n: number }>();
  if (!ready || ready.n === 0) return { purged: false };
  if (ready.n !== 3) return deny("cleanup_schema_incomplete");
  const ledger = new BenchmarkLedger(env.DB), status = await ledger.status(EXPERIMENT_ID);
  if (!status || status.expiresAt > Date.now()) return { purged: false };
  await ledger.purgeResults(EXPERIMENT_ID, Date.now());
  return { purged: true };
}
