import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

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
