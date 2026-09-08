/** Administrative decisions are separate from provider usage and ordinary settlement. */
export const HOLD_DISPOSITION_STATUS = "administratively_released";
export const HOLD_DISPOSITION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS budget_hold_dispositions (
    disposition_id TEXT PRIMARY KEY NOT NULL, operator_id TEXT NOT NULL,
    job_id TEXT NOT NULL, correlation_id TEXT NOT NULL,
    token_reservation_id TEXT NOT NULL UNIQUE, cost_reservation_id TEXT NOT NULL UNIQUE,
    command_sha256 TEXT NOT NULL, record_sha256 TEXT NOT NULL, record_json TEXT NOT NULL,
    event_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
    UNIQUE(job_id,correlation_id))`,
  `CREATE TRIGGER IF NOT EXISTS budget_hold_dispositions_no_update BEFORE UPDATE ON budget_hold_dispositions
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END`,
  `CREATE TRIGGER IF NOT EXISTS budget_hold_dispositions_no_delete BEFORE DELETE ON budget_hold_dispositions
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END`,
  ...["budget_reservations", "cost_budget_reservations"].flatMap(table => {
    const column = table === "budget_reservations" ? "token_reservation_id" : "cost_reservation_id";
    return ["UPDATE", "DELETE"].map(action => `CREATE TRIGGER IF NOT EXISTS ${table}_disposition_no_${action.toLowerCase()}
      BEFORE ${action} ON ${table} WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE ${column}=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END`);
  }),
];

/** Pin the installed table and all immutable guards; a table-only migration is not sufficient. */
export function holdSchemaProof() {
  const sql = HOLD_DISPOSITION_SCHEMA.map(() => "EXISTS(SELECT 1 FROM sqlite_schema WHERE name=? AND sql=?)").join(" AND ");
  // SQLite stores the creator's whitespace but removes IF NOT EXISTS. The shipped
  // operation SQL and runtime initializer deliberately use the same definitions.
  return {sql,bindings:HOLD_DISPOSITION_SCHEMA.flatMap(statement=>{
    const name=/CREATE (?:TABLE|TRIGGER) IF NOT EXISTS ([a-z_]+)/.exec(statement)![1];
    return [name,statement.replace("IF NOT EXISTS ","")];
  })};
}
