// Importing this fixture has no database or worker side effects. Callers choose
// the schema construction path before explicitly inserting the graph.
const quote = (value) => `"${value.replaceAll('"', '""')}"`;

export const outputGraphTables = ["output_atomic_assertions", "output_commands", "output_plan_revisions", "output_plan_targets", "output_preflights", "output_execution_grants", "output_operation_slots", "output_operation_routes", "output_provider_calls", "output_assets", "output_asset_storage_writes", "output_native_storage_writes", "output_results", "output_target_acceptances", "output_plan_fulfillments", "output_delivery_manifests"];

export function valueFor(table, column) {
  const id = { scope_key: "scope", owner_user_id: "owner", actor_user_id: "owner", payer_user_id: "owner", created_by_user_id: "owner", reviewer_user_id: "reviewer", project_id: "project", document_id: "document", plan_revision_id: "plan", plan_id: "document", target_id: "target", preflight_id: "preflight", grant_id: "grant", slot_id: "slot", stage_key: "stage", call_key: "call", asset_id: "asset", result_id: "result", acceptance_id: "acceptance" };
  if (column.name in id) return id[column.name];
  if (column.name === "scope_kind") return "personal";
  if (column.name === "media_kind") return "image";
  if (column.name === "checks_status") return "passed";
  if (column.name === "content_sha256") return "a".repeat(64);
  if (column.name === "status") return table.includes("storage_writes") ? "writing" : table === "output_provider_calls" ? "pending" : "authorized";
  if (["organization_id", "project_access_id", "context_id", "previous_slot_id", "redacted_at", "provider_response_id", "settled_at", "used_microusd"].includes(column.name)) return null;
  if (column.name.endsWith("event_id")) return "event";
  if (column.name === "byte_length") return 100;
  if (column.name === "maximum_tokens") return 1000;
  if (column.name.includes("microusd")) return 100;
  if (["source_head", "ordinal", "attempt_ordinal", "write_acknowledged", "is_partial"].includes(column.name)) return 0;
  if (column.type.toUpperCase() === "INTEGER") return 1;
  return column.name;
}

export function seedValidGraph(sqlite) {
  sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES('event','creative:owner',1,'now','now','user:owner','test','migration-proof',1,'SchemaFixture','{}')").run();
  for (const table of outputGraphTables) {
    const columns = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all();
    sqlite.prepare(`INSERT INTO ${quote(table)}(${columns.map((c) => quote(c.name)).join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((column) => valueFor(table, column)));
  }
}
