/** Fixed schema SQL shared by generated migration checks and runtime readiness.
 * No caller-supplied SQL, source content, identities or identifiers are accepted. */
export const SCENE_SOURCE_GENERATION_MAX = 9007199254740991;
const maximum = String(SCENE_SOURCE_GENERATION_MAX);
type Operation = "INSERT" | "UPDATE" | "DELETE";
type SourceTable = "events" | "event_private_payloads" | "project_event_scopes";
function affected(table: SourceTable, operation: Operation): string {
  const old = operation !== "INSERT", next = operation !== "DELETE";
  const references: string[] = [];
  if (table === "events") {
    if (old) references.push("SELECT OLD.stream_id AS scope_key");
    if (next) references.push("SELECT NEW.stream_id AS scope_key", `SELECT stream_id AS scope_key FROM events
      WHERE event_id=NEW.event_id OR (stream_id=NEW.stream_id AND sequence=NEW.sequence) OR rowid=NEW.rowid`);
  } else if (table === "event_private_payloads") {
    if (old) references.push("SELECT stream_id AS scope_key FROM events WHERE event_id=OLD.private_event_id");
    if (next) references.push("SELECT stream_id AS scope_key FROM events WHERE event_id=NEW.private_event_id",
      `SELECT event.stream_id AS scope_key FROM event_private_payloads conflicting JOIN events event ON event.event_id=conflicting.private_event_id
       WHERE conflicting.private_event_id=NEW.private_event_id OR conflicting.rowid=NEW.rowid`);
  } else {
    if (old) references.push("SELECT OLD.project_access_id AS scope_key");
    if (next) references.push("SELECT NEW.project_access_id AS scope_key", `SELECT project_access_id AS scope_key FROM project_event_scopes
      WHERE event_id=NEW.event_id OR (project_access_id=NEW.project_access_id AND project_sequence=NEW.project_sequence) OR rowid=NEW.rowid`);
  }
  return references.join(" UNION ");
}
function sourceTrigger(table: SourceTable, operation: Operation) {
  const kind = table === "project_event_scopes" ? "project" : "stream";
  let keys = `SELECT '${kind}' AS scope_kind,scope_key FROM (${affected(table, operation)})`;
  if (table !== "project_event_scopes") {
    const ids: string[] = [], field = table === "events" ? "event_id" : "private_event_id";
    if (operation !== "INSERT") ids.push(`SELECT OLD.${field} AS event_id`);
    if (operation !== "DELETE") {
      ids.push(`SELECT NEW.${field} AS event_id`);
      ids.push(table === "events"
        ? "SELECT event_id FROM events WHERE event_id=NEW.event_id OR (stream_id=NEW.stream_id AND sequence=NEW.sequence) OR rowid=NEW.rowid"
        : "SELECT private_event_id AS event_id FROM event_private_payloads WHERE private_event_id=NEW.private_event_id OR rowid=NEW.rowid");
    }
    // Project history joins membership by event identity, not by owner stream.
    // Invalidate member content even when its event belongs to another stream.
    keys += ` UNION SELECT 'project' AS scope_kind,project_access_id AS scope_key FROM project_event_scopes WHERE event_id IN (${ids.join(" UNION ")})`;
  }
  return { name: `scene_source_${table}_${operation.toLowerCase()}`, sql: `CREATE TRIGGER scene_source_${table}_${operation.toLowerCase()}
    BEFORE ${operation} ON ${table} BEGIN
      UPDATE scene_source_generations SET generation=CASE WHEN generation<${maximum} THEN generation+1 ELSE generation END
        WHERE (scope_kind,scope_key) IN (${keys});
      INSERT INTO scene_source_generations(scope_kind,scope_key,generation)
        SELECT affected.scope_kind,affected.scope_key,1 FROM (${keys}) affected
        WHERE affected.scope_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_source_generations current
          WHERE current.scope_kind=affected.scope_kind AND current.scope_key=affected.scope_key);
    END` };
}
export const SCENE_SOURCE_GENERATION_TRIGGERS = Object.freeze([
  { name: "scene_source_generations_insert_guard", sql: `CREATE TRIGGER scene_source_generations_insert_guard BEFORE INSERT ON scene_source_generations
    WHEN NEW.generation IS NOT 1 OR EXISTS(SELECT 1 FROM scene_source_generations WHERE (scope_kind=NEW.scope_kind AND scope_key=NEW.scope_key) OR rowid=NEW.rowid)
    BEGIN SELECT RAISE(ABORT,'scene_source_generation_reset'); END` },
  { name: "scene_source_generations_update_guard", sql: `CREATE TRIGGER scene_source_generations_update_guard BEFORE UPDATE ON scene_source_generations
    WHEN NEW.scope_kind IS NOT OLD.scope_kind OR NEW.scope_key IS NOT OLD.scope_key OR NEW.rowid IS NOT OLD.rowid
      OR NOT (NEW.generation IS OLD.generation+1 AND OLD.generation<${maximum} OR OLD.generation=${maximum} AND NEW.generation IS OLD.generation)
    BEGIN SELECT RAISE(ABORT,'scene_source_generation_reset'); END` },
  { name: "scene_source_generations_delete_guard", sql: `CREATE TRIGGER scene_source_generations_delete_guard BEFORE DELETE ON scene_source_generations
    BEGIN SELECT RAISE(ABORT,'scene_source_generation_reset'); END` },
  { name: "scene_source_epoch_insert_guard", sql: `CREATE TRIGGER scene_source_epoch_insert_guard BEFORE INSERT ON scene_source_epoch
    WHEN NEW.singleton IS NOT 1 OR NEW.schema_version IS NOT 1 OR NEW.generation IS NOT 1 OR EXISTS(SELECT 1 FROM scene_source_epoch)
    BEGIN SELECT RAISE(ABORT,'scene_source_epoch_reset'); END` },
  { name: "scene_source_epoch_update_guard", sql: `CREATE TRIGGER scene_source_epoch_update_guard BEFORE UPDATE ON scene_source_epoch
    WHEN NEW.singleton IS NOT OLD.singleton OR NEW.schema_version IS NOT OLD.schema_version OR NEW.instance_nonce IS NOT OLD.instance_nonce
      OR NOT (NEW.generation IS OLD.generation+1 AND OLD.generation<${maximum} OR OLD.generation=${maximum} AND NEW.generation IS OLD.generation)
    BEGIN SELECT RAISE(ABORT,'scene_source_epoch_reset'); END` },
  { name: "scene_source_epoch_delete_guard", sql: `CREATE TRIGGER scene_source_epoch_delete_guard BEFORE DELETE ON scene_source_epoch
    BEGIN SELECT RAISE(ABORT,'scene_source_epoch_reset'); END` },
  ...(["events", "event_private_payloads", "project_event_scopes"] as const).flatMap(table =>
    (["INSERT", "UPDATE", "DELETE"] as const).map(operation => sourceTrigger(table, operation))),
].map(value => Object.freeze(value)));

// Operational activation is allowed only after complete schema certification.
// No backfill, history copy, overwrite, counter reset or new source admission.
export const SCENE_SOURCE_EPOCH_ACTIVATE_SQL = `INSERT INTO scene_source_epoch(singleton,schema_version,instance_nonce,generation)
  SELECT 1,1,lower(hex(randomblob(16))),1 WHERE NOT EXISTS(SELECT 1 FROM scene_source_epoch)`;
export const SCENE_SOURCE_EPOCH_ADVANCE_SQL = `UPDATE scene_source_epoch
  SET generation=CASE WHEN generation<${maximum} THEN generation+1 ELSE generation END WHERE singleton=1`;
