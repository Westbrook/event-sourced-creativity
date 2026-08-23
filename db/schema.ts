import { integer, sqliteTable, text, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";
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
  (table) => [index("idx_private_content_owner_expiry").on(table.ownerId, table.expiresAt)],
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
