/** Administrative decisions are separate from provider usage and ordinary settlement. */
export const HOLD_DISPOSITION_STATUS = "administratively_released";
export const HOLD_DISPOSITION_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS `budget_hold_dispositions` (\n\t`disposition_id` text PRIMARY KEY NOT NULL,\n\t`operator_id` text NOT NULL,\n\t`job_id` text NOT NULL,\n\t`correlation_id` text NOT NULL,\n\t`token_reservation_id` text NOT NULL,\n\t`cost_reservation_id` text NOT NULL,\n\t`command_sha256` text NOT NULL,\n\t`record_sha256` text NOT NULL,\n\t`record_json` text NOT NULL,\n\t`event_id` text NOT NULL,\n\t`created_at` text NOT NULL\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `budget_hold_dispositions_token_reservation_id_unique` ON `budget_hold_dispositions` (`token_reservation_id`)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `budget_hold_dispositions_cost_reservation_id_unique` ON `budget_hold_dispositions` (`cost_reservation_id`)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `budget_hold_dispositions_event_id_unique` ON `budget_hold_dispositions` (`event_id`)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `idx_hold_dispositions_job_attempt` ON `budget_hold_dispositions` (`job_id`,`correlation_id`)",
  `CREATE TRIGGER IF NOT EXISTS budget_hold_dispositions_no_update BEFORE UPDATE ON budget_hold_dispositions
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END`,
  `CREATE TRIGGER IF NOT EXISTS budget_hold_dispositions_no_delete BEFORE DELETE ON budget_hold_dispositions
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END`,
  `CREATE TRIGGER IF NOT EXISTS budget_hold_dispositions_no_replace BEFORE INSERT ON budget_hold_dispositions
    WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE disposition_id=NEW.disposition_id
      OR token_reservation_id=NEW.token_reservation_id OR cost_reservation_id=NEW.cost_reservation_id
      OR event_id=NEW.event_id OR (job_id=NEW.job_id AND correlation_id=NEW.correlation_id))
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END`,
  ...["budget_reservations", "cost_budget_reservations"].flatMap(table => {
    const column = table === "budget_reservations" ? "token_reservation_id" : "cost_reservation_id";
    return ["INSERT", "UPDATE", "DELETE"].map(action => `CREATE TRIGGER IF NOT EXISTS ${table}_disposition_no_${action.toLowerCase()}
      BEFORE ${action} ON ${table} WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE ${action === "UPDATE" ? `${column} IN(OLD.reservation_id,NEW.reservation_id)` : `${column}=${action === "INSERT" ? "NEW" : "OLD"}.reservation_id`})
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END`);
  }),
];

/** Pin the installed table and all immutable guards; a table-only migration is not sufficient. */
export function holdSchemaProof() {
  const sql = HOLD_DISPOSITION_SCHEMA.map(() => "EXISTS(SELECT 1 FROM sqlite_schema WHERE name=? AND sql=?)").join(" AND ");
  // SQLite stores the creator's whitespace but removes IF NOT EXISTS. The shipped
  // operation SQL and production migration deliberately use the same definitions.
  return {sql,bindings:HOLD_DISPOSITION_SCHEMA.flatMap(statement=>{
    const match=/^CREATE (?:TABLE|TRIGGER|UNIQUE INDEX) (?:IF NOT EXISTS )?[`"]?([a-z_][a-z0-9_]*)[`"]?(?:\s|\()/.exec(statement);
    if (!match) throw new Error("Unsupported hold schema definition");
    const name=match[1];
    return [name,statement.replace("IF NOT EXISTS ","")];
  })};
}
