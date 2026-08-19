export interface WorkerEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_PROJECT?: string;
  OPENAI_MODEL?: string;
  OPENAI_IMAGE_MODEL?: string;
  FORMA_ADMIN_EMAILS?: string;
  FORMA_RETENTION_DAYS?: string;
  FORMA_USER_TOKEN_LIMIT?: string;
  FORMA_WORKSPACE_TOKEN_LIMIT?: string;
  FORMA_USER_COST_LIMIT_USD?: string;
  FORMA_WORKSPACE_COST_LIMIT_USD?: string;
  FORMA_LIVE_REPLAY_ENABLED?: string;
}

export interface WorkerExecutionContext { waitUntil(promise: Promise<unknown>): void; }

export type EventRow = {
  eventId: string; streamId: string; sequence: number; occurredAt: string; recordedAt: string;
  actor: string; clientId: string; correlationId: string; causationId: string | null;
  compensatesEventId: string | null; schemaVersion: number; type: string; payload: Record<string, unknown>;
};

export const uuidV7 = () => {
  const time = Date.now().toString(16).padStart(12, "0");
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const variant = ((bytes[4] & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${time.slice(0, 8)}-${time.slice(8)}-7${hex.slice(0, 3)}-${variant}${hex.slice(5, 7)}-${hex.slice(7, 19)}`;
};

export async function ensureSchema(env: WorkerEnv) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL,
      occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor TEXT NOT NULL, client_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL, causation_id TEXT, compensates_event_id TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, payload TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_stream_sequence ON events(stream_id, sequence)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_stream_type ON events(stream_id, type)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_stream_actor ON events(stream_id, actor)"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS events_block_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS events_block_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS external_content (content_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_external_content_owner ON external_content(owner_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'creator', consent_version TEXT, consented_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS private_content (content_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, redacted_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_private_content_owner_expiry ON private_content(owner_id, expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS budget_counters (scope TEXT NOT NULL, scope_id TEXT NOT NULL, period TEXT NOT NULL, used_tokens INTEGER NOT NULL DEFAULT 0, reserved_tokens INTEGER NOT NULL DEFAULT 0, hard_limit_tokens INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope, scope_id, period))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS budget_reservations (reservation_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, stream_id TEXT NOT NULL, correlation_id TEXT NOT NULL, operation TEXT NOT NULL, period TEXT NOT NULL, reserved_tokens INTEGER NOT NULL, used_tokens INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, settlement_reason TEXT, created_at TEXT NOT NULL, settled_at TEXT, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_budget_reservations_owner_status ON budget_reservations(owner_id, status, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_budget_reservations_correlation ON budget_reservations(correlation_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS cost_budget_counters (scope TEXT NOT NULL, scope_id TEXT NOT NULL, period TEXT NOT NULL, used_microusd INTEGER NOT NULL DEFAULT 0, reserved_microusd INTEGER NOT NULL DEFAULT 0, hard_limit_microusd INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope, scope_id, period))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS shares (share_id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL, owner_id TEXT NOT NULL, stream_id TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_token_hash ON shares(token_hash)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_id, created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_approvals (approval_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, confirmation_version TEXT NOT NULL, seed TEXT NOT NULL, requested_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_replay_approvals_owner_expiry ON replay_approvals(owner_id, expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_cost_authorizations (approval_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, pricing_version TEXT NOT NULL, estimated_microusd INTEGER NOT NULL, reserved_microusd INTEGER NOT NULL, maximum_microusd INTEGER NOT NULL, allow_user_overage INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_approval_profiles (approval_id TEXT PRIMARY KEY NOT NULL, event_count INTEGER NOT NULL, provider_coverage TEXT NOT NULL, milestone_count INTEGER NOT NULL, image_count INTEGER NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_development_profiles (approval_id TEXT PRIMARY KEY NOT NULL, study_types_json TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_sessions (session_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, seed TEXT NOT NULL, event_count INTEGER NOT NULL DEFAULT 0, image_count INTEGER NOT NULL DEFAULT 0, preview_media_url TEXT, final_media_url TEXT, events_json TEXT, plan_json TEXT, usage_json TEXT, planner_model TEXT, image_model TEXT, error_message TEXT, created_at TEXT NOT NULL, completed_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_replay_sessions_owner_created ON replay_sessions(owner_id, created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_session_operations (session_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, approval_id TEXT NOT NULL, stage TEXT NOT NULL, progress_message TEXT NOT NULL, completed_operations INTEGER NOT NULL DEFAULT 0, total_operations INTEGER NOT NULL DEFAULT 0, reserved_microusd INTEGER NOT NULL DEFAULT 0, actual_microusd INTEGER NOT NULL DEFAULT 0, budget_period TEXT NOT NULL, heartbeat_at TEXT NOT NULL, created_at TEXT NOT NULL, settled_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_replay_session_operations_owner_heartbeat ON replay_session_operations(owner_id, heartbeat_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_cost_settlements (session_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, reserved_microusd INTEGER NOT NULL, actual_microusd INTEGER NOT NULL, budget_period TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, settled_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_event_chunks (session_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, start_sequence INTEGER NOT NULL, end_sequence INTEGER NOT NULL, events_json TEXT NOT NULL, PRIMARY KEY(session_id,chunk_index))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_replay_event_chunks_sequence ON replay_event_chunks(session_id, start_sequence, end_sequence)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_session_milestones (session_id TEXT NOT NULL, milestone_index INTEGER NOT NULL, plan_json TEXT NOT NULL, assets_json TEXT NOT NULL, PRIMARY KEY(session_id,milestone_index))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_personas (persona_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL, fictional_user_id TEXT NOT NULL UNIQUE, fictional_stream_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, status TEXT NOT NULL, project_id TEXT, document_id TEXT, route TEXT, event_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_replay_personas_owner_updated ON replay_personas(owner_id, updated_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS impersonation_sessions (impersonation_id TEXT PRIMARY KEY NOT NULL, actor_user_id TEXT NOT NULL, persona_id TEXT NOT NULL, fictional_user_id TEXT NOT NULL, replay_session_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, expires_at TEXT NOT NULL, ended_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_impersonation_actor_status ON impersonation_sessions(actor_user_id, status, expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS document_jobs (job_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, stream_id TEXT NOT NULL, document_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, source_surface TEXT NOT NULL, correlation_id TEXT NOT NULL, requested_sequence INTEGER NOT NULL, request_json TEXT NOT NULL, result_json TEXT, error_message TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, requested_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, lease_expires_at TEXT, notified_at TEXT, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_document_jobs_owner_status ON document_jobs(owner_id, status, requested_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_document_jobs_stream_document ON document_jobs(stream_id, document_id, requested_at)"),
  ]);
}

export function makeEvent(streamId: string, sequence: number, actor: string, clientId: string, correlationId: string, type: string, payload: Record<string, unknown>, options: { causationId?: string | null; compensatesEventId?: string | null } = {}): EventRow {
  const now = new Date().toISOString();
  return { eventId: uuidV7(), streamId, sequence, occurredAt: now, recordedAt: now, actor, clientId, correlationId, causationId: options.causationId ?? null, compensatesEventId: options.compensatesEventId ?? null, schemaVersion: 1, type, payload };
}

export const insertEvent = (env: WorkerEnv, event: EventRow) => env.DB.prepare(`INSERT INTO events (event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(event.eventId, event.streamId, event.sequence, event.occurredAt, event.recordedAt, event.actor, event.clientId, event.correlationId, event.causationId, event.compensatesEventId, event.schemaVersion, event.type, JSON.stringify(event.payload));

const insertEventAtHead = (env: WorkerEnv, event: EventRow, expectedHead: number) => env.DB.prepare(`INSERT INTO events (event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
  WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`).bind(event.eventId, event.streamId, event.sequence, event.occurredAt, event.recordedAt, event.actor, event.clientId, event.correlationId, event.causationId, event.compensatesEventId, event.schemaVersion, event.type, JSON.stringify(event.payload), event.streamId, expectedHead);

export class StaleSequenceError extends Error {
  constructor(readonly expected: number, readonly head: number) { super("stale_sequence"); this.name = "StaleSequenceError"; }
}

/** Reserve and append one contiguous event range in a single D1 batch. */
export async function appendEvents(env: WorkerEnv, events: EventRow[], options: { expectedHead?: number; retries?: number } = {}) {
  if (!events.length) return events;
  const streamId = events[0].streamId; if (!events.every((event) => event.streamId === streamId)) throw new Error("mixed_event_stream_batch");
  const retries = options.expectedHead === undefined ? Math.max(1, options.retries ?? 4) : 1;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const head = options.expectedHead ?? await streamHead(env, streamId);
    events.forEach((event, index) => { event.sequence = head + index + 1; });
    const results = await env.DB.batch(events.map((event, index) => insertEventAtHead(env, event, head + index)));
    if (results.every((result) => Number(result.meta.changes ?? 0) === 1)) return events;
    const current = await streamHead(env, streamId);
    if (options.expectedHead !== undefined) throw new StaleSequenceError(options.expectedHead, current);
  }
  throw new Error("event_append_contention");
}

export async function streamHead(env: WorkerEnv, streamId: string) {
  const row = await env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(streamId).first<{ head: number }>();
  return Number(row?.head ?? 0);
}

export function serializeEvent(row: Record<string, unknown>): EventRow {
  return { eventId: String(row.event_id), streamId: String(row.stream_id), sequence: Number(row.sequence), occurredAt: String(row.occurred_at), recordedAt: String(row.recorded_at), actor: String(row.actor), clientId: String(row.client_id), correlationId: String(row.correlation_id), causationId: row.causation_id ? String(row.causation_id) : null, compensatesEventId: row.compensates_event_id ? String(row.compensates_event_id) : null, schemaVersion: Number(row.schema_version), type: String(row.type), payload: JSON.parse(String(row.payload)) as Record<string, unknown> };
}

export async function readEvents(env: WorkerEnv, streamId: string, limit = 2000) {
  const result = await env.DB.prepare("SELECT * FROM events WHERE stream_id=? ORDER BY sequence ASC LIMIT ?").bind(streamId, limit).all<Record<string, unknown>>();
  return result.results.map(serializeEvent);
}

export async function appendAuditEvent(env: WorkerEnv, streamId: string, actor: string, type: string, payload: Record<string, unknown>, correlationId = uuidV7()) {
  const event = makeEvent(streamId, 0, actor, "server:policy", correlationId, type, payload);
  await appendEvents(env, [event]); return event;
}
