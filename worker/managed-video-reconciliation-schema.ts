/** The migration owns these definitions. Runtime code only verifies them. */
export const VIDEO_RECONCILIATION_SCHEMA = [
  "CREATE TABLE `managed_video_reconciliations` (\n\t`reconciliation_id` text PRIMARY KEY NOT NULL,\n\t`operator_id` text NOT NULL,\n\t`job_id` text NOT NULL,\n\t`correlation_id` text NOT NULL,\n\t`token_reservation_id` text NOT NULL,\n\t`cost_reservation_id` text NOT NULL,\n\t`command_sha256` text NOT NULL,\n\t`treatment_sha256` text NOT NULL,\n\t`record_sha256` text NOT NULL,\n\t`record_json` text NOT NULL,\n\t`created_at` text NOT NULL\n)",
  "CREATE UNIQUE INDEX `managed_video_reconciliations_token_reservation_id_unique` ON `managed_video_reconciliations` (`token_reservation_id`)",
  "CREATE UNIQUE INDEX `managed_video_reconciliations_cost_reservation_id_unique` ON `managed_video_reconciliations` (`cost_reservation_id`)",
  "CREATE UNIQUE INDEX `idx_video_reconciliations_job_attempt` ON `managed_video_reconciliations` (`job_id`,`correlation_id`)",
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER managed_video_reconciliations_no_${action.toLowerCase()} BEFORE ${action} ON managed_video_reconciliations
    BEGIN SELECT RAISE(ABORT,'video_reconciliations_are_append_only'); END`),
  `CREATE TRIGGER managed_video_reconciliations_no_replace BEFORE INSERT ON managed_video_reconciliations
    WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE reconciliation_id=NEW.reconciliation_id
      OR token_reservation_id=NEW.token_reservation_id OR cost_reservation_id=NEW.cost_reservation_id
      OR (job_id=NEW.job_id AND correlation_id=NEW.correlation_id))
    BEGIN SELECT RAISE(ABORT,'video_reconciliations_are_append_only'); END`,
  ...["budget_reservations", "cost_budget_reservations"].flatMap(table => {
    const column = table === "budget_reservations" ? "token_reservation_id" : "cost_reservation_id";
    return ["INSERT", "UPDATE", "DELETE"].map(action => `CREATE TRIGGER ${table}_video_reconciliation_no_${action.toLowerCase()}
      BEFORE ${action} ON ${table} WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE ${action === "UPDATE" ? `${column} IN(OLD.reservation_id,NEW.reservation_id)` : `${column}=${action === "INSERT" ? "NEW" : "OLD"}.reservation_id`})
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END`);
  }),
];

export function videoReconciliationSchemaProof() {
  const definitions = [...VIDEO_RECONCILIATION_SCHEMA,
    "CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL CHECK(passed=1))"];
  return { sql: definitions.map(() => "EXISTS(SELECT 1 FROM sqlite_schema WHERE name=? AND sql=?)").join(" AND "),
    bindings: definitions.flatMap(statement => {
      const name = /^CREATE (?:TABLE|TRIGGER|UNIQUE INDEX) [`"]?([a-z_][a-z0-9_]*)[`"]?(?:\s|\()/u.exec(statement)?.[1];
      if (!name) throw new Error("Unsupported reconciliation schema definition");
      return [name, statement];
    }) };
}
