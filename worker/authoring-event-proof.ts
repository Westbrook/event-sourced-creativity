import type { BudgetReservationGuard } from "./pilot-policy.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings, type EventRow } from "./runtime.ts";

// Pure extraction of the Phase6 exact-row proofs. No event or sidecar is written here.
const JSON_BYTES = 1_900_000;
const ROWS_PER_STATEMENT = 128;
const byteLength = (value: string) => new TextEncoder().encode(value).length;
type ProofRow = readonly (string | number | null)[];

/** Write batches keep their 128-row bound. Read-only source proofs may pack by bytes only. */
export function authoringJsonChunks(rows: readonly unknown[], options: { byteBoundedOnly?: boolean } = {}): string[] {
  const chunks: string[] = [];
  let current: string[] = [], bytes = 2;
  for (const row of rows) {
    const json = JSON.stringify(row), size = byteLength(json);
    if (size + 2 > JSON_BYTES) throw new Error("authoring_payload_too_large");
    if (current.length && (!options.byteBoundedOnly && current.length >= ROWS_PER_STATEMENT || bytes + size + 1 > JSON_BYTES)) {
      chunks.push("[" + current.join(",") + "]"); current = []; bytes = 2;
    }
    current.push(json); bytes += size + 1;
  }
  if (current.length) chunks.push("[" + current.join(",") + "]");
  return chunks;
}

export const combineAuthoringGuards = (...guards: BudgetReservationGuard[]): BudgetReservationGuard => ({
  sql: guards.length ? guards.map((guard) => "(" + guard.sql + ")").join(" AND ") : "1",
  bindings: guards.flatMap((guard) => guard.bindings),
});

export const AUTHORING_EVENT_COLUMNS = EVENT_WRITE_COLUMNS.split(",").slice(0, 13);
const expectedJsonColumn = (index: number) => `json_extract(expected.value,'$[${index}]')`;

/** Allocated writes require a private row. A captured legacy source may prove its original absence. */
export function authoringEventRowsProof(rows: readonly ProofRow[], allowAbsentPrivate = false, options: { byteBoundedOnly?: boolean } = {}): BudgetReservationGuard {
  const proofs: BudgetReservationGuard[] = [];
  const join = allowAbsentPrivate ? "LEFT JOIN" : "JOIN";
  for (let first = 0; first < rows.length;) {
    const row = rows[first]!, serialized = JSON.stringify(row);
    if (row.length !== 17) throw new Error("authoring_write_proof_required");
    if (byteLength(serialized) + 2 > JSON_BYTES) {
      // Phase6's direct-binding fallback preserves a large existing body without JSON-escaping it again.
      if (row.some((value) => typeof value === "string" && byteLength(value) > 2_000_000)) throw new Error("authoring_payload_too_large");
      proofs.push({
        sql: `EXISTS(SELECT 1 FROM events event ${join} event_private_payloads secret ON secret.private_event_id=event.event_id
          WHERE (${AUTHORING_EVENT_COLUMNS.map((column) => "event." + column).join(",")},secret.owner_id,secret.project_id,secret.document_id,secret.private_json)
            IS (${Array.from({ length: 17 }, () => "?").join(",")}) AND secret.redacted_at IS NULL)`,
        bindings: [...row],
      });
      first++; continue;
    }
    const parts: string[] = []; let bytes = 2;
    while (first < rows.length && (options.byteBoundedOnly || parts.length < ROWS_PER_STATEMENT)) {
      if (rows[first]!.length !== 17) throw new Error("authoring_write_proof_required");
      const next = JSON.stringify(rows[first]), size = byteLength(next);
      if (size + 2 > JSON_BYTES || parts.length && bytes + size + 1 > JSON_BYTES) break;
      parts.push(next); bytes += size + 1; first++;
    }
    proofs.push({
      sql: `NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
        SELECT 1 FROM events event ${join} event_private_payloads secret ON secret.private_event_id=event.event_id
        WHERE (${AUTHORING_EVENT_COLUMNS.map((column) => "event." + column).join(",")},secret.owner_id,secret.project_id,secret.document_id,secret.private_json)
          IS (${Array.from({ length: 17 }, (_, index) => expectedJsonColumn(index)).join(",")}) AND secret.redacted_at IS NULL))`,
      bindings: ["[" + parts.join(",") + "]"],
    });
  }
  return combineAuthoringGuards(...proofs);
}

export function authoringEventProof(events: readonly EventRow[]): BudgetReservationGuard {
  if (!events.length || events.length > 512) throw new Error("invalid_authoring_operation");
  return authoringEventRowsProof(events.map(eventWriteBindings));
}

export const AUTHORING_SIDECAR_COLUMNS = {
  project_event_scopes: ["event_id", "project_access_id", "organization_id", "project_id", "owner_user_id", "source_stream_id", "source_sequence", "project_sequence", "actor_user_id", "created_at"],
  project_resource_scopes: ["project_access_id", "resource_kind", "resource_id", "organization_id", "project_id", "owner_user_id", "visibility", "source_event_id", "actor_user_id", "created_at"],
} as const;

/** These are the same complete-sidecar comparisons used by the prepared Phase6 atomic batch. */
export function authoringSidecarProof(table: keyof typeof AUTHORING_SIDECAR_COLUMNS, rows: readonly ProofRow[], options: { byteBoundedOnly?: boolean } = {}): BudgetReservationGuard {
  const columns = AUTHORING_SIDECAR_COLUMNS[table], proofs: BudgetReservationGuard[] = [];
  if (rows.some((row) => row.length !== columns.length)) throw new Error("authoring_write_proof_required");
  for (const json of authoringJsonChunks(rows, options)) {
    proofs.push({
      sql: `NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM ${table} stored
        WHERE (${columns.map((column) => "stored." + column).join(",")}) IS (${columns.map((_, index) => expectedJsonColumn(index)).join(",")})))`,
      bindings: [json],
    });
  }
  return combineAuthoringGuards(...proofs);
}
