import { OUTPUT_REQUIREMENTS_SCHEMA, OUTPUT_MODEL3D_SCHEMA_STATE_SQL, upgradeOutputRequirementsSchema } from "./output-requirements-schema.ts";
import { markOutputSchemaReady } from "./output-schema-state.ts";
import { PROFILE_EXCLUDED_EVENT_TYPES, PROJECT_BOOTSTRAP_EVENT_TYPES } from "../src/model/event-profiles.ts";
import { PHANTOM_ATTENTION_EVENT_SQL } from "../db/event-predicates.ts";
import { uuidV7, makeEvent, EVENT_WRITE_COLUMNS, eventWriteBindings, EVENT_WRITE_STAGE_TRIGGER_SQL, type EventRow } from "./event-write-primitives.ts";
export { uuidV7, makeEvent, EVENT_WRITE_COLUMNS, eventWriteBindings, EVENT_WRITE_STAGE_TRIGGER_SQL };
export type { EventRow };
import { serializeEvent } from "./event-read-primitives.ts";
export { serializeEvent };
import { streamHead, EVENT_PAGE_SIZE, readEventPage, readEvents } from "./event-stream-read.ts";
export { streamHead, EVENT_PAGE_SIZE, readEventPage, readEvents };
import { insertEventAtHead, StaleSequenceError, appendEvents } from "./event-append.ts";
import type { SponsorImageEntryConfiguration } from "./experience-sponsor-image-entry.ts";
export { StaleSequenceError, appendEvents };

export { PHANTOM_ATTENTION_EVENT_SQL } from "../db/event-predicates.ts";

export interface WorkerEnv {
  /** Disabled until the companion consumer passes hosted qualification. */
  FORMA_ORDINARY_IMAGE_QUEUE_QUALIFIED?: string;
  FORMA_ORDINARY_IMAGE_QUEUE_SECRET?: string;
  FORMA_ORDINARY_IMAGE_QUEUE_USERS?: string;
  /** Explicit server-owned intake/confirmation selection. Omitted stays inert;
   * this installs no policy/schema and never enables generation. */
  FORMA_SPONSOR_IMAGE_ENTRY?: SponsorImageEntryConfiguration;
  /** Default-off native memory read rollout; explicit enrollment and authority are still required. */
  FORMA_MEMORY_ENABLED?: string;
  FORMA_MEMORY_SCHEMA_REPAIR_MANIFEST?: string;
  FORMA_MEMORY_USER_IDS?: string;
  /** Separate default-off document-profile purpose; no implicit reference-memory upgrade. */
  FORMA_MEMORY_PROFILE_ENABLED?: string;
  FORMA_MEMORY_PROFILE_USER_IDS?: string;
  /** Separate purpose/cost rollout. Unset qualification bindings remain inert. */
  FORMA_MEMORY_DERIVATION_ENABLED?: string;
  FORMA_MEMORY_DERIVATION_PROCESSING_ENABLED?: string;
  FORMA_MEMORY_DERIVATION_USER_IDS?: string;
  FORMA_MEMORY_DERIVATION_SOURCE_SHA256?: string;
  FORMA_MEMORY_DERIVATION_ORIGIN?: string;
  FORMA_MEMORY_DERIVATION_DEPLOYMENT_ID?: string;
  /** Separate exact-true admission for the existing scheduled memory job; unset stays disabled. */
  FORMA_MEMORY_SCHEDULING_ENABLED?: string;
  /** Isolated synthetic benchmark only; no real-user Memory enrollment is implied. */
  FORMA_MEMORY_BENCHMARK_ENABLED?: string;
  FORMA_MEMORY_BENCHMARK_ORIGIN?: string;
  FORMA_MEMORY_BENCHMARK_ACTOR_IDS?: string;
  FORMA_MEMORY_BENCHMARK_SOURCE_SHA256?: string;
  ASSETS: Fetcher;
  JEV_API_KEY?: string;
  /** Creation providers are opt-in service bindings; absent bindings stay degraded. */
  STILL_UNIFIED_CREATION_ENABLED?: string;
  /** Independent inference admission; cleanup remains active while off. */
  STILL_CREATION_INDEX_ENABLED?: string;
  STILL_CREATION_DEPLOYMENT_ID?: string;
  STILL_CREATION_SEARCH?: Fetcher;
  STILL_CREATION_SEARCH_MODEL?: string;
  STILL_CREATION_ORGANIZER?: Fetcher;
  STILL_CREATION_ORGANIZER_MODEL?: string;
  STILL_CREATION_PROVIDER_CUSTODIES?: string;
  STILL_CREATION_PROVIDER_TOKEN?: string;
  STILL_CREATION_JEV_ENABLED?: string;
  DB: D1Database;
  MEDIA: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_PROJECT?: string;
  OPENAI_MODEL?: string;
  OPENAI_SLIDES_COMPOSITION_MODEL?: string;
  OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT?: string;
  OPENAI_SLIDES_REPAIR_MODEL?: string;
  OPENAI_SLIDES_REPAIR_REASONING_EFFORT?: string;
  OPENAI_IMAGE_MODEL?: string;
  FAL_KEY?: string;
  FAL_IMAGE_MODEL?: string;
  FAL_IMAGE_PREVIEW_MODEL?: string;
  FAL_IMAGE_EDIT_MODEL?: string;
  FAL_VIDEO_MODEL?: string;
  FAL_REFERENCE_VIDEO_MODEL?: string;
  FAL_AUDIO_MODEL?: string;
  FORMA_IMAGE_PROVIDER?: string;
  FORMA_VIDEO_PROVIDER?: string;
  FORMA_AUDIO_PROVIDER?: string;
  FORMA_ADMIN_EMAILS?: string;
  FORMA_HOLD_DISPOSITION_ENABLED?: string;
  FORMA_RETENTION_DAYS?: string;
  FORMA_EVIDENCE_RETENTION_DAYS?: string;
  FORMA_USER_TOKEN_LIMIT?: string;
  FORMA_WORKSPACE_TOKEN_LIMIT?: string;
  FORMA_USER_COST_LIMIT_USD?: string;
  FORMA_WORKSPACE_COST_LIMIT_USD?: string;
  FORMA_PILOT_COHORT_ID?: string;
  FORMA_LIVE_REPLAY_ENABLED?: string;
  FORMA_ASSISTANT_INTERNAL_USER_IDS?: string;
  FORMA_ASSISTANT_ACTION_USER_IDS?: string;
  FORMA_ASSISTANT_PROVIDER_USER_IDS?: string;
  FORMA_ASSISTANT_SOL_USER_IDS?: string;
  FORMA_ASSISTANT_ALLOWED_MODELS?: string;
  FORMA_ENCRYPTION_ROOT_KEY?: string;
  FORMA_ENCRYPTION_ROOT_KEYS?: string;
  FORMA_ENCRYPTION_ROOT_KEY_VERSION?: string;
}

export interface WorkerExecutionContext { waitUntil(promise: Promise<unknown>): void; }


const initializedSchemas = new WeakMap<D1Database, Promise<void>>();
const readySchemas = new WeakSet<D1Database>();

/** A guarded proxy shares only a successfully initialized underlying binding. */
export function inheritRuntimeSchemaReadiness(source: D1Database, guarded: D1Database) {
  const initialization = initializedSchemas.get(source);
  if (!initialization || !readySchemas.has(source)) return;
  initializedSchemas.set(guarded, initialization);
  readySchemas.add(guarded);
  markOutputSchemaReady(guarded);
}
const retentionSweeps = new WeakMap<D1Database, number>();


