/** Pure SQL construction for the one reviewed Output model3d rebuild.
 * The caller must execute each returned statement array in one transaction.
 */
const guardTable = "__output_model3d_migration_guard";
const legacyAssertionToken = "output-model3d-schema-foreign-keys";
const copies = [
  {
    table: "output_plan_targets",
    columns: "scope_key,plan_revision_id,target_id,target_contract_digest,media_kind,required,selected,ordinal",
    before: "media_kind IN('image','slides','audio','video','document','unknown')",
    after: "media_kind IN('image','slides','audio','video','document','model3d','unknown')",
  },
  {
    table: "output_assets",
    columns: "scope_key,asset_id,document_id,owner_user_id,created_by_user_id,source_digest,storage_key,content_sha256,byte_length,mime_type,media_kind,created_event_id,created_at,redacted_at",
    before: "media_kind IN('image','slides','audio','video','document')",
    after: "media_kind IN('image','slides','audio','video','document','model3d')",
  },
  {
    table: "output_asset_storage_writes",
    columns: "scope_key,asset_id,owner_user_id,actor_user_id,organization_id,project_access_id,project_id,document_id,context_id,command_key,request_digest,source_digest,storage_key,content_sha256,byte_length,status,write_acknowledged,publication_event_id,created_at,updated_at",
    before: "typeof(byte_length)='integer' AND byte_length>0 AND byte_length<=24000000",
    after: "typeof(byte_length)='integer' AND byte_length>0 AND byte_length<=67108864",
  },
] as const;
const unchangedTables = ["output_atomic_assertions", "output_operation_slots", "output_results", "output_plan_fulfillments"] as const;
const guardedTables: readonly string[] = [...copies.map(copy => copy.table), ...unchangedTables];
const stagingTables = copies.map(copy => `__${copy.table}_model3d`);
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const literals = (values: readonly string[]) => values.map(literal).join(",");
const all = (conditions: readonly string[]) => conditions.map(condition => `(${condition})`).join(" AND ");
const sameRows = (left: string, right: string) => `NOT EXISTS(${left} EXCEPT ${right}) AND NOT EXISTS(${right} EXCEPT ${left})`;
const proof = (token: string, condition: string) => `INSERT INTO main.${identifier(guardTable)}(token) SELECT CASE WHEN (${condition}) THEN ${literal(token)} ELSE NULL END`;
const noForeignKeyViolations = "NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check)";

