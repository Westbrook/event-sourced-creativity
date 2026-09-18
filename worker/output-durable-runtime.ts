import { ensureOutputRequirementsSchema } from "./output-requirements-ledger.ts";
import { OUTPUT_DURABLE_SCHEMA, OUTPUT_DURABLE_SCHEMA_NAMES } from "./output-durable-schema.ts";
import { registerOutputDurableRuntime, registerOutputDurableLease, outputJobIsDurable, hintOutputDurableDelivery, type OutputDurableDelivery, type OutputDurableMedia } from "./output-durable-control.ts";
import { OutputConflictError, outputAssertionStatements, type OutputSqlAssertion } from "./output-command-core.ts";
import { ensureSchema, inheritRuntimeSchemaReadiness, type WorkerEnv } from "./runtime.ts";
import { markOutputSchemaReady, outputSchemaIsReady } from "./output-schema-state.ts";
import type { OutputDurablePhase } from "../src/model/output-durable-observation.ts";

export type OutputDurableRow = {
  job_id: string; scope_key: string; slot_id: string; grant_id: string; actor_user_id: string; stream_id: string;
  document_id: string; run_event_id: string; route_digest: string; source_digest: string; target_contract_digest: string;
  phase: OutputDurablePhase; revision: number; lease_epoch: number; lease_token: string | null; lease_expires_at: string | null;
  next_attempt_at: string; delivery_count: number; read_failures:number; last_error_code: string | null; created_at: string; updated_at: string;
};
export type OutputDurableOutcome = Readonly<{ phase: OutputDurablePhase; retryAfterMs?: number; code?: string }>;
export type OutputDurablePorts = Readonly<{
  /** Advisory acceleration only. An independently durable sweep is mandatory. */
  wake(delivery: OutputDurableDelivery): Promise<void>;
  /** Server implementation only; receives a fenced environment, never a cookie. */
  execute(env: WorkerEnv, row: Readonly<OutputDurableRow>): Promise<OutputDurableOutcome>;
}>;
export type OutputDurableRuntime = Readonly<{
  env: WorkerEnv;
  consume(delivery: unknown): Promise<OutputDurableOutcome | Readonly<{ phase: "busy" | "not_due" | "missing" }>>;
  sweep(limit?: number): Promise<Readonly<{ scanned: number; hinted: number }>>;
  inspect(jobId: string): Promise<Readonly<OutputDurableRow> | null>;
}>;
const work = ["queued", "generating", "awaiting_provider", "retaining", "cancel_requested"];
const phases: readonly unknown[] = [...work, "ready", "uncertain", "failed", "cancelled"];
const identifier = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(x);
const fail = (code: string): never => { throw new OutputConflictError(code); };
const normal = (sql: string) => sql.replace(/\s+/gu, " ").trim().replace(/;$/u, "");

/** Read-only qualification of the deliberately uninstalled schema. A table with
 * missing/weakened constraints is not a supported runtime installation. */
export async function verifyOutputDurableSchema(env: WorkerEnv): Promise<void> {
  const read = await env.DB.prepare("SELECT name,sql FROM sqlite_master WHERE name IN(SELECT value FROM json_each(?))")
    .bind(JSON.stringify(OUTPUT_DURABLE_SCHEMA_NAMES)).all<{ name: string; sql: string }>();
  if (read.success !== true || read.results.length !== OUTPUT_DURABLE_SCHEMA.length
    || OUTPUT_DURABLE_SCHEMA_NAMES.some((name, index) => normal(read.results.find(row => row.name === name)?.sql ?? "") !== normal(OUTPUT_DURABLE_SCHEMA[index]!)))
    fail("output_durable_schema_unavailable");
}

function fence(row: OutputDurableRow): OutputSqlAssertion {
  return { sql: `EXISTS(SELECT 1 FROM output_durable_jobs durable
    JOIN document_jobs job ON job.job_id=durable.job_id
    JOIN output_operation_slots slot ON slot.scope_key=durable.scope_key AND slot.slot_id=durable.slot_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    JOIN events run ON run.event_id=durable.run_event_id AND run.stream_id=job.stream_id AND run.type='OutputExecutionRunRequested'
    JOIN output_commands command ON command.event_id=run.event_id AND command.scope_key=durable.scope_key AND command.actor_user_id=durable.actor_user_id AND command.action='run' AND command.command_key=run.correlation_id
    WHERE run.actor='user:'||durable.actor_user_id AND run.client_id='server:output-requirements'
      AND json_extract(run.payload,'$.grant_id')=durable.grant_id AND json_extract(run.payload,'$.document_id')=durable.document_id
      AND durable.job_id=? AND durable.lease_epoch=? AND durable.lease_token=?
      AND durable.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND durable.phase IN('queued','generating','awaiting_provider','retaining','cancel_requested')
      AND job.owner_id=durable.actor_user_id AND job.stream_id=durable.stream_id AND job.document_id=durable.document_id
      AND json_extract(job.request_json,'$.outputDurable')=1
      AND slot.job_id=job.job_id AND slot.grant_id=durable.grant_id AND slot.route_digest=durable.route_digest
      AND slot.source_digest=durable.source_digest AND slot.target_contract_digest=durable.target_contract_digest
      AND grant_row.actor_user_id=durable.actor_user_id AND grant_row.payer_user_id=durable.actor_user_id)`,
    bindings: [row.job_id, row.lease_epoch, row.lease_token], deadlineMs: Date.parse(row.lease_expires_at!) };
}

