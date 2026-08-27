import { integer, sqliteTable, text, uniqueIndex, index, primaryKey, check } from "drizzle-orm/sqlite-core";
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
  ],
);

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