export const PROJECT_NOTIFICATION_TRIGGER_SQL = `CREATE TRIGGER IF NOT EXISTS project_notification_after_event AFTER INSERT ON project_event_scopes
  WHEN (SELECT type FROM events WHERE event_id=NEW.event_id) IN('ArtifactReviewRequested','ArtifactApproved','ArtifactChangesRequested','DocumentArtifactEdited','DocumentRenderCompleted','DocumentRemoved','BlockCreated','BlockPropertyEdited','BlockRenamed','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRehomed','BlockRemoved','BlockRestored','BlockRelationAdded','BlockRelationRemoved','ChipEdited','ExtractionRequested','ExtractionCompleted','ExtractionFailed','FocalPointSet','RightsAsserted')
  BEGIN
    UPDATE project_review_tasks
      SET status=CASE WHEN change.type='ArtifactApproved' AND project_review_tasks.assigned_user_id=NEW.actor_user_id THEN 'approved'
          WHEN change.type='ArtifactChangesRequested' AND project_review_tasks.assigned_user_id=NEW.actor_user_id THEN 'changes-requested'
          ELSE 'superseded' END,
        resolved_at=NEW.created_at,resolved_by_user_id=NEW.actor_user_id
      FROM events change
      WHERE change.event_id=NEW.event_id AND project_review_tasks.project_access_id=NEW.project_access_id
        AND project_review_tasks.organization_id=NEW.organization_id AND project_review_tasks.status='pending'
        AND (
          change.type IN('ArtifactReviewRequested','ArtifactApproved','ArtifactChangesRequested','DocumentArtifactEdited')
            AND project_review_tasks.artifact_id=CAST(json_extract(change.payload,'$.artifact_id') AS TEXT)
            AND (change.type NOT IN('ArtifactApproved','ArtifactChangesRequested') OR (
              project_review_tasks.artifact_revision=COALESCE(CAST(json_extract(change.payload,'$.artifact_revision') AS INTEGER),-1)
              AND project_review_tasks.content_sha256=COALESCE(CAST(json_extract(change.payload,'$.content_sha256') AS TEXT),'')))
          OR change.type IN('BlockPropertyEdited','BlockRenamed','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRehomed','BlockRemoved','BlockRestored','ChipEdited','ExtractionRequested','ExtractionCompleted','ExtractionFailed','FocalPointSet')
            AND EXISTS(SELECT 1 FROM project_event_scopes rendered_scope JOIN events rendered ON rendered.event_id=rendered_scope.event_id
              JOIN json_each(json_extract(rendered.payload,'$.source_block_versions')) source
              WHERE rendered_scope.project_access_id=NEW.project_access_id AND rendered.type='DocumentRenderCompleted'
                AND json_extract(rendered.payload,'$.artifact_id')=project_review_tasks.artifact_id
                AND json_extract(source.value,'$.block_id')=json_extract(change.payload,'$.block_id'))
          OR change.type IN('BlockCreated','BlockRelationAdded','BlockRelationRemoved','DocumentRemoved')
            AND project_review_tasks.document_id=CAST(json_extract(change.payload,'$.document_id') AS TEXT)
        );

    INSERT OR IGNORE INTO project_review_tasks(task_id,project_access_id,organization_id,project_id,artifact_id,document_id,request_event_id,requested_by_user_id,assigned_user_id,artifact_revision,content_sha256,status,due_at,created_at,resolved_at,resolved_by_user_id)
      SELECT lower(hex(randomblob(16))),NEW.project_access_id,NEW.organization_id,NEW.project_id,
        CAST(json_extract(change.payload,'$.artifact_id') AS TEXT),CAST(json_extract(change.payload,'$.document_id') AS TEXT),
        NEW.event_id,NEW.actor_user_id,recipients.user_id,COALESCE(CAST(json_extract(change.payload,'$.artifact_revision') AS INTEGER),0),
        COALESCE(CAST(json_extract(change.payload,'$.content_sha256') AS TEXT),''),'pending',
        strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+'||COALESCE(policy.review_due_hours,48)||' hours'),NEW.created_at,NULL,NULL
      FROM (
        SELECT owner_user_id AS user_id FROM organization_projects WHERE project_access_id=NEW.project_access_id AND organization_id=NEW.organization_id AND status='active'
        UNION SELECT user_id FROM project_memberships WHERE project_access_id=NEW.project_access_id AND organization_id=NEW.organization_id AND status='active' AND revoked_at IS NULL
      ) recipients
      JOIN organization_memberships membership ON membership.organization_id=NEW.organization_id AND membership.user_id=recipients.user_id
        AND membership.status='active' AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL
      JOIN events change ON change.event_id=NEW.event_id AND change.type='ArtifactReviewRequested'
      LEFT JOIN project_automation_policies policy ON policy.project_access_id=NEW.project_access_id AND policy.organization_id=NEW.organization_id
      WHERE recipients.user_id<>NEW.actor_user_id
        AND (COALESCE(CAST(json_extract(change.payload,'$.assigned_reviewer_user_id') AS TEXT),'')=''
          OR recipients.user_id=CAST(json_extract(change.payload,'$.assigned_reviewer_user_id') AS TEXT))
        AND (
          EXISTS(SELECT 1 FROM organization_projects project WHERE project.project_access_id=NEW.project_access_id AND project.organization_id=NEW.organization_id AND project.owner_user_id=recipients.user_id)
          OR EXISTS(SELECT 1 FROM capability_grants reviewer WHERE reviewer.user_id=recipients.user_id AND reviewer.capability='project.review.approve'
            AND reviewer.scope_type='project' AND reviewer.organization_id=NEW.organization_id AND reviewer.project_access_id=NEW.project_access_id
            AND reviewer.status='active' AND reviewer.revoked_at IS NULL AND (reviewer.expires_at IS NULL OR reviewer.expires_at>NEW.created_at))
        )
        AND NOT EXISTS(SELECT 1 FROM project_event_scopes contributed JOIN events edit ON edit.event_id=contributed.event_id
          WHERE contributed.project_access_id=NEW.project_access_id AND contributed.actor_user_id=recipients.user_id
            AND edit.type='DocumentArtifactEdited' AND json_extract(edit.payload,'$.artifact_id')=json_extract(change.payload,'$.artifact_id'))
        AND NOT EXISTS(SELECT 1 FROM project_event_scopes rendered_scope JOIN events rendered ON rendered.event_id=rendered_scope.event_id
          WHERE rendered_scope.project_access_id=NEW.project_access_id AND rendered.type='DocumentRenderCompleted'
            AND json_extract(rendered.payload,'$.artifact_id')=json_extract(change.payload,'$.artifact_id')
            AND COALESCE(CAST(json_extract(rendered.payload,'$.requested_by_user_id') AS TEXT),'')=recipients.user_id)
        AND NOT EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=NEW.organization_id AND cohort.status IN('active','paused','closed')
          AND (cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=NEW.organization_id AND successor.status IN('active','paused')))
          AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id AND participant.organization_id=NEW.organization_id
            AND participant.user_id=recipients.user_id AND participant.status='active' AND participant.revoked_at IS NULL));

    INSERT OR IGNORE INTO project_notifications(notification_id,project_access_id,organization_id,project_id,recipient_user_id,event_id,kind,artifact_id,document_id,message,created_at,expires_at,read_at)
      SELECT lower(hex(randomblob(16))),NEW.project_access_id,NEW.organization_id,NEW.project_id,recipients.user_id,NEW.event_id,
        CASE change.type WHEN 'ArtifactReviewRequested' THEN 'review_requested' WHEN 'ArtifactApproved' THEN 'output_approved'
          WHEN 'ArtifactChangesRequested' THEN 'changes_requested' WHEN 'DocumentArtifactEdited' THEN 'output_edited'
          WHEN 'DocumentRenderCompleted' THEN 'output_ready' ELSE 'context_changed' END,
        CAST(json_extract(change.payload,'$.artifact_id') AS TEXT),CAST(json_extract(change.payload,'$.document_id') AS TEXT),
        CASE change.type WHEN 'ArtifactReviewRequested' THEN 'A finished output needs independent review.'
          WHEN 'ArtifactApproved' THEN 'A finished output was independently approved.'
          WHEN 'ArtifactChangesRequested' THEN 'Changes requested: '||COALESCE((SELECT substr(CAST(json_extract(note.private_json,'$.review_note') AS TEXT),1,300)
            FROM event_private_payloads note WHERE note.private_event_id=change.event_id AND note.redacted_at IS NULL),'Open the finished output for reviewer guidance.')
          WHEN 'DocumentArtifactEdited' THEN 'A finished output changed and needs a fresh review.'
          WHEN 'DocumentRenderCompleted' THEN 'A new finished output is ready for the project.'
          ELSE 'Project context changed. Existing output approvals may need a fresh review.' END,
        NEW.created_at,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+30 days'),NULL
      FROM (
        SELECT owner_user_id AS user_id FROM organization_projects WHERE project_access_id=NEW.project_access_id AND organization_id=NEW.organization_id AND status='active'
        UNION SELECT user_id FROM project_memberships WHERE project_access_id=NEW.project_access_id AND organization_id=NEW.organization_id AND status='active' AND revoked_at IS NULL
      ) recipients
      JOIN organization_memberships membership ON membership.organization_id=NEW.organization_id AND membership.user_id=recipients.user_id
        AND membership.status='active' AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL
      JOIN events change ON change.event_id=NEW.event_id
      LEFT JOIN project_automation_policies policy ON policy.project_access_id=NEW.project_access_id AND policy.organization_id=NEW.organization_id
      WHERE recipients.user_id<>NEW.actor_user_id
        AND NOT EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=NEW.organization_id AND cohort.status IN('active','paused','closed')
          AND (cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=NEW.organization_id AND successor.status IN('active','paused')))
          AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id AND participant.organization_id=NEW.organization_id
            AND participant.user_id=recipients.user_id AND participant.status='active' AND participant.revoked_at IS NULL))
        AND (
          change.type='ArtifactReviewRequested' AND EXISTS(SELECT 1 FROM project_review_tasks task WHERE task.request_event_id=NEW.event_id AND task.project_access_id=NEW.project_access_id AND task.assigned_user_id=recipients.user_id)
          OR change.type IN('ArtifactApproved','ArtifactChangesRequested') AND (
            EXISTS(SELECT 1 FROM project_review_tasks task WHERE task.project_access_id=NEW.project_access_id
              AND task.artifact_id=CAST(json_extract(change.payload,'$.artifact_id') AS TEXT)
              AND task.artifact_revision=COALESCE(CAST(json_extract(change.payload,'$.artifact_revision') AS INTEGER),-1)
              AND task.content_sha256=COALESCE(CAST(json_extract(change.payload,'$.content_sha256') AS TEXT),'')
              AND task.requested_by_user_id=recipients.user_id)
            OR EXISTS(SELECT 1 FROM organization_projects project WHERE project.project_access_id=NEW.project_access_id AND project.owner_user_id=recipients.user_id)
          )
          OR change.type NOT IN('ArtifactReviewRequested','ArtifactApproved','ArtifactChangesRequested')
            AND COALESCE(policy.enabled,1)=1
            AND (change.type!='DocumentRenderCompleted' OR COALESCE(policy.notify_output_ready,1)=1)
            AND (change.type NOT IN('BlockCreated','BlockPropertyEdited','BlockRenamed','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRehomed','BlockRemoved','BlockRestored','BlockRelationAdded','BlockRelationRemoved','ChipEdited','ExtractionRequested','ExtractionCompleted','ExtractionFailed','FocalPointSet','RightsAsserted') OR COALESCE(policy.notify_context_changes,1)=1)
            AND (
              EXISTS(SELECT 1 FROM organization_projects project WHERE project.project_access_id=NEW.project_access_id AND project.owner_user_id=recipients.user_id)
              OR EXISTS(SELECT 1 FROM project_memberships editor WHERE editor.project_access_id=NEW.project_access_id AND editor.organization_id=NEW.organization_id
                AND editor.user_id=recipients.user_id AND editor.role='editor' AND editor.status='active' AND editor.revoked_at IS NULL)
            )
        );

    INSERT OR IGNORE INTO project_automation_runs(run_id,project_access_id,organization_id,project_id,event_id,rule_kind,status,recipient_count,created_at,completed_at)
      SELECT lower(hex(randomblob(16))),NEW.project_access_id,NEW.organization_id,NEW.project_id,NEW.event_id,
        CASE change.type WHEN 'ArtifactReviewRequested' THEN 'review-assignment' ELSE 'targeted-in-app-notification' END,'completed',
        (SELECT COUNT(*) FROM project_notifications notification WHERE notification.project_access_id=NEW.project_access_id AND notification.event_id=NEW.event_id),
        NEW.created_at,NEW.created_at
      FROM events change WHERE change.event_id=NEW.event_id;
    DELETE FROM project_notifications WHERE project_access_id=NEW.project_access_id AND (expires_at<=NEW.created_at OR notification_id IN(
      SELECT ranked.notification_id FROM(
        SELECT retained.notification_id,ROW_NUMBER() OVER(PARTITION BY retained.recipient_user_id
          ORDER BY(retained.read_at IS NULL) DESC,retained.created_at DESC,retained.notification_id DESC) AS recipient_rank
        FROM project_notifications retained WHERE retained.project_access_id=NEW.project_access_id
      ) ranked WHERE ranked.recipient_rank>1000
    ));
  END`;