/** Every D1 operation runs with the same lease proof. Native source/privacy
 * wrappers sit above this fence; their batch result offsets remain unchanged. */
function fencedEnvironment(base: WorkerEnv, row: OutputDurableRow) {
  let active = true;
  const proof = fence(row), deadline = proof.deadlineMs!;
  const current = () => { if (!active || Date.now() >= deadline) fail("output_durable_lease_expired"); };
  const tracked = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const execute = async (inputs: D1PreparedStatement[]) => {
    current();
    const statements = inputs.map(statement => tracked.get(statement) ?? fail("output_durable_statement_untracked"));
    const prefix = outputAssertionStatements(base, proof);
    const result = await base.DB.batch([...prefix, ...statements, ...outputAssertionStatements(base, proof)]);
    current();
    if (result.length !== prefix.length + statements.length + 2 || result.some(value => value.success !== true)) fail("output_durable_batch_unconfirmed");
    return result.slice(prefix.length, prefix.length + statements.length);
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
      if (key === "run" || key === "all") return async () => (await execute([proxy]))[0];
      if (key === "first") return async (column?: string) => {
        const result = (await execute([proxy]))[0]!.results[0] as Record<string, unknown> | undefined;
        return result ? column === undefined ? result : result[column] ?? null : null;
      };
      if (key === "raw") return () => fail("output_durable_raw_unsupported");
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    tracked.set(proxy, statement); return proxy;
  };
  const DB = new Proxy(base.DB, { get(target, key) {
    if (key === "prepare") return (sql: string) => {
      if (!/^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE)\b/iu.test(sql)) fail("output_durable_schema_mutation_forbidden");
      return wrap(target.prepare(sql));
    };
    if (key === "batch") return execute;
    if (key === "exec" || key === "withSession") return () => fail("output_durable_database_escape_forbidden");
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  inheritRuntimeSchemaReadiness(base.DB, DB);
  if (outputSchemaIsReady(base.DB)) markOutputSchemaReady(DB);
  const MEDIA = new Proxy(base.MEDIA, { get(target, key) {
    if (key === "createMultipartUpload" || key === "resumeMultipartUpload") return () => fail("output_durable_multipart_unsupported");
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      current(); await base.DB.batch(outputAssertionStatements(base, proof)); current();
      if(key==="put")await base.DB.batch([...outputAssertionStatements(base,proof),
        base.DB.prepare("UPDATE output_durable_jobs SET phase='retaining',revision=revision+1,updated_at=? WHERE job_id=?").bind(new Date().toISOString(),row.job_id)]);
      const result = await Reflect.apply(value, target, args);
      // A put already accepted by R2 cannot be rolled back. Native deterministic
      // storage receipts/custody decide safe adoption or cleanup after expiry.
      current(); await base.DB.batch(outputAssertionStatements(base, proof)); return result;
    };
  } });
  const env = { ...base, DB, MEDIA };
  registerOutputDurableLease(env, { jobId: row.job_id, deadline, assertion: proof, active: () => active });
  return { env, proof, retire() { active = false; } };
}

/** Dormant composition seam, not an endpoint or scheduler. There is no caller
 * in worker/index or any public handler. Schema installation and a reliable
 * sweep/trigger must be qualified separately before a host constructs this. */
export async function createOutputDurableRuntime(base: WorkerEnv, ports: OutputDurablePorts,
  options: Readonly<{ leaseMs?: number; retryMs?: number; enrollMedia?:readonly OutputDurableMedia[] }> = {}): Promise<OutputDurableRuntime> {
  await verifyOutputDurableSchema(base);
  // A fresh queue isolate has no in-memory readiness cache. The normal core
  // bootstrap runs on the base DB before the execution fence is installed.
  await ensureSchema(base);
  await ensureOutputRequirementsSchema(base);
  const leaseMs = options.leaseMs ?? 900000, retryMs = options.retryMs ?? 15000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 1800000
    || !Number.isSafeInteger(retryMs) || retryMs < 1000 || retryMs > 3600000
    || typeof ports.wake !== "function" || typeof ports.execute !== "function") fail("output_durable_runtime_invalid");
  const media=options.enrollMedia??[];
  if(!Array.isArray(media)||new Set(media).size!==media.length||media.some(value=>!["image","slides","short_story","scene","storyboard","audio","video","model3d"].includes(value)))fail("output_durable_enrollment_policy_invalid");
  const env = { ...base };
  // Omitted policy is drain-only: consume/sweep work, enroll no new media.
  registerOutputDurableRuntime(env, ports.wake, media);
  const inspect = async (jobId: string) => {
    if (!identifier(jobId)) fail("output_durable_delivery_invalid");
    return base.DB.prepare("SELECT * FROM output_durable_jobs WHERE job_id=?").bind(jobId).first<OutputDurableRow>();
  };
  return Object.freeze({ env, inspect,
    async sweep(limit = 25) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("output_durable_sweep_limit");
      const rows = await base.DB.prepare(`SELECT job_id FROM output_durable_jobs
        WHERE phase IN('queued','generating','awaiting_provider','retaining','cancel_requested')
          AND next_attempt_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND (lease_expires_at IS NULL OR lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ORDER BY next_attempt_at,job_id LIMIT ?`).bind(limit).all<{ job_id: string }>();
      const hints = await Promise.all(rows.results.map(row => hintOutputDurableDelivery(ports.wake, { version: 1, jobId: row.job_id })));
      return Object.freeze({ scanned: rows.results.length, hinted: hints.filter(Boolean).length });
    },
    async consume(delivery: unknown) {
      if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) return fail("output_durable_delivery_invalid");
      const message = delivery as Record<string, unknown>;
      if (Object.keys(message).length !== 2 || message.version !== 1 || !identifier(message.jobId)) return fail("output_durable_delivery_invalid");
      const before = await inspect(message.jobId);
      if (!before) return { phase: "missing" as const };
      if (!work.includes(before.phase)) return { phase: before.phase };
      const now = new Date().toISOString(), until = new Date(Date.now() + leaseMs).toISOString(), token = crypto.randomUUID();
      const acquired = await base.DB.prepare(`UPDATE output_durable_jobs SET lease_epoch=lease_epoch+1,lease_token=?,lease_expires_at=?,
        delivery_count=delivery_count+1,revision=revision+1,updated_at=?
        WHERE job_id=? AND phase IN('queued','generating','awaiting_provider','retaining','cancel_requested')
          AND next_attempt_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND (lease_expires_at IS NULL OR lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
        .bind(token, until, now, before.job_id).run();
      if (acquired.meta.changes !== 1) return { phase: before.lease_expires_at && before.lease_expires_at > now ? "busy" as const : "not_due" as const };
      const row = await inspect(before.job_id);
      if (!row || row.lease_token !== token) return { phase: "busy" as const };
      const owned = fencedEnvironment(base, row);
      try {
        // Prove canonical enrollment before exposing any execution port.
        await base.DB.batch(outputAssertionStatements(base, owned.proof));
        const job = await owned.env.DB.prepare("SELECT request_json FROM document_jobs WHERE job_id=?").bind(row.job_id).first<{ request_json: string }>();
        if (!job || !outputJobIsDurable(job)) fail("output_durable_binding_changed");
        const outcome = await ports.execute(owned.env, Object.freeze({ ...row }));
        if (!outcome || !phases.includes(outcome.phase) || outcome.code && !/^[a-z0-9_]{1,100}$/u.test(outcome.code)) fail("output_durable_outcome_invalid");
        const delay = outcome.retryAfterMs ?? retryMs;
        if (!Number.isSafeInteger(delay) || delay < 1000 || delay > 3600000) fail("output_durable_retry_invalid");
        const next = new Date(Date.now() + delay).toISOString();
        await base.DB.batch([...outputAssertionStatements(base, owned.proof),
          ...(outcome.phase === "ready" ? outputAssertionStatements(base, { sql: `EXISTS(SELECT 1 FROM document_jobs job
            JOIN output_operation_slots slot ON slot.job_id=job.job_id
            JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id
            JOIN budget_reservations token ON token.reservation_id=slot.token_reservation_id
            WHERE job.job_id=? AND job.status='completed' AND slot.status='succeeded' AND cost.status='settled' AND (token.status='settled' OR token.status='released' AND token.used_tokens=0)
              AND NOT EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id AND (call.status IN('pending','uncertain') OR call.used_microusd IS NULL)))`, bindings: [row.job_id] }) : []),
          base.DB.prepare(`UPDATE output_durable_jobs SET phase=?,revision=revision+1,lease_token=NULL,lease_expires_at=NULL,
            next_attempt_at=?,last_error_code=?,read_failures=CASE WHEN ?='output_durable_provider_read_retry' THEN read_failures+1 ELSE 0 END,updated_at=? WHERE job_id=? AND lease_epoch=? AND lease_token=?`)
            .bind(outcome.phase, next, outcome.code ?? null, outcome.code ?? null, new Date().toISOString(), row.job_id, row.lease_epoch, token),
          ...outputAssertionStatements(base, { sql: "changes()=1" })]);
        return Object.freeze({ ...outcome });
      } finally {
        // Failure leaves the persisted lease to expire. A future delivery reads
        // actual job/provider evidence; it never blindly repeats the callback.
        owned.retire();
      }
    },
  });
}
