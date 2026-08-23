import { PROFILE_EXCLUDED_EVENT_TYPES, PROJECT_BOOTSTRAP_EVENT_TYPES } from "../src/model/event-profiles.ts";
import { PHANTOM_ATTENTION_EVENT_SQL } from "../db/event-predicates.ts";

export { PHANTOM_ATTENTION_EVENT_SQL } from "../db/event-predicates.ts";

export interface WorkerEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_PROJECT?: string;
  OPENAI_MODEL?: string;
  OPENAI_IMAGE_MODEL?: string;
  FAL_KEY?: string;
  FAL_IMAGE_MODEL?: string;
  FAL_IMAGE_PREVIEW_MODEL?: string;
  FAL_IMAGE_EDIT_MODEL?: string;
  FAL_VIDEO_MODEL?: string;
  FAL_REFERENCE_VIDEO_MODEL?: string;
  FORMA_IMAGE_PROVIDER?: string;
  FORMA_VIDEO_PROVIDER?: string;
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

const initializedSchemas = new WeakMap<D1Database, Promise<void>>();

/** Run schema bootstrap once per database binding and worker isolate. */
export function ensureSchema(env: WorkerEnv): Promise<void> {
  const initialized = initializedSchemas.get(env.DB);
  if (initialized) return initialized;
  const initialization = env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL,
      occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor TEXT NOT NULL, client_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL, causation_id TEXT, compensates_event_id TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, payload TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_stream_sequence ON events(stream_id, sequence)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_stream_type ON events(stream_id, type)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_type_occurred_stream ON events(type,occurred_at,stream_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_stream_actor ON events(stream_id, actor)"),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_events_nonphantom_stream_sequence ON events(stream_id,sequence) WHERE NOT (${PHANTOM_ATTENTION_EVENT_SQL})`),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS event_client_receipts (stream_id TEXT NOT NULL, client_event_id TEXT NOT NULL, event_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(stream_id,client_event_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_event_client_receipts_event ON event_client_receipts(event_id)"),
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS cost_budget_reservations (reservation_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL DEFAULT 'forma', stream_id TEXT NOT NULL DEFAULT '', correlation_id TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL, period TEXT NOT NULL, reserved_microusd INTEGER NOT NULL, used_microusd INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, allow_user_overage INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, settled_at TEXT, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cost_budget_reservations_owner_status_period ON cost_budget_reservations(owner_id,status,period)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cost_budget_reservations_owner_correlation ON cost_budget_reservations(owner_id,correlation_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cost_budget_reservations_workspace_period_status ON cost_budget_reservations(workspace_id,period,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS shares (share_id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL, owner_id TEXT NOT NULL, stream_id TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_token_hash ON shares(token_hash)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_id, created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS share_scopes (share_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL, project_id TEXT NOT NULL, media_keys_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_share_scopes_owner_resource ON share_scopes(owner_id, resource_kind, resource_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_approvals (approval_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, confirmation_version TEXT NOT NULL, seed TEXT NOT NULL, requested_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_replay_approvals_owner_expiry ON replay_approvals(owner_id, expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_cost_authorizations (approval_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, pricing_version TEXT NOT NULL, estimated_microusd INTEGER NOT NULL, reserved_microusd INTEGER NOT NULL, maximum_microusd INTEGER NOT NULL, allow_user_overage INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_approval_profiles (approval_id TEXT PRIMARY KEY NOT NULL, event_count INTEGER NOT NULL, provider_coverage TEXT NOT NULL, milestone_count INTEGER NOT NULL, image_count INTEGER NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_development_profiles (approval_id TEXT PRIMARY KEY NOT NULL, study_types_json TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS replay_experience_profiles (approval_id TEXT PRIMARY KEY NOT NULL, experience_profile TEXT NOT NULL, created_at TEXT NOT NULL)"),
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
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_document_jobs_stream_status_requested ON document_jobs(stream_id,status,requested_at,job_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_document_jobs_stream_correlation ON document_jobs(stream_id,correlation_id,job_id,owner_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS provider_health (scope_key TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, scope TEXT NOT NULL, message TEXT NOT NULL, observed_at TEXT NOT NULL, expires_at TEXT NOT NULL, retry_after_ms INTEGER, request_id TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_provider_health_expiry ON provider_health(expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS generation_preflights (preflight_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, stream_id TEXT NOT NULL, document_id TEXT NOT NULL, request_key TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, UNIQUE(owner_id,request_key))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_generation_preflights_owner_document ON generation_preflights(owner_id,document_id,expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS canvas_governance_requirements (requirement_id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, approved_by_user_id TEXT, approved_by_name TEXT, approved_at TEXT, evidence_ref TEXT, details_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organizations (organization_id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, owner_user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_user_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_memberships (membership_id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', invited_by_user_id TEXT NOT NULL, accepted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revoked_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_memberships_org_user ON organization_memberships(organization_id,user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_organization_memberships_user_status ON organization_memberships(user_id,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_invitations (invitation_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,email_normalized TEXT NOT NULL,role TEXT NOT NULL,invited_by_user_id TEXT NOT NULL,token_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,accepted_at TEXT,revoked_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_invitations_token ON organization_invitations(token_hash)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_organization_invitations_email_status ON organization_invitations(email_normalized,status,expires_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_organization_invitations_organization ON organization_invitations(organization_id,status,created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_audit_events (audit_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,action TEXT NOT NULL,resource_kind TEXT NOT NULL,resource_id TEXT NOT NULL,detail_json TEXT NOT NULL DEFAULT '{}',occurred_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_organization_audit_scope_time ON organization_audit_events(organization_id,occurred_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_projects (project_access_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, organization_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_projects_owner_project ON organization_projects(owner_user_id,project_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_organization_projects_organization ON organization_projects(organization_id,status)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_organization_projects_owner ON organization_projects(owner_user_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_memberships (membership_id TEXT PRIMARY KEY NOT NULL, project_access_id TEXT NOT NULL, project_id TEXT NOT NULL, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', granted_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revoked_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_memberships_access_user ON project_memberships(project_access_id,user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_memberships_user_status ON project_memberships(user_id,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_migration_states (project_access_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',last_owner_sequence INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_migration_organization_status ON project_migration_states(organization_id,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_event_scopes (event_id TEXT PRIMARY KEY NOT NULL,project_access_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,source_stream_id TEXT NOT NULL,source_sequence INTEGER NOT NULL,project_sequence INTEGER NOT NULL,actor_user_id TEXT NOT NULL,created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_event_scopes_sequence ON project_event_scopes(project_access_id,project_sequence)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_event_scopes_owner ON project_event_scopes(owner_user_id,source_sequence)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_resource_scopes (project_access_id TEXT NOT NULL,resource_kind TEXT NOT NULL,resource_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,visibility TEXT NOT NULL DEFAULT 'collaborative_output',source_event_id TEXT,actor_user_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_access_id,resource_kind,resource_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_resource_scopes_resource ON project_resource_scopes(resource_kind,resource_id,owner_user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_resource_scopes_owner_kind_actor ON project_resource_scopes(owner_user_id,resource_kind,resource_id,actor_user_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_context_sessions (context_id TEXT PRIMARY KEY NOT NULL,principal_user_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_access_id TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_context_principal_scope ON project_context_sessions(principal_user_id,organization_id,project_access_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS budget_scope_policies (scope TEXT NOT NULL,scope_id TEXT NOT NULL,organization_id TEXT NOT NULL,token_limit INTEGER NOT NULL,microusd_limit INTEGER NOT NULL,updated_by_user_id TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(scope,scope_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_budget_scope_policies_organization ON budget_scope_policies(organization_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_budget_reservation_scopes (reservation_kind TEXT NOT NULL,reservation_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_access_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,workspace_scope_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(reservation_kind,reservation_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_budget_scope_organization ON project_budget_reservation_scopes(organization_id,project_access_id,created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS route_performance_samples (sample_id TEXT PRIMARY KEY NOT NULL,audience TEXT NOT NULL,route_family TEXT NOT NULL,route_surface TEXT NOT NULL,cache_class TEXT NOT NULL,route_latency_ms INTEGER NOT NULL,lcp_ms INTEGER,inp_ms INTEGER,cls_microunits INTEGER,recorded_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_route_performance_surface_time ON route_performance_samples(audience,route_family,recorded_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_route_performance_recorded_at ON route_performance_samples(recorded_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS capability_grants (grant_id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, capability TEXT NOT NULL, scope_type TEXT NOT NULL, organization_id TEXT, project_access_id TEXT, project_id TEXT, status TEXT NOT NULL DEFAULT 'active', granted_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_capability_grants_user_status ON capability_grants(user_id,status,capability)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_capability_grants_organization ON capability_grants(organization_id,capability)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS delivery_decisions (decision_id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, audience TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', owner_user_id TEXT NOT NULL, owner_display_name TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '', dependency_ids_json TEXT NOT NULL DEFAULT '[]', created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_delivery_decisions_status_updated ON delivery_decisions(status,updated_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_delivery_decisions_owner ON delivery_decisions(owner_user_id)"),
  ]).then(() => undefined).catch((error: unknown) => {
    initializedSchemas.delete(env.DB);
    throw error;
  });
  initializedSchemas.set(env.DB, initialization);
  return initialization;
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
  readonly expected: number;
  readonly head: number;
  constructor(expected: number, head: number) { super("stale_sequence"); this.expected=expected;this.head=head;this.name = "StaleSequenceError"; }
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

export async function readEventsByClientEventIds(env:WorkerEnv,streamId:string,clientEventIds:string[]){
  const ids=[...new Set(clientEventIds.filter(Boolean))];const events=new Map<string,EventRow>();
  if(!ids.length)return events;
  // D1 permits 100 bound values per statement; reserve one for the stream.
  const statements=[];
  for(let offset=0;offset<ids.length;offset+=99){const page=ids.slice(offset,offset+99),placeholders=page.map(()=>"?").join(",");statements.push(env.DB.prepare(`SELECT r.client_event_id,e.* FROM event_client_receipts r JOIN events e ON e.event_id=r.event_id WHERE r.stream_id=? AND r.client_event_id IN (${placeholders})`).bind(streamId,...page));}
  const results=statements.length===1?[await statements[0].all<Record<string,unknown>>()]:await env.DB.batch<Record<string,unknown>>(statements);
  for(const result of results)for(const row of result.results)events.set(String(row.client_event_id),serializeEvent(row));
  return events;
}

/**
 * Append a client action and its idempotency receipts in one D1 transaction.
 * A retry after a lost response therefore resolves to the original events
 * instead of duplicating a move, resize, text edit, or placement.
 */
export async function appendEventsWithClientReceipts(env:WorkerEnv,events:EventRow[],clientEventIds:string[],options:{retries?:number}={}){
  if(events.length!==clientEventIds.length)throw new Error("client_receipt_count_mismatch");if(!events.length)return events;
  const streamId=events[0].streamId;if(!events.every((event)=>event.streamId===streamId))throw new Error("mixed_event_stream_batch");
  for(let attempt=0;attempt<Math.max(1,options.retries??8);attempt+=1){
    const existing=await readEventsByClientEventIds(env,streamId,clientEventIds);const missing=events.map((event,index)=>({event,clientEventId:clientEventIds[index]})).filter((item)=>!existing.has(item.clientEventId));if(!missing.length)return events;
    const head=await streamHead(env,streamId);missing.forEach((item,index)=>{item.event.sequence=head+index+1;});const createdAt=new Date().toISOString();const statements=missing.flatMap((item,index)=>[insertEventAtHead(env,item.event,head+index),env.DB.prepare("INSERT INTO event_client_receipts (stream_id,client_event_id,event_id,sequence,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM events WHERE event_id=?)").bind(streamId,item.clientEventId,item.event.eventId,item.event.sequence,createdAt,item.event.eventId)]);
    try{const results=await env.DB.batch(statements);if(missing.every((_,index)=>Number(results[index*2]?.meta.changes??0)===1))return events;}catch{/* A competing retry may have committed the same client receipt. */}
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

/** Recover job receipts without replaying an account's entire event ledger. */
export async function readCorrelatedEvents(env:WorkerEnv,streamId:string,correlationIds:string[]){
  const ids=[...new Set(correlationIds.filter(Boolean))];if(!ids.length)return[] as EventRow[];
  const statements=[];
  for(let offset=0;offset<ids.length;offset+=99){const page=ids.slice(offset,offset+99);statements.push(env.DB.prepare(`SELECT * FROM events INDEXED BY idx_events_correlation WHERE stream_id=? AND correlation_id IN (${page.map(()=>"?").join(",")}) ORDER BY sequence ASC`).bind(streamId,...page));}
  const pages=statements.length===1?[await statements[0].all<Record<string,unknown>>()]:await env.DB.batch<Record<string,unknown>>(statements);
  return pages.flatMap((page)=>page.results.map(serializeEvent)).sort((left,right)=>left.sequence-right.sequence);
}

export const EVENT_PAGE_SIZE = 5000;
export const SCOPED_EVENT_PAGE_SIZE = 6500;

export type EventReadProfile = import("../src/model/event-profiles.ts").ScopedEventProfile;
export { PROJECT_BOOTSTRAP_EVENT_TYPES } from "../src/model/event-profiles.ts";
export const PROJECTION_IGNORED_EVENT_TYPES = PROFILE_EXCLUDED_EVENT_TYPES.workspace;

export async function readEventPage(env: WorkerEnv, streamId: string, afterSequence = 0, limit = EVENT_PAGE_SIZE) {
  const pageSize=Math.max(1,Math.min(EVENT_PAGE_SIZE,Math.floor(limit)));
  const result=await env.DB.prepare("SELECT * FROM events WHERE stream_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?").bind(streamId,Math.max(0,Math.floor(afterSequence)),pageSize).all<Record<string,unknown>>();
  return result.results.map(serializeEvent);
}

/** Keep a transport page and its head on the same consistent D1 snapshot. */
export async function readEventPageWithHead(env: WorkerEnv, streamId: string, afterSequence = 0, limit = EVENT_PAGE_SIZE) {
  const after = Math.max(0, Math.floor(afterSequence));
  const pageSize = Math.max(1, Math.min(EVENT_PAGE_SIZE, Math.floor(limit)));
  const [page, current] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT * FROM events WHERE stream_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?")
      .bind(streamId, after, pageSize),
    env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?")
      .bind(streamId),
  ]);
  const events = (page?.results ?? []).map(serializeEvent);
  const head = Number(current?.results[0]?.head ?? 0);
  const nextAfter = Number(events.at(-1)?.sequence ?? after);
  return { events, head, nextAfter, hasMore: nextAfter < head };
}

/** Read a route-specific page and its authoritative stream head in one D1 round trip. */
export async function readProfileEventPage(
  env: WorkerEnv,
  streamId: string,
  profile: EventReadProfile,
  afterSequence = 0,
  limit = SCOPED_EVENT_PAGE_SIZE,
) {
  const pageSize = Math.max(1, Math.min(SCOPED_EVENT_PAGE_SIZE, Math.floor(limit)));
  const eventTypes = profile === "projects" ? PROJECT_BOOTSTRAP_EVENT_TYPES : PROFILE_EXCLUDED_EVENT_TYPES[profile];
  const placeholders = eventTypes.map(() => "?").join(",");
  const operator = profile === "projects" ? "IN" : "NOT IN";
  const index = profile === "projects" ? " INDEXED BY idx_events_stream_type" : "";
  const attentionFilter = profile !== "projects" ? ` AND NOT (${PHANTOM_ATTENTION_EVENT_SQL})` : "";
  const [page, current] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT * FROM events${index} WHERE stream_id=? AND sequence>? AND type ${operator} (${placeholders})${attentionFilter} ORDER BY sequence ASC LIMIT ?`)
      .bind(streamId, Math.max(0, Math.floor(afterSequence)), ...eventTypes, pageSize),
    env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(streamId),
  ]);
  const events = (page?.results ?? []).map(serializeEvent);
  const head = Number(current?.results[0]?.head ?? 0);
  // Excluded telemetry can trail the final useful event; advance past it.
  const nextAfter = events.length < pageSize ? head : Number(events.at(-1)?.sequence ?? afterSequence);
  return { events, head, nextAfter, hasMore: nextAfter < head, profile };
}

/** Load every projection-relevant account event without replaying telemetry. */
export async function readWorkspaceEvents(env:WorkerEnv,streamId:string){
  const events:EventRow[]=[];let after=0;
  while(true){const page=await readProfileEventPage(env,streamId,"workspace",after,SCOPED_EVENT_PAGE_SIZE);events.push(...page.events);if(!page.hasMore)return events;after=page.nextAfter;}
}

/** Intelligence interactions need genuine attention evidence, not timer artifacts or raw admin telemetry. */
export async function readIntelligenceEvents(env: WorkerEnv, streamId: string) {
  const events: EventRow[] = []; let after = 0;
  while (true) {
    const page = await readProfileEventPage(env, streamId, "sessions", after, SCOPED_EVENT_PAGE_SIZE);
    events.push(...page.events);
    if (!page.hasMore) return events;
    after = page.nextAfter;
  }
}

/** Read immutable inspection rows newest-first without replaying or filtering the account ledger. */
export async function readAuditEventPage(env: WorkerEnv, streamId: string, options: {
  before?: number;
  asOf?: number;
  limit?: number;
  actor?: string;
  type?: string;
  correlation?: string;
} = {}) {
  const requestedLimit = Number(options.limit ?? 150);
  const limit = Math.max(1, Math.min(500, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 150));
  const requestedAnchor = Number(options.asOf ?? 0);
  const asOf = Number.isSafeInteger(requestedAnchor) && requestedAnchor > 0 ? requestedAnchor : 0;
  const scopeConditions = asOf ? ["stream_id=?", "sequence<=?"] : ["stream_id=?"];
  const scopeValues: Array<string | number> = asOf ? [streamId, asOf] : [streamId];
  const conditions = [...scopeConditions];
  const values = [...scopeValues];
  const actor = String(options.actor ?? "").trim().slice(0, 120);
  const type = String(options.type ?? "").trim().slice(0, 160);
  const correlation = String(options.correlation ?? "").trim().slice(0, 160);
  if (actor && actor !== "all") { conditions.push("actor=?"); values.push(actor); }
  if (type) { conditions.push("instr(lower(type),lower(?))>0"); values.push(type); }
  if (correlation) { conditions.push("instr(lower(correlation_id),lower(?))>0"); values.push(correlation); }
  const filteredWhere = conditions.join(" AND ");
  const requestedBefore = Number(options.before ?? 0);
  const before = Number.isSafeInteger(requestedBefore) && requestedBefore > 0 ? requestedBefore : 0;
  const pageWhere = before > 0 ? `${filteredWhere} AND sequence<?` : filteredWhere;
  const pageValues = before > 0 ? [...values, Math.floor(before)] : values;
  const statements = [
    env.DB.prepare(`SELECT * FROM events WHERE ${pageWhere} ORDER BY sequence DESC LIMIT ?`).bind(...pageValues, limit + 1),
    env.DB.prepare(`SELECT COUNT(*) AS total,COALESCE(MAX(sequence),0) AS head FROM events WHERE ${scopeConditions.join(" AND ")}`).bind(...scopeValues),
    env.DB.prepare(`SELECT DISTINCT actor FROM events WHERE ${scopeConditions.join(" AND ")} ORDER BY actor`).bind(...scopeValues),
  ];
  const filtered = conditions.length > scopeConditions.length;
  if (filtered) statements.push(env.DB.prepare(`SELECT COUNT(*) AS matched FROM events WHERE ${filteredWhere}`).bind(...values));
  const [page, totals, actors, matches] = await env.DB.batch<Record<string, unknown>>(statements);
  const rows = page?.results ?? [];
  const hasOlder = rows.length > limit;
  const events = rows.slice(0, limit).map(serializeEvent).reverse();
  const total = Number(totals?.results[0]?.total ?? 0);
  return {
    events,
    head: Number(totals?.results[0]?.head ?? 0),
    total,
    matched: filtered ? Number(matches?.results[0]?.matched ?? 0) : total,
    actors: (actors?.results ?? []).map((row) => String(row.actor)),
    nextBefore: hasOlder ? Number(events[0]?.sequence ?? 0) : null,
    hasOlder,
  };
}

/** Read a complete stream in bounded D1 pages. Callers that only need transport pages should use readEventPage. */
export async function readEvents(env: WorkerEnv, streamId: string, limit = Number.POSITIVE_INFINITY) {
  const requested=Number.isFinite(limit)?Math.max(0,Math.floor(limit)):Number.POSITIVE_INFINITY;
  const events:EventRow[]=[];let cursor=0;
  while(events.length<requested){const page=await readEventPage(env,streamId,cursor,Math.min(EVENT_PAGE_SIZE,requested-events.length));if(!page.length)break;events.push(...page);cursor=page.at(-1)!.sequence;if(page.length<EVENT_PAGE_SIZE)break;}
  return events;
}

export async function appendAuditEvent(env: WorkerEnv, streamId: string, actor: string, type: string, payload: Record<string, unknown>, correlationId = uuidV7()) {
  const event = makeEvent(streamId, 0, actor, "server:policy", correlationId, type, payload);
  await appendEvents(env, [event]); return event;
}
