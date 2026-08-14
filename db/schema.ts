import { integer, sqliteTable, text, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";

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
    index("idx_events_correlation").on(table.correlationId),
    index("idx_events_stream_actor").on(table.streamId, table.actor),
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
  ],
);