/** Managed pilots may not strand an indexing or active project through racing owner-removal requests. */
export const PILOT_OWNER_REVOCATION_TRIGGER_SQL=`CREATE TRIGGER IF NOT EXISTS pilot_project_owner_membership_guard BEFORE UPDATE OF status ON organization_memberships
  WHEN NEW.status='revoked' AND OLD.status!='revoked'
    AND EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=OLD.organization_id AND cohort.status IN ('active','paused'))
    AND EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=OLD.organization_id AND project.owner_user_id=OLD.user_id AND project.status IN('indexing','active'))
  BEGIN
    SELECT RAISE(ABORT,'project_owner_transfer_required');
  END`;

export const PILOT_PARTICIPANT_OWNER_REVOCATION_TRIGGER_SQL=`CREATE TRIGGER IF NOT EXISTS pilot_project_owner_participant_guard BEFORE UPDATE OF status,revoked_at ON pilot_participants
  WHEN (NEW.status='revoked' OR NEW.revoked_at IS NOT NULL) AND OLD.status='active' AND OLD.revoked_at IS NULL AND OLD.user_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.cohort_id=OLD.cohort_id AND cohort.organization_id=OLD.organization_id AND cohort.status IN ('active','paused'))
    AND EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=OLD.organization_id AND project.owner_user_id=OLD.user_id AND project.status IN('indexing','active'))
  BEGIN
    SELECT RAISE(ABORT,'project_owner_transfer_required');
  END`;

export const PILOT_OWNER_DELETION_TRIGGER_SQL=`CREATE TRIGGER IF NOT EXISTS pilot_project_owner_membership_deletion_guard BEFORE DELETE ON organization_memberships
  WHEN EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=OLD.organization_id AND cohort.status IN ('active','paused'))
    AND EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=OLD.organization_id AND project.owner_user_id=OLD.user_id AND project.status IN('indexing','active'))
  BEGIN
    SELECT RAISE(ABORT,'project_owner_transfer_required');
  END`;

export const PILOT_PARTICIPANT_OWNER_DELETION_TRIGGER_SQL=`CREATE TRIGGER IF NOT EXISTS pilot_project_owner_participant_deletion_guard BEFORE DELETE ON pilot_participants
  WHEN OLD.status='active' AND OLD.revoked_at IS NULL AND OLD.user_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.cohort_id=OLD.cohort_id AND cohort.organization_id=OLD.organization_id AND cohort.status IN ('active','paused'))
    AND EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=OLD.organization_id AND project.owner_user_id=OLD.user_id AND project.status IN('indexing','active'))
  BEGIN
    SELECT RAISE(ABORT,'project_owner_transfer_required');
  END`;

export const PILOT_COHORT_DELETION_TRIGGER_SQL=`CREATE TRIGGER IF NOT EXISTS pilot_active_cohort_deletion_guard BEFORE DELETE ON pilot_cohorts
  WHEN OLD.status IN ('active','paused')
  BEGIN
    SELECT RAISE(ABORT,'active_pilot_cannot_be_deleted');
  END`;

