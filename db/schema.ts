import { integer, sqliteTable, text, uniqueIndex, index, primaryKey, check, unique, foreignKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { PHANTOM_ATTENTION_EVENT_SQL } from "./event-predicates.ts";

/**
 * Truth lives here. Product state is always rebuilt by folding these rows.
 * Payloads remain JSON text at the SQLite edge and are validated before append.
 */
export const events = sqliteTable(
  "events",
  {
    eventId: text("event_id").primaryKey(),
    streamId: text("stream_id").notNull(),
    sequence: integer("sequence").notNull(),
    occurredAt: text("occurred_at").notNull(),
    recordedAt: text("recorded_at").notNull(),
    actor: text("actor").notNull(),
    clientId: text("client_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id"),
    compensatesEventId: text("compensates_event_id"),
    schemaVersion: integer("schema_version").notNull().default(1),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [
    uniqueIndex("idx_events_stream_sequence").on(table.streamId, table.sequence),
    index("idx_events_stream_type").on(table.streamId, table.type),
    index("idx_events_type_occurred_stream").on(table.type, table.occurredAt, table.streamId),
    index("idx_events_correlation").on(table.correlationId),
    index("idx_events_stream_actor").on(table.streamId, table.actor),
    index("idx_events_nonphantom_stream_sequence").on(table.streamId, table.sequence).where(sql.raw(`NOT (${PHANTOM_ATTENTION_EVENT_SQL})`)),
  ],
);

/** Authored event bodies are mutable/erasable; immutable events retain operational metadata only. */
export const eventPrivatePayloads = sqliteTable(
  "event_private_payloads",
  {
    privateEventId: text("private_event_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    projectId: text("project_id"),
    documentId: text("document_id"),
    privateJson: text("private_json").notNull(),
    createdAt: text("created_at").notNull(),
    redactedAt: text("redacted_at"),
  },
  (table) => [index("idx_event_private_payloads_owner_scope").on(table.ownerId, table.projectId, table.documentId, table.redactedAt)],
);

/** Operational change witnesses, never copies of authored history. Saturation
 * stops new certificates without preventing privacy erasure of source rows. */
export const sceneSourceGenerations = sqliteTable("scene_source_generations", {
  scopeKind: text("scope_kind").notNull(), scopeKey: text("scope_key").notNull(),
  generation: integer("generation").notNull(),
}, table => [
  primaryKey({ columns: [table.scopeKind, table.scopeKey] }),
  check("scene_source_generation_kind", sql`${table.scopeKind} IN ('stream','project')`),
  check("scene_source_generation_value", sql`typeof(${table.generation})='integer' AND ${table.generation} BETWEEN 1 AND 9007199254740991`),
]);
export const sceneSourceEpoch = sqliteTable("scene_source_epoch", {
  singleton: integer("singleton").primaryKey().notNull(), schemaVersion: integer("schema_version").notNull(),
  instanceNonce: text("instance_nonce").notNull(), generation: integer("generation").notNull(),
}, table => [
  check("scene_source_epoch_singleton", sql`${table.singleton}=1`),
  check("scene_source_epoch_version", sql`${table.schemaVersion}=1`),
  check("scene_source_epoch_nonce", sql`length(${table.instanceNonce})=32 AND ${table.instanceNonce} NOT GLOB '*[^0-9a-f]*'`),
  check("scene_source_epoch_generation", sql`typeof(${table.generation})='integer' AND ${table.generation} BETWEEN 1 AND 9007199254740991`),
]);

/** A self-cleaning SQLite trigger commits immutable metadata and its private body together. */
export const eventWriteStage = sqliteTable(
  "event_write_stage",
  {
    eventId: text("event_id").primaryKey(),
    streamId: text("stream_id").notNull(),
    sequence: integer("sequence").notNull(),
    occurredAt: text("occurred_at").notNull(),
    recordedAt: text("recorded_at").notNull(),
    actor: text("actor").notNull(),
    clientId: text("client_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id"),
    compensatesEventId: text("compensates_event_id"),
    schemaVersion: integer("schema_version").notNull(),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
    ownerId: text("owner_id").notNull(),
    projectId: text("project_id"),
    documentId: text("document_id"),
    privateJson: text("private_json"),
  },
);

/** Event-triggered team follow-up contains only scoped operational metadata, never creative prose. */
export const projectNotifications = sqliteTable(
  "project_notifications",
  {
    notificationId: text("notification_id").primaryKey(),
    projectAccessId: text("project_access_id").notNull(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id").notNull(),
    recipientUserId: text("recipient_user_id").notNull(),
    eventId: text("event_id").notNull(),
    kind: text("kind").notNull(),
    artifactId: text("artifact_id"),
    documentId: text("document_id"),
    message: text("message").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    readAt: text("read_at"),
  },
  (table) => [uniqueIndex("idx_project_notifications_recipient_event").on(table.projectAccessId,table.recipientUserId,table.eventId,table.kind),index("idx_project_notifications_recipient_time").on(table.recipientUserId,table.projectAccessId,table.createdAt)],
);

/** Explicit pilot boundaries never change enrollment or spending for unrelated organizations. */
export const pilotCohorts = sqliteTable(
  "pilot_cohorts",
  {
    cohortId: text("cohort_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    status: text("status").notNull().default("active"),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    maxParticipants: integer("max_participants").notNull().default(10),
    participantCapMicrousd: integer("participant_cap_microusd").notNull().default(15_000_000),
    organizationCapMicrousd: integer("organization_cap_microusd").notNull().default(150_000_000),
    sourceClassification: text("source_classification").notNull().default("non-sensitive-licensed"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_pilot_cohorts_active_organization").on(table.organizationId).where(sql`${table.status}='active'`),
    index("idx_pilot_cohorts_organization_status").on(table.organizationId, table.status, table.startsAt),
  ],
);

/** A named invitation is not interchangeable with another identity sharing an email. */
export const pilotParticipants = sqliteTable(
  "pilot_participants",
  {
    participantId: text("participant_id").primaryKey(),
    cohortId: text("cohort_id").notNull(),
    organizationId: text("organization_id").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    userId: text("user_id"),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    invitedByUserId: text("invited_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_pilot_participants_cohort_email").on(table.cohortId, table.emailNormalized),
    uniqueIndex("idx_pilot_participants_cohort_user").on(table.cohortId, table.userId).where(sql`${table.userId} IS NOT NULL`),
    index("idx_pilot_participants_organization_status").on(table.organizationId, table.status, table.userId),
  ],
);

/** Fixed-window pilot reservations stay linked to the original monthly provider receipt. */
export const pilotCostReservationScopes = sqliteTable(
  "pilot_cost_reservation_scopes",
  {
    reservationId: text("reservation_id").primaryKey(),
    cohortId: text("cohort_id").notNull(),
    organizationId: text("organization_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_pilot_cost_reservation_cohort_actor").on(table.cohortId, table.actorUserId)],
);

/** Retention changes are prospective, exact-tenant policies rather than installation-wide rewrites. */
export const organizationRetentionPolicies = sqliteTable(
  "organization_retention_policies",
  {
    organizationId: text("organization_id").primaryKey(),
    transientDays: integer("transient_days").notNull().default(30),
    evidenceDays: integer("evidence_days").notNull().default(365),
    revisionDays: integer("revision_days").notNull().default(365),
    legalHold: integer("legal_hold", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull().default(1),
    updatedByUserId: text("updated_by_user_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

/** Content keeps the exact project and policy version assigned when its body was written. */
export const privateContentRetentionScopes = sqliteTable(
  "private_content_retention_scopes",
  {
    contentId: text("content_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectAccessId: text("project_access_id").notNull(),
    projectId: text("project_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    classification: text("classification").notNull(),
    policyVersion: integer("policy_version").notNull(),
    assignedExpiresAt: text("assigned_expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_private_content_retention_organization_expiry").on(table.organizationId, table.assignedExpiresAt)],
);

/** Scheduler receipts disclose operational outcomes, never authored material or provider secrets. */
export const retentionSweepRuns = sqliteTable(
  "retention_sweep_runs",
  {
    runId: text("run_id").primaryKey(),
    triggerKind: text("trigger_kind").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    processedCount: integer("processed_count").notNull().default(0),
    remainingCount: integer("remaining_count").notNull().default(0),
    oldestExpiredAt: text("oldest_expired_at"),
    errorCode: text("error_code"),
  },
  (table) => [index("idx_retention_sweep_runs_started").on(table.startedAt, table.status)],
);

/** Actual recoverable output bodies remain erasable and scoped outside immutable event envelopes. */
export const artifactRevisions = sqliteTable(
  "artifact_revisions",
  {
    revisionId: text("revision_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    organizationId: text("organization_id"),
    projectAccessId: text("project_access_id"),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    revision: integer("revision").notNull(),
    contentJson: text("content_json").notNull(),
    contentSha256: text("content_sha256").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    redactedAt: text("redacted_at"),
  },
  (table) => [
    uniqueIndex("idx_artifact_revisions_owner_artifact_revision").on(table.ownerId, table.artifactId, table.revision),
    index("idx_artifact_revisions_project_artifact").on(table.projectAccessId, table.artifactId, table.revision),
    index("idx_artifact_revisions_expiry").on(table.expiresAt).where(sql`${table.redactedAt} IS NULL`),
  ],
);

/** Organizational knowledge remains owned by its tenant, never by a departing author. */
export const organizationContextPackages = sqliteTable(
  "organization_context_packages",
  {
    packageId: text("package_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_org_context_packages_scope").on(table.organizationId, table.status, table.updatedAt)],
);

/** Published snapshots are immutable, independently attributable, and separately erasable. */
export const organizationContextPackageVersions = sqliteTable(
  "organization_context_package_versions",
  {
    versionId: text("version_id").primaryKey(),
    packageId: text("package_id").notNull(),
    organizationId: text("organization_id").notNull(),
    version: integer("version").notNull(),
    contentSha256: text("content_sha256").notNull(),
    sourceProjectAccessId: text("source_project_access_id").notNull(),
    sourceDocumentId: text("source_document_id").notNull(),
    status: text("status").notNull().default("draft"),
    createdByUserId: text("created_by_user_id").notNull(),
    approvedByUserId: text("approved_by_user_id"),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
    redactedAt: text("redacted_at"),
  },
  (table) => [
    uniqueIndex("idx_org_context_package_version").on(table.packageId, table.version),
    index("idx_org_context_versions_scope").on(table.organizationId, table.packageId, table.status),
  ],
);

/** Creative package bodies remain erasable even though published version receipts are immutable. */
export const organizationContextPackageContents = sqliteTable(
  "organization_context_package_contents",
  {
    versionId: text("version_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    contentJson: text("content_json").notNull(),
    createdAt: text("created_at").notNull(),
    redactedAt: text("redacted_at"),
  },
  (table) => [index("idx_org_context_package_contents_scope").on(table.organizationId, table.redactedAt)],
);

/** Exact source provenance prevents a package from silently inheriting foreign-tenant rights. */
export const organizationContextPackageSources = sqliteTable(
  "organization_context_package_sources",
  {
    versionId: text("version_id").notNull(),
    organizationId: text("organization_id").notNull(),
    sourceProjectAccessId: text("source_project_access_id").notNull(),
    sourceBlockId: text("source_block_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    contentSha256: text("content_sha256").notNull(),
    rightsExpiresAt: text("rights_expires_at"),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.sourceBlockId] }),
    index("idx_org_context_sources_scope").on(table.organizationId, table.sourceProjectAccessId),
  ],
);

/** Bindings pin one exact published version until an entitled author explicitly accepts an update. */
export const projectContextPackageBindings = sqliteTable(
  "project_context_package_bindings",
  {
    bindingId: text("binding_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectAccessId: text("project_access_id").notNull(),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    packageId: text("package_id").notNull(),
    versionId: text("version_id").notNull(),
    updateMode: text("update_mode").notNull().default("pinned"),
    status: text("status").notNull().default("active"),
    pendingVersionId: text("pending_version_id"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_project_context_binding_document_package").on(table.projectAccessId, table.documentId, table.packageId),
    index("idx_project_context_binding_package").on(table.organizationId, table.packageId, table.updateMode, table.status),
  ],
);

/** Local block identities are never confused with another project's source-block identity. */
export const projectContextPackageMembers = sqliteTable(
  "project_context_package_members",
  {
    bindingId: text("binding_id").notNull(),
    organizationId: text("organization_id").notNull(),
    sourceBlockId: text("source_block_id").notNull(),
    targetBlockId: text("target_block_id").notNull(),
    contentSha256: text("content_sha256").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bindingId, table.sourceBlockId] }),
    index("idx_project_context_member_target").on(table.organizationId, table.targetBlockId),
  ],
);

/** Independent review is assigned to an exact person, artifact revision, and content digest. */
export const projectReviewTasks = sqliteTable(
  "project_review_tasks",
  {
    taskId: text("task_id").primaryKey(),
    projectAccessId: text("project_access_id").notNull(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    documentId: text("document_id").notNull(),
    requestEventId: text("request_event_id").notNull(),
    requestedByUserId: text("requested_by_user_id").notNull(),
    assignedUserId: text("assigned_user_id").notNull(),
    artifactRevision: integer("artifact_revision").notNull().default(0),
    contentSha256: text("content_sha256").notNull(),
    status: text("status").notNull().default("pending"),
    dueAt: text("due_at"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id"),
  },
  (table) => [
    uniqueIndex("idx_project_review_task_event_assignee").on(table.projectAccessId, table.requestEventId, table.assignedUserId),
    index("idx_project_review_tasks_assigned").on(table.assignedUserId, table.status, table.dueAt),
    index("idx_project_review_tasks_artifact").on(table.projectAccessId, table.artifactId, table.status),
  ],
);

/** Tenant/project-scoped automations only create free, deterministic follow-up. */
export const projectAutomationPolicies = sqliteTable(
  "project_automation_policies",
  {
    projectAccessId: text("project_access_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    notifyContextChanges: integer("notify_context_changes", { mode: "boolean" }).notNull().default(true),
    notifyOutputReady: integer("notify_output_ready", { mode: "boolean" }).notNull().default(true),
    reviewDueHours: integer("review_due_hours").notNull().default(48),
    reminderHours: integer("reminder_hours").notNull().default(24),
    version: integer("version").notNull().default(1),
    updatedByUserId: text("updated_by_user_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_project_automation_policy_org").on(table.organizationId)],
);

/** One durable idempotency receipt exists for each event and automation rule. */
export const projectAutomationRuns = sqliteTable(
  "project_automation_runs",
  {
    runId: text("run_id").primaryKey(),
    projectAccessId: text("project_access_id").notNull(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id").notNull(),
    eventId: text("event_id").notNull(),
    ruleKind: text("rule_kind").notNull(),
    status: text("status").notNull(),
    recipientCount: integer("recipient_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("idx_project_automation_run_event_rule").on(table.projectAccessId, table.eventId, table.ruleKind),
    index("idx_project_automation_runs_scope").on(table.organizationId, table.projectAccessId, table.createdAt),
  ],
);

/** A local-only delivery outbox never implies an unconfigured email, Slack, or webhook integration. */
export const projectAutomationOutbox = sqliteTable(
  "project_automation_outbox",
  {
    deliveryId: text("delivery_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectAccessId: text("project_access_id").notNull(),
    taskId: text("task_id"),
    recipientUserId: text("recipient_user_id").notNull(),
    kind: text("kind").notNull(),
    destination: text("destination").notNull().default("in-app"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    payloadJson: text("payload_json").notNull().default("{}"),
    availableAt: text("available_at").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    deliveredAt: text("delivered_at"),
  },
  (table) => [
    uniqueIndex("idx_project_automation_outbox_idempotency").on(table.organizationId, table.idempotencyKey),
    index("idx_project_automation_outbox_pending").on(table.organizationId, table.status, table.availableAt),
  ],
);

/** Identity requirements describe observed platform identity, never invented MFA or federation. */
export const organizationSecurityPolicies = sqliteTable(
  "organization_security_policies",
  {
    organizationId: text("organization_id").primaryKey(),
    authenticationSource: text("authentication_source").notNull().default("any"),
    allowedDomainsJson: text("allowed_domains_json").notNull().default("[]"),
    requireMfa: integer("require_mfa", { mode: "boolean" }).notNull().default(false),
    encryptionMode: text("encryption_mode").notNull().default("platform-unverified"),
    maxSessionMinutes: integer("max_session_minutes").notNull().default(480),
    version: integer("version").notNull().default(1),
    updatedByUserId: text("updated_by_user_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

/** Provisioned identity bindings are tenant-local and immediately revocable. */
export const organizationIdentityBindings = sqliteTable(
  "organization_identity_bindings",
  {
    bindingId: text("binding_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    authenticationSource: text("authentication_source").notNull(),
    subject: text("subject").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_org_identity_binding_user").on(table.organizationId, table.userId),
    index("idx_org_identity_binding_subject").on(table.organizationId, table.authenticationSource, table.subject),
  ],
);

/** Provisioning bearer credentials are hashed; their raw values never enter durable storage or audit. */
export const organizationProvisioningCredentials = sqliteTable(
  "organization_provisioning_credentials",
  {
    credentialId: text("credential_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [uniqueIndex("idx_org_provisioning_token_hash").on(table.tokenHash), index("idx_org_provisioning_scope").on(table.organizationId, table.status)],
);

/** Local group mappings never grant permissions outside the organization that owns them. */
export const organizationIdentityGroups = sqliteTable(
  "organization_identity_groups",
  {
    groupId: text("group_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    mappedRole: text("mapped_role").notNull().default("member"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_org_identity_group_external").on(table.organizationId, table.externalId)],
);

export const organizationIdentityGroupMembers = sqliteTable(
  "organization_identity_group_members",
  {
    groupId: text("group_id").notNull(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] }), index("idx_org_identity_group_members_user").on(table.organizationId, table.userId)],
);

/** Tenant data keys are wrapped with an environment-provided root; plaintext keys are never persisted. */
export const organizationKeyVersions = sqliteTable(
  "organization_key_versions",
  {
    keyId: text("key_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    version: integer("version").notNull(),
    algorithm: text("algorithm").notNull().default("AES-GCM-256"),
    wrappedKey: text("wrapped_key").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    retiredAt: text("retired_at"),
  },
  (table) => [uniqueIndex("idx_org_key_version").on(table.organizationId, table.version), index("idx_org_key_active").on(table.organizationId, table.status),uniqueIndex("idx_org_key_one_active").on(table.organizationId).where(sql`${table.status}='active'`)],
);

/** Project- and resource-specific legal holds never block unrelated tenant data. */
export const organizationLegalHolds = sqliteTable(
  "organization_legal_holds",
  {
    holdId: text("hold_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    scopeKind: text("scope_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    releasedAt: text("released_at"),
  },
  (table) => [index("idx_org_legal_holds_scope").on(table.organizationId, table.status, table.scopeKind, table.resourceId)],
);

/** Organization erasure is resumable because D1 and R2 cannot share a transaction. */
export const organizationDeletionJobs = sqliteTable(
  "organization_deletion_jobs",
  {
    jobId: text("job_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    initiatedByUserId: text("initiated_by_user_id").notNull(),
    status: text("status").notNull().default("pending"),
    inventoryJson: text("inventory_json").notNull().default("{}"),
    receiptJson: text("receipt_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [index("idx_org_deletion_jobs_scope").on(table.organizationId, table.status)],
);

export const organizationDeletionItems = sqliteTable(
  "organization_deletion_items",
  {
    jobId: text("job_id").notNull(),
    organizationId: text("organization_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.resourceKind, table.resourceId] }), index("idx_org_deletion_items_status").on(table.jobId, table.status)],
);

/** Recovery payloads are AEAD-encrypted; no configured root means no recovery snapshot. */
export const organizationRecoverySnapshots = sqliteTable(
  "organization_recovery_snapshots",
  {
    snapshotId: text("snapshot_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    keyId: text("key_id").notNull(),
    manifestJson: text("manifest_json").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    contentSha256: text("content_sha256").notNull(),
    status: text("status").notNull().default("available"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_org_recovery_snapshots_scope").on(table.organizationId, table.createdAt)],
);

/** A measured local recovery drill is evidence, never a fabricated contractual RPO/RTO. */
export const organizationRecoveryDrills = sqliteTable(
  "organization_recovery_drills",
  {
    drillId: text("drill_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    status: text("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    restoredRecordCount: integer("restored_record_count").notNull().default(0),
    verifiedObjectCount: integer("verified_object_count").notNull().default(0),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_org_recovery_drills_scope").on(table.organizationId, table.createdAt)],
);

/** Transfer receipts disclose whether organization or project custody actually changed. */
export const organizationCustodyTransfers = sqliteTable(
  "organization_custody_transfers",
  {
    transferId: text("transfer_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectAccessId: text("project_access_id"),
    sourceUserId: text("source_user_id").notNull(),
    targetUserId: text("target_user_id").notNull(),
    status: text("status").notNull(),
    manifestJson: text("manifest_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [index("idx_org_custody_transfer_scope").on(table.organizationId, table.status)],
);

/** Idempotency receipts let retried Canvas actions resolve to their first durable event. */
export const eventClientReceipts = sqliteTable(
  "event_client_receipts",
  {
    streamId: text("stream_id").notNull(),
    clientEventId: text("client_event_id").notNull(),
    eventId: text("event_id").notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.streamId, table.clientEventId] }),
    index("idx_event_client_receipts_event").on(table.eventId),
  ],
);

/** Erasable natural-language content lives outside the immutable event log. */
export const externalContent = sqliteTable(
  "external_content",
  {
    contentId: text("content_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_external_content_owner").on(table.ownerId)],
);

export const users = sqliteTable(
  "users",
  {
    userId: text("user_id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("creator"),
    consentVersion: text("consent_version"),
    consentedAt: text("consented_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_users_email").on(table.email), index("idx_users_role").on(table.role)],
);

/** Organizations are durable ownership boundaries, never aliases for a global workspace. */
export const organizations = sqliteTable(
  "organizations",
  {
    organizationId: text("organization_id").primaryKey(),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_organizations_owner").on(table.ownerUserId)],
);

/** Membership and revocation are server-owned; an email is never itself an entitlement. */
export const organizationMemberships = sqliteTable(
  "organization_memberships",
  {
    membershipId: text("membership_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    invitedByUserId: text("invited_by_user_id").notNull(),
    acceptedAt: text("accepted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_organization_memberships_org_user").on(table.organizationId, table.userId),
    index("idx_organization_memberships_user_status").on(table.userId, table.status),
  ],
);

/** Identity-bound invitations work before an account exists and never store a raw token. */
export const organizationInvitations = sqliteTable(
  "organization_invitations",
  {
    invitationId: text("invitation_id").primaryKey(), organizationId: text("organization_id").notNull(),
    emailNormalized: text("email_normalized").notNull(), role: text("role").notNull(),
    invitedByUserId: text("invited_by_user_id").notNull(), tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"), expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
    acceptedAt: text("accepted_at"), revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_organization_invitations_token").on(table.tokenHash),
    index("idx_organization_invitations_email_status").on(table.emailNormalized, table.status, table.expiresAt),
    index("idx_organization_invitations_organization").on(table.organizationId, table.status, table.createdAt),
  ],
);

/** Customer-visible administration history contains only redacted, tenant-owned facts. */
export const organizationAuditEvents = sqliteTable(
  "organization_audit_events",
  {
    auditId: text("audit_id").primaryKey(), organizationId: text("organization_id").notNull(),
    actorUserId: text("actor_user_id").notNull(), action: text("action").notNull(),
    resourceKind: text("resource_kind").notNull(), resourceId: text("resource_id").notNull(),
    detailJson: text("detail_json").notNull().default("{}"), occurredAt: text("occurred_at").notNull(),
  },
  (table) => [index("idx_organization_audit_scope_time").on(table.organizationId, table.occurredAt)],
);

/** Project ownership is additive to existing account streams; no collaborator inherits an owner stream. */
export const organizationProjects = sqliteTable(
  "organization_projects",
  {
    projectAccessId: text("project_access_id").primaryKey(),
    projectId: text("project_id").notNull(),
    organizationId: text("organization_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_organization_projects_owner_project").on(table.ownerUserId, table.projectId),
    index("idx_organization_projects_organization").on(table.organizationId, table.status),
    index("idx_organization_projects_owner").on(table.ownerUserId),
  ],
);

/** Explicit project access never grants unrelated projects, account content, media, or streams. */
export const projectMemberships = sqliteTable(
  "project_memberships",
  {
    membershipId: text("membership_id").primaryKey(),
    projectAccessId: text("project_access_id").notNull(),
    projectId: text("project_id").notNull(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    grantedByUserId: text("granted_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_project_memberships_access_user").on(table.projectAccessId, table.userId),
    index("idx_project_memberships_user_status").on(table.userId, table.status),
  ],
);

/** Owner history is never exposed until every project resource has been safely attributed. */
export const projectMigrationStates = sqliteTable(
  "project_migration_states",
  {
    projectAccessId: text("project_access_id").primaryKey(), organizationId: text("organization_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(), status: text("status").notNull().default("pending"),
    lastOwnerSequence: integer("last_owner_sequence").notNull().default(0), updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_project_migration_organization_status").on(table.organizationId, table.status)],
);

/** Dense project sequences project immutable owner events without leaking another owner event. */
export const projectEventScopes = sqliteTable(
  "project_event_scopes",
  {
    eventId: text("event_id").primaryKey(), projectAccessId: text("project_access_id").notNull(),
    organizationId: text("organization_id").notNull(), projectId: text("project_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(), sourceStreamId: text("source_stream_id").notNull(),
    sourceSequence: integer("source_sequence").notNull(), projectSequence: integer("project_sequence").notNull(),
    actorUserId: text("actor_user_id").notNull(), createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_project_event_scopes_sequence").on(table.projectAccessId, table.projectSequence),
    index("idx_project_event_scopes_owner").on(table.ownerUserId, table.sourceSequence),
  ],
);

/** Exact media, document, block, job, and content ownership overrides personal-owner fallbacks. */
export const projectResourceScopes = sqliteTable(
  "project_resource_scopes",
  {
    projectAccessId: text("project_access_id").notNull(), resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(), organizationId: text("organization_id").notNull(),
    projectId: text("project_id").notNull(), ownerUserId: text("owner_user_id").notNull(),
    visibility: text("visibility").notNull().default("collaborative_output"), sourceEventId: text("source_event_id"),
    actorUserId: text("actor_user_id").notNull(), createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectAccessId, table.resourceKind, table.resourceId] }),
    index("idx_project_resource_scopes_resource").on(table.resourceKind, table.resourceId, table.ownerUserId),
    index("idx_project_resource_scopes_owner_kind_actor").on(table.ownerUserId,table.resourceKind,table.resourceId,table.actorUserId),
  ],
);

/** Project selection is an opaque, principal-bound, revocable server-owned capability. */
export const projectContextSessions = sqliteTable(
  "project_context_sessions",
  {
    contextId: text("context_id").primaryKey(), principalUserId: text("principal_user_id").notNull(),
    organizationId: text("organization_id").notNull(), projectAccessId: text("project_access_id").notNull(),
    createdAt: text("created_at").notNull(), expiresAt: text("expires_at").notNull(), revokedAt: text("revoked_at"),
  },
  (table) => [index("idx_project_context_principal_scope").on(table.principalUserId, table.organizationId, table.projectAccessId)],
);

/** Exact organization/project caps never overwrite existing personal or platform counters. */
export const budgetScopePolicies = sqliteTable(
  "budget_scope_policies",
  {
    scope: text("scope").notNull(), scopeId: text("scope_id").notNull(), organizationId: text("organization_id").notNull(),
    tokenLimit: integer("token_limit").notNull(), microusdLimit: integer("microusd_limit").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull(), updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.scopeId] }), index("idx_budget_scope_policies_organization").on(table.organizationId)],
);

/** Settlement and retries remain permanently bound to the original authorized tenant and actor. */
export const projectBudgetReservationScopes = sqliteTable(
  "project_budget_reservation_scopes",
  {
    reservationKind: text("reservation_kind").notNull(), reservationId: text("reservation_id").notNull(),
    organizationId: text("organization_id").notNull(), projectAccessId: text("project_access_id").notNull(),
    actorUserId: text("actor_user_id").notNull(), workspaceScopeId: text("workspace_scope_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.reservationKind, table.reservationId] }),
    index("idx_project_budget_scope_organization").on(table.organizationId, table.projectAccessId, table.createdAt),
  ],
);

/** Coarse fleet performance samples deliberately contain no user, tenant, project, or URL identifiers. */
export const routePerformanceSamples = sqliteTable(
  "route_performance_samples",
  {
    sampleId: text("sample_id").primaryKey(), audience: text("audience").notNull(),
    routeFamily: text("route_family").notNull(), routeSurface: text("route_surface").notNull(),
    cacheClass: text("cache_class").notNull(), routeLatencyMs: integer("route_latency_ms").notNull(),
    lcpMs: integer("lcp_ms"), inpMs: integer("inp_ms"), clsMicrounits: integer("cls_microunits"),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [index("idx_route_performance_surface_time").on(table.audience, table.routeFamily, table.recordedAt),index("idx_route_performance_recorded_at").on(table.recordedAt)],
);

/** Specialist privileges are explicit, revocable, optionally tenant/project scoped grants. */
export const capabilityGrants = sqliteTable(
  "capability_grants",
  {
    grantId: text("grant_id").primaryKey(),
    userId: text("user_id").notNull(),
    capability: text("capability").notNull(),
    scopeType: text("scope_type").notNull(),
    organizationId: text("organization_id"),
    projectAccessId: text("project_access_id"),
    projectId: text("project_id"),
    status: text("status").notNull().default("active"),
    grantedByUserId: text("granted_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("idx_capability_grants_user_status").on(table.userId, table.status, table.capability),
    index("idx_capability_grants_organization").on(table.organizationId, table.capability),
  ],
);

/** Internal delivery decisions are platform planning records, never creator documents or customer content. */
export const deliveryDecisions = sqliteTable(
  "delivery_decisions",
  {
    decisionId: text("decision_id").primaryKey(),
    title: text("title").notNull(),
    audience: text("audience").notNull(),
    status: text("status").notNull().default("planned"),
    ownerUserId: text("owner_user_id").notNull(),
    ownerDisplayName: text("owner_display_name").notNull(),
    evidence: text("evidence").notNull().default(""),
    dependencyIdsJson: text("dependency_ids_json").notNull().default("[]"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_delivery_decisions_status_updated").on(table.status, table.updatedAt),
    index("idx_delivery_decisions_owner").on(table.ownerUserId),
  ],
);

/** Private, erasable prompt and provider output content. Events only retain references. */
export const privateContent = sqliteTable(
  "private_content",
  {
    contentId: text("content_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    redactedAt: text("redacted_at"),
  },
  (table) => [
    index("idx_private_content_owner_expiry").on(table.ownerId, table.expiresAt),
    index("idx_private_content_pending_expiry").on(table.expiresAt).where(sql`${table.redactedAt} IS NULL AND ${table.kind}!='document-artifact'`),
  ],
);

/** Rebuildable operational projection used for race-safe hard-cap enforcement. */
export const budgetCounters = sqliteTable(
  "budget_counters",
  {
    scope: text("scope").notNull(),
    scopeId: text("scope_id").notNull(),
    period: text("period").notNull(),
    usedTokens: integer("used_tokens").notNull().default(0),
    reservedTokens: integer("reserved_tokens").notNull().default(0),
    hardLimitTokens: integer("hard_limit_tokens").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.scopeId, table.period] })],
);

/** Idempotent ownership ledger for each capacity reservation represented by BudgetReserved. */
export const budgetReservations = sqliteTable(
  "budget_reservations",
  {
    reservationId: text("reservation_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    streamId: text("stream_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    operation: text("operation").notNull(),
    period: text("period").notNull(),
    reservedTokens: integer("reserved_tokens").notNull(),
    usedTokens: integer("used_tokens").notNull().default(0),
    status: text("status").notNull(),
    settlementReason: text("settlement_reason"),
    createdAt: text("created_at").notNull(),
    settledAt: text("settled_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_budget_reservations_owner_status").on(table.ownerId, table.status, table.createdAt),
    index("idx_budget_reservations_correlation").on(table.correlationId),
  ],
);

/** Monthly USD-denominated projection for provider work whose modalities have different token prices. */
export const costBudgetCounters = sqliteTable(
  "cost_budget_counters",
  {
    scope: text("scope").notNull(), scopeId: text("scope_id").notNull(), period: text("period").notNull(),
    usedMicrousd: integer("used_microusd").notNull().default(0), reservedMicrousd: integer("reserved_microusd").notNull().default(0), hardLimitMicrousd: integer("hard_limit_microusd").notNull(), updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.scopeId, table.period] })],
);

/** Immutable-month, owner-scoped USD reservation ledger for every paid provider operation. */
export const costBudgetReservations = sqliteTable(
  "cost_budget_reservations",
  {
    reservationId: text("reservation_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id").notNull().default("forma"),
    streamId: text("stream_id").notNull().default(""),
    correlationId: text("correlation_id").notNull().default(""),
    operation: text("operation").notNull(),
    period: text("period").notNull(),
    reservedMicrousd: integer("reserved_microusd").notNull(),
    usedMicrousd: integer("used_microusd").notNull().default(0),
    status: text("status").notNull(),
    allowUserOverage: integer("allow_user_overage", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    settledAt: text("settled_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_cost_budget_reservations_owner_status_period").on(table.ownerId, table.status, table.period),
    index("idx_cost_budget_reservations_owner_correlation").on(table.ownerId, table.correlationId),
    index("idx_cost_budget_reservations_workspace_period_status").on(table.workspaceId, table.period, table.status),
  ],
);

export const consequentialExecutions = sqliteTable("consequential_executions", {
  executionId:text("execution_id").primaryKey(),actorUserId:text("actor_user_id").notNull(),streamId:text("stream_id").notNull(),projectId:text("project_id").notNull(),documentId:text("document_id").notNull(),
  organizationId:text("organization_id"),projectAccessId:text("project_access_id"),operation:text("operation").notNull(),intentHash:text("intent_hash").notNull(),bindingHash:text("binding_hash").notNull(),consentRef:text("consent_ref").notNull(),resultRef:text("result_ref"),
  status:text("status").notNull(),errorCode:text("error_code"),createdAt:text("created_at").notNull(),expiresAt:text("expires_at").notNull(),updatedAt:text("updated_at").notNull(),
},(table)=>[index("idx_consequential_executions_actor_scope").on(table.actorUserId,table.projectId,table.documentId,table.status,table.createdAt)]);
export const consequentialExecutionSteps = sqliteTable("consequential_execution_steps",{
  executionId:text("execution_id").notNull(),stepIndex:integer("step_index").notNull(),tokenReservationId:text("token_reservation_id").notNull(),costReservationId:text("cost_reservation_id").notNull(),
  maximumTokens:integer("maximum_tokens").notNull(),maximumMicrousd:integer("maximum_microusd").notNull(),status:text("status").notNull(),providerRequestId:text("provider_request_id"),verifiedTokens:integer("verified_tokens"),verifiedMicrousd:integer("verified_microusd"),updatedAt:text("updated_at").notNull(),
},(table)=>[primaryKey({columns:[table.executionId,table.stepIndex]})]);

export const authoringCommits=sqliteTable("authoring_commits",{
  previewId:text("preview_id").primaryKey(),actorUserId:text("actor_user_id").notNull(),operation:text("operation").notNull(),projectId:text("project_id").notNull(),documentId:text("document_id").notNull(),
  blockId:text("block_id").notNull(),canvasId:text("canvas_id"),
  organizationId:text("organization_id"),projectAccessId:text("project_access_id"),approvalHash:text("approval_hash").notNull(),resultJson:text("result_json").notNull(),lastEventId:text("last_event_id").notNull(),verified:integer("verified").notNull(),createdAt:text("created_at").notNull(),
},(table)=>[check("authoring_commit_verified",sql`${table.verified}=1`),index("idx_authoring_commits_actor_document").on(table.actorUserId,table.projectId,table.documentId)]);

export const shares = sqliteTable(
  "shares",
  {
    shareId: text("share_id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    ownerId: text("owner_id").notNull(),
    streamId: text("stream_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_shares_token_hash").on(table.tokenHash), index("idx_shares_owner").on(table.ownerId, table.createdAt)],
);

/** Selected-output public reads retain only operational replay/token tombstones after
 * metadata retirement. The canonical migration adds WITHOUT ROWID and immutable
 * transition triggers; Drizzle models columns, indexes, uniqueness and CHECKs. */
export const selectedOutputShares = sqliteTable("selected_output_shares", {
  shareId: text("share_id").primaryKey().notNull(),
  purpose: text("purpose").notNull(),
  replayKey: text("replay_key").notNull().unique(),
  ownerId: text("owner_id"),
  ownerEmail: text("owner_email"),
  intentKey: text("intent_key"),
  projectId: text("project_id"),
  jobId: text("job_id"),
  completionEventId: text("completion_event_id"),
  selectionJson: text("selection_json"),
  reviewTitle: text("review_title"),
  sourceExpiresAt: text("source_expires_at"),
  provenanceExpiresAt: text("provenance_expires_at"),
  expiresAt: text("expires_at"),
  candidateSha256: text("candidate_sha256"),
  issuerAuthoritySha256: text("issuer_authority_sha256"),
  createdAt: text("created_at"),
  tokenHash: text("token_hash").unique(),
  issuedAt: text("issued_at"),
  revokedAt: text("revoked_at"),
  minimizedAt: text("minimized_at"),
}, table => [
  unique("selected_output_shares_owner_intent_unique").on(table.ownerId, table.intentKey),
  index("selected_output_shares_owner").on(table.ownerId, table.createdAt),
  check("selected_output_share_purpose", sql.raw(`purpose='selected-output-read-v1'`)),
  check("selected_output_share_replay_key", sql.raw(`length(replay_key)=64 AND replay_key NOT GLOB '*[^0-9a-f]*'`)),
  check("selected_output_share_token_pair", sql.raw(`(token_hash IS NULL AND issued_at IS NULL) OR (token_hash IS NOT NULL AND issued_at IS NOT NULL
      AND length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*' AND length(issued_at)=24)`)),
  check("selected_output_share_revocation", sql.raw(`revoked_at IS NULL OR length(revoked_at)=24`)),
  check("selected_output_share_active_or_minimized", sql.raw(`(minimized_at IS NULL AND owner_id IS NOT NULL AND owner_email IS NOT NULL AND intent_key IS NOT NULL AND project_id IS NOT NULL AND job_id IS NOT NULL AND completion_event_id IS NOT NULL AND selection_json IS NOT NULL AND review_title IS NOT NULL AND source_expires_at IS NOT NULL AND provenance_expires_at IS NOT NULL AND expires_at IS NOT NULL AND candidate_sha256 IS NOT NULL AND issuer_authority_sha256 IS NOT NULL AND created_at IS NOT NULL
      AND json_valid(selection_json) AND length(CAST(selection_json AS BLOB)) BETWEEN 1 AND 1024
      AND length(CAST(review_title AS BLOB)) BETWEEN 1 AND 512
      AND length(candidate_sha256)=64 AND candidate_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(issuer_authority_sha256)=64 AND issuer_authority_sha256 NOT GLOB '*[^0-9a-f]*'
      AND length(created_at)=24 AND length(source_expires_at)=24 AND length(provenance_expires_at)=24 AND length(expires_at)=24
      AND created_at<expires_at AND expires_at<=source_expires_at AND expires_at<=provenance_expires_at
      AND (issued_at IS NULL OR (issued_at>=created_at AND issued_at<expires_at))
      AND (revoked_at IS NULL OR revoked_at>=created_at))
      OR (minimized_at IS NOT NULL AND length(minimized_at)=24 AND revoked_at IS NOT NULL AND revoked_at<=minimized_at
        AND (issued_at IS NULL OR issued_at<=minimized_at) AND owner_id IS NULL AND owner_email IS NULL AND intent_key IS NULL AND project_id IS NULL AND job_id IS NULL AND completion_event_id IS NULL AND selection_json IS NULL AND review_title IS NULL AND source_expires_at IS NULL AND provenance_expires_at IS NULL AND expires_at IS NULL AND candidate_sha256 IS NULL AND issuer_authority_sha256 IS NULL AND created_at IS NULL)`)),
]);

/** Immutable resource and exact-media authorization attached to a private share. */
export const shareScopes = sqliteTable(
  "share_scopes",
  {
    shareId: text("share_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    projectId: text("project_id").notNull(),
    mediaKeysJson: text("media_keys_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_share_scopes_owner_resource").on(table.ownerId, table.resourceKind, table.resourceId)],
);

/** Short-lived, one-use proof that a human admin explicitly accepted a paid replay run. */
export const replayApprovals = sqliteTable(
  "replay_approvals",
  {
    approvalId: text("approval_id").primaryKey(), ownerId: text("owner_id").notNull(), confirmationVersion: text("confirmation_version").notNull(),
    seed: text("seed").notNull(), requestedAt: text("requested_at").notNull(), expiresAt: text("expires_at").notNull(), consumedAt: text("consumed_at"),
  },
  (table) => [index("idx_replay_approvals_owner_expiry").on(table.ownerId, table.expiresAt)],
);

/** Amount-bounded cost authorization attached to a one-use replay approval. */
export const replayCostAuthorizations = sqliteTable(
  "replay_cost_authorizations",
  {
    approvalId: text("approval_id").primaryKey(), ownerId: text("owner_id").notNull(), pricingVersion: text("pricing_version").notNull(),
    estimatedMicrousd: integer("estimated_microusd").notNull(), reservedMicrousd: integer("reserved_microusd").notNull(), maximumMicrousd: integer("maximum_microusd").notNull(), allowUserOverage: integer("allow_user_overage", { mode: "boolean" }).notNull().default(false), createdAt: text("created_at").notNull(),
  },
);

/** Paid provider-backed mocks are durable fixtures so their events and images can be replayed without paying again. */
export const replaySessions = sqliteTable(
  "replay_sessions",
  {
    sessionId: text("session_id").primaryKey(), ownerId: text("owner_id").notNull(), status: text("status").notNull(), title: text("title").notNull(), summary: text("summary").notNull(), seed: text("seed").notNull(),
    eventCount: integer("event_count").notNull().default(0), imageCount: integer("image_count").notNull().default(0), previewMediaUrl: text("preview_media_url"), finalMediaUrl: text("final_media_url"),
    eventsJson: text("events_json"), planJson: text("plan_json"), usageJson: text("usage_json"), plannerModel: text("planner_model"), imageModel: text("image_model"), errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(), completedAt: text("completed_at"),
  },
  (table) => [index("idx_replay_sessions_owner_created").on(table.ownerId, table.createdAt)],
);

/** Durable, mutable execution records for document work that must outlive a browser request. */
export const documentJobs = sqliteTable(
  "document_jobs",
  {
    jobId: text("job_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    streamId: text("stream_id").notNull(),
    documentId: text("document_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    sourceSurface: text("source_surface").notNull(),
    correlationId: text("correlation_id").notNull(),
    requestedSequence: integer("requested_sequence").notNull(),
    requestJson: text("request_json").notNull(),
    resultJson: text("result_json"),
    sceneSourceVersionJson: text("scene_source_version_json"),
    sceneSourceProtocol: integer("scene_source_protocol").notNull().default(0),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
    requestedAt: text("requested_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    leaseExpiresAt: text("lease_expires_at"),
    notifiedAt: text("notified_at"),
    expiresAt: text("expires_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_document_jobs_owner_status").on(table.ownerId, table.status, table.requestedAt),
    index("idx_document_jobs_stream_document").on(table.streamId, table.documentId, table.requestedAt),
    index("idx_document_jobs_stream_status_requested").on(table.streamId,table.status,table.requestedAt,table.jobId),
    index("idx_document_jobs_stream_correlation").on(table.streamId,table.correlationId,table.jobId,table.ownerId),
    check("ck_document_jobs_scene_source_protocol",sql`${table.sceneSourceProtocol} IN (0,1)`),
  ],
);

/** Existing runtime assistant tables, declared without adopting legacy turns as consent. */
export const assistantTurns = sqliteTable("assistant_turns", {
  turnId:text("turn_id").notNull(), actorUserId:text("actor_user_id").notNull(), scopeKey:text("scope_key").notNull(),
  organizationId:text("organization_id"), projectAccessId:text("project_access_id"), projectId:text("project_id"), documentId:text("document_id"),
  routeFamily:text("route_family").notNull(), userContentRef:text("user_content_ref").notNull(), assistantContentRef:text("assistant_content_ref").notNull(),
  proposalJson:text("proposal_json"), requestJson:text("request_json"), permissionEpoch:text("permission_epoch").notNull(), status:text("status").notNull(),
  createdAt:text("created_at").notNull(), completedAt:text("completed_at").notNull(),
}, table => [primaryKey({columns:[table.actorUserId,table.scopeKey,table.turnId]}),index("idx_assistant_turns_actor_scope").on(table.actorUserId,table.scopeKey,table.createdAt)]);

export const assistantActionProposals = sqliteTable("assistant_action_proposals", {
  proposalId:text("proposal_id").primaryKey().notNull(), actorUserId:text("actor_user_id").notNull(), scopeKey:text("scope_key").notNull(), turnId:text("turn_id").notNull(),
  organizationId:text("organization_id"), projectAccessId:text("project_access_id"), projectId:text("project_id").notNull(), documentId:text("document_id").notNull(),
  actionKind:text("action_kind").notNull(), actionContentRef:text("action_content_ref").notNull(), sourceVersionsJson:text("source_versions_json").notNull(),
  expectedHead:integer("expected_head").notNull(), permissionEpoch:text("permission_epoch").notNull(), status:text("status").notNull(),
  createdAt:text("created_at").notNull(), expiresAt:text("expires_at").notNull(), resolvedAt:text("resolved_at"),
}, table => [index("idx_assistant_proposals_actor_scope").on(table.actorUserId,table.scopeKey,table.status,table.createdAt)]);

export const assistantActionCommits = sqliteTable("assistant_action_commits", {
  commitId:text("commit_id").primaryKey().notNull(), verified:integer("verified").notNull(), createdAt:text("created_at").notNull(),
}, table => [check("assistant_action_commits_verified",sql`${table.verified}=1`)]);

export const assistantSpecialistTasks = sqliteTable("assistant_specialist_tasks", {
  taskId:text("task_id").primaryKey().notNull(), actorUserId:text("actor_user_id").notNull(), scopeKey:text("scope_key").notNull(), turnId:text("turn_id").notNull(),
  organizationId:text("organization_id"), projectAccessId:text("project_access_id"), projectId:text("project_id"), documentId:text("document_id"),
  routeFamily:text("route_family").notNull(), taskKind:text("task_kind").notNull(), selectedModel:text("selected_model").notNull(),
  tokenReservationId:text("token_reservation_id").notNull(), costReservationId:text("cost_reservation_id").notNull(), estimatedMicrousd:integer("estimated_microusd").notNull(),
  maximumInputTokens:integer("maximum_input_tokens").notNull(), maximumOutputTokens:integer("maximum_output_tokens").notNull(), locale:text("locale").notNull(),
  permissionEpoch:text("permission_epoch").notNull(), status:text("status").notNull(), errorCode:text("error_code"),
  createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull(), startedAt:text("started_at"), completedAt:text("completed_at"),
  leaseExpiresAt:text("lease_expires_at"), providerSubmitted:integer("provider_submitted").notNull().default(0), resultJson:text("result_json"),
}, table => [unique().on(table.actorUserId,table.scopeKey,table.turnId,table.taskKind),index("idx_assistant_tasks_actor_scope").on(table.actorUserId,table.scopeKey,table.status,table.createdAt),uniqueIndex("idx_assistant_single_consented_turn").on(table.actorUserId,table.scopeKey,table.turnId).where(sql`${table.resultJson} IS NOT NULL`)]);

/** Immutable audit rows: migration triggers also prohibit update and deletion. */
export const assistantBillingReconciliations = sqliteTable("assistant_billing_reconciliations", {
  reconciliationId:text("reconciliation_id").primaryKey().notNull(), taskId:text("task_id").notNull(), actorUserId:text("actor_user_id").notNull(), reviewerUserId:text("reviewer_user_id").notNull(),
  organizationId:text("organization_id"), projectAccessId:text("project_access_id"), evidenceClassification:text("evidence_classification").notNull(), occurredAt:text("occurred_at").notNull(),
}, table => [unique().on(table.taskId,table.reviewerUserId),check("assistant_billing_reconciliations_evidence",sql`${table.evidenceClassification}='verified-no-provider-charge'`),index("idx_assistant_billing_reconciliations_actor_scope").on(table.actorUserId,table.organizationId,table.projectAccessId,table.occurredAt)]);

/** Server-owned release projection; every mutation also appends an immutable governance receipt. */
export const canvasGovernanceRequirements = sqliteTable(
  "canvas_governance_requirements",
  {
    requirementId: text("requirement_id").primaryKey(),
    status: text("status").notNull(),
    approvedByUserId: text("approved_by_user_id"),
    approvedByName: text("approved_by_name"),
    approvedAt: text("approved_at"),
    evidenceRef: text("evidence_ref"),
    detailsJson: text("details_json").notNull().default("{}"),
    updatedAt: text("updated_at").notNull(),
  },
);

/** Output requirements: private event bodies plus scoped projections and durable admission authority. */

export const outputAtomicAssertions = sqliteTable(
  "output_atomic_assertions",
  {
    token: text("token").primaryKey().notNull(),
    passed: integer("passed").notNull(),
  },
  () => [
    check("output_atomic_assertions_check_1", sql.raw("passed=1")),
  ],
);

export const outputCommands = sqliteTable(
  "output_commands",
  {
    scopeKey: text("scope_key").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    commandKey: text("command_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    action: text("action").notNull(),
    eventId: text("event_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.actorUserId, table.commandKey] }),
    foreignKey({ columns: [table.eventId], foreignColumns: [events.eventId] }),
  ],
);

export const outputPlanRevisions = sqliteTable(
  "output_plan_revisions",
  {
    scopeKey: text("scope_key").notNull(),
    scopeKind: text("scope_kind").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    organizationId: text("organization_id"),
    projectAccessId: text("project_access_id"),
    planRevisionId: text("plan_revision_id").notNull(),
    planId: text("plan_id").notNull(),
    revision: integer("revision").notNull(),
    confirmedEventId: text("confirmed_event_id").notNull(),
    requirementsDigest: text("requirements_digest").notNull(),
    sourceDigest: text("source_digest").notNull(),
    resolverVersion: text("resolver_version").notNull(),
    sourceHead: integer("source_head").notNull(),
    targetCount: integer("target_count").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.planRevisionId] }),
    foreignKey({ columns: [table.confirmedEventId], foreignColumns: [events.eventId] }),
    check("output_plan_revisions_check_1", sql.raw("scope_kind IN('personal','project')")),
    check("output_plan_revisions_check_2", sql.raw("typeof(revision)='integer' AND revision>0")),
    check("output_plan_revisions_check_3", sql.raw("typeof(source_head)='integer' AND source_head>=0")),
    check("output_plan_revisions_check_4", sql.raw("typeof(target_count)='integer' AND target_count>=0 AND target_count<=1000")),
    check("output_plan_revisions_check_5", sql.raw("(scope_kind='personal' AND organization_id IS NULL AND project_access_id IS NULL) OR (scope_kind='project' AND organization_id IS NOT NULL AND project_access_id IS NOT NULL)")),
    index("idx_output_plans_document").on(table.scopeKey, table.documentId, sql`${table.revision} DESC`),
    uniqueIndex("idx_output_plan_revisions_unique_1").on(table.scopeKey, table.planId, table.revision),
  ],
);

export const outputPlanTargets = sqliteTable(
  "output_plan_targets",
  {
    scopeKey: text("scope_key").notNull(),
    planRevisionId: text("plan_revision_id").notNull(),
    targetId: text("target_id").notNull(),
    targetContractDigest: text("target_contract_digest").notNull(),
    mediaKind: text("media_kind").notNull(),
    required: integer("required").notNull(),
    selected: integer("selected").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.planRevisionId, table.targetId] }),
    foreignKey({ columns: [table.scopeKey, table.planRevisionId], foreignColumns: [outputPlanRevisions.scopeKey, outputPlanRevisions.planRevisionId] }),
    check("output_plan_targets_check_1", sql.raw("media_kind IN('image','slides','audio','video','document','model3d','unknown')")),
    check("output_plan_targets_check_2", sql.raw("required IN(0,1)")),
    check("output_plan_targets_check_3", sql.raw("selected IN(0,1)")),
    check("output_plan_targets_check_4", sql.raw("typeof(ordinal)='integer' AND ordinal>=0")),
  ],
);

export const outputPreflights = sqliteTable(
  "output_preflights",
  {
    scopeKey: text("scope_key").notNull(),
    preflightId: text("preflight_id").notNull(),
    planRevisionId: text("plan_revision_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    termsDigest: text("terms_digest").notNull(),
    eventId: text("event_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.preflightId] }),
    foreignKey({ columns: [table.scopeKey, table.planRevisionId], foreignColumns: [outputPlanRevisions.scopeKey, outputPlanRevisions.planRevisionId] }),
    foreignKey({ columns: [table.eventId], foreignColumns: [events.eventId] }),
  ],
);

export const outputExecutionGrants = sqliteTable(
  "output_execution_grants",
  {
    scopeKey: text("scope_key").notNull(),
    grantId: text("grant_id").notNull(),
    planRevisionId: text("plan_revision_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    payerUserId: text("payer_user_id").notNull(),
    contextId: text("context_id"),
    preflightId: text("preflight_id").notNull(),
    authorizationEventId: text("authorization_event_id").notNull(),
    maximumMicrousd: integer("maximum_microusd").notNull(),
    maximumCalls: integer("maximum_calls").notNull(),
    status: text("status").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.grantId] }),
    foreignKey({ columns: [table.scopeKey, table.planRevisionId], foreignColumns: [outputPlanRevisions.scopeKey, outputPlanRevisions.planRevisionId] }),
    foreignKey({ columns: [table.scopeKey, table.preflightId], foreignColumns: [outputPreflights.scopeKey, outputPreflights.preflightId] }),
    foreignKey({ columns: [table.authorizationEventId], foreignColumns: [events.eventId] }),
    check("output_execution_grants_check_1", sql.raw("typeof(maximum_microusd)='integer' AND maximum_microusd>0 AND maximum_microusd<=1000000000000")),
    check("output_execution_grants_check_2", sql.raw("typeof(maximum_calls)='integer' AND maximum_calls>0 AND maximum_calls<=10000")),
    check("output_execution_grants_check_3", sql.raw("status IN('authorized','active','completed','revoked','exceeded')")),
    uniqueIndex("idx_output_execution_grants_unique_1").on(table.scopeKey, table.preflightId),
  ],
);

export const outputOperationSlots = sqliteTable(
  "output_operation_slots",
  {
    scopeKey: text("scope_key").notNull(),
    slotId: text("slot_id").notNull(),
    grantId: text("grant_id").notNull(),
    planRevisionId: text("plan_revision_id").notNull(),
    targetId: text("target_id").notNull(),
    targetContractDigest: text("target_contract_digest").notNull(),
    sourceDigest: text("source_digest").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    routeDigest: text("route_digest").notNull(),
    jobId: text("job_id").notNull(),
    costReservationId: text("cost_reservation_id").notNull(),
    tokenReservationId: text("token_reservation_id").notNull(),
    maximumMicrousd: integer("maximum_microusd").notNull(),
    maximumCalls: integer("maximum_calls").notNull(),
    maximumTokens: integer("maximum_tokens").notNull(),
    attemptOrdinal: integer("attempt_ordinal").notNull().default(0),
    previousSlotId: text("previous_slot_id"),
    status: text("status").notNull(),
    outcomeEventId: text("outcome_event_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.slotId] }),
    foreignKey({ columns: [table.scopeKey, table.grantId], foreignColumns: [outputExecutionGrants.scopeKey, outputExecutionGrants.grantId] }),
    foreignKey({ columns: [table.scopeKey, table.previousSlotId], foreignColumns: [table.scopeKey, table.slotId] }),
    foreignKey({ columns: [table.scopeKey, table.planRevisionId, table.targetId], foreignColumns: [outputPlanTargets.scopeKey, outputPlanTargets.planRevisionId, outputPlanTargets.targetId] }),
    check("output_operation_slots_check_1", sql.raw("typeof(maximum_microusd)='integer' AND maximum_microusd>0 AND maximum_microusd<=1000000000000")),
    check("output_operation_slots_check_2", sql.raw("typeof(maximum_calls)='integer' AND maximum_calls>0 AND maximum_calls<=1000")),
    check("output_operation_slots_check_3", sql.raw("typeof(maximum_tokens)='integer' AND maximum_tokens>0")),
    check("output_operation_slots_check_4", sql.raw("typeof(attempt_ordinal)='integer' AND attempt_ordinal>=0")),
    check("output_operation_slots_check_5", sql.raw("status IN('authorized','queued','running','succeeded','failed','cancelled','unavailable','uncertain')")),
    check("output_operation_slots_check_6", sql.raw("(attempt_ordinal=0 AND previous_slot_id IS NULL) OR (attempt_ordinal>0 AND previous_slot_id IS NOT NULL)")),
    uniqueIndex("idx_output_operation_slots_unique_1").on(table.scopeKey, table.grantId, table.targetId),
    uniqueIndex("idx_output_operation_slots_unique_2").on(table.scopeKey, table.targetId, table.targetContractDigest, table.attemptOrdinal),
    uniqueIndex("idx_output_operation_slots_unique_3").on(table.jobId),
    uniqueIndex("idx_output_operation_slots_unique_4").on(table.costReservationId),
    uniqueIndex("idx_output_operation_slots_unique_5").on(table.tokenReservationId),
  ],
);

export const outputOperationRoutes = sqliteTable(
  "output_operation_routes",
  {
    scopeKey: text("scope_key").notNull(),
    slotId: text("slot_id").notNull(),
    stageKey: text("stage_key").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    maximumCalls: integer("maximum_calls").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.slotId, table.stageKey] }),
    foreignKey({ columns: [table.scopeKey, table.slotId], foreignColumns: [outputOperationSlots.scopeKey, outputOperationSlots.slotId] }),
    check("output_operation_routes_check_1", sql.raw("typeof(maximum_calls)='integer' AND maximum_calls>0 AND maximum_calls<=1000")),
  ],
);

export const outputProviderCalls = sqliteTable(
  "output_provider_calls",
  {
    scopeKey: text("scope_key").notNull(),
    slotId: text("slot_id").notNull(),
    callKey: text("call_key").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    requestDigest: text("request_digest").notNull(),
    stageKey: text("stage_key").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    reservedMicrousd: integer("reserved_microusd").notNull(),
    usedMicrousd: integer("used_microusd"),
    status: text("status").notNull(),
    providerResponseId: text("provider_response_id"),
    createdAt: text("created_at").notNull(),
    settledAt: text("settled_at"),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.slotId, table.callKey] }),
    foreignKey({ columns: [table.scopeKey, table.slotId, table.stageKey], foreignColumns: [outputOperationRoutes.scopeKey, outputOperationRoutes.slotId, outputOperationRoutes.stageKey] }),
    check("output_provider_calls_check_1", sql.raw("typeof(reserved_microusd)='integer' AND reserved_microusd>0")),
    check("output_provider_calls_check_2", sql.raw("used_microusd IS NULL OR typeof(used_microusd)='integer' AND used_microusd>=0")),
    check("output_provider_calls_check_3", sql.raw("status IN('pending','uncertain','settled','rejected')")),
    uniqueIndex("idx_output_provider_calls_unique_1").on(table.clientRequestId),
  ],
);

export const outputAssets = sqliteTable(
  "output_assets",
  {
    scopeKey: text("scope_key").notNull(),
    assetId: text("asset_id").notNull(),
    documentId: text("document_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    sourceDigest: text("source_digest").notNull(),
    storageKey: text("storage_key").notNull(),
    contentSha256: text("content_sha256").notNull(),
    byteLength: integer("byte_length").notNull(),
    mimeType: text("mime_type").notNull(),
    mediaKind: text("media_kind").notNull(),
    createdEventId: text("created_event_id").notNull(),
    createdAt: text("created_at").notNull(),
    redactedAt: text("redacted_at"),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.assetId] }),
    foreignKey({ columns: [table.createdEventId], foreignColumns: [events.eventId] }),
    check("output_assets_check_1", sql.raw("typeof(byte_length)='integer' AND byte_length>0")),
    check("output_assets_check_2", sql.raw("media_kind IN('image','slides','audio','video','document','model3d')")),
    uniqueIndex("idx_output_assets_unique_1").on(table.storageKey),
  ],
);

export const outputNativeStorageWrites = sqliteTable(
  "output_native_storage_writes",
  {
    scopeKey: text("scope_key").notNull(),
    slotId: text("slot_id").notNull(),
    storageKey: text("storage_key").notNull(),
    contentSha256: text("content_sha256").notNull(),
    status: text("status").notNull(),
    writeAcknowledged: integer("write_acknowledged").notNull().default(0),
    publicationEventId: text("publication_event_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.slotId, table.storageKey] }),
    foreignKey({ columns: [table.scopeKey, table.slotId], foreignColumns: [outputOperationSlots.scopeKey, outputOperationSlots.slotId] }),
    foreignKey({ columns: [table.publicationEventId], foreignColumns: [events.eventId] }),
    check("output_native_storage_writes_check_1", sql.raw("status IN('writing','written','cleanup_pending','deleted')")),
    check("output_native_storage_writes_check_2", sql.raw("write_acknowledged IN(0,1)")),
    uniqueIndex("idx_output_native_storage_writes_unique_1").on(table.storageKey),
  ],
);

export const outputAssetStorageWrites = sqliteTable(
  "output_asset_storage_writes",
  {
    scopeKey: text("scope_key").notNull(),
    assetId: text("asset_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    organizationId: text("organization_id"),
    projectAccessId: text("project_access_id"),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    contextId: text("context_id"),
    commandKey: text("command_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    sourceDigest: text("source_digest").notNull(),
    storageKey: text("storage_key").notNull(),
    contentSha256: text("content_sha256").notNull(),
    byteLength: integer("byte_length").notNull(),
    status: text("status").notNull(),
    writeAcknowledged: integer("write_acknowledged").notNull().default(0),
    publicationEventId: text("publication_event_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.assetId] }),
    foreignKey({ columns: [table.publicationEventId], foreignColumns: [events.eventId] }),
    check("output_asset_storage_writes_check_1", sql.raw("typeof(byte_length)='integer' AND byte_length>0 AND byte_length<=67108864")),
    check("output_asset_storage_writes_check_2", sql.raw("status IN('writing','written','cleanup_pending','deleted')")),
    check("output_asset_storage_writes_check_3", sql.raw("write_acknowledged IN(0,1)")),
    check("output_asset_storage_writes_check_4", sql.raw("(organization_id IS NULL AND project_access_id IS NULL AND context_id IS NULL) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND context_id IS NOT NULL)")),
    uniqueIndex("idx_output_asset_storage_writes_unique_1").on(table.scopeKey, table.actorUserId, table.commandKey),
    uniqueIndex("idx_output_asset_storage_writes_unique_2").on(table.storageKey),
  ],
);

export const outputResults = sqliteTable(
  "output_results",
  {
    scopeKey: text("scope_key").notNull(),
    resultId: text("result_id").notNull(),
    documentId: text("document_id").notNull(),
    planRevisionId: text("plan_revision_id").notNull(),
    targetId: text("target_id").notNull(),
    targetContractDigest: text("target_contract_digest").notNull(),
    sourceDigest: text("source_digest").notNull(),
    assetId: text("asset_id").notNull(),
    resultRevision: text("result_revision").notNull(),
    contentSha256: text("content_sha256").notNull(),
    validationPolicy: text("validation_policy").notNull(),
    checksStatus: text("checks_status").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    boundEventId: text("bound_event_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.resultId] }),
    foreignKey({ columns: [table.scopeKey, table.assetId], foreignColumns: [outputAssets.scopeKey, outputAssets.assetId] }),
    foreignKey({ columns: [table.scopeKey, table.planRevisionId, table.targetId], foreignColumns: [outputPlanTargets.scopeKey, outputPlanTargets.planRevisionId, outputPlanTargets.targetId] }),
    foreignKey({ columns: [table.boundEventId], foreignColumns: [events.eventId] }),
    check("output_results_check_1", sql.raw("checks_status IN('passed','failed','unavailable')")),
  ],
);

export const outputTargetAcceptances = sqliteTable(
  "output_target_acceptances",
  {
    scopeKey: text("scope_key").notNull(),
    acceptanceId: text("acceptance_id").notNull(),
    targetId: text("target_id").notNull(),
    targetContractDigest: text("target_contract_digest").notNull(),
    resultId: text("result_id").notNull(),
    resultRevision: text("result_revision").notNull(),
    contentSha256: text("content_sha256").notNull(),
    sourceDigest: text("source_digest").notNull(),
    validationPolicy: text("validation_policy").notNull(),
    reviewerUserId: text("reviewer_user_id").notNull(),
    approvalEventId: text("approval_event_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.acceptanceId] }),
    foreignKey({ columns: [table.scopeKey, table.resultId], foreignColumns: [outputResults.scopeKey, outputResults.resultId] }),
    foreignKey({ columns: [table.approvalEventId], foreignColumns: [events.eventId] }),
  ],
);

export const outputPlanFulfillments = sqliteTable(
  "output_plan_fulfillments",
  {
    scopeKey: text("scope_key").notNull(),
    planRevisionId: text("plan_revision_id").notNull(),
    targetId: text("target_id").notNull(),
    acceptanceId: text("acceptance_id").notNull(),
    eligibilityEventId: text("eligibility_event_id").notNull(),
    checkedAt: text("checked_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.planRevisionId, table.targetId] }),
    foreignKey({ columns: [table.scopeKey, table.planRevisionId, table.targetId], foreignColumns: [outputPlanTargets.scopeKey, outputPlanTargets.planRevisionId, outputPlanTargets.targetId] }),
    foreignKey({ columns: [table.scopeKey, table.acceptanceId], foreignColumns: [outputTargetAcceptances.scopeKey, outputTargetAcceptances.acceptanceId] }),
    foreignKey({ columns: [table.eligibilityEventId], foreignColumns: [events.eventId] }),
  ],
);

export const outputDeliveryManifests = sqliteTable(
  "output_delivery_manifests",
  {
    scopeKey: text("scope_key").notNull(),
    manifestId: text("manifest_id").notNull(),
    documentId: text("document_id").notNull(),
    planRevisionId: text("plan_revision_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    eventId: text("event_id").notNull(),
    isPartial: integer("is_partial").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKey, table.manifestId] }),
    foreignKey({ columns: [table.scopeKey, table.planRevisionId], foreignColumns: [outputPlanRevisions.scopeKey, outputPlanRevisions.planRevisionId] }),
    foreignKey({ columns: [table.eventId], foreignColumns: [events.eventId] }),
    check("output_delivery_manifests_check_1", sql.raw("is_partial IN(0,1)")),
  ],
);


export const memoryLiveEnrollments = sqliteTable(
  "memory_live_enrollments",
  {
    enrollmentId: text("enrollment_id").primaryKey().notNull(),
    actorUserId: text("actor_user_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    organizationId: text("organization_id"),
    projectAccessId: text("project_access_id"),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    permissionEpoch: text("permission_epoch").notNull(),
    policyVersion: text("policy_version").notNull(),
    revision: integer("revision").notNull(),
    learnEnabled: integer("learn_enabled").notNull(),
    recallEnabled: integer("recall_enabled").notNull(),
    backgroundEnabled: integer("background_enabled").notNull(),
    retentionDays: integer("retention_days").notNull(),
    timeZone: text("time_zone").notNull(),
    enrolledAt: text("enrolled_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    cursorSequence: integer("cursor_sequence").notNull(),
    cutoffSequence: integer("cutoff_sequence"),
    lastLocalDay: text("last_local_day"),
    lastAdmittedAt: text("last_admitted_at"),
    nextDueAt: text("next_due_at").notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    attempts: integer("attempts").default(0).notNull(),
    failureCode: text("failure_code"),
  },
  (table) => [
    check("memory_live_revision", sql.raw(`"memory_live_enrollments"."revision">0`)),
    check("memory_live_flags", sql.raw(`"memory_live_enrollments"."learn_enabled" IN(0,1) AND "memory_live_enrollments"."recall_enabled" IN(0,1) AND "memory_live_enrollments"."background_enabled" IN(0,1)`)),
    check("memory_live_retention", sql.raw(`"memory_live_enrollments"."retention_days" BETWEEN 1 AND 365`)),
    index("idx_memory_live_actor").on(table.actorUserId, table.enrollmentId),
    index("idx_memory_live_due").on(table.nextDueAt, table.enrollmentId),
    index("idx_memory_live_organization").on(table.organizationId),
  ],
);

export const memoryLiveRuns = sqliteTable(
  "memory_live_runs",
  {
    runId: text("run_id").primaryKey().notNull(),
    triggerKind: text("trigger_kind").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    scopes: integer("scopes").default(0).notNull(),
    processed: integer("processed").default(0).notNull(),
    erased: integer("erased").default(0).notNull(),
    failed: integer("failed").default(0).notNull(),
  },
  (table) => [index("idx_memory_live_runs_started").on(table.startedAt)],
);

export const memoryLiveSources = sqliteTable(
  "memory_live_sources",
  {
    enrollmentId: text("enrollment_id").notNull(),
    eventId: text("event_id").notNull(),
    sequence: integer("sequence").notNull(),
    expiresAt: text("expires_at").notNull(),
    conversationSegmented: integer("conversation_segmented").default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.enrollmentId, table.eventId] }),
    foreignKey({ columns: [table.enrollmentId], foreignColumns: [memoryLiveEnrollments.enrollmentId] }).onUpdate("no action").onDelete("no action"),
    index("idx_memory_live_source_page").on(table.enrollmentId, table.sequence),
    index("idx_memory_live_expiry").on(table.expiresAt),
  ],
);

// Body-free processing metadata only. This is neither retained source evidence
// nor permission to hydrate content, invoke a provider, or publish an inference.
export const memoryLiveChangeCheckpoints = sqliteTable(
  "memory_live_change_checkpoints",
  {
    enrollmentId: text("enrollment_id").primaryKey().notNull().references(() => memoryLiveEnrollments.enrollmentId, { onDelete: "cascade" }),
    enrollmentRevision: integer("enrollment_revision").notNull(),
    generation: text("generation").notNull(),
    afterSequence: integer("after_sequence").notNull(),
    throughSequence: integer("through_sequence").notNull(),
    observedReferences: integer("observed_references").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("idx_memory_live_checkpoint_expiry").on(table.expiresAt, table.enrollmentId),
    check("memory_live_checkpoint_bounds", sql.raw("typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND typeof(after_sequence)='integer' AND after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(through_sequence)='integer' AND through_sequence BETWEEN 1 AND 9007199254740991 AND through_sequence>after_sequence AND typeof(observed_references)='integer' AND observed_references BETWEEN 1 AND 9007199254740991")),
    check("memory_live_checkpoint_generation", sql.raw("length(generation)=32 AND generation NOT GLOB '*[^0-9a-f]*'")),
    check("memory_live_checkpoint_time", sql.raw("length(created_at)=24 AND length(updated_at)=24 AND length(expires_at)=24 AND created_at<=updated_at AND updated_at<expires_at")),
  ],
);

// Operator-reviewed qualification and purpose-specific consent are independent
// from enrollment. These tables contain no source text, inference or vectors.
export const memoryDerivationQualifications = sqliteTable("memory_derivation_qualifications", {
  qualificationId: text("qualification_id").primaryKey().notNull(),
  sourceSha256: text("source_sha256").notNull(),
  origin: text("origin").notNull(),
  deploymentId: text("deployment_id").notNull(),
  termsJson: text("terms_json").notNull(),
  termsSha256: text("terms_sha256").notNull(),
  status: text("status").notNull(),
  qualifiedAt: text("qualified_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, table => [
  index("idx_memory_derivation_qualification_current").on(table.sourceSha256, table.status, table.expiresAt),
  check("memory_derivation_qualification_hash", sql.raw("length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*' AND length(terms_sha256)=64 AND terms_sha256 NOT GLOB '*[^0-9a-f]*'")),
  check("memory_derivation_qualification_terms", sql.raw("json_valid(terms_json) AND json_type(terms_json)='object' AND length(CAST(terms_json AS BLOB)) BETWEEN 1 AND 8192")),
  check("memory_derivation_qualification_state", sql.raw("status IN('qualified','withdrawn') AND length(qualified_at)=24 AND length(expires_at)=24 AND qualified_at<expires_at")),
]);

export const memoryDerivationGrants = sqliteTable("memory_derivation_grants", {
  consentId: text("consent_id").notNull(),
  grantId: text("grant_id").notNull(),
  revision: integer("revision").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  organizationId: text("organization_id"),
  projectAccessId: text("project_access_id"),
  projectId: text("project_id").notNull(),
  documentId: text("document_id").notNull(),
  enrollmentId: text("enrollment_id").notNull().references(() => memoryLiveEnrollments.enrollmentId, { onDelete: "cascade" }),
  enrollmentRevision: integer("enrollment_revision").notNull(),
  permissionEpoch: text("permission_epoch").notNull(),
  policyVersion: text("policy_version").notNull(),
  purpose: text("purpose").notNull(),
  qualificationId: text("qualification_id").notNull().references(() => memoryDerivationQualifications.qualificationId),
  termsSha256: text("terms_sha256").notNull(),
  payerUserId: text("payer_user_id").notNull(),
  monthlyCapMicroUsd: integer("monthly_cap_microusd").notNull(),
  sourceAfterSequence: integer("source_after_sequence").notNull(),
  retentionDays: integer("retention_days").notNull(),
  backgroundEnabled: integer("background_enabled").notNull(),
  consentedAt: text("consented_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
}, table => [
  primaryKey({ columns: [table.grantId, table.revision] }),
  uniqueIndex("idx_memory_derivation_grant_active").on(table.grantId).where(sql.raw("revoked_at IS NULL")),
  index("idx_memory_derivation_grant_actor").on(table.actorUserId, table.expiresAt),
  index("idx_memory_derivation_grant_parent").on(table.enrollmentId, table.enrollmentRevision),
  index("idx_memory_derivation_grant_organization").on(table.organizationId, table.actorUserId),
  check("memory_derivation_grant_scope", sql.raw("length(actor_user_id)>0 AND length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND payer_user_id=actor_user_id AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))")),
  check("memory_derivation_grant_identity", sql.raw("length(consent_id)=36 AND length(grant_id)=64 AND grant_id NOT GLOB '*[^0-9a-f]*' AND length(terms_sha256)=64 AND terms_sha256 NOT GLOB '*[^0-9a-f]*' AND policy_version='personal-memory-derivation-v1' AND purpose IN('rolling-summary','profile','suggestion')")),
  check("memory_derivation_grant_bounds", sql.raw("typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991 AND typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND typeof(source_after_sequence)='integer' AND source_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(monthly_cap_microusd)='integer' AND monthly_cap_microusd BETWEEN 1 AND 1000000000 AND typeof(retention_days)='integer' AND retention_days BETWEEN 1 AND 365 AND background_enabled IN(0,1)")),
  check("memory_derivation_grant_time", sql.raw("length(consented_at)=24 AND length(expires_at)=24 AND consented_at<expires_at AND (revoked_at IS NULL OR length(revoked_at)=24 AND revoked_at>=consented_at)")),
]);

// Durable private delivery references, not a source proof, provider request or
// completed-summary cursor. No financial identity cascades from these rows.
export const memoryDerivationCursors = sqliteTable("memory_derivation_cursors", {
  consentId: text("consent_id").primaryKey().notNull(),
  grantId: text("grant_id").notNull(),
  grantRevision: integer("grant_revision").notNull(),
  purpose: text("purpose").notNull(),
  registeredThroughSequence: integer("registered_through_sequence").notNull(),
  generation: integer("generation").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, table => [
  foreignKey({ columns: [table.grantId, table.grantRevision], foreignColumns: [memoryDerivationGrants.grantId, memoryDerivationGrants.revision] }).onDelete("cascade"),
  index("idx_memory_derivation_cursor_expiry").on(table.expiresAt),
  check("memory_derivation_cursor_bounds", sql.raw("length(consent_id)=36 AND purpose IN('rolling-summary','profile','suggestion') AND typeof(grant_revision)='integer' AND grant_revision>0 AND typeof(registered_through_sequence)='integer' AND registered_through_sequence BETWEEN 0 AND 9007199254740991 AND typeof(generation)='integer' AND generation BETWEEN 0 AND 9007199254740991")),
  check("memory_derivation_cursor_time", sql.raw("length(created_at)=24 AND length(updated_at)=24 AND length(expires_at)=24 AND created_at<=updated_at AND updated_at<expires_at")),
]);

export const memoryDerivationJobs = sqliteTable("memory_derivation_jobs", {
  jobId: text("job_id").primaryKey().notNull(),
  consentId: text("consent_id").notNull().references(() => memoryDerivationCursors.consentId, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  afterSequence: integer("after_sequence").notNull(),
  throughSequence: integer("through_sequence").notNull(),
  sourceCount: integer("source_count").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  state: text("state").notNull(),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  attempts: integer("attempts").notNull(),
  notBefore: text("not_before").notNull(),
  failureCode: text("failure_code"),
}, table => [
  index("idx_memory_derivation_job_due").on(table.notBefore, table.createdAt, table.jobId),
  index("idx_memory_derivation_job_consent").on(table.consentId, table.afterSequence),
  uniqueIndex("idx_memory_derivation_job_interval").on(table.consentId, table.afterSequence),
  check("memory_derivation_job_bounds", sql.raw("length(job_id)=64 AND job_id NOT GLOB '*[^0-9a-f]*' AND length(consent_id)=36 AND purpose IN('rolling-summary','profile','suggestion') AND typeof(after_sequence)='integer' AND after_sequence>=0 AND typeof(through_sequence)='integer' AND through_sequence>after_sequence AND through_sequence<=9007199254740991 AND typeof(source_count)='integer' AND source_count BETWEEN 1 AND 128 AND typeof(attempts)='integer' AND attempts BETWEEN 0 AND 9007199254740991")),
  check("memory_derivation_job_lease", sql.raw("(state='waiting' AND lease_token IS NULL AND lease_expires_at IS NULL) OR (state='leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND length(lease_token)=36 AND length(lease_expires_at)=24 AND lease_expires_at<=expires_at)")),
  check("memory_derivation_job_time", sql.raw("length(created_at)=24 AND length(expires_at)=24 AND length(not_before)=24 AND created_at<expires_at AND not_before>=created_at AND (failure_code IS NULL OR failure_code IN('native-proof-unavailable','provider-unavailable','interrupted','budget-unavailable'))")),
]);

export const memoryDerivationJobSources = sqliteTable("memory_derivation_job_sources", {
  jobId: text("job_id").notNull().references(() => memoryDerivationJobs.jobId, { onDelete: "cascade" }),
  enrollmentId: text("enrollment_id").notNull(),
  eventId: text("event_id").notNull(),
  sequence: integer("sequence").notNull(),
  expiresAt: text("expires_at").notNull(),
}, table => [
  primaryKey({ columns: [table.jobId, table.eventId] }),
  uniqueIndex("idx_memory_derivation_source_sequence").on(table.jobId, table.sequence),
  index("idx_memory_derivation_source_inverse").on(table.enrollmentId, table.eventId),
  foreignKey({ columns: [table.enrollmentId, table.eventId], foreignColumns: [memoryLiveSources.enrollmentId, memoryLiveSources.eventId] }).onDelete("cascade"),
  check("memory_derivation_source_bounds", sql.raw("typeof(sequence)='integer' AND sequence BETWEEN 1 AND 9007199254740991 AND length(expires_at)=24")),
]);

export const memoryLiveConversationSegments = sqliteTable(
  "memory_live_conversation_segments",
  {
    enrollmentId: text("enrollment_id").notNull(),
    enrollmentRevision: integer("enrollment_revision").notNull(),
    recipeVersion: text("recipe_version").notNull(),
    firstSequence: integer("first_sequence").notNull(),
    lastSequence: integer("last_sequence").notNull(),
    memberCount: integer("member_count").notNull(),
    membersJson: text("members_json").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.enrollmentId, table.enrollmentRevision, table.recipeVersion, table.firstSequence] }),
    foreignKey({ columns: [table.enrollmentId], foreignColumns: [memoryLiveEnrollments.enrollmentId] }).onUpdate("no action").onDelete("no action"),
    check("memory_live_conversation_bounds", sql.raw(`"memory_live_conversation_segments"."enrollment_revision">0 AND "memory_live_conversation_segments"."first_sequence">0 AND "memory_live_conversation_segments"."last_sequence">="memory_live_conversation_segments"."first_sequence" AND "memory_live_conversation_segments"."member_count" BETWEEN 1 AND 8`)),
    check("memory_live_conversation_members", sql.raw(`CASE WHEN json_valid("memory_live_conversation_segments"."members_json") THEN json_type("memory_live_conversation_segments"."members_json")='array' AND json_array_length("memory_live_conversation_segments"."members_json")="memory_live_conversation_segments"."member_count" AND length("memory_live_conversation_segments"."members_json")<=8192 ELSE 0 END`)),
    index("idx_memory_live_conversation_page").on(table.enrollmentId, table.firstSequence),
  ],
);

export const memoryNativeAnswerOrigins = sqliteTable(
  "memory_native_answer_origins",
  {
    originId: text("origin_id").primaryKey().notNull(),
    schemaVersion: integer("schema_version").notNull(),
    recipeVersion: text("recipe_version").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    organizationId: text("organization_id"),
    projectAccessId: text("project_access_id"),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    scopeKey: text("scope_key").notNull(),
    turnId: text("turn_id").notNull(),
    userEventId: text("user_event_id").notNull(),
    userContentId: text("user_content_id").notNull(),
    userSourceSequence: integer("user_source_sequence").notNull(),
    userSha256: text("user_sha256").notNull(),
    answerEventId: text("answer_event_id").notNull(),
    answerContentId: text("answer_content_id").notNull(),
    answerSourceSequence: integer("answer_source_sequence").notNull(),
    answerSha256: text("answer_sha256").notNull(),
    answerExpiresAt: text("answer_expires_at").notNull(),
    consumedValueSha256: text("consumed_value_sha256").notNull(),
    dependencyListSha256: text("dependency_list_sha256").notNull(),
    enrollmentId: text("enrollment_id").notNull(),
    enrollmentRevision: integer("enrollment_revision").notNull(),
    policyVersion: text("policy_version").notNull(),
    permissionEpoch: text("permission_epoch").notNull(),
    enrolledAt: text("enrolled_at").notNull(),
    enrollmentExpiresAt: text("enrollment_expires_at").notNull(),
    retentionDays: integer("retention_days").notNull(),
    selectionCursor: integer("selection_cursor").notNull(),
    sourceRetentionCeiling: text("source_retention_ceiling").notNull(),
    dependencyCount: integer("dependency_count").notNull(),
    createdAt: text("created_at").notNull(),
    status: text("status").notNull(),
    withdrawnAt: text("withdrawn_at"),
    withdrawalReason: text("withdrawal_reason"),
  },
  (table) => [
    check("memory_native_answer_origins_check_1", sql.raw("schema_version=1 AND recipe_version='native-answer-origin-v1'")),
    check("memory_native_answer_origins_check_2", sql.raw("(organization_id IS NULL)=(project_access_id IS NULL)")),
    check("memory_native_answer_origins_check_3", sql.raw("enrollment_revision>0 AND retention_days BETWEEN 1 AND 365 AND selection_cursor>0 AND user_source_sequence>selection_cursor AND answer_source_sequence=user_source_sequence+1")),
    check("memory_native_answer_origins_check_4", sql.raw("dependency_count BETWEEN 1 AND 128")),
    check("memory_native_answer_origins_check_5", sql.raw("created_at<answer_expires_at AND answer_expires_at<=source_retention_ceiling")),
    check("memory_native_answer_origins_check_6", sql.raw("status='active' AND withdrawn_at IS NULL AND withdrawal_reason IS NULL OR status='withdrawn' AND withdrawn_at IS NOT NULL AND withdrawal_reason IS NOT NULL")),
    unique().on(table.answerEventId),
    unique().on(table.userEventId),
    unique().on(table.userContentId),
    unique().on(table.answerContentId),
    unique().on(table.actorUserId, table.scopeKey, table.turnId),
    index("idx_memory_native_origin_actor").on(table.actorUserId, table.status),
    index("idx_memory_native_origin_enrollment").on(table.enrollmentId, table.status),
  ],
);

export const memoryNativeAnswerDependencies = sqliteTable(
  "memory_native_answer_dependencies",
  {
    originId: text("origin_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    eventStreamId: text("event_stream_id").notNull(),
    eventId: text("event_id").notNull(),
    sourceSequence: integer("source_sequence").notNull(),
    eventType: text("event_type").notNull(),
    recordedAt: text("recorded_at").notNull(),
    blockId: text("block_id"),
    turnId: text("turn_id"),
    userContentId: text("user_content_id"),
    assistantContentId: text("assistant_content_id"),
    projectionSha256: text("projection_sha256").notNull(),
    sourceRetentionCeiling: text("source_retention_ceiling").notNull(),
    consumed: integer("consumed").notNull(),
    segmentEnrollmentId: text("segment_enrollment_id"),
    segmentRevision: integer("segment_revision"),
    segmentRecipe: text("segment_recipe"),
    segmentFirstSequence: integer("segment_first_sequence"),
    segmentLastSequence: integer("segment_last_sequence"),
    segmentMemberCount: integer("segment_member_count"),
    segmentOrdinal: integer("segment_ordinal"),
    segmentCreatedAt: text("segment_created_at"),
    segmentRetentionCeiling: text("segment_retention_ceiling"),
  },
  (table) => [
    primaryKey({ columns: [table.originId, table.ordinal] }),
    unique().on(table.originId, table.eventId),
    unique().on(table.originId, table.sourceSequence),
    foreignKey({ columns: [table.originId], foreignColumns: [memoryNativeAnswerOrigins.originId] }).onDelete("cascade"),
    check("memory_native_answer_dependencies_check_1", sql.raw("ordinal BETWEEN 0 AND 127 AND source_sequence>0 AND consumed IN(0,1)")),
    check("memory_native_answer_dependencies_check_2", sql.raw("event_type='AssistantReasoned' AND turn_id IS NOT NULL AND user_content_id IS NOT NULL AND assistant_content_id IS NOT NULL OR event_type!='AssistantReasoned' AND turn_id IS NULL AND user_content_id IS NULL AND assistant_content_id IS NULL")),
    check("memory_native_answer_dependencies_check_3", sql.raw("segment_enrollment_id IS NULL AND segment_revision IS NULL AND segment_recipe IS NULL AND segment_first_sequence IS NULL AND segment_last_sequence IS NULL AND segment_member_count IS NULL AND segment_ordinal IS NULL AND segment_created_at IS NULL AND segment_retention_ceiling IS NULL OR segment_enrollment_id IS NOT NULL AND segment_revision IS NOT NULL AND segment_recipe IS NOT NULL AND segment_first_sequence IS NOT NULL AND segment_last_sequence IS NOT NULL AND segment_member_count IS NOT NULL AND segment_ordinal IS NOT NULL AND segment_created_at IS NOT NULL AND segment_retention_ceiling IS NOT NULL")),
    index("idx_memory_native_origin_source").on(table.eventStreamId, table.eventId),
    index("idx_memory_native_origin_user_content").on(table.userContentId),
    index("idx_memory_native_origin_answer_content").on(table.assistantContentId),
  ],
);

export const memoryDocumentProfileGrants = sqliteTable(
  "memory_document_profile_grants",
  {
    grantId: text("grant_id").primaryKey().notNull(),
    actorUserId: text("actor_user_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    organizationId: text("organization_id"),
    projectAccessId: text("project_access_id"),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    permissionEpoch: text("permission_epoch").notNull(),
    policyVersion: text("policy_version").notNull(),
    recipeVersion: text("recipe_version").notNull(),
    revision: integer("revision").notNull(),
    enrollmentId: text("enrollment_id").notNull(),
    enrollmentRevision: integer("enrollment_revision").notNull(),
    inferEnabled: integer("infer_enabled").notNull(),
    inspectEnabled: integer("inspect_enabled").notNull(),
    backgroundEnabled: integer("background_enabled").notNull(),
    sourceAfterSequence: integer("source_after_sequence").notNull(),
    consentedAt: text("consented_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    retentionDays: integer("retention_days").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    check("memory_document_profile_grants_check_1", sql.raw("policy_version='document-profile-v1' AND recipe_version='native-document-palette-choice-v1'")),
    check("memory_document_profile_grants_check_2", sql.raw("(organization_id IS NULL)=(project_access_id IS NULL)")),
    check("memory_document_profile_grants_check_3", sql.raw("organization_id IS NOT NULL OR owner_user_id=actor_user_id")),
    check("memory_document_profile_grants_check_4", sql.raw("revision BETWEEN 1 AND 9007199254740991 AND enrollment_revision BETWEEN 1 AND 9007199254740991")),
    check("memory_document_profile_grants_check_5", sql.raw("revoked_at IS NOT NULL OR revision<9007199254740991")),
    check("memory_document_profile_grants_check_6", sql.raw("source_after_sequence BETWEEN 0 AND 9007199254740991 AND retention_days BETWEEN 1 AND 365")),
    check("memory_document_profile_grants_check_7", sql.raw("infer_enabled IN(0,1) AND inspect_enabled IN(0,1) AND background_enabled IN(0,1)")),
    check("memory_document_profile_grants_check_8", sql.raw("revoked_at IS NULL AND consented_at<expires_at\n    OR revoked_at IS NOT NULL AND infer_enabled=0 AND inspect_enabled=0 AND background_enabled=0")),
    index("idx_document_profile_grants_actor").on(table.actorUserId, table.revokedAt),
    index("idx_document_profile_grants_enrollment").on(table.enrollmentId, table.enrollmentRevision),
    index("idx_document_profile_grants_organization").on(table.organizationId, table.revokedAt),
  ],
);

export const memoryDocumentProfileSuppressions = sqliteTable(
  "memory_document_profile_suppressions",
  {
    grantId: text("grant_id").notNull(),
    grantRevision: integer("grant_revision").notNull(),
    claimKey: text("claim_key").notNull(),
    revision: integer("revision").notNull(),
    state: text("state").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.grantId, table.grantRevision, table.claimKey] }),
    check("memory_document_profile_suppressions_check_1", sql.raw("grant_revision BETWEEN 1 AND 9007199254740991 AND revision BETWEEN 1 AND 9007199254740991")),
    check("memory_document_profile_suppressions_check_2", sql.raw("state IN('active','revoked')")),
    check("memory_document_profile_suppressions_check_3", sql.raw("state='revoked' OR created_at<expires_at")),
  ],
);

export const memoryStructuredConversationHeads = sqliteTable(
  "memory_structured_conversation_heads",
  {
    ledgerId: text("ledger_id").primaryKey().notNull(),
    actorUserId: text("actor_user_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    organizationId: text("organization_id"),
    projectAccessId: text("project_access_id"),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    enrollmentId: text("enrollment_id"),
    enrollmentRevision: integer("enrollment_revision"),
    permissionEpoch: text("permission_epoch"),
    policyVersion: text("policy_version"),
    storageRevision: integer("storage_revision").notNull(),
    currentBodyRef: text("current_body_ref"),
    currentBodyHash: text("current_body_hash"),
    annotationCount: integer("annotation_count"),
    coverageAfterSequence: integer("coverage_after_sequence"),
    coverageThroughSequence: integer("coverage_through_sequence"),
    state: text("state").notNull(),
    firstTerminalAt: text("first_terminal_at"),
    cleanupTurn: integer("cleanup_turn").default(0).notNull(),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("memory_structured_heads_key", sql.raw("length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*'")),
    check("memory_structured_heads_scope", sql.raw("length(actor_user_id)>0 AND length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))")),
    check("memory_structured_heads_counters", sql.raw("typeof(storage_revision)='integer' AND storage_revision BETWEEN 1 AND 9007199254740991 AND typeof(cleanup_turn)='integer' AND cleanup_turn BETWEEN 0 AND 3 AND (state!='retired' OR cleanup_turn=0)")),
    check("memory_structured_heads_times", sql.raw("length(created_at)>0 AND created_at<=updated_at AND (first_terminal_at IS NULL OR (created_at<=first_terminal_at AND first_terminal_at<=updated_at))")),
    check("memory_structured_heads_state", sql.raw("(state='active' AND first_terminal_at IS NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND current_body_ref IS NOT NULL AND current_body_hash IS NOT NULL AND annotation_count IS NOT NULL AND coverage_after_sequence IS NOT NULL AND coverage_through_sequence IS NOT NULL AND expires_at IS NOT NULL) OR (state IN('retiring','retired') AND first_terminal_at IS NOT NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND current_body_ref IS NULL AND current_body_hash IS NULL AND annotation_count IS NULL AND coverage_after_sequence IS NULL AND coverage_through_sequence IS NULL AND expires_at IS NULL)")),
    check("memory_structured_heads_active", sql.raw("state!='active' OR (storage_revision BETWEEN 1 AND 64 AND length(enrollment_id)>0 AND typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND length(permission_epoch)>0 AND length(policy_version)>0 AND length(current_body_ref)>0 AND length(current_body_hash)=64 AND current_body_hash NOT GLOB '*[^0-9a-f]*' AND typeof(annotation_count)='integer' AND annotation_count BETWEEN 1 AND 256 AND typeof(coverage_after_sequence)='integer' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)='integer' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence AND created_at<expires_at)")),
    uniqueIndex("idx_memory_structured_heads_personal").on(table.actorUserId, table.ownerUserId, table.projectId, table.documentId).where(sql.raw("organization_id IS NULL")),
    uniqueIndex("idx_memory_structured_heads_shared").on(table.actorUserId, table.ownerUserId, table.organizationId, table.projectAccessId, table.projectId, table.documentId).where(sql.raw("organization_id IS NOT NULL")),
    index("idx_memory_structured_heads_enrollment").on(table.enrollmentId, table.state),
    index("idx_memory_structured_heads_organization").on(table.organizationId, table.actorUserId),
    index("idx_memory_structured_heads_cleanup").on(table.state, table.expiresAt, table.ledgerId),
  ],
);

export const memoryStructuredConversationRevisions = sqliteTable(
  "memory_structured_conversation_revisions",
  {
    ledgerId: text("ledger_id").notNull(),
    revision: integer("revision").notNull(),
    predecessorRevision: integer("predecessor_revision").notNull(),
    predecessorHash: text("predecessor_hash"),
    bodyRef: text("body_ref").notNull(),
    bodyHash: text("body_hash").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    recipeVersion: text("recipe_version").notNull(),
    annotationCount: integer("annotation_count").notNull(),
    coverageAfterSequence: integer("coverage_after_sequence").notNull(),
    coverageThroughSequence: integer("coverage_through_sequence").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ledgerId, table.revision] }),
    foreignKey({ columns: [table.ledgerId], foreignColumns: [memoryStructuredConversationHeads.ledgerId] }).onUpdate("no action").onDelete("no action"),
    check("memory_structured_revisions_version", sql.raw("typeof(schema_version)='integer' AND schema_version=1 AND recipe_version='native-declared-ledger-v1'")),
    check("memory_structured_revisions_identity", sql.raw("length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*' AND length(body_ref)>0 AND length(body_hash)=64 AND body_hash NOT GLOB '*[^0-9a-f]*'")),
    check("memory_structured_revisions_chain", sql.raw("typeof(revision)='integer' AND revision BETWEEN 1 AND 64 AND typeof(predecessor_revision)='integer' AND ((revision=1 AND predecessor_revision=0 AND predecessor_hash IS NULL) OR (revision>1 AND predecessor_revision=revision-1 AND predecessor_hash IS NOT NULL AND length(predecessor_hash)=64 AND predecessor_hash NOT GLOB '*[^0-9a-f]*'))")),
    check("memory_structured_revisions_bounds", sql.raw("typeof(annotation_count)='integer' AND annotation_count BETWEEN 1 AND 256 AND typeof(coverage_after_sequence)='integer' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)='integer' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence")),
    check("memory_structured_revisions_times", sql.raw("length(created_at)>0 AND created_at<expires_at")),
    uniqueIndex("idx_memory_structured_revisions_body").on(table.bodyRef),
    index("idx_memory_structured_revisions_expiry").on(table.expiresAt, table.ledgerId, table.revision),
  ],
);

export const memoryStructuredAnswerOrigins = sqliteTable(
  "memory_structured_answer_origins",
  {
    originId: text("origin_id").primaryKey().notNull(),
    schemaVersion: integer("schema_version").notNull(),
    recipeVersion: text("recipe_version").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    ownerUserId: text("owner_user_id"),
    organizationId: text("organization_id"),
    projectAccessId: text("project_access_id"),
    projectId: text("project_id"),
    documentId: text("document_id"),
    scopeKey: text("scope_key").notNull(),
    turnId: text("turn_id").notNull(),
    userEventId: text("user_event_id").notNull(),
    userContentId: text("user_content_id").notNull(),
    userSourceSequence: integer("user_source_sequence"),
    userSha256: text("user_sha256"),
    answerEventId: text("answer_event_id").notNull(),
    answerContentId: text("answer_content_id").notNull(),
    answerSourceSequence: integer("answer_source_sequence"),
    answerSha256: text("answer_sha256"),
    answerExpiresAt: text("answer_expires_at"),
    enrollmentId: text("enrollment_id"),
    enrollmentRevision: integer("enrollment_revision"),
    permissionEpoch: text("permission_epoch"),
    policyVersion: text("policy_version"),
    enrolledAt: text("enrolled_at"),
    enrollmentExpiresAt: text("enrollment_expires_at"),
    retentionDays: integer("retention_days"),
    sourceHead: integer("source_head"),
    ledgerId: text("ledger_id"),
    ledgerStorageRevision: integer("ledger_storage_revision"),
    ledgerBodyRef: text("ledger_body_ref"),
    ledgerBodySha256: text("ledger_body_sha256"),
    consumedContextSha256: text("consumed_context_sha256"),
    sourceListSha256: text("source_list_sha256"),
    sourceCount: integer("source_count"),
    ledgerHistorySha256: text("ledger_history_sha256"),
    ledgerRevisionCount: integer("ledger_revision_count"),
    manifestContentRef: text("manifest_content_ref").notNull(),
    manifestSha256: text("manifest_sha256"),
    manifestExpiresAt: text("manifest_expires_at"),
    sourceRetentionCeiling: text("source_retention_ceiling"),
    createdAt: text("created_at"),
    status: text("status").notNull(),
    withdrawnAt: text("withdrawn_at"),
    withdrawalReason: text("withdrawal_reason"),
  },
  (table) => [
    check("memory_structured_origins_version", sql.raw("typeof(schema_version)='integer' AND schema_version=1 AND recipe_version='native-structured-answer-origin-v1'")),
    check("memory_structured_origins_scope", sql.raw("length(origin_id)>0 AND length(actor_user_id)>0 AND length(scope_key)>0 AND length(turn_id)>0 AND (status='minimized' OR (length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))))")),
    check("memory_structured_origins_scope_key", sql.raw("CASE WHEN json_valid(scope_key) THEN json_type(scope_key)='array' AND json_array_length(scope_key)=4 AND json_type(scope_key,'$[0]')='text' AND json_type(scope_key,'$[1]')='text' AND json_type(scope_key,'$[2]')='text' AND json_type(scope_key,'$[3]')='text' AND ((json_extract(scope_key,'$[0]')='' AND json_extract(scope_key,'$[1]')='') OR (json_extract(scope_key,'$[0]')<>'' AND json_extract(scope_key,'$[1]')<>'')) AND json_extract(scope_key,'$[2]')<>'' AND json_extract(scope_key,'$[3]')<>'' AND scope_key=json_array(json_extract(scope_key,'$[0]'),json_extract(scope_key,'$[1]'),json_extract(scope_key,'$[2]'),json_extract(scope_key,'$[3]')) AND (status='minimized' OR (json_extract(scope_key,'$[0]')=COALESCE(organization_id,'') AND json_extract(scope_key,'$[1]')=COALESCE(project_access_id,'') AND json_extract(scope_key,'$[2]')=project_id AND json_extract(scope_key,'$[3]')=document_id)) ELSE 0 END")),
    check("memory_structured_origins_identities", sql.raw("length(user_event_id)>0 AND length(answer_event_id)>0 AND user_event_id<>answer_event_id AND length(user_content_id)>0 AND length(answer_content_id)>0 AND length(manifest_content_ref)>0 AND user_content_id<>answer_content_id AND manifest_content_ref<>user_content_id AND manifest_content_ref<>answer_content_id AND (status='minimized' OR (length(ledger_body_ref)>0 AND length(enrollment_id)>0 AND length(permission_epoch)>0 AND length(policy_version)>0))")),
    check("memory_structured_origins_hashes", sql.raw("status='minimized' OR (length(user_sha256)=64 AND user_sha256 NOT GLOB '*[^0-9a-f]*' AND length(answer_sha256)=64 AND answer_sha256 NOT GLOB '*[^0-9a-f]*' AND length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*' AND length(ledger_body_sha256)=64 AND ledger_body_sha256 NOT GLOB '*[^0-9a-f]*' AND length(consumed_context_sha256)=64 AND consumed_context_sha256 NOT GLOB '*[^0-9a-f]*' AND length(source_list_sha256)=64 AND source_list_sha256 NOT GLOB '*[^0-9a-f]*' AND length(ledger_history_sha256)=64 AND ledger_history_sha256 NOT GLOB '*[^0-9a-f]*' AND length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')")),
    check("memory_structured_origins_enrollment", sql.raw("status='minimized' OR (typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND typeof(retention_days)='integer' AND retention_days BETWEEN 1 AND 365)")),
    check("memory_structured_origins_sequences", sql.raw("status='minimized' OR (typeof(source_head)='integer' AND source_head BETWEEN 1 AND 9007199254740989 AND typeof(user_source_sequence)='integer' AND user_source_sequence=source_head+1 AND typeof(answer_source_sequence)='integer' AND answer_source_sequence=source_head+2)")),
    check("memory_structured_origins_counts", sql.raw("status='minimized' OR (typeof(source_count)='integer' AND source_count BETWEEN 2 AND 128 AND source_count%2=0 AND typeof(ledger_storage_revision)='integer' AND ledger_storage_revision BETWEEN 1 AND 64 AND typeof(ledger_revision_count)='integer' AND ledger_revision_count=ledger_storage_revision)")),
    check("memory_structured_origins_lifetime", sql.raw("status='minimized' OR (length(enrolled_at)>0 AND enrolled_at<=created_at AND created_at<answer_expires_at AND created_at<manifest_expires_at AND answer_expires_at<=source_retention_ceiling AND manifest_expires_at<=source_retention_ceiling AND source_retention_ceiling<=enrollment_expires_at)")),
    check("memory_structured_origins_state", sql.raw("(status='active' AND withdrawn_at IS NULL AND withdrawal_reason IS NULL) OR (status IN('withdrawn','minimized') AND withdrawn_at IS NOT NULL AND length(withdrawn_at)>0 AND withdrawal_reason IS NOT NULL AND (status='minimized' OR created_at<=withdrawn_at) AND withdrawal_reason IN('source-unavailable','source-changed','source-expired','enrollment-changed','access-withdrawn','erased','manual'))")),
    check("memory_structured_origins_shape", sql.raw("(status IN('active','withdrawn') AND owner_user_id IS NOT NULL AND project_id IS NOT NULL AND document_id IS NOT NULL AND user_source_sequence IS NOT NULL AND user_sha256 IS NOT NULL AND answer_source_sequence IS NOT NULL AND answer_sha256 IS NOT NULL AND answer_expires_at IS NOT NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND enrolled_at IS NOT NULL AND enrollment_expires_at IS NOT NULL AND retention_days IS NOT NULL AND source_head IS NOT NULL AND ledger_id IS NOT NULL AND ledger_storage_revision IS NOT NULL AND ledger_body_ref IS NOT NULL AND ledger_body_sha256 IS NOT NULL AND consumed_context_sha256 IS NOT NULL AND source_list_sha256 IS NOT NULL AND source_count IS NOT NULL AND ledger_history_sha256 IS NOT NULL AND ledger_revision_count IS NOT NULL AND manifest_sha256 IS NOT NULL AND manifest_expires_at IS NOT NULL AND source_retention_ceiling IS NOT NULL AND created_at IS NOT NULL) OR (status='minimized' AND owner_user_id IS NULL AND organization_id IS NULL AND project_access_id IS NULL AND project_id IS NULL AND document_id IS NULL AND user_source_sequence IS NULL AND user_sha256 IS NULL AND answer_source_sequence IS NULL AND answer_sha256 IS NULL AND answer_expires_at IS NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND enrolled_at IS NULL AND enrollment_expires_at IS NULL AND retention_days IS NULL AND source_head IS NULL AND ledger_id IS NULL AND ledger_storage_revision IS NULL AND ledger_body_ref IS NULL AND ledger_body_sha256 IS NULL AND consumed_context_sha256 IS NULL AND source_list_sha256 IS NULL AND source_count IS NULL AND ledger_history_sha256 IS NULL AND ledger_revision_count IS NULL AND manifest_sha256 IS NULL AND manifest_expires_at IS NULL AND source_retention_ceiling IS NULL AND created_at IS NULL)")),
    uniqueIndex("idx_memory_structured_origin_user_event").on(table.userEventId),
    uniqueIndex("idx_memory_structured_origin_answer_event").on(table.answerEventId),
    uniqueIndex("idx_memory_structured_origin_user_content").on(table.userContentId),
    uniqueIndex("idx_memory_structured_origin_answer_content").on(table.answerContentId),
    uniqueIndex("idx_memory_structured_origin_manifest").on(table.manifestContentRef),
    uniqueIndex("idx_memory_structured_origin_turn").on(table.actorUserId, table.scopeKey, table.turnId),
    index("idx_memory_structured_origin_actor").on(table.actorUserId, table.status),
    index("idx_memory_structured_origin_enrollment").on(table.enrollmentId, table.status),
    index("idx_memory_structured_origin_ledger").on(table.ledgerId, table.status),
  ],
);

export const memoryStructuredAnswerOriginals = sqliteTable(
  "memory_structured_answer_originals",
  {
    originId: text("origin_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    eventStreamId: text("event_stream_id").notNull(),
    eventId: text("event_id").notNull(),
    sourceSequence: integer("source_sequence").notNull(),
    eventType: text("event_type").notNull(),
    role: text("role").notNull(),
    turnId: text("turn_id").notNull(),
    contentId: text("content_id").notNull(),
    contentSha256: text("content_sha256").notNull(),
    projectionSha256: text("projection_sha256").notNull(),
    recordedAt: text("recorded_at").notNull(),
    sourceRetentionCeiling: text("source_retention_ceiling").notNull(),
    retainedByLedger: integer("retained_by_ledger").notNull(),
    presentedInContext: integer("presented_in_context").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.originId, table.ordinal] }),
    foreignKey({ columns: [table.originId], foreignColumns: [memoryStructuredAnswerOrigins.originId] }).onUpdate("no action").onDelete("no action"),
    check("memory_structured_originals_bounds", sql.raw("typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 127 AND typeof(source_sequence)='integer' AND source_sequence BETWEEN 1 AND 9007199254740991 AND typeof(retained_by_ledger)='integer' AND retained_by_ledger IN(0,1) AND typeof(presented_in_context)='integer' AND presented_in_context IN(0,1)")),
    check("memory_structured_originals_identity", sql.raw("length(origin_id)>0 AND length(event_stream_id)>0 AND length(event_id)>0 AND length(turn_id)>0 AND length(content_id)>0 AND length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*' AND length(projection_sha256)=64 AND projection_sha256 NOT GLOB '*[^0-9a-f]*'")),
    check("memory_structured_originals_role", sql.raw("(role='user' AND event_type='ChatMessageSent') OR (role='assistant' AND event_type='AssistantReasoned')")),
    check("memory_structured_originals_lifetime", sql.raw("length(recorded_at)>0 AND recorded_at<source_retention_ceiling")),
    uniqueIndex("idx_memory_structured_original_event").on(table.originId, table.eventId),
    uniqueIndex("idx_memory_structured_original_sequence").on(table.originId, table.eventStreamId, table.sourceSequence),
    uniqueIndex("idx_memory_structured_original_content").on(table.originId, table.contentId),
    uniqueIndex("idx_memory_structured_original_turn_role").on(table.originId, table.turnId, table.role),
    index("idx_memory_structured_original_source").on(table.eventStreamId, table.eventId),
    index("idx_memory_structured_original_body").on(table.contentId),
  ],
);

export const memoryStructuredAnswerLedgerRevisions = sqliteTable(
  "memory_structured_answer_ledger_revisions",
  {
    originId: text("origin_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    ledgerId: text("ledger_id").notNull(),
    storageRevision: integer("storage_revision").notNull(),
    predecessorRevision: integer("predecessor_revision").notNull(),
    predecessorHash: text("predecessor_hash"),
    bodyRef: text("body_ref").notNull(),
    bodyHash: text("body_hash").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.originId, table.ordinal] }),
    foreignKey({ columns: [table.originId], foreignColumns: [memoryStructuredAnswerOrigins.originId] }).onUpdate("no action").onDelete("no action"),
    check("memory_structured_origin_revisions_identity", sql.raw("length(origin_id)>0 AND length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*' AND length(body_ref)>0 AND length(body_hash)=64 AND body_hash NOT GLOB '*[^0-9a-f]*'")),
    check("memory_structured_origin_revisions_chain", sql.raw("typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 63 AND typeof(storage_revision)='integer' AND storage_revision=ordinal+1 AND typeof(predecessor_revision)='integer' AND ((storage_revision=1 AND predecessor_revision=0 AND predecessor_hash IS NULL) OR (storage_revision>1 AND predecessor_revision=storage_revision-1 AND predecessor_hash IS NOT NULL AND length(predecessor_hash)=64 AND predecessor_hash NOT GLOB '*[^0-9a-f]*'))")),
    check("memory_structured_origin_revisions_lifetime", sql.raw("length(created_at)>0 AND created_at<expires_at")),
    uniqueIndex("idx_memory_structured_origin_revision").on(table.originId, table.ledgerId, table.storageRevision),
    uniqueIndex("idx_memory_structured_origin_revision_body").on(table.originId, table.bodyRef),
    index("idx_memory_structured_origin_revision_content").on(table.bodyRef),
    index("idx_memory_structured_origin_revision_ledger").on(table.ledgerId),
  ],
);

export const memoryDocumentJobAnswerOrigins = sqliteTable(
  "memory_document_job_answer_origins",
  {
    originId: text("origin_id").primaryKey().notNull(),
    schemaVersion: integer("schema_version").notNull(),
    recipeVersion: text("recipe_version").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    scopeKey: text("scope_key").notNull(),
    jobId: text("job_id").notNull(),
    turnId: text("turn_id").notNull(),
    userEventId: text("user_event_id").notNull(),
    userContentId: text("user_content_id").notNull(),
    answerEventId: text("answer_event_id").notNull(),
    answerContentId: text("answer_content_id").notNull(),
    manifestContentRef: text("manifest_content_ref").notNull(),
    ownerUserId: text("owner_user_id"),
    streamId: text("stream_id"),
    organizationId: text("organization_id"),
    projectAccessId: text("project_access_id"),
    projectId: text("project_id"),
    documentId: text("document_id"),
    attemptCount: integer("attempt_count"),
    correlationId: text("correlation_id"),
    requestSha256: text("request_sha256"),
    claimSha256: text("claim_sha256"),
    inputContentRef: text("input_content_ref"),
    inputSha256: text("input_sha256"),
    inputExpiresAt: text("input_expires_at"),
    jobRequestedAt: text("job_requested_at"),
    jobStartedAt: text("job_started_at"),
    jobLeaseExpiresAt: text("job_lease_expires_at"),
    jobExpiresAt: text("job_expires_at"),
    requestedSequence: integer("requested_sequence"),
    sourceHead: integer("source_head"),
    projectSourceHead: integer("project_source_head"),
    userSourceSequence: integer("user_source_sequence"),
    userSha256: text("user_sha256"),
    answerSourceSequence: integer("answer_source_sequence"),
    answerSha256: text("answer_sha256"),
    answerExpiresAt: text("answer_expires_at"),
    mode: text("mode"),
    rendererRecipe: text("renderer_recipe"),
    locale: text("locale"),
    enrollmentId: text("enrollment_id"),
    enrollmentRevision: integer("enrollment_revision"),
    permissionEpoch: text("permission_epoch"),
    policyVersion: text("policy_version"),
    enrolledAt: text("enrolled_at"),
    enrollmentExpiresAt: text("enrollment_expires_at"),
    retentionDays: integer("retention_days"),
    selectionCursor: integer("selection_cursor"),
    consumedValueSha256: text("consumed_value_sha256"),
    sourceCount: integer("source_count"),
    ledgerRevisionCount: integer("ledger_revision_count"),
    selectorCount: integer("selector_count"),
    selectorListSha256: text("selector_list_sha256"),
    manifestSha256: text("manifest_sha256"),
    manifestExpiresAt: text("manifest_expires_at"),
    proofValidUntil: text("proof_valid_until"),
    sourceRetentionCeiling: text("source_retention_ceiling"),
    createdAt: text("created_at"),
    status: text("status").notNull(),
    withdrawnAt: text("withdrawn_at"),
    withdrawalReason: text("withdrawal_reason"),
  },
  (table) => [
    check("memory_document_job_origins_version", sql.raw("COALESCE((typeof(schema_version)='integer' AND schema_version=1 AND recipe_version='native-document-job-answer-origin-v1'),0)")),
    check("memory_document_job_origins_registrations", sql.raw("COALESCE((length(origin_id)>0 AND length(actor_user_id)>0 AND length(scope_key)>0 AND length(job_id)>0 AND length(turn_id)>0 AND length(user_event_id)>0 AND length(user_content_id)>0 AND length(answer_event_id)>0 AND length(answer_content_id)>0 AND length(manifest_content_ref)>0 AND user_event_id<>answer_event_id AND user_content_id<>answer_content_id AND user_content_id<>manifest_content_ref AND answer_content_id<>manifest_content_ref),0)")),
    check("memory_document_job_origins_scope", sql.raw("COALESCE((status='minimized' OR (length(owner_user_id)>0 AND stream_id='creative:'||owner_user_id AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND project_source_head IS NULL AND actor_user_id=owner_user_id) OR (length(organization_id)>0 AND length(project_access_id)>0 AND typeof(project_source_head)='integer' AND project_source_head BETWEEN 0 AND 9007199254740989)))),0)")),
    check("memory_document_job_origins_scope_key", sql.raw("COALESCE((CASE WHEN json_valid(scope_key) THEN json_type(scope_key)='array' AND json_array_length(scope_key)=4 AND json_type(scope_key,'$[0]')='text' AND json_type(scope_key,'$[1]')='text' AND json_type(scope_key,'$[2]')='text' AND json_type(scope_key,'$[3]')='text' AND ((json_extract(scope_key,'$[0]')='' AND json_extract(scope_key,'$[1]')='') OR (json_extract(scope_key,'$[0]')<>'' AND json_extract(scope_key,'$[1]')<>'')) AND json_extract(scope_key,'$[2]')<>'' AND json_extract(scope_key,'$[3]')<>'' AND scope_key=json_array(json_extract(scope_key,'$[0]'),json_extract(scope_key,'$[1]'),json_extract(scope_key,'$[2]'),json_extract(scope_key,'$[3]')) AND (status='minimized' OR (json_extract(scope_key,'$[0]')=COALESCE(organization_id,'') AND json_extract(scope_key,'$[1]')=COALESCE(project_access_id,'') AND json_extract(scope_key,'$[2]')=project_id AND json_extract(scope_key,'$[3]')=document_id)) ELSE 0 END),0)")),
    check("memory_document_job_origins_identities", sql.raw("COALESCE((status='minimized' OR (length(correlation_id)>0 AND length(input_content_ref)>0 AND renderer_recipe='document-job-evidence-answer-v1' AND length(enrollment_id)>0 AND length(permission_epoch)>0 AND length(policy_version)>0 AND typeof(attempt_count)='integer' AND attempt_count BETWEEN 1 AND 9007199254740991 AND input_content_ref<>answer_content_id AND input_content_ref<>manifest_content_ref)),0)")),
    check("memory_document_job_origins_hashes", sql.raw("COALESCE((status='minimized' OR (length(request_sha256)=64 AND request_sha256 NOT GLOB '*[^0-9a-f]*' AND length(claim_sha256)=64 AND claim_sha256 NOT GLOB '*[^0-9a-f]*' AND length(input_sha256)=64 AND input_sha256 NOT GLOB '*[^0-9a-f]*' AND length(user_sha256)=64 AND user_sha256 NOT GLOB '*[^0-9a-f]*' AND length(answer_sha256)=64 AND answer_sha256 NOT GLOB '*[^0-9a-f]*' AND length(consumed_value_sha256)=64 AND consumed_value_sha256 NOT GLOB '*[^0-9a-f]*' AND length(selector_list_sha256)=64 AND selector_list_sha256 NOT GLOB '*[^0-9a-f]*' AND length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')),0)")),
    check("memory_document_job_origins_sequences", sql.raw("COALESCE((status='minimized' OR (typeof(source_head)='integer' AND source_head BETWEEN 1 AND 9007199254740989 AND typeof(requested_sequence)='integer' AND requested_sequence BETWEEN 0 AND source_head AND typeof(selection_cursor)='integer' AND selection_cursor<=source_head AND ((mode='extractive' AND selection_cursor>=1) OR (mode='structured' AND selection_cursor>=0)) AND typeof(user_source_sequence)='integer' AND user_source_sequence=source_head+1 AND typeof(answer_source_sequence)='integer' AND answer_source_sequence=source_head+2)),0)")),
    check("memory_document_job_origins_evidence", sql.raw("COALESCE((status='minimized' OR (locale IN('en','fr','ar','ja') AND typeof(source_count)='integer' AND source_count BETWEEN 1 AND 128 AND typeof(ledger_revision_count)='integer' AND ((mode='extractive' AND ledger_revision_count=0) OR (mode='structured' AND source_count>=2 AND source_count%2=0 AND ledger_revision_count BETWEEN 1 AND 64)) AND typeof(selector_count)='integer' AND selector_count BETWEEN 1 AND 513)),0)")),
    check("memory_document_job_origins_enrollment", sql.raw("COALESCE((status='minimized' OR (typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND typeof(retention_days)='integer' AND retention_days BETWEEN 1 AND 365)),0)")),
    check("memory_document_job_origins_timestamps", sql.raw("COALESCE((status='minimized' OR (length(input_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',input_expires_at)=input_expires_at AND length(job_requested_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_requested_at)=job_requested_at AND length(job_started_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_started_at)=job_started_at AND length(job_lease_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_lease_expires_at)=job_lease_expires_at AND length(job_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_expires_at)=job_expires_at AND length(answer_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',answer_expires_at)=answer_expires_at AND length(enrolled_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',enrolled_at)=enrolled_at AND length(enrollment_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',enrollment_expires_at)=enrollment_expires_at AND length(manifest_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',manifest_expires_at)=manifest_expires_at AND length(proof_valid_until)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',proof_valid_until)=proof_valid_until AND length(source_retention_ceiling)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',source_retention_ceiling)=source_retention_ceiling AND length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)),0)")),
    check("memory_document_job_origins_lifetime", sql.raw("COALESCE((status='minimized' OR (job_requested_at<=job_started_at AND job_started_at<=created_at AND enrolled_at<=created_at AND created_at<proof_valid_until AND proof_valid_until<=job_lease_expires_at AND proof_valid_until<=input_expires_at AND proof_valid_until<=job_expires_at AND proof_valid_until<=source_retention_ceiling AND created_at<answer_expires_at AND answer_expires_at<=manifest_expires_at AND manifest_expires_at<=source_retention_ceiling AND source_retention_ceiling<=enrollment_expires_at AND manifest_expires_at<=input_expires_at AND manifest_expires_at<=job_expires_at)),0)")),
    check("memory_document_job_origins_state", sql.raw("COALESCE(((status='active' AND withdrawn_at IS NULL AND withdrawal_reason IS NULL) OR (status IN('withdrawn','minimized') AND length(withdrawn_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',withdrawn_at)=withdrawn_at AND withdrawal_reason IN('source-unavailable','source-changed','source-expired','enrollment-changed','access-withdrawn','job-changed','erased','manual') AND (status='minimized' OR created_at<=withdrawn_at))),0)")),
    check("memory_document_job_origins_shape", sql.raw("COALESCE(((status IN('active','withdrawn') AND owner_user_id IS NOT NULL AND stream_id IS NOT NULL AND project_id IS NOT NULL AND document_id IS NOT NULL AND attempt_count IS NOT NULL AND correlation_id IS NOT NULL AND request_sha256 IS NOT NULL AND claim_sha256 IS NOT NULL AND input_content_ref IS NOT NULL AND input_sha256 IS NOT NULL AND input_expires_at IS NOT NULL AND job_requested_at IS NOT NULL AND job_started_at IS NOT NULL AND job_lease_expires_at IS NOT NULL AND job_expires_at IS NOT NULL AND requested_sequence IS NOT NULL AND source_head IS NOT NULL AND user_source_sequence IS NOT NULL AND user_sha256 IS NOT NULL AND answer_source_sequence IS NOT NULL AND answer_sha256 IS NOT NULL AND answer_expires_at IS NOT NULL AND mode IS NOT NULL AND renderer_recipe IS NOT NULL AND locale IS NOT NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND enrolled_at IS NOT NULL AND enrollment_expires_at IS NOT NULL AND retention_days IS NOT NULL AND selection_cursor IS NOT NULL AND consumed_value_sha256 IS NOT NULL AND source_count IS NOT NULL AND ledger_revision_count IS NOT NULL AND selector_count IS NOT NULL AND selector_list_sha256 IS NOT NULL AND manifest_sha256 IS NOT NULL AND manifest_expires_at IS NOT NULL AND proof_valid_until IS NOT NULL AND source_retention_ceiling IS NOT NULL AND created_at IS NOT NULL) OR (status='minimized' AND owner_user_id IS NULL AND stream_id IS NULL AND organization_id IS NULL AND project_access_id IS NULL AND project_id IS NULL AND document_id IS NULL AND attempt_count IS NULL AND correlation_id IS NULL AND request_sha256 IS NULL AND claim_sha256 IS NULL AND input_content_ref IS NULL AND input_sha256 IS NULL AND input_expires_at IS NULL AND job_requested_at IS NULL AND job_started_at IS NULL AND job_lease_expires_at IS NULL AND job_expires_at IS NULL AND requested_sequence IS NULL AND source_head IS NULL AND project_source_head IS NULL AND user_source_sequence IS NULL AND user_sha256 IS NULL AND answer_source_sequence IS NULL AND answer_sha256 IS NULL AND answer_expires_at IS NULL AND mode IS NULL AND renderer_recipe IS NULL AND locale IS NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND enrolled_at IS NULL AND enrollment_expires_at IS NULL AND retention_days IS NULL AND selection_cursor IS NULL AND consumed_value_sha256 IS NULL AND source_count IS NULL AND ledger_revision_count IS NULL AND selector_count IS NULL AND selector_list_sha256 IS NULL AND manifest_sha256 IS NULL AND manifest_expires_at IS NULL AND proof_valid_until IS NULL AND source_retention_ceiling IS NULL AND created_at IS NULL)),0)")),
    uniqueIndex("idx_memory_document_job_origin_job_id").on(table.jobId),
    uniqueIndex("idx_memory_document_job_origin_user_event_id").on(table.userEventId),
    uniqueIndex("idx_memory_document_job_origin_answer_event_id").on(table.answerEventId),
    uniqueIndex("idx_memory_document_job_origin_user_content_id").on(table.userContentId),
    uniqueIndex("idx_memory_document_job_origin_answer_content_id").on(table.answerContentId),
    uniqueIndex("idx_memory_document_job_origin_manifest_content_ref").on(table.manifestContentRef),
    uniqueIndex("idx_memory_document_job_origin_turn").on(table.actorUserId, table.scopeKey, table.turnId),
    index("idx_memory_document_job_origin_actor").on(table.actorUserId, table.status),
    index("idx_memory_document_job_origin_enrollment").on(table.enrollmentId, table.status),
    index("idx_memory_document_job_origin_scope").on(table.actorUserId, table.scopeKey, table.status),
    index("idx_memory_document_job_origin_expiry").on(table.status, table.answerExpiresAt),
  ],
);

export const memoryDocumentJobOriginDependencies = sqliteTable(
  "memory_document_job_origin_dependencies",
  {
    originId: text("origin_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.originId, table.resourceKind, table.resourceId] }),
    foreignKey({ columns: [table.originId], foreignColumns: [memoryDocumentJobAnswerOrigins.originId] }).onUpdate("no action").onDelete("cascade"),
    check("memory_document_job_origin_dependencies_shape", sql.raw("COALESCE((length(origin_id)>0 AND resource_kind IN('event','private-content','ledger','enrollment') AND length(resource_id)>0),0)")),
    index("idx_memory_document_job_origin_dependency").on(table.resourceKind, table.resourceId, table.originId),
  ],
);

export const memoryDocumentJobOriginRetirementProgress = sqliteTable('memory_document_job_origin_retirement_progress', {
  originId: text('origin_id').primaryKey().notNull(),
  schemaVersion: integer('schema_version').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  evidenceSha256: text('evidence_sha256').notNull(),
  selectorCount: integer('selector_count').notNull(),
  selectorCursor: integer('selector_cursor').notNull(),
  phase: text('phase').notNull(),
  revision: integer('revision').notNull(),
  answerRedactedAt: text('answer_redacted_at'),
  manifestRedactedAt: text('manifest_redacted_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, () => [
  check('memory_document_job_retirement_schema_version', sql.raw(`schema_version = 1`)),
  check('memory_document_job_retirement_evidence_json', sql.raw(`typeof(evidence_json) = 'text' AND length(CAST(evidence_json AS BLOB)) BETWEEN 1 AND 524288 AND json_valid(evidence_json)`)),
  check('memory_document_job_retirement_evidence_sha256', sql.raw(`length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'`)),
  check('memory_document_job_retirement_selector_count', sql.raw(`selector_count BETWEEN 1 AND 513`)),
  check('memory_document_job_retirement_selector_cursor', sql.raw(`selector_cursor BETWEEN 0 AND selector_count`)),
  check('memory_document_job_retirement_phase', sql.raw(`phase IN ('answer','manifest','selectors','answer-delete','manifest-delete','finalize')`)),
  check('memory_document_job_retirement_revision', sql.raw(`revision BETWEEN 0 AND 517`)),
  check('memory_document_job_retirement_timestamps', sql.raw(`COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at AND length(created_at) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS updated_at AND length(updated_at) = 24 AND updated_at >= created_at,0)`)),
  check('memory_document_job_retirement_phase_state', sql.raw(`COALESCE((phase = 'answer' AND revision = 0 AND selector_cursor = 0 AND answer_redacted_at IS NULL AND manifest_redacted_at IS NULL)
    OR (phase = 'manifest' AND revision = 1 AND selector_cursor = 0 AND answer_redacted_at IS NOT NULL AND manifest_redacted_at IS NULL)
    OR (phase = 'selectors' AND revision = 2 + selector_cursor AND selector_cursor < selector_count AND answer_redacted_at IS NOT NULL AND manifest_redacted_at IS NOT NULL)
    OR (phase = 'answer-delete' AND revision = 2 + selector_count AND selector_cursor = selector_count AND answer_redacted_at IS NOT NULL AND manifest_redacted_at IS NOT NULL)
    OR (phase = 'manifest-delete' AND revision = 3 + selector_count AND selector_cursor = selector_count AND answer_redacted_at IS NOT NULL AND manifest_redacted_at IS NOT NULL)
    OR (phase = 'finalize' AND revision = 4 + selector_count AND selector_cursor = selector_count AND answer_redacted_at IS NOT NULL AND manifest_redacted_at IS NOT NULL),0)`)),
  check('memory_document_job_retirement_answer_redacted_at', sql.raw(`answer_redacted_at IS NULL OR COALESCE(length(answer_redacted_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ',answer_redacted_at) IS answer_redacted_at
    AND answer_redacted_at BETWEEN created_at AND updated_at,0)`)),
  check('memory_document_job_retirement_manifest_redacted_at', sql.raw(`manifest_redacted_at IS NULL OR COALESCE(length(manifest_redacted_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ',manifest_redacted_at) IS manifest_redacted_at
    AND manifest_redacted_at BETWEEN answer_redacted_at AND updated_at,0)`)),
]);

/** An administrative capacity release is not a zero-cost provider settlement. */
export const budgetHoldDispositions = sqliteTable("budget_hold_dispositions", {
  dispositionId: text("disposition_id").primaryKey(), operatorId: text("operator_id").notNull(),
  jobId: text("job_id").notNull(), correlationId: text("correlation_id").notNull(),
  tokenReservationId: text("token_reservation_id").notNull().unique(), costReservationId: text("cost_reservation_id").notNull().unique(),
  commandSha256: text("command_sha256").notNull(), recordSha256: text("record_sha256").notNull(), recordJson: text("record_json").notNull(),
  eventId: text("event_id").notNull().unique(), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("idx_hold_dispositions_job_attempt").on(table.jobId, table.correlationId)]);

/** Explicit operator-adjudicated usage is distinct from unknown-outcome hold release. */
export const managedVideoReconciliations = sqliteTable("managed_video_reconciliations", {
  reconciliationId: text("reconciliation_id").primaryKey(), operatorId: text("operator_id").notNull(),
  jobId: text("job_id").notNull(), correlationId: text("correlation_id").notNull(),
  tokenReservationId: text("token_reservation_id").notNull().unique(), costReservationId: text("cost_reservation_id").notNull().unique(),
  commandSha256: text("command_sha256").notNull(), treatmentSha256: text("treatment_sha256").notNull(),
  recordSha256: text("record_sha256").notNull(), recordJson: text("record_json").notNull(), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("idx_video_reconciliations_job_attempt").on(table.jobId, table.correlationId)]);

/** Short-lived, private recommendation cache; never an authority or creative record. */
export const stillDecisionCache = sqliteTable('still_decision_cache', {
  cacheKey: text('cache_key').primaryKey(),
  ownerId: text('owner_id').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  body: text('body').notNull(),
}, table => [index('idx_still_decision_cache_expiry').on(table.expiresAt), index('idx_still_decision_cache_owner').on(table.ownerId, table.createdAt)]);

// Independent minimized finance. Only the private job bridge follows erasure.
export const memoryDerivationMonthCaps = sqliteTable("memory_derivation_month_caps", {
  payerId: text("payer_id").notNull(),
  period: text("period").notNull(),
  capMicrousd: integer("cap_microusd").notNull(),
}, table => [
  primaryKey({ columns: [table.payerId, table.period] }),
  check("memory_derivation_month_caps_check_1", sql.raw("length(payer_id) BETWEEN 1 AND 240")),
  check("memory_derivation_month_caps_check_2", sql.raw("length(period)=7 AND period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(period,6,2) BETWEEN '01' AND '12'")),
  check("memory_derivation_month_caps_check_3", sql.raw("typeof(cap_microusd)='integer' AND cap_microusd BETWEEN 1 AND 1000000000")),
]);

export const memoryDerivationFinance = sqliteTable("memory_derivation_finance", {
  financeId: text("finance_id").notNull().primaryKey(),
  payerId: text("payer_id").notNull(),
  period: text("period").notNull(),
  tokenId: text("token_id").notNull().unique(),
  costId: text("cost_id").notNull().unique(),
  operation: text("operation").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  termsSha256: text("terms_sha256").notNull(),
  requestSha256: text("request_sha256").notNull(),
  inputPrice: integer("input_price").notNull(),
  cachedInputPrice: integer("cached_input_price").notNull(),
  outputPrice: integer("output_price").notNull(),
  maximumInput: integer("maximum_input").notNull(),
  maximumOutput: integer("maximum_output").notNull(),
  maximumTokens: integer("maximum_tokens").notNull(),
  maximumMicrousd: integer("maximum_microusd").notNull(),
  authorizedCapMicrousd: integer("authorized_cap_microusd").notNull(),
  workspaceId: text("workspace_id").notNull(),
  projectAccessId: text("project_access_id"),
  pilotCohortId: text("pilot_cohort_id"),
  createdAt: text("created_at").notNull(),
  dispatchToken: text("dispatch_token").unique(),
  dispatchedAt: text("dispatched_at"),
  admissionClosedAt: text("admission_closed_at"),
}, table => [
  index("idx_memory_derivation_finance_payer_month").on(table.payerId,table.period),
  index("idx_memory_derivation_finance_workspace").on(table.workspaceId,table.projectAccessId,table.pilotCohortId),
  check("memory_derivation_finance_check_1", sql.raw("length(finance_id) BETWEEN 1 AND 240")),
  check("memory_derivation_finance_check_2", sql.raw("length(payer_id) BETWEEN 1 AND 240")),
  check("memory_derivation_finance_check_3", sql.raw("period=substr(created_at,1,7)")),
  check("memory_derivation_finance_check_4", sql.raw("length(token_id) BETWEEN 1 AND 240")),
  check("memory_derivation_finance_check_5", sql.raw("length(cost_id) BETWEEN 1 AND 240 AND cost_id<>token_id")),
  check("memory_derivation_finance_check_6", sql.raw("operation IN('memory-derivation:rolling-summary','memory-derivation:profile','memory-derivation:suggestion')")),
  check("memory_derivation_finance_check_7", sql.raw("provider='openai'")),
  check("memory_derivation_finance_check_8", sql.raw("length(model) BETWEEN 1 AND 240")),
  check("memory_derivation_finance_check_9", sql.raw("length(terms_sha256)=64 AND terms_sha256 NOT GLOB '*[^0-9a-f]*'")),
  check("memory_derivation_finance_check_10", sql.raw("length(request_sha256)=64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'")),
  check("memory_derivation_finance_check_11", sql.raw("typeof(input_price)='integer' AND input_price BETWEEN 0 AND 1000000000")),
  check("memory_derivation_finance_check_12", sql.raw("typeof(cached_input_price)='integer' AND cached_input_price BETWEEN 0 AND input_price")),
  check("memory_derivation_finance_check_13", sql.raw("typeof(output_price)='integer' AND output_price BETWEEN 0 AND 1000000000")),
  check("memory_derivation_finance_check_14", sql.raw("typeof(maximum_input)='integer' AND maximum_input BETWEEN 1 AND 131072")),
  check("memory_derivation_finance_check_15", sql.raw("typeof(maximum_output)='integer' AND maximum_output BETWEEN 1 AND 8192")),
  check("memory_derivation_finance_check_16", sql.raw("typeof(maximum_tokens)='integer' AND maximum_tokens=maximum_input+maximum_output")),
  check("memory_derivation_finance_check_17", sql.raw("typeof(maximum_microusd)='integer' AND maximum_microusd BETWEEN 1 AND 1000000000\n   AND maximum_microusd=(maximum_input*input_price+maximum_output*output_price+999999)/1000000")),
  check("memory_derivation_finance_check_18", sql.raw("typeof(authorized_cap_microusd)='integer' AND authorized_cap_microusd BETWEEN 1 AND 1000000000")),
  check("memory_derivation_finance_check_19", sql.raw("length(workspace_id) BETWEEN 1 AND 240")),
  check("memory_derivation_finance_check_20", sql.raw("length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at")),
  check("memory_derivation_finance_check_21", sql.raw("(workspace_id='forma' AND project_access_id IS NULL AND pilot_cohort_id IS NULL) OR (workspace_id<>'forma' AND project_access_id IS NOT NULL AND length(project_access_id) BETWEEN 1 AND 240)")),
  check("memory_derivation_finance_check_22", sql.raw("pilot_cohort_id IS NULL OR length(pilot_cohort_id) BETWEEN 1 AND 240")),
  check("memory_derivation_finance_check_23", sql.raw("(dispatch_token IS NULL AND dispatched_at IS NULL) OR (dispatch_token IS NOT NULL AND length(dispatch_token) BETWEEN 1 AND 240 AND dispatched_at IS NOT NULL AND length(dispatched_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',dispatched_at) IS dispatched_at AND dispatched_at>=created_at)")),
  check("memory_derivation_finance_check_24", sql.raw("admission_closed_at IS NULL OR length(admission_closed_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',admission_closed_at) IS admission_closed_at AND admission_closed_at>=created_at")),
]);

export const memoryDerivationUsage = sqliteTable("memory_derivation_usage", {
  financeId: text("finance_id").notNull().primaryKey().references(() => memoryDerivationFinance.financeId),
  providerRequestId: text("provider_request_id").notNull().unique(),
  receiptSha256: text("receipt_sha256").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  cachedInputTokens: integer("cached_input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  usedTokens: integer("used_tokens").notNull(),
  usedMicrousd: integer("used_microusd").notNull(),
  recordedAt: text("recorded_at").notNull(),
}, () => [
  check("memory_derivation_usage_check_1", sql.raw("length(provider_request_id) BETWEEN 1 AND 240")),
  check("memory_derivation_usage_check_2", sql.raw("length(receipt_sha256)=64 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'")),
  check("memory_derivation_usage_check_3", sql.raw("typeof(input_tokens)='integer' AND input_tokens BETWEEN 0 AND 1000000")),
  check("memory_derivation_usage_check_4", sql.raw("typeof(cached_input_tokens)='integer' AND cached_input_tokens BETWEEN 0 AND input_tokens")),
  check("memory_derivation_usage_check_5", sql.raw("typeof(output_tokens)='integer' AND output_tokens BETWEEN 0 AND 1000000")),
  check("memory_derivation_usage_check_6", sql.raw("typeof(used_tokens)='integer' AND used_tokens=input_tokens+output_tokens")),
  check("memory_derivation_usage_check_7", sql.raw("typeof(used_microusd)='integer' AND used_microusd BETWEEN 0 AND 2000000000")),
  check("memory_derivation_usage_check_8", sql.raw("length(recorded_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at) IS recorded_at")),
]);

export const memoryDerivationNoDispatch = sqliteTable("memory_derivation_no_dispatch", {
  financeId: text("finance_id").notNull().primaryKey().references(() => memoryDerivationFinance.financeId),
  evidenceSha256: text("evidence_sha256").notNull(),
  tokenWasPresent: integer("token_was_present").notNull(),
  costWasPresent: integer("cost_was_present").notNull(),
  recordedAt: text("recorded_at").notNull(),
}, () => [
  check("memory_derivation_no_dispatch_check_1", sql.raw("length(evidence_sha256)=64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'")),
  check("memory_derivation_no_dispatch_check_2", sql.raw("typeof(token_was_present)='integer' AND token_was_present IN(0,1)")),
  check("memory_derivation_no_dispatch_check_3", sql.raw("typeof(cost_was_present)='integer' AND cost_was_present IN(0,1)")),
  check("memory_derivation_no_dispatch_check_4", sql.raw("length(recorded_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at) IS recorded_at")),
]);

export const memoryDerivationJobFinance = sqliteTable("memory_derivation_job_finance", {
  jobId: text("job_id").notNull().primaryKey().references(() => memoryDerivationJobs.jobId, { onDelete: "cascade" }),
  financeId: text("finance_id").notNull().unique().references(() => memoryDerivationFinance.financeId),
}, () => [
]);

/** A scan position for bounded financial maintenance, never semantic coverage,
 * source custody, enrollment, or permission to submit another provider call. */
export const memoryDerivationRecoveryCursor = sqliteTable("memory_derivation_recovery_cursor", {
  singleton: integer("singleton").notNull().primaryKey(),
  afterFinanceId: text("after_finance_id").references(() => memoryDerivationFinance.financeId),
  generation: integer("generation").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [
  check("memory_derivation_recovery_singleton", sql`${table.singleton}=1`),
  check("memory_derivation_recovery_generation", sql.raw("typeof(generation)='integer' AND generation BETWEEN 0 AND 9007199254740991")),
  check("memory_derivation_recovery_time", sql.raw("length(updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS updated_at")),
]);
