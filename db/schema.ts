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