/** Run schema bootstrap once per database binding and worker isolate. */
export function ensureSchema(env: WorkerEnv): Promise<void> {
  const initialized = initializedSchemas.get(env.DB);
  if (initialized) return initialized;
  const initialization = env.DB.batch<{ current: number }>([
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS event_private_payloads (private_event_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT NOT NULL,created_at TEXT NOT NULL,redacted_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_event_private_payloads_owner_scope ON event_private_payloads(owner_id,project_id,document_id,redacted_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS event_write_stage (event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT)"),
    env.DB.prepare(EVENT_WRITE_STAGE_TRIGGER_SQL),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS event_client_receipts (stream_id TEXT NOT NULL, client_event_id TEXT NOT NULL, event_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(stream_id,client_event_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_event_client_receipts_event ON event_client_receipts(event_id)"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS events_block_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS events_block_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS external_content (content_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_external_content_owner ON external_content(owner_id)"),
    // Schema-one checkpoints copied customer-authored prose into an unbounded
    // cache. They are derived data and can be safely discarded and rebuilt.
    env.DB.prepare("DELETE FROM external_content WHERE content_id LIKE 'analytics-source:v1:%' AND CASE WHEN json_valid(content) THEN COALESCE(json_extract(content,'$.schema'),0)<>2 ELSE 1 END"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'creator', consent_version TEXT, consented_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS private_content (content_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, redacted_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_private_content_owner_expiry ON private_content(owner_id, expires_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_private_content_pending_expiry ON private_content(expires_at) WHERE redacted_at IS NULL AND kind!='document-artifact'"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS budget_counters (scope TEXT NOT NULL, scope_id TEXT NOT NULL, period TEXT NOT NULL, used_tokens INTEGER NOT NULL DEFAULT 0, reserved_tokens INTEGER NOT NULL DEFAULT 0, hard_limit_tokens INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope, scope_id, period))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS budget_reservations (reservation_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, stream_id TEXT NOT NULL, correlation_id TEXT NOT NULL, operation TEXT NOT NULL, period TEXT NOT NULL, reserved_tokens INTEGER NOT NULL, used_tokens INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, settlement_reason TEXT, created_at TEXT NOT NULL, settled_at TEXT, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_budget_reservations_owner_status ON budget_reservations(owner_id, status, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_budget_reservations_correlation ON budget_reservations(correlation_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS cost_budget_counters (scope TEXT NOT NULL, scope_id TEXT NOT NULL, period TEXT NOT NULL, used_microusd INTEGER NOT NULL DEFAULT 0, reserved_microusd INTEGER NOT NULL DEFAULT 0, hard_limit_microusd INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope, scope_id, period))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS cost_budget_reservations (reservation_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL DEFAULT 'forma', stream_id TEXT NOT NULL DEFAULT '', correlation_id TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL, period TEXT NOT NULL, reserved_microusd INTEGER NOT NULL, used_microusd INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, allow_user_overage INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, settled_at TEXT, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cost_budget_reservations_owner_status_period ON cost_budget_reservations(owner_id,status,period)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cost_budget_reservations_owner_correlation ON cost_budget_reservations(owner_id,correlation_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cost_budget_reservations_workspace_period_status ON cost_budget_reservations(workspace_id,period,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS consequential_executions (execution_id TEXT PRIMARY KEY NOT NULL,actor_user_id TEXT NOT NULL,stream_id TEXT NOT NULL,project_id TEXT NOT NULL,document_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,operation TEXT NOT NULL,intent_hash TEXT NOT NULL,binding_hash TEXT NOT NULL,consent_ref TEXT NOT NULL,result_ref TEXT,status TEXT NOT NULL,error_code TEXT,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_consequential_executions_actor_scope ON consequential_executions(actor_user_id,project_id,document_id,status,created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS consequential_execution_steps (execution_id TEXT NOT NULL,step_index INTEGER NOT NULL,token_reservation_id TEXT NOT NULL,cost_reservation_id TEXT NOT NULL,maximum_tokens INTEGER NOT NULL,maximum_microusd INTEGER NOT NULL,status TEXT NOT NULL,provider_request_id TEXT,verified_tokens INTEGER,verified_microusd INTEGER,updated_at TEXT NOT NULL,PRIMARY KEY(execution_id,step_index))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS authoring_commits (preview_id TEXT PRIMARY KEY NOT NULL,actor_user_id TEXT NOT NULL,operation TEXT NOT NULL,project_id TEXT NOT NULL,document_id TEXT NOT NULL,block_id TEXT NOT NULL,canvas_id TEXT,organization_id TEXT,project_access_id TEXT,approval_hash TEXT NOT NULL,result_json TEXT NOT NULL,last_event_id TEXT NOT NULL,verified INTEGER NOT NULL CONSTRAINT authoring_commit_verified CHECK(verified=1),created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_authoring_commits_actor_document ON authoring_commits(actor_user_id,project_id,document_id)"),
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS document_jobs (job_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, stream_id TEXT NOT NULL, document_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, source_surface TEXT NOT NULL, correlation_id TEXT NOT NULL, requested_sequence INTEGER NOT NULL, request_json TEXT NOT NULL, result_json TEXT, scene_source_version_json TEXT, scene_source_protocol INTEGER NOT NULL DEFAULT 0 CHECK(scene_source_protocol IN(0,1)), error_message TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, requested_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, lease_expires_at TEXT, notified_at TEXT, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_notifications(notification_id TEXT PRIMARY KEY NOT NULL,project_access_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,recipient_user_id TEXT NOT NULL,event_id TEXT NOT NULL,kind TEXT NOT NULL,artifact_id TEXT,document_id TEXT,message TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,read_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_notifications_recipient_event ON project_notifications(project_access_id,recipient_user_id,event_id,kind)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_notifications_recipient_time ON project_notifications(recipient_user_id,project_access_id,created_at)"),
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pilot_cohorts(cohort_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,max_participants INTEGER NOT NULL DEFAULT 10,participant_cap_microusd INTEGER NOT NULL DEFAULT 15000000,organization_cap_microusd INTEGER NOT NULL DEFAULT 150000000,source_classification TEXT NOT NULL DEFAULT 'non-sensitive-licensed',created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_pilot_cohorts_active_organization ON pilot_cohorts(organization_id) WHERE status='active'"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_pilot_cohorts_organization_status ON pilot_cohorts(organization_id,status,starts_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pilot_participants(participant_id TEXT PRIMARY KEY NOT NULL,cohort_id TEXT NOT NULL,organization_id TEXT NOT NULL,email_normalized TEXT NOT NULL,user_id TEXT,role TEXT NOT NULL DEFAULT 'member',status TEXT NOT NULL DEFAULT 'active',invited_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_pilot_participants_cohort_email ON pilot_participants(cohort_id,email_normalized)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_pilot_participants_cohort_user ON pilot_participants(cohort_id,user_id) WHERE user_id IS NOT NULL"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_pilot_participants_organization_status ON pilot_participants(organization_id,status,user_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pilot_cost_reservation_scopes(reservation_id TEXT PRIMARY KEY NOT NULL,cohort_id TEXT NOT NULL,organization_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_pilot_cost_reservation_cohort_actor ON pilot_cost_reservation_scopes(cohort_id,actor_user_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_retention_policies(organization_id TEXT PRIMARY KEY NOT NULL,transient_days INTEGER NOT NULL DEFAULT 30,evidence_days INTEGER NOT NULL DEFAULT 365,revision_days INTEGER NOT NULL DEFAULT 365,legal_hold INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,updated_by_user_id TEXT NOT NULL,updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS private_content_retention_scopes(content_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,project_access_id TEXT NOT NULL,project_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,classification TEXT NOT NULL,policy_version INTEGER NOT NULL,assigned_expires_at TEXT NOT NULL,created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_private_content_retention_organization_expiry ON private_content_retention_scopes(organization_id,assigned_expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS retention_sweep_runs(run_id TEXT PRIMARY KEY NOT NULL,trigger_kind TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,processed_count INTEGER NOT NULL DEFAULT 0,remaining_count INTEGER NOT NULL DEFAULT 0,oldest_expired_at TEXT,error_code TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_retention_sweep_runs_started ON retention_sweep_runs(started_at,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS artifact_revisions(revision_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,project_id TEXT NOT NULL,document_id TEXT NOT NULL,artifact_id TEXT NOT NULL,revision INTEGER NOT NULL,content_json TEXT NOT NULL,content_sha256 TEXT NOT NULL,created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,redacted_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_revisions_owner_artifact_revision ON artifact_revisions(owner_id,artifact_id,revision)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_artifact_revisions_project_artifact ON artifact_revisions(project_access_id,artifact_id,revision)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_artifact_revisions_expiry ON artifact_revisions(expires_at) WHERE redacted_at IS NULL"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_context_packages(package_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_context_packages_scope ON organization_context_packages(organization_id,status,updated_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_context_package_versions(version_id TEXT PRIMARY KEY NOT NULL,package_id TEXT NOT NULL,organization_id TEXT NOT NULL,version INTEGER NOT NULL,content_sha256 TEXT NOT NULL,source_project_access_id TEXT NOT NULL,source_document_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created_by_user_id TEXT NOT NULL,approved_by_user_id TEXT,published_at TEXT,created_at TEXT NOT NULL,redacted_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_org_context_package_version ON organization_context_package_versions(package_id,version)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_context_versions_scope ON organization_context_package_versions(organization_id,package_id,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_context_package_contents(version_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,content_json TEXT NOT NULL,created_at TEXT NOT NULL,redacted_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_context_package_contents_scope ON organization_context_package_contents(organization_id,redacted_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_context_package_sources(version_id TEXT NOT NULL,organization_id TEXT NOT NULL,source_project_access_id TEXT NOT NULL,source_block_id TEXT NOT NULL,source_kind TEXT NOT NULL,content_sha256 TEXT NOT NULL,rights_expires_at TEXT,position INTEGER NOT NULL,PRIMARY KEY(version_id,source_block_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_context_sources_scope ON organization_context_package_sources(organization_id,source_project_access_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_context_package_bindings(binding_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,project_access_id TEXT NOT NULL,project_id TEXT NOT NULL,document_id TEXT NOT NULL,package_id TEXT NOT NULL,version_id TEXT NOT NULL,update_mode TEXT NOT NULL DEFAULT 'pinned',status TEXT NOT NULL DEFAULT 'active',pending_version_id TEXT,created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_context_binding_document_package ON project_context_package_bindings(project_access_id,document_id,package_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_context_binding_package ON project_context_package_bindings(organization_id,package_id,update_mode,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_context_package_members(binding_id TEXT NOT NULL,organization_id TEXT NOT NULL,source_block_id TEXT NOT NULL,target_block_id TEXT NOT NULL,content_sha256 TEXT NOT NULL,PRIMARY KEY(binding_id,source_block_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_context_member_target ON project_context_package_members(organization_id,target_block_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_review_tasks(task_id TEXT PRIMARY KEY NOT NULL,project_access_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,artifact_id TEXT NOT NULL,document_id TEXT NOT NULL,request_event_id TEXT NOT NULL,requested_by_user_id TEXT NOT NULL,assigned_user_id TEXT NOT NULL,artifact_revision INTEGER NOT NULL DEFAULT 0,content_sha256 TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',due_at TEXT,created_at TEXT NOT NULL,resolved_at TEXT,resolved_by_user_id TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_review_task_event_assignee ON project_review_tasks(project_access_id,request_event_id,assigned_user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_review_tasks_assigned ON project_review_tasks(assigned_user_id,status,due_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_review_tasks_artifact ON project_review_tasks(project_access_id,artifact_id,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_automation_policies(project_access_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,notify_context_changes INTEGER NOT NULL DEFAULT 1,notify_output_ready INTEGER NOT NULL DEFAULT 1,review_due_hours INTEGER NOT NULL DEFAULT 48,reminder_hours INTEGER NOT NULL DEFAULT 24,version INTEGER NOT NULL DEFAULT 1,updated_by_user_id TEXT NOT NULL,updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_automation_policy_org ON project_automation_policies(organization_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_automation_runs(run_id TEXT PRIMARY KEY NOT NULL,project_access_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,event_id TEXT NOT NULL,rule_kind TEXT NOT NULL,status TEXT NOT NULL,recipient_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,completed_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_automation_run_event_rule ON project_automation_runs(project_access_id,event_id,rule_kind)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_automation_runs_scope ON project_automation_runs(organization_id,project_access_id,created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS project_automation_outbox(delivery_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,project_access_id TEXT NOT NULL,task_id TEXT,recipient_user_id TEXT NOT NULL,kind TEXT NOT NULL,destination TEXT NOT NULL DEFAULT 'in-app',idempotency_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',payload_json TEXT NOT NULL DEFAULT '{}',available_at TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,delivered_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_automation_outbox_idempotency ON project_automation_outbox(organization_id,idempotency_key)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_automation_outbox_pending ON project_automation_outbox(organization_id,status,available_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_security_policies(organization_id TEXT PRIMARY KEY NOT NULL,authentication_source TEXT NOT NULL DEFAULT 'any',allowed_domains_json TEXT NOT NULL DEFAULT '[]',require_mfa INTEGER NOT NULL DEFAULT 0,encryption_mode TEXT NOT NULL DEFAULT 'platform-unverified',max_session_minutes INTEGER NOT NULL DEFAULT 480,version INTEGER NOT NULL DEFAULT 1,updated_by_user_id TEXT NOT NULL,updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_identity_bindings(binding_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,user_id TEXT NOT NULL,authentication_source TEXT NOT NULL,subject TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revoked_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_org_identity_binding_user ON organization_identity_bindings(organization_id,user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_identity_binding_subject ON organization_identity_bindings(organization_id,authentication_source,subject)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_provisioning_credentials(credential_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,token_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_org_provisioning_token_hash ON organization_provisioning_credentials(token_hash)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_provisioning_scope ON organization_provisioning_credentials(organization_id,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_identity_groups(group_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,external_id TEXT NOT NULL,name TEXT NOT NULL,mapped_role TEXT NOT NULL DEFAULT 'member',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_org_identity_group_external ON organization_identity_groups(organization_id,external_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_identity_group_members(group_id TEXT NOT NULL,organization_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(group_id,user_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_identity_group_members_user ON organization_identity_group_members(organization_id,user_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_key_versions(key_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,version INTEGER NOT NULL,algorithm TEXT NOT NULL DEFAULT 'AES-GCM-256',wrapped_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,retired_at TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_org_key_version ON organization_key_versions(organization_id,version)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_key_active ON organization_key_versions(organization_id,status)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_org_key_one_active ON organization_key_versions(organization_id) WHERE status='active'"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_legal_holds(hold_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,scope_kind TEXT NOT NULL,resource_id TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,released_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_legal_holds_scope ON organization_legal_holds(organization_id,status,scope_kind,resource_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_deletion_jobs(job_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,initiated_by_user_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',inventory_json TEXT NOT NULL DEFAULT '{}',receipt_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_deletion_jobs_scope ON organization_deletion_jobs(organization_id,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_deletion_items(job_id TEXT NOT NULL,organization_id TEXT NOT NULL,resource_kind TEXT NOT NULL,resource_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempt_count INTEGER NOT NULL DEFAULT 0,error_code TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(job_id,resource_kind,resource_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_deletion_items_status ON organization_deletion_items(job_id,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_recovery_snapshots(snapshot_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,key_id TEXT NOT NULL,manifest_json TEXT NOT NULL,encrypted_payload TEXT NOT NULL,content_sha256 TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'available',created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_recovery_snapshots_scope ON organization_recovery_snapshots(organization_id,created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_recovery_drills(drill_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,status TEXT NOT NULL,duration_ms INTEGER NOT NULL,restored_record_count INTEGER NOT NULL DEFAULT 0,verified_object_count INTEGER NOT NULL DEFAULT 0,created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_recovery_drills_scope ON organization_recovery_drills(organization_id,created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_custody_transfers(transfer_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,project_access_id TEXT,source_user_id TEXT NOT NULL,target_user_id TEXT NOT NULL,status TEXT NOT NULL,manifest_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,completed_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_org_custody_transfer_scope ON organization_custody_transfers(organization_id,status)"),
    env.DB.prepare("DROP TRIGGER IF EXISTS organization_context_package_version_immutable"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_context_package_version_immutable BEFORE UPDATE ON organization_context_package_versions WHEN OLD.status='published' AND (NEW.version_id<>OLD.version_id OR NEW.status<>OLD.status OR NEW.package_id<>OLD.package_id OR NEW.organization_id<>OLD.organization_id OR NEW.version<>OLD.version OR NEW.content_sha256<>OLD.content_sha256 OR NEW.source_project_access_id<>OLD.source_project_access_id OR NEW.source_document_id<>OLD.source_document_id OR NEW.created_by_user_id<>OLD.created_by_user_id OR COALESCE(NEW.approved_by_user_id,'')<>COALESCE(OLD.approved_by_user_id,'') OR COALESCE(NEW.published_at,'')<>COALESCE(OLD.published_at,'')) BEGIN SELECT RAISE(ABORT,'published_context_package_is_immutable'); END"),
    env.DB.prepare("DROP TRIGGER IF EXISTS organization_context_package_content_immutable"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_context_package_content_immutable BEFORE UPDATE OF content_json ON organization_context_package_contents WHEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published') AND NEW.content_json<>OLD.content_json BEGIN SELECT RAISE(ABORT,'published_context_package_content_is_immutable'); END"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_context_package_source_immutable BEFORE UPDATE ON organization_context_package_sources WHEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published') BEGIN SELECT RAISE(ABORT,'published_context_package_source_is_immutable'); END"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_context_package_source_delete_guard BEFORE DELETE ON organization_context_package_sources WHEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published') AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=OLD.organization_id AND deletion.status='processing') BEGIN SELECT RAISE(ABORT,'published_context_package_source_is_immutable'); END"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_context_package_version_delete_guard BEFORE DELETE ON organization_context_package_versions WHEN OLD.status='published' AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=OLD.organization_id AND deletion.status='processing') BEGIN SELECT RAISE(ABORT,'published_context_package_is_immutable'); END"),
    env.DB.prepare("DROP TRIGGER IF EXISTS organization_legal_hold_during_deletion_guard"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_legal_hold_during_deletion_guard BEFORE INSERT ON organization_legal_holds WHEN NEW.status='active' AND(NOT EXISTS(SELECT 1 FROM organizations governed WHERE governed.organization_id=NEW.organization_id AND governed.status='active') OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing','completed'))) BEGIN SELECT RAISE(ABORT,'organization_deletion_in_progress'); END"),
    env.DB.prepare("DROP TRIGGER IF EXISTS organization_deletion_active_hold_guard"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_deletion_active_hold_guard BEFORE INSERT ON organization_deletion_jobs WHEN EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=NEW.organization_id AND hold.status='active') OR EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=NEW.organization_id AND policy.legal_hold=1) OR EXISTS(SELECT 1 FROM organization_recovery_snapshots recovery WHERE recovery.organization_id=NEW.organization_id AND recovery.status='staging') OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing')) BEGIN SELECT RAISE(ABORT,'organization_deletion_blocked'); END"),
    env.DB.prepare("DROP TRIGGER IF EXISTS organization_retention_hold_during_deletion_guard"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_retention_hold_during_deletion_guard BEFORE UPDATE OF legal_hold ON organization_retention_policies WHEN NEW.legal_hold=1 AND(NOT EXISTS(SELECT 1 FROM organizations governed WHERE governed.organization_id=NEW.organization_id AND governed.status='active') OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing','completed'))) BEGIN SELECT RAISE(ABORT,'organization_deletion_in_progress'); END"),
    env.DB.prepare("DROP TRIGGER IF EXISTS organization_retention_hold_insert_during_deletion_guard"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_retention_hold_insert_during_deletion_guard BEFORE INSERT ON organization_retention_policies WHEN NEW.legal_hold=1 AND(NOT EXISTS(SELECT 1 FROM organizations governed WHERE governed.organization_id=NEW.organization_id AND governed.status='active') OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing','completed'))) BEGIN SELECT RAISE(ABORT,'organization_deletion_in_progress'); END"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_audit_block_update BEFORE UPDATE ON organization_audit_events BEGIN SELECT RAISE(ABORT,'organization audit is append-only'); END"),
    env.DB.prepare("CREATE TRIGGER IF NOT EXISTS organization_audit_block_delete BEFORE DELETE ON organization_audit_events BEGIN SELECT RAISE(ABORT,'organization audit is append-only'); END"),
    env.DB.prepare("DROP TRIGGER IF EXISTS project_notification_after_event"),
    env.DB.prepare(PROJECT_NOTIFICATION_TRIGGER_SQL),
    env.DB.prepare("DROP TRIGGER IF EXISTS pilot_project_owner_membership_guard"),
    env.DB.prepare(PILOT_OWNER_REVOCATION_TRIGGER_SQL),
    env.DB.prepare("DROP TRIGGER IF EXISTS pilot_project_owner_participant_guard"),
    env.DB.prepare(PILOT_PARTICIPANT_OWNER_REVOCATION_TRIGGER_SQL),
    env.DB.prepare("DROP TRIGGER IF EXISTS pilot_project_owner_membership_deletion_guard"),
    env.DB.prepare(PILOT_OWNER_DELETION_TRIGGER_SQL),
    env.DB.prepare("DROP TRIGGER IF EXISTS pilot_project_owner_participant_deletion_guard"),
    env.DB.prepare(PILOT_PARTICIPANT_OWNER_DELETION_TRIGGER_SQL),
    env.DB.prepare(PILOT_COHORT_DELETION_TRIGGER_SQL),
    ...OUTPUT_REQUIREMENTS_SCHEMA.map((sql) => env.DB.prepare(sql)),
    // Read the migration route in this existing bootstrap round trip. The
    // following migration/validation transaction still rechecks all guards.
    env.DB.prepare(OUTPUT_MODEL3D_SCHEMA_STATE_SQL),
  ]).then(async (results) => {
    await upgradeOutputRequirementsSchema(env.DB, results.at(-1)?.results[0]?.current);
    readySchemas.add(env.DB);
    markOutputSchemaReady(env.DB);
  }).catch((error: unknown) => {
    initializedSchemas.delete(env.DB);
    throw error;
  });
  initializedSchemas.set(env.DB, initialization);
  return initialization;
}

const ordinaryPrivateRetentionUnheld = `NOT EXISTS(SELECT 1 FROM private_content_retention_scopes scope JOIN organization_retention_policies policy ON policy.organization_id=scope.organization_id AND policy.legal_hold=1 WHERE scope.content_id=private_content.content_id AND scope.classification='governed-evidence')
  AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes scope JOIN organization_legal_holds hold ON hold.organization_id=scope.organization_id AND hold.status='active'
    WHERE scope.content_id=private_content.content_id AND (hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=scope.project_access_id OR hold.scope_kind='content' AND hold.resource_id=scope.content_id))`;
const ordinaryRevisionRetentionUnheld = `NOT EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=artifact_revisions.organization_id AND policy.legal_hold=1)
  AND NOT EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=artifact_revisions.organization_id AND hold.status='active'
    AND (hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=artifact_revisions.project_access_id OR hold.scope_kind='artifact' AND hold.resource_id=artifact_revisions.artifact_id))`;

/** Dedicated answer/origin retirement owns its bodies even after consent or ledger rows disappear. */
async function ordinaryStructuredOriginExclusion(env: WorkerEnv, observation?:{db:WorkerEnv["DB"];result:unknown}): Promise<{sql:string;bindings:(string|number|null)[]}> {
  const db=env.DB;
  try {
    const { nativeStructuredOriginSchema, nativeStructuredMemoryOriginAnswerExclusion } = await import("./memory-native-origin.ts");
    const schema=observation?await (await import("./memory-native-origin-schema.ts")).qualifyNativeStructuredOriginSchema(env,observation.db,observation.result):await nativeStructuredOriginSchema(env),answer=nativeStructuredMemoryOriginAnswerExclusion(schema.present,"private_content");
    if(env.DB!==db)throw new Error("retention-cleanup-binding-changed");
    return{sql:"("+schema.guard.condition+") AND ("+answer.sql+")",bindings:[...schema.guard.bindings,...answer.bindings]};
  } catch(error) {
    if(env.DB!==db)throw new Error("retention-cleanup-binding-changed",{cause:error});
    if(!(error instanceof Error)||error.message!=="native_structured_origin_schema_unavailable")throw error;
    // Only this optional ordinary class is withheld. The dedicated preparation
    // and backlog still report unavailable provenance; they cannot certify empty.
    return{sql:"0",bindings:[]};
  }
}

async function ordinaryRetentionShape(env:WorkerEnv,now:string,workClass:number,observation?:{db:WorkerEnv["DB"];result:unknown;platform:boolean}){
  const db=env.DB;
  if(workClass===0){
    const origin=await ordinaryStructuredOriginExclusion(env,observation);
    if(env.DB!==db)throw new Error("retention-cleanup-binding-changed");
    return{table:"private_content",identity:"content_id",body:"content",
      eligible:"redacted_at IS NULL AND kind NOT IN('document-artifact','memory-structured-ledger','memory-structured-origin') AND expires_at<=? AND "+ordinaryPrivateRetentionUnheld+" AND "+origin.sql,
      bindings:[now,...origin.bindings]};
  }
  if(workClass===1)return{table:"artifact_revisions",identity:"revision_id",body:"content_json",
    eligible:"redacted_at IS NULL AND expires_at<=? AND "+ordinaryRevisionRetentionUnheld,bindings:[now]};
  if(workClass===2){
    const platform=observation?observation.platform:await db.prepare("SELECT 1 AS available FROM sqlite_schema WHERE type='table' AND name='platform_assistant_private_content' LIMIT 1").first();
    if(env.DB!==db)throw new Error("retention-cleanup-binding-changed");
    return platform?{table:"platform_assistant_private_content",identity:"content_id",body:"content",eligible:"redacted_at IS NULL AND expires_at<=?",bindings:[now]}:null;
  }
  throw new Error("retention-cleanup-class-invalid");
}

/** Existing ordinary cleanup excludes every dedicated structured body. */
async function ordinaryRetentionStatement(env: WorkerEnv, now: string, workClass: number, maximum: number): Promise<D1PreparedStatement | null> {
  const db=env.DB,shape=await ordinaryRetentionShape(env,now,workClass);
  if(env.DB!==db)throw new Error("retention-cleanup-binding-changed");
  if(!shape)return null;
  const candidate=await db.prepare("SELECT "+shape.identity+" FROM "+shape.table+" WHERE "+shape.eligible+" ORDER BY expires_at LIMIT 1").bind(...shape.bindings).first();
  if(env.DB!==db)throw new Error("retention-cleanup-binding-changed");
  if(!candidate)return null;
  return db.prepare("UPDATE "+shape.table+" SET "+shape.body+"='',redacted_at=? WHERE rowid IN (SELECT rowid FROM "+shape.table+" WHERE "+shape.eligible+" ORDER BY expires_at LIMIT ?)").bind(now,...shape.bindings,maximum);
}

/** A FIFO candidate is a one-use exact snapshot, not a reusable cleanup capability. */
async function ordinaryRetentionCandidate(env:WorkerEnv,now:string,workClass:number){
  const db=env.DB,shape=await ordinaryRetentionShape(env,now,workClass);
  if(env.DB!==db)throw new Error("retention-cleanup-binding-changed");
  if(!shape)return null;
  const selection="SELECT "+shape.identity+" AS identity,expires_at FROM "+shape.table+" WHERE "+shape.eligible+" ORDER BY expires_at,"+shape.identity+" LIMIT 1";
  const row=await db.prepare(selection).bind(...shape.bindings).first<{identity:string;expires_at:string}>();
  if(env.DB!==db)throw new Error("retention-cleanup-binding-changed");
  if(!row)return null;
  if(typeof row.identity!=="string"||!row.identity||row.identity.length>1024||typeof row.expires_at!=="string"
    ||row.expires_at.length!==24||!Number.isFinite(Date.parse(row.expires_at))||new Date(row.expires_at).toISOString()!==row.expires_at||row.expires_at>now)
    throw new Error("retention-cleanup-unavailable");
  const assertion=(condition:string,bindings:(string|number|null)[])=>db.prepare("SELECT CASE WHEN ("+condition+") THEN 1 ELSE json('retention_cleanup_changed') END AS verified").bind(...bindings);
  const statements=[
    assertion("EXISTS(SELECT 1 FROM ("+selection+") selected WHERE selected.identity=? AND selected.expires_at=?)",[...shape.bindings,row.identity,row.expires_at]),
    db.prepare("UPDATE "+shape.table+" SET "+shape.body+"='',redacted_at=? WHERE "+shape.identity+"=? AND expires_at=? AND "+shape.eligible).bind(now,row.identity,row.expires_at,...shape.bindings),
    assertion("changes()=1",[]),
    assertion("EXISTS(SELECT 1 FROM "+shape.table+" WHERE "+shape.identity+"=? AND expires_at=? AND "+shape.body+"='' AND redacted_at=?)",[row.identity,row.expires_at,now]),
  ];
  let consumed=false;
  return{oldest:row.expires_at,selectionKey:String(workClass)+":"+row.identity,async commit():Promise<1>{
    if(consumed||env.DB!==db)throw new Error("retention-cleanup-stale");consumed=true;
    try{
      const results=await db.batch(statements);
      if(env.DB!==db||!Array.isArray(results)||results.length!==statements.length||results.some(result=>!result||typeof result!=="object"||Array.isArray(result)
        ||!Object.hasOwn(result,"success")||result.success!==true||(result as typeof result & {error?:unknown}).error!==undefined||!Object.hasOwn(result,"results")||!Array.isArray(result.results)))throw new Error("retention-cleanup-unconfirmed");
      for(const index of [0,2,3]){
        const rows=results[index]!.results;
        if(rows.length!==1||!rows[0]||typeof rows[0]!=="object"||Array.isArray(rows[0])||Object.keys(rows[0]).length!==1
          ||Object.keys(rows[0])[0]!=="verified"||(rows[0] as Record<string,unknown>).verified!==1)throw new Error("retention-cleanup-unconfirmed");
      }
      if(!Object.hasOwn(results[1]!,"meta")||!results[1]!.meta||typeof results[1]!.meta!=="object"||Array.isArray(results[1]!.meta)||!Object.hasOwn(results[1]!.meta,"changes")||results[1]!.meta.changes!==1)throw new Error("retention-cleanup-unconfirmed");
      return 1;
    }catch(error){throw new Error("retention-cleanup-unconfirmed",{cause:error});}
  }};
}

function ordinaryRetentionCommitted(result: D1Result, maximum: number): number {
  const changes = result?.meta?.changes;
  if (!result || result.success !== true || ("error" in result && result.error !== undefined)
    || typeof changes !== "number" || !Number.isSafeInteger(changes) || changes < 0 || changes > maximum) throw new Error("retention-cleanup-unconfirmed");
  return changes;
}

async function sweepOrdinaryExpiredPrivateContent(env: WorkerEnv, now: string, maximum: number): Promise<number> {
  const db = env.DB;
  const {nativeStructuredOriginSchemaRead}=await import('./memory-native-origin-schema.ts');
  if(env.DB!==db)throw Error('retention-cleanup-binding-changed');
  // Independent metadata and candidate reads share two native round trips.
  // These select work only; each bounded UPDATE rechecks its complete current
  // schema, negative origin boundary, expiry and legal-hold predicates.
  const metadata=structuredClone(await db.batch<Record<string,unknown>>([
    nativeStructuredOriginSchemaRead(db),
    db.prepare("SELECT 1 AS available FROM sqlite_schema WHERE type='table' AND name='platform_assistant_private_content' LIMIT 1"),
  ]));
  if(env.DB!==db||!Array.isArray(metadata)||metadata.length!==2||!Object.hasOwn(metadata,0)||!Object.hasOwn(metadata,1)
    ||metadata[1]?.success!==true||('error' in metadata[1]&&metadata[1].error!==undefined)||!Array.isArray(metadata[1].results)
    ||metadata[1].results.length>1||metadata[1].results.length===1&&(!metadata[1].results[0]||Object.keys(metadata[1].results[0]).join(',')!=='available'||metadata[1].results[0].available!==1))throw Error('retention-cleanup-unavailable');
  const observation={db,result:metadata[0],platform:metadata[1].results.length===1};
  const shapes=[];
  for(let workClass=0;workClass<3;workClass++){
    const shape=await ordinaryRetentionShape(env,now,workClass,observation);if(shape)shapes.push(shape);
  }
  if(env.DB!==db)throw Error('retention-cleanup-binding-changed');
  const selected=structuredClone(await db.batch<Record<string,unknown>>(shapes.map(shape=>db.prepare('SELECT '+shape.identity+' AS identity FROM '+shape.table+' WHERE '+shape.eligible+' ORDER BY expires_at LIMIT 1').bind(...shape.bindings))));
  if(env.DB!==db||!Array.isArray(selected)||selected.length!==shapes.length||!Array.from(selected).every(row=>row&&row.success===true&&(!('error' in row)||row.error===undefined)
    &&Array.isArray(row.results)&&row.results.length<=1&&(row.results.length===0||row.results[0]&&Object.keys(row.results[0]).join(',')==='identity'&&typeof row.results[0].identity==='string'&&row.results[0].identity.length>0)))throw Error('retention-cleanup-unconfirmed');
  let processed=0;
  for(const [index,shape]of shapes.entries()){
    if(processed>=maximum)break;if(selected[index]!.results.length===0)continue;
    const result=await db.prepare('UPDATE '+shape.table+' SET '+shape.body+"='',redacted_at=? WHERE rowid IN (SELECT rowid FROM "+shape.table+' WHERE '+shape.eligible+' ORDER BY expires_at LIMIT ?)').bind(now,...shape.bindings,maximum-processed).run();
    if(env.DB!==db)throw Error('retention-cleanup-binding-changed');
    processed+=ordinaryRetentionCommitted(result,maximum-processed);
  }
  return processed;
}

/** Retire eligible private data within the existing shared work-unit allowance.
 * Ordinary units still redact one body, plus at most one anchor cursor row.
 * A ledger unit changes at most one body, revision, exact custody resource,
 * retention row and head/cursor (five rows);
 * a head-only transition costs its own unit. A dedicated origin operation costs
 * one unit, with an anchor cursor update in the same transaction when present.
 * This return value is NOT a count of physically erased rows or a claim that
 * held/pending data is gone. */
export async function sweepExpiredPrivateContent(env: WorkerEnv, limit = 250): Promise<number> {
  const db = env.DB;
  const bindingCurrent = () => { if (env.DB !== db) throw new Error("retention-cleanup-binding-changed"); };
  await ensureSchema(env);
  bindingCurrent();
  const now = new Date().toISOString();
  const maximum = Math.max(1, Math.min(1_000, Math.floor(limit) || 250));
  // Import only when the existing retention path runs. No schema installation,
  // consumer activation, enrollment or additional scheduling is introduced.
  const { prepareStructuredConversationRetentionStep } = await import("./memory-live-store.ts");
  const { prepareNativeStructuredOriginRetentionStep } = await import("./memory-native-origin.ts");
  bindingCurrent();
  // A source-free empty snapshot can finish the common no-work case without
  // separately preparing four cleanup classes. Any optional structured or
  // platform schema, dedicated residue, or expired ordinary body falls through
  // to the original per-class proof/hold/fairness machinery. This path performs
  // no write, remembers no absence and never authorizes a content read.
  const idle=structuredClone(await db.prepare(`SELECT CASE WHEN
    NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE tbl_name IN
      ('memory_structured_conversation_heads','memory_structured_conversation_revisions',
       'memory_structured_answer_origins','memory_structured_answer_originals','memory_structured_answer_ledger_revisions',
       'platform_assistant_private_content'))
    AND NOT EXISTS(SELECT 1 FROM private_content WHERE kind IN('memory-structured-ledger','memory-structured-origin'))
    AND NOT EXISTS(SELECT 1 FROM private_content WHERE redacted_at IS NULL AND kind<>'document-artifact' AND expires_at<=?)
    AND NOT EXISTS(SELECT 1 FROM artifact_revisions WHERE redacted_at IS NULL AND expires_at<=?)
    AND NOT EXISTS(SELECT 1 FROM events event WHERE event.type='AssistantReasoned' AND CASE WHEN json_valid(event.payload)
      THEN json_extract(event.payload,'$.memory_origin_version') IS 2 ELSE 0 END)
    THEN 1 ELSE 0 END AS retention_idle`).bind(now,now).all<Record<string,unknown>>());
  bindingCurrent();
  if(!idle||idle.success!==true||('error' in idle&&idle.error!==undefined)||!Array.isArray(idle.results)||idle.results.length!==1
    ||!idle.results[0]||Array.isArray(idle.results[0])||Object.keys(idle.results[0]).join(',')!=='retention_idle'||![0,1].includes(idle.results[0].retention_idle as number))throw Error('retention-cleanup-unavailable');
  if(idle.results[0].retention_idle===1)return 0;
  let processed = 0;
  const preparationErrors: unknown[] = [];
  let ledgerUnavailable = false, originUnavailable = false;
  while (processed < maximum) {
    let step: Awaited<ReturnType<typeof prepareStructuredConversationRetentionStep>> = null;
    let origin: Awaited<ReturnType<typeof prepareNativeStructuredOriginRetentionStep>> = null;
    // Each preparation is read-only and independent. Withhold an unavailable
    // class for this invocation, but let other genuine plans use the remaining
    // shared allowance. Fresh plans are still required after every committed unit.
    if (!ledgerUnavailable) {
      try {
        step = await prepareStructuredConversationRetentionStep(env, { now });
        bindingCurrent();
        if (step && (!Number.isInteger(step.nextClass) || step.nextClass < 0 || step.nextClass > 3)) throw new Error("retention-cleanup-class-invalid");
        if (step && (typeof step.oldest!=="string"||step.oldest.length!==24||!Number.isFinite(Date.parse(step.oldest))
          ||new Date(step.oldest).toISOString()!==step.oldest||step.oldest>now)) throw new Error("retention-cleanup-unavailable");
      } catch (error) {
        bindingCurrent();
        step = null; ledgerUnavailable = true; preparationErrors.push(error);
      }
    }
    if (!originUnavailable) {
      try {
        origin = await prepareNativeStructuredOriginRetentionStep(env, { now });
        bindingCurrent();
        if(origin&&(origin.workUnits!==1||typeof origin.oldest!=="string"||origin.oldest.length!==24
          ||!Number.isFinite(Date.parse(origin.oldest))||new Date(origin.oldest).toISOString()!==origin.oldest||origin.oldest>now
          ||typeof origin.selectionKey!=="string"||!origin.selectionKey||origin.selectionKey.length>1024))throw new Error("retention-cleanup-unavailable");
      } catch (error) {
        bindingCurrent();
        origin = null; originUnavailable = true; preparationErrors.push(error);
      }
    }
    if (!step) {
      bindingCurrent();
      if(!origin){
        processed += await sweepOrdinaryExpiredPrivateContent(env, now, maximum - processed);
        bindingCurrent();
        break;
      }
      const selectedOrigin=origin;
      const candidates:{oldest:string;selectionKey:string;commit:()=>Promise<1>}[]=[{oldest:origin.oldest,selectionKey:"3:"+origin.selectionKey,commit:async()=>{
        bindingCurrent();
        try{
          const statements=selectedOrigin.statements.map(query=>db.prepare(query.sql).bind(...query.bindings));
          const results=await db.batch(statements);
          bindingCurrent();
          if(!selectedOrigin.acknowledge(results))throw new Error("retention-cleanup-unconfirmed");
          return 1;
        }catch(error){throw new Error("retention-cleanup-unconfirmed",{cause:error});}
      }}];
      for(let workClass=0;workClass<3;workClass++){
        const candidate=await ordinaryRetentionCandidate(env,now,workClass);
        bindingCurrent();if(candidate)candidates.push(candidate);
      }
      // With no ledger anchor, use exact global FIFO candidates. Newer traffic
      // cannot continually jump ahead of an older durable origin cleanup unit.
      candidates.sort((left,right)=>left.oldest<right.oldest?-1:left.oldest>right.oldest?1:left.selectionKey<right.selectionKey?-1:left.selectionKey>right.selectionKey?1:0);
      if(await candidates[0]!.commit()!==1)throw new Error("retention-cleanup-unconfirmed");
      bindingCurrent();processed++;continue;
    }
    let committed = false;
    // The native head's persisted cursor rotates all four classes while an
    // executable ledger target exists, including across fresh limit-one calls.
    // Empty/held classes cost no writes and are skipped in this finite scan.
    for (let offset = 0; offset < 4; offset++) {
      const workClass = (step.nextClass + offset) % 4;
      bindingCurrent();
      if (workClass === 3) {
        // The existing anchor cursor still rotates ordinary classes. Dedicated
        // origins and ledger work share this slot in immutable timestamp order.
        const committed=origin&&origin.oldest<step.oldest?await step.commitOrigin(origin):await step.commitLedger();
        if (committed !== 1) throw new Error("retention-cleanup-unconfirmed");
      } else {
        const statement = await ordinaryRetentionStatement(env, now, workClass, 1);
        bindingCurrent();
        if (!statement) continue;
        if (await step.commitOrdinary(workClass, statement) !== 1) throw new Error("retention-cleanup-unconfirmed");
      }
      bindingCurrent();
      // Each commit also CAS-advances the exact anchor cursor to this slot's
      // successor. An unconfirmed commit throws without retrying or reusing its
      // attempted allowance; the next invocation reads persisted progress.
      processed++;
      committed = true;
      break;
    }
    if (!committed) throw new Error("retention-cleanup-unavailable");
  }
  // Confirmed progress does not turn unavailable provenance into a completed
  // sweep. Commit/ACK failures bypass this deferred error and stop immediately.
  if (preparationErrors.length) throw preparationErrors[0];
  return processed;
}

/** Only an actual scheduled invocation creates an auditable, content-free run receipt. */
export async function observeScheduledRetention(env: WorkerEnv, limit = 1_000): Promise<number> {
  const db = env.DB;
  const bindingCurrent = () => { if (env.DB !== db) throw new Error("retention-cleanup-binding-changed"); };
  await ensureSchema(env);
  bindingCurrent();
  const runId=uuidV7(),startedAt=new Date().toISOString();
  await db.prepare("INSERT INTO retention_sweep_runs(run_id,trigger_kind,status,started_at,finished_at,processed_count,remaining_count,oldest_expired_at,error_code) VALUES(?,'scheduled','running',?,NULL,0,0,NULL,NULL)").bind(runId,startedAt).run();
  try{
    bindingCurrent();
    const processed=await sweepExpiredPrivateContent(env,limit);
    bindingCurrent();
    const now=new Date().toISOString();
    const platform=await db.prepare("SELECT 1 AS available FROM sqlite_schema WHERE type='table' AND name='platform_assistant_private_content' LIMIT 1")
      .first<{available:number}>();
    bindingCurrent();
    const platformBacklog=platform?" UNION ALL SELECT platform.expires_at FROM platform_assistant_private_content platform WHERE platform.redacted_at IS NULL AND platform.expires_at<=?":"";
    const ordinaryOrigin=await ordinaryStructuredOriginExclusion(env);
    bindingCurrent();
    const backlog=await db.prepare(`SELECT COUNT(*) AS count,MIN(expires_at) AS oldest FROM(
      SELECT private_content.expires_at FROM private_content WHERE private_content.redacted_at IS NULL AND private_content.kind NOT IN('document-artifact','memory-structured-ledger','memory-structured-origin') AND private_content.expires_at<=? AND (${ordinaryOrigin.sql})
        AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes scope JOIN organization_retention_policies policy ON policy.organization_id=scope.organization_id AND policy.legal_hold=1
          WHERE scope.content_id=private_content.content_id AND scope.classification='governed-evidence')
        AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes scope JOIN organization_legal_holds hold ON hold.organization_id=scope.organization_id AND hold.status='active'
          WHERE scope.content_id=private_content.content_id AND (hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=scope.project_access_id OR hold.scope_kind='content' AND hold.resource_id=scope.content_id))
      UNION ALL SELECT artifact_revisions.expires_at FROM artifact_revisions WHERE artifact_revisions.redacted_at IS NULL AND artifact_revisions.expires_at<=?
        AND NOT EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=artifact_revisions.organization_id AND policy.legal_hold=1)
        AND NOT EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=artifact_revisions.organization_id AND hold.status='active'
          AND (hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=artifact_revisions.project_access_id OR hold.scope_kind='artifact' AND hold.resource_id=artifact_revisions.artifact_id))${platformBacklog})`)
      .bind(now,...ordinaryOrigin.bindings,now,...(platform?[now]:[])).first<{count:number;oldest:string|null}>();
    bindingCurrent();
    // Count eligible work units, not physical rows; held or unavailable data is
    // never represented as erased. Absent/partial ledger schema is checked by
    // the native helper, including stray dedicated-kind bodies.
    const { structuredConversationRetentionBacklog } = await import("./memory-live-store.ts");
    bindingCurrent();
    const ledgerBacklog = await structuredConversationRetentionBacklog(env, { now });
    bindingCurrent();
    const { nativeStructuredOriginRetentionBacklog } = await import("./memory-native-origin.ts");
    const originBacklog=await nativeStructuredOriginRetentionBacklog(env,{now});
    bindingCurrent();
    const oldest = [backlog?.oldest, ledgerBacklog.oldest, originBacklog.oldest].filter((value): value is string => typeof value === "string").sort()[0] ?? null;
    await db.prepare("UPDATE retention_sweep_runs SET status='completed',finished_at=?,processed_count=?,remaining_count=?,oldest_expired_at=? WHERE run_id=?")
      .bind(now,processed,Number(backlog?.count??0)+ledgerBacklog.count+originBacklog.count,oldest,runId).run();
    bindingCurrent();
    await db.prepare("DELETE FROM retention_sweep_runs WHERE run_id NOT IN(SELECT run_id FROM retention_sweep_runs ORDER BY started_at DESC,run_id DESC LIMIT 500)").run();
    bindingCurrent();
    return processed;
  }catch(error){
    // Failed-run counts were not finalized and are incomplete/unknown, not
    // evidence that no cleanup committed before the failure or lost receipt.
    // Record failure only on the original binding, never a replacement target.
    await db.prepare("UPDATE retention_sweep_runs SET status='failed',finished_at=?,error_code='retention_cleanup_failed' WHERE run_id=?")
      .bind(new Date().toISOString(),runId).run();
    throw error;
  }
}

/** Active application traffic provides bounded cleanup even when the original creator never returns. */
export function schedulePrivateContentRetention(env: WorkerEnv, context: WorkerExecutionContext, now = Date.now()) {
  const previous = retentionSweeps.get(env.DB);
  if (previous !== undefined && now - previous < 5 * 60_000) return;
  retentionSweeps.set(env.DB, now);
  context.waitUntil(sweepExpiredPrivateContent(env).catch(() => { retentionSweeps.delete(env.DB); }));
}


export const insertEvent = (env: WorkerEnv, event: EventRow) => env.DB.prepare(`INSERT INTO event_write_stage (${EVENT_WRITE_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...eventWriteBindings(event));

export async function readEventsByClientEventIds(env:WorkerEnv,streamId:string,clientEventIds:string[]){
  const ids=[...new Set(clientEventIds.filter(Boolean))];const events=new Map<string,EventRow>();
  if(!ids.length)return events;
  // D1 permits 100 bound values per statement; reserve one for the stream.
  const statements=[];
  for(let offset=0;offset<ids.length;offset+=99){const page=ids.slice(offset,offset+99),placeholders=page.map(()=>"?").join(",");statements.push(env.DB.prepare(`SELECT r.client_event_id,e.*,secret.private_json FROM event_client_receipts r JOIN events e ON e.event_id=r.event_id LEFT JOIN event_private_payloads secret ON secret.private_event_id=e.event_id AND secret.redacted_at IS NULL WHERE r.stream_id=? AND r.client_event_id IN (${placeholders})`).bind(streamId,...page));}
  const results=statements.length===1?[await statements[0].all<Record<string,unknown>>()]:await env.DB.batch<Record<string,unknown>>(statements);
  for(const result of results)for(const row of result.results)events.set(String(row.client_event_id),serializeEvent(row));
  return events;
}

/**
 * Append a client action and its idempotency receipts in one D1 transaction.
 * A retry after a lost response therefore resolves to the original events
 * instead of duplicating a move, resize, text edit, or placement.
 */
export async function appendEventsWithClientReceipts(env:WorkerEnv,events:EventRow[],clientEventIds:string[],options:{retries?:number;expectedHead?:number}={}){
  if(events.length!==clientEventIds.length)throw new Error("client_receipt_count_mismatch");if(!events.length)return events;
  const streamId=events[0].streamId;if(!events.every((event)=>event.streamId===streamId))throw new Error("mixed_event_stream_batch");
  const retries=options.expectedHead===undefined?Math.max(1,options.retries??8):1;
  for(let attempt=0;attempt<retries;attempt+=1){
    const existing=await readEventsByClientEventIds(env,streamId,clientEventIds);const missing=events.map((event,index)=>({event,clientEventId:clientEventIds[index]})).filter((item)=>!existing.has(item.clientEventId));if(!missing.length)return events;
    const head=options.expectedHead??await streamHead(env,streamId);missing.forEach((item,index)=>{item.event.sequence=head+index+1;});const createdAt=new Date().toISOString();const statements=missing.flatMap((item,index)=>[insertEventAtHead(env,item.event,head+index),env.DB.prepare("INSERT INTO event_client_receipts (stream_id,client_event_id,event_id,sequence,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM events WHERE event_id=?)").bind(streamId,item.clientEventId,item.event.eventId,item.event.sequence,createdAt,item.event.eventId)]);
    try{const results=await env.DB.batch(statements);if(missing.every((_,index)=>Number(results[index*2]?.meta.changes??0)>0))return events;}catch{/* A competing retry may have committed the same client receipt. */}
    if(options.expectedHead!==undefined){
      // The original validated head is fixed inside the event/receipt batch.
      // An ambiguous acknowledgement may recover only the exact old receipts;
      // it must never rebase a stale requirement against a newer source.
      const committed=await readEventsByClientEventIds(env,streamId,clientEventIds);
      if(clientEventIds.every((id)=>committed.has(id)))return events;
      throw new StaleSequenceError(options.expectedHead,await streamHead(env,streamId));
    }
  }
  throw new Error("event_append_contention");
}



/** Recover job receipts without replaying an account's entire event ledger. */
export async function readCorrelatedEvents(env:WorkerEnv,streamId:string,correlationIds:string[]){
  const ids=[...new Set(correlationIds.filter(Boolean))];if(!ids.length)return[] as EventRow[];
  const statements=[];
  for(let offset=0;offset<ids.length;offset+=99){const page=ids.slice(offset,offset+99);statements.push(env.DB.prepare(`SELECT * FROM events INDEXED BY idx_events_correlation LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id AND secret.redacted_at IS NULL WHERE stream_id=? AND correlation_id IN (${page.map(()=>"?").join(",")}) ORDER BY sequence ASC`).bind(streamId,...page));}
  const pages=statements.length===1?[await statements[0].all<Record<string,unknown>>()]:await env.DB.batch<Record<string,unknown>>(statements);
  return pages.flatMap((page)=>page.results.map(serializeEvent)).sort((left,right)=>left.sequence-right.sequence);
}

export const SCOPED_EVENT_PAGE_SIZE = 6500;

export type EventReadProfile = import("../src/model/event-profiles.ts").ScopedEventProfile;
export { PROJECT_BOOTSTRAP_EVENT_TYPES } from "../src/model/event-profiles.ts";
export const PROJECTION_IGNORED_EVENT_TYPES = PROFILE_EXCLUDED_EVENT_TYPES.workspace;


/** Keep a transport page and its head on the same consistent D1 snapshot. */
export async function readEventPageWithHead(env: WorkerEnv, streamId: string, afterSequence = 0, limit = EVENT_PAGE_SIZE) {
  const after = Math.max(0, Math.floor(afterSequence));
  const pageSize = Math.max(1, Math.min(EVENT_PAGE_SIZE, Math.floor(limit)));
  const [page, current] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT * FROM events LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id AND secret.redacted_at IS NULL WHERE stream_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?")
      .bind(streamId, after, pageSize),
    env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?")
      .bind(streamId),
  ]);
  const events = (page?.results ?? []).map(serializeEvent);
  const head = Number(current?.results[0]?.head ?? 0);
  const nextAfter = Number(events.at(-1)?.sequence ?? after);
  return { events, head, nextAfter, hasMore: nextAfter < head };
}

/** Server-only original source proof, read alongside each hydrated page. The
 * verifier is synchronous and must reject every failed/missing assertion and any
 * expired deadline before rows are serialized or consumed by a projection. */
export type EventReadProof = Readonly<{
  statements: readonly D1PreparedStatement[];
  verify: (results: Array<D1Result<Record<string, unknown>>>) => void;
}>;

/** Canonical SQL membership shared by the reader, census and metadata projection. */
export function eventProfilePredicate(profile:EventReadProfile) {
  const types=profile==='projects'?PROJECT_BOOTSTRAP_EVENT_TYPES:PROFILE_EXCLUDED_EVENT_TYPES[profile];
  return {sql:`type ${profile==='projects'?'IN':'NOT IN'} (${types.map(()=>'?').join(',')})${profile==='projects'?'':` AND NOT (${PHANTOM_ATTENTION_EVENT_SQL})`}`,bindings:[...types]};
}

/** Read a route-specific page and its authoritative stream head in one D1 round trip. */
export async function readProfileEventPage(
  env: WorkerEnv,
  streamId: string,
  profile: EventReadProfile,
  afterSequence = 0,
  limit = SCOPED_EVENT_PAGE_SIZE,
  proof?: EventReadProof,
  custody?: { ownerId:string; observe:(rows:Record<string,unknown>[])=>void; captureProof?:(proof:EventReadProof)=>void; maxRows?:number },
) {
  const pageSize = Math.max(1, Math.min(SCOPED_EVENT_PAGE_SIZE, Math.floor(limit)));
  const predicate = eventProfilePredicate(profile);
  const index = profile === "projects" ? " INDEXED BY idx_events_stream_type" : "";
  const checkedProof = proof ? { statements: [...proof.statements], verify: proof.verify } : null;
  const custodyCapacity = custody?.maxRows===undefined ? '' : ` AND (SELECT count(*) FROM (SELECT 1 FROM events WHERE stream_id=? AND ${predicate.sql} LIMIT ?))<=?`;
  const readStatements = [
    env.DB.prepare(`SELECT events.*,secret.*${custody?`,custody.owner_id AS custody_owner,custody.project_id AS custody_project,custody.document_id AS custody_document,custody.created_at AS custody_created,custody.redacted_at AS custody_redacted,custody.private_event_id AS custody_id,
        EXISTS(SELECT 1 FROM project_event_scopes s WHERE s.event_id=events.event_id) AS custody_scoped`:""} FROM events${index}${custody?" LEFT JOIN event_private_payloads custody ON custody.private_event_id=events.event_id":""} LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id AND secret.redacted_at IS NULL WHERE stream_id=? AND sequence>? AND ${predicate.sql}${custody?" AND length(CAST(events.payload AS BLOB))<=65536 AND length(CAST(COALESCE(secret.private_json,'') AS BLOB))<=65536":""} ${custodyCapacity} ORDER BY sequence ASC LIMIT ?`)
      .bind(streamId, Math.max(0, Math.floor(afterSequence)), ...predicate.bindings,...(custody?.maxRows===undefined?[]:[streamId,...predicate.bindings,custody.maxRows+1,custody.maxRows]), pageSize),
    env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(streamId),
    ...(checkedProof?.statements ?? []),
  ];
  const [page, current, ...sourceChecks] = await env.DB.batch<Record<string,unknown>>(readStatements);
  if (checkedProof && (!page || page.success !== true || !Array.isArray(page.results) || page.results.length > pageSize
    || !current || current.success !== true || !Array.isArray(current.results) || current.results.length !== 1
    || typeof current.results[0]?.head !== "number" || !Number.isSafeInteger(current.results[0].head) || current.results[0].head < 0)) {
    throw new Error("output_source_changed_during_read");
  }
  checkedProof?.verify(sourceChecks);
  custody?.observe(page.results);
  if(custody?.captureProof){const expected=JSON.stringify([page,...sourceChecks].map(r=>r.results));
    custody.captureProof({statements:[readStatements[0]!,...readStatements.slice(2)],verify(results){
      if(results.some(r=>r.success!==true)||JSON.stringify(results.map(r=>r.results))!==expected)throw Error("source_census_changed");}});}

  const events = (page?.results ?? []).map(serializeEvent);
  const head = Number(current?.results[0]?.head ?? 0);
  // Excluded telemetry can trail the final useful event; advance past it.
  const nextAfter = events.length < pageSize ? head : Number(events.at(-1)?.sequence ?? afterSequence);
  return { events, head, nextAfter, hasMore: nextAfter < head, profile };
}

/** Bounded complete workspace receipt before private custody is discarded.
 * The profile is shared with ordinary source resolution. All its rows are retained
 * conservatively, including unrelated history that can affect implicit defaults.
 * Authored sidecars have no time expiry: their lifetime ends at deletion/redaction
 * or any custody/scope change. Consumers must additionally cap their own access. */
export async function readWorkspaceSourceCensus(env:WorkerEnv,streamId:string,ownerId:string,verifyRows:(rows:Record<string,unknown>[])=>void,proof?:EventReadProof) {
  const predicate=eventProfilePredicate("workspace"), raw:Record<string,unknown>[]=[];
  let count=-1;let finalProof:EventReadProof|undefined;
  const page=await readProfileEventPage(env,streamId,"workspace",0,129,{
    statements:[env.DB.prepare(`SELECT count(*) AS total FROM events WHERE stream_id=? AND ${predicate.sql}`).bind(streamId,...predicate.bindings),...(proof?.statements??[])],
    verify(results){const result=results[0];if(!result?.success||result.results?.length!==1||!Number.isSafeInteger(result.results[0].total))throw Error("source_census_incomplete");
      count=Number(result.results[0].total);if(count>128)throw Error("source_census_capacity");proof?.verify(results.slice(1));}
  },{ownerId,maxRows:128,captureProof(value){finalProof=value;},observe(rows){if(rows.length!==count)throw Error("source_census_incomplete");verifyRows(rows);raw.push(...rows);}});
  if(page.hasMore||raw.length!==count)throw Error("source_census_incomplete");
  return {events:page.events,rows:raw,proof:finalProof!};
}

/** Load every projection-relevant account event without replaying telemetry. */
export async function readWorkspaceEvents(env:WorkerEnv,streamId:string,proof?:EventReadProof){
  const events:EventRow[]=[];let after=0;
  while(true){const page=await readProfileEventPage(env,streamId,"workspace",after,SCOPED_EVENT_PAGE_SIZE,proof);events.push(...page.events);if(!page.hasMore)return events;after=page.nextAfter;}
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
    env.DB.prepare(`SELECT * FROM events LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id AND secret.redacted_at IS NULL WHERE ${pageWhere} ORDER BY sequence DESC LIMIT ?`).bind(...pageValues, limit + 1),
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


export async function appendAuditEvent(env: WorkerEnv, streamId: string, actor: string, type: string, payload: Record<string, unknown>, correlationId = uuidV7()) {
  const event = makeEvent(streamId, 0, actor, "server:policy", correlationId, type, payload);
  await appendEvents(env, [event]); return event;
}