// Only outer SQL syntax is normalized. Literal contents, CHECK predicates,
// column definitions and internal whitespace must match a known declaration.
function canonicalDeclaration(sql: string): string {
  return sql.trim().replace(/;$/u, "")
    .replace(/^CREATE TABLE IF NOT EXISTS /u, "CREATE TABLE ")
    .replace(/^CREATE (UNIQUE )?INDEX IF NOT EXISTS /u, "CREATE $1INDEX ");
}
function declarationFor(schema: readonly string[], table: string): string {
  const declarations = schema.filter(sql => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${table}(`));
  if (declarations.length !== 1) throw new Error(`output_model3d_declaration_missing:${table}`);
  return canonicalDeclaration(declarations[0]!);
}
function tableMatches(table: string, declaration: string, renamed = false): string {
  const variants = [declaration];
  if (renamed) variants.push(declaration.replace(`CREATE TABLE ${table}(`, `CREATE TABLE ${identifier(table)}(`));
  return `EXISTS(SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name=${literal(table)} AND tbl_name=${literal(table)} AND sql COLLATE BINARY IN(${literals(variants)}))`;
}

function callerSettings(): string {
  const settings: ReadonlyArray<readonly [string, number]> = [
    ["foreign_keys", 1], ["defer_foreign_keys", 0], ["ignore_check_constraints", 0],
    ["legacy_alter_table", 0],
  ];
  // D1 denies writable_schema, including reads, at its SQL authorizer. The
  // local SQLite runner checks that flag before starting its transaction.
  // Keep the shared batch inside D1's documented PRAGMA allowlist.
  return all([
    ...settings.map(([name, expected]) => `EXISTS(SELECT 1 FROM pragma_${name} WHERE ${identifier(name)}=${expected})`),
    // TEMP objects could shadow a source table or attach a trigger invisible
    // in main.sqlite_schema. Reject them before any application-table write.
    "NOT EXISTS(SELECT 1 FROM temp.sqlite_schema)",
  ]);
}

type ExpectedIndex = { name: string; table: string; sql: string };
function sourceIndexes(schema: readonly string[]): ExpectedIndex[] {
  return schema.filter(sql => /^CREATE (?:UNIQUE )?INDEX /u.test(sql)).map(sql => {
    const canonical = canonicalDeclaration(sql);
    const match = /^CREATE (?:UNIQUE )?INDEX ([a-z0-9_]+) ON ([a-z0-9_]+)\(/u.exec(canonical);
    if (!match) throw new Error("output_model3d_index_declaration_unsupported");
    return { name: match[1]!, table: match[2]!, sql: canonical };
  }).filter(index => guardedTables.includes(index.table));
}
function attachmentsMatch(indexes: readonly ExpectedIndex[]): string {
  // Each guarded declaration has exactly one implicit primary-key index.
  // ALTER TABLE RENAME changes its generated name to the canonical table name.
  const expected = [
    ...guardedTables.map(table => `('index',${literal(`sqlite_autoindex_${table}_1`)},${literal(table)},NULL)`),
    ...indexes.map(index => `('index',${literal(index.name)},${literal(index.table)},${literal(index.sql)})`),
  ].join(",");
  const actual = `SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE lower(tbl_name) IN(${literals(guardedTables)}) AND type IN('index','trigger')`;
  // Comparing complete sets rejects extra indexes/triggers and missing or
  // differently defined named indexes, including unexpected implicit indexes.
  // D1 limits compound SELECTs to five terms. VALUES has no compound-term
  // limit and preserves the exact constant catalog used by both comparisons.
  return sameRows(actual, `SELECT * FROM (VALUES ${expected})`);
}

function inboundKeysMatch(): string {
  const targetColumns = ["scope_key", "plan_revision_id", "target_id"];
  const relationships = [
    { child: "output_operation_slots", parent: "output_plan_targets", columns: targetColumns },
    { child: "output_results", parent: "output_plan_targets", columns: targetColumns },
    { child: "output_results", parent: "output_assets", columns: ["scope_key", "asset_id"] },
    { child: "output_plan_fulfillments", parent: "output_plan_targets", columns: targetColumns },
  ];
  const expectedRows = relationships.flatMap(key => key.columns.map((column, sequence) =>
    `(${literal(key.child)},${literal(key.parent)},${sequence},${literal(column)},${literal(column)},'NO ACTION','NO ACTION','NONE')`));
  const watchedNames = [...copies.map(copy => copy.table), ...stagingTables, guardTable];
  const actual = `SELECT child.name,fk.[table],fk.seq,fk.[from],fk.[to],fk.on_update,fk.on_delete,fk.[match]
    FROM main.sqlite_schema AS child,pragma_foreign_key_list(child.name,'main') AS fk
    WHERE child.type='table' AND instr(lower(child.sql),'references')>0 AND lower(fk.[table]) IN(${literals(watchedNames)})`;
  // No namespace prefix is excluded. Even empty or NO ACTION dependencies
  // outside the known children require review; staging/guard inbound keys are
  // never allowed. DDL checks bind composite-key grouping on known children.
  // A foreign-key declaration must contain the REFERENCES keyword. Filtering
  // out declarations without it avoids inspecting D1's protected engine
  // tables while retaining every possible application foreign key, regardless
  // of its table name, keyword case or whitespace around that keyword.
  return all([
    sameRows(actual, `SELECT * FROM (VALUES ${expectedRows.join(",")})`),
    `(SELECT count(*) FROM (${actual}))=${expectedRows.length}`,
  ]);
}

function copiedColumnsMatch(): string {
  return all(copies.map(copy => {
    const columns = copy.columns.split(",");
    return all([
      `(SELECT count(*) FROM pragma_table_xinfo(${literal(copy.table)},'main'))=${columns.length}`,
      `NOT EXISTS(SELECT 1 FROM pragma_table_xinfo(${literal(copy.table)},'main') WHERE name NOT IN(${literals(columns)}) OR hidden<>0)`,
    ]);
  }));
}
function typedRows(table: string, columns: string): string {
  const values = ["rowid", ...columns.split(",")].flatMap(column => {
    const name = identifier(column);
    return [`typeof(${name})`, `${name} COLLATE BINARY`];
  });
  return `SELECT ${values.join(",")} FROM main.${identifier(table)}`;
}

export type OutputModel3dMigration = {
  migrationStatements: readonly string[];
  validationStatements: readonly string[];
  currentStateSql: string;
};

export function createOutputModel3dMigration(schema: readonly string[]): OutputModel3dMigration {
  const declarations = new Map<string, string>(guardedTables.map(table => [table, declarationFor(schema, table)]));
  const oldDeclarations = new Map<string, string>(copies.map(copy => {
    const declaration = declarations.get(copy.table)!;
    if (declaration.split(copy.after).length !== 2) throw new Error(`output_model3d_check_declaration_unsupported:${copy.table}`);
    return [copy.table, declaration.replace(copy.after, copy.before)] as const;
  }));
  const before = all(copies.map(copy => tableMatches(copy.table, oldDeclarations.get(copy.table)!)));
  const after = all(copies.map(copy => tableMatches(copy.table, declarations.get(copy.table)!, true)));
  const unchanged = all(unchangedTables.map(table => tableMatches(table, declarations.get(table)!)));
  const indexes = sourceIndexes(schema);
  const attachments = attachmentsMatch(indexes);
  const inbound = inboundKeysMatch();
  const columns = copiedColumnsMatch();
  const noStaging = `NOT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE lower(name) IN(${literals(stagingTables)}))`;
  // RENAME also rewrites references in other views/triggers. Reject existing
  // uses of these reserved names, even in unrelated objects, before staging
  // creation can make a previously invalid reference resolve to a new table.
  const reservedReferences = `NOT EXISTS(SELECT 1 FROM main.sqlite_schema WHERE name<>${literal(guardTable)} AND sql IS NOT NULL AND (${[...stagingTables, guardTable].map(name => `instr(lower(sql),${literal(name)})>0`).join(" OR ")}))`;
  const assertionAvailable = `NOT EXISTS(SELECT 1 FROM output_atomic_assertions WHERE token=${literal(legacyAssertionToken)})`;
  const createGuard = `CREATE TABLE main.${identifier(guardTable)}(token TEXT PRIMARY KEY NOT NULL)`;
  const dropGuard = `DROP TABLE main.${identifier(guardTable)}`;
  const settings = callerSettings();
  const preflight = (state: string) => [
    createGuard,
    // A fresh NOT NULL proof target cannot inherit an altered CHECK predicate
    // or trigger. A collision is an error, never permission to reuse a table.
    proof("caller-settings", settings),
    proof("known-contracts", all([state, unchanged, columns, noStaging, reservedReferences])),
    proof("known-attachments", attachments),
    proof("known-inbound-keys", inbound),
    proof("legacy-assertion-available", assertionAvailable),
    proof("foreign-keys-before", noForeignKeyViolations),
  ];
  const migrationStatements = [
    ...preflight(`(${before}) OR (${after})`),
    "PRAGMA defer_foreign_keys=ON",
    ...copies.flatMap(copy => {
      const temporary = `__${copy.table}_model3d`;
      return [
        declarations.get(copy.table)!.replace(`CREATE TABLE ${copy.table}(`, `CREATE TABLE ${temporary}(`),
        `INSERT INTO ${temporary}(rowid,${copy.columns}) SELECT rowid,${copy.columns} FROM ${copy.table}`,
        proof(`copy-${copy.table}`, sameRows(typedRows(copy.table, copy.columns), typedRows(temporary, copy.columns))),
        `DROP TABLE ${copy.table}`,
        `ALTER TABLE ${temporary} RENAME TO ${copy.table}`,
        ...indexes.filter(index => index.table === copy.table).map(index => index.sql),
      ];
    }),
    proof("completed-contracts", all([after, unchanged, columns, noStaging, reservedReferences])),
    proof("completed-attachments", attachments),
    proof("completed-inbound-keys", inbound),
    // Parent DROP leaves deferred counters even after replacement restores the
    // same keys. Check the whole actual graph before clearing those counters.
    proof("foreign-keys-after", noForeignKeyViolations),
    "PRAGMA defer_foreign_keys=OFF",
    proof("restored-settings", settings),
    dropGuard,
  ];
  return {
    migrationStatements,
    validationStatements: [...preflight(after), dropGuard],
    // This read is a routing hint only. Whichever path the caller chooses must
    // revalidate its accepted state and all guards in the execution transaction.
    currentStateSql: `SELECT CASE WHEN (${after}) THEN 1 ELSE 0 END AS current`,
  };
}

/** Render the very same runtime statements for the journaled 0022 SQL file. */
export function renderOutputModel3dMigration(statements: readonly string[]): string {
  return [
    "-- Preserve the Output graph while widening the model3d CHECK predicates.",
    "-- Execute every statement in one transaction with foreign keys enabled.",
    "-- Generated from OUTPUT_MODEL3D_SCHEMA_MIGRATION; runtime and journal SQL must agree.",
    statements.map(sql => `${sql};`).join("\n--> statement-breakpoint\n"),
    "",
  ].join("\n");
}
