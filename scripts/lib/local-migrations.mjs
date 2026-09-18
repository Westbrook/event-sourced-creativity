import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const RECEIPTS = "__forma_local_migrations";
const RECEIPT_SQL = `CREATE TABLE ${RECEIPTS} (
  tag TEXT PRIMARY KEY NOT NULL,
  hash TEXT NOT NULL,
  journal_when INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN ('applied','verified-existing')),
  executed_statements INTEGER NOT NULL,
  skipped_statements INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
)`;
const fail = (code, detail) => { throw new Error(`${code}: ${detail}`); };
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const hashSql = (sql) => createHash("sha256").update(sql).digest("hex");
const asPath = (path) => path instanceof URL ? fileURLToPath(path) : resolve(path);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sorted = (items) => items.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

// This is one reviewed migration, not permission to execute arbitrary rebuilds.
// Changing its SQL, source identity, or affected contracts requires a new handler.
const MODEL3D_REBUILD = {
  tag: "0022_output_model3d", when: 1788192000000,
  hash: "393bf222f1aa1210d679af3d588ffdf0e989cc6b9bd4db02eeef78cfb9907206",
  statementCount: 33, preflightCount: 7, clearsDeferralAt: 30,
  legacyHash: "e857a9750002d068c76651768835d5cc4b93ec484a657fc0bc58fe52e69dd291", legacyStatementCount: 19,
  assertion: "output-model3d-schema-foreign-keys",
  copies: [
    { table: "output_plan_targets", temporary: "__output_plan_targets_model3d", copiedAt: 9,
      before: "media_kind IN('image','slides','audio','video','document','unknown')",
      after: "media_kind IN('image','slides','audio','video','document','model3d','unknown')" },
    { table: "output_assets", temporary: "__output_assets_model3d", copiedAt: 14,
      before: "media_kind IN('image','slides','audio','video','document')",
      after: "media_kind IN('image','slides','audio','video','document','model3d')" },
    { table: "output_asset_storage_writes", temporary: "__output_asset_storage_writes_model3d", copiedAt: 20,
      before: "typeof(byte_length)='integer' AND byte_length>0 AND byte_length<=24000000",
      after: "typeof(byte_length)='integer' AND byte_length>0 AND byte_length<=67108864" },
  ],
};

/** Read source metadata only; the Drizzle journal is not an applied-history ledger. */
export function readLocalMigrations(directory) {
  const path = asPath(directory);
  let journal;
  try { journal = JSON.parse(readFileSync(join(path, "meta", "_journal.json"), "utf8")); }
  catch (error) { fail("migration_journal_invalid", error.message); }
  if (journal.dialect !== "sqlite" || !Array.isArray(journal.entries)) fail("migration_journal_invalid", "expected a SQLite journal with entries");
  const tags = new Set();
  const migrations = journal.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || entry.idx !== index || typeof entry.tag !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(entry.tag)
      || !Number.isSafeInteger(entry.when) || entry.when < 0 || tags.has(entry.tag)) fail("migration_journal_invalid", `invalid entry ${index}`);
    tags.add(entry.tag);
    const sql = readFileSync(join(path, `${entry.tag}.sql`), "utf8");
    return { ...entry, sql, hash: hashSql(sql) };
  });
  const files = readdirSync(path).filter((name) => name.endsWith(".sql")).sort();
  if (!equal(files, migrations.map(({ tag }) => `${tag}.sql`).sort())) fail("migration_journal_invalid", "SQL files and journal entries differ");
  return migrations;
}

// A deliberately small lexer, not a SQL rewrite engine. Literal values remain
// distinct from identifiers and retain their exact case and whitespace.
function tokens(sql) {
  const result = [];
  for (let cursor = 0; cursor < sql.length;) {
    const rest = sql.slice(cursor), char = sql[cursor];
    if (/\s/u.test(char)) { cursor++; continue; }
    if (rest.startsWith("--")) { const end = sql.indexOf("\n", cursor); cursor = end < 0 ? sql.length : end + 1; continue; }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", cursor + 2);
      if (end < 0) fail("migration_sql_unsupported", "unterminated comment");
      cursor = end + 2; continue;
    }
    if (["'", '"', "`", "["].includes(char)) {
      const close = char === "[" ? "]" : char;
      let value = "", closed = false; cursor++;
      while (cursor < sql.length) {
        if (sql[cursor] === close) {
          if (char !== "[" && sql[cursor + 1] === close) { value += close; cursor += 2; continue; }
          cursor++; closed = true; break;
        }
        value += sql[cursor++];
      }
      if (!closed) fail("migration_sql_unsupported", "unterminated quoted value");
      result.push({ kind: char === "'" ? "literal" : "identifier", value: char === "'" ? value : value.toLowerCase(), quoted: true, quote: char });
      continue;
    }
    const word = rest.match(/^[A-Za-z_$][A-Za-z0-9_$]*/u);
    if (word) { result.push({ kind: "identifier", value: word[0].toLowerCase() }); cursor += word[0].length; continue; }
    const number = rest.match(/^(?:0x[0-9a-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/iu);
    if (number) { result.push({ kind: "number", value: number[0].toLowerCase() }); cursor += number[0].length; continue; }
    const symbol = rest.match(/^(?:->>|->|<=|>=|<>|!=|==|\|\||[(),.;+*/%=<>!~&|^-])/u);
    if (!symbol) fail("migration_sql_unsupported", `unrecognized SQL token at offset ${cursor}`);
    result.push({ kind: "symbol", value: symbol[0] }); cursor += symbol[0].length;
  }
  return result;
}
const word = (token, value) => token?.kind === "identifier" && !token.quoted && token.value === value;
const nameAt = (list, index) => {
  if (list[index]?.kind !== "identifier") fail("migration_sql_unsupported", "expected an object name");
  return list[index].value;
};
function closingParen(list, opening) {
  let depth = 0;
  for (let index = opening; index < list.length; index++) {
    if (list[index].value === "(" && list[index].kind === "symbol") depth++;
    if (list[index].value === ")" && list[index].kind === "symbol" && --depth === 0) return index;
  }
  fail("migration_sql_unsupported", "unbalanced parentheses");
}
function expression(list, table) {
  let selected = list;
  while (selected[0]?.value === "(" && closingParen(selected, 0) === selected.length - 1) selected = selected.slice(1, -1);
  return selected.flatMap((token, index) => {
    if (token.kind === "identifier" && token.value === table && selected[index + 1]?.value === ".") return [];
    if (token.value === "." && selected[index - 1]?.kind === "identifier" && selected[index - 1].value === table) return [];
    return [[token.kind, token.value]];
  });
}
function defaultValue(value, unsupportedCode, table) {
  if (value === null) return null;
  const list = tokens(String(value));
  if (list.some((token) => token.kind === "identifier" && token.quote === '"')) fail(unsupportedCode, `double-quoted default schema is unsupported for ${table}`);
  const parsed = expression(list);
  if (equal(parsed, [["identifier", "null"]])) return null;
  if (equal(parsed, [["identifier", "true"]])) return [["number", "1"]];
  if (equal(parsed, [["identifier", "false"]])) return [["number", "0"]];
  return parsed;
}
function splitParts(list) {
  const parts = []; let opening = 0, depth = 0;
  list.forEach((token, index) => {
    if (token.kind !== "symbol") return;
    if (token.value === "(") depth++;
    if (token.value === ")") depth--;
    if (token.value === "," && depth === 0) { parts.push(list.slice(opening, index)); opening = index + 1; }
  });
  parts.push(list.slice(opening)); return parts;
}
function classify(sql) {
  const list = tokens(sql);
  if (!list.length) return null;
  if (list.at(-1)?.value === ";") list.pop();
  let kind, cursor = 1, unique = false;
  if (word(list[0], "create")) {
    if (word(list[cursor], "unique")) { unique = true; cursor++; }
    kind = list[cursor++]?.value;
    if (!["table", "index", "trigger"].includes(kind) || unique && kind !== "index") fail("migration_sql_unsupported", "only additive TABLE, INDEX and TRIGGER declarations are supported");
    if (word(list[cursor], "if") && word(list[cursor + 1], "not") && word(list[cursor + 2], "exists")) cursor += 3;
    const name = nameAt(list, cursor++);
    if (name.startsWith("sqlite_") || name === RECEIPTS || name === "__drizzle_migrations") fail("migration_sql_unsupported", `reserved object ${name}`);
    if (kind === "trigger") {
      const begin = list.findIndex((token, index) => index >= cursor && word(token, "begin"));
      if (begin < 0) fail("migration_sql_unsupported", `trigger ${name} has no body`);
      let depth = 1, end = -1;
      for (let index = begin + 1; index < list.length; index++) {
        if (word(list[index], "begin") || word(list[index], "case")) depth++;
        if (word(list[index], "end") && --depth === 0) { end = index; break; }
      }
      if (end !== list.length - 1 || list.slice(0, begin).some((token) => token.value === ";" && token.kind === "symbol")) fail("migration_sql_unsupported", `multiple statements in trigger ${name}`);
    } else if (list.some((token) => token.value === ";" && token.kind === "symbol")) fail("migration_sql_unsupported", "each breakpoint must contain one statement");
    if (kind === "table" && list[cursor]?.value !== "(") fail("migration_sql_unsupported", "CREATE TABLE AS and qualified names are unsupported");
    if (kind === "index" && !word(list[cursor], "on")) fail("migration_sql_unsupported", `invalid index ${name}`);
    return { kind, name, sql, list };
  }
  if (list.some((token) => token.value === ";" && token.kind === "symbol")) fail("migration_sql_unsupported", "each breakpoint must contain one statement");
  if (word(list[0], "alter") && word(list[1], "table") && word(list[3], "add")) {
    const table = nameAt(list, 2), columnIndex = word(list[4], "column") ? 5 : 4;
    if (table === RECEIPTS || table === "__drizzle_migrations" || table.startsWith("sqlite_")) fail("migration_sql_unsupported", `reserved table ${table}`);
    return { kind: "column", table, name: nameAt(list, columnIndex), sql, list };
  }
  if (list.length === 2 && word(list[0], "pragma") && word(list[1], "optimize")) return { kind: "optimize", sql, list };
  fail("migration_sql_unsupported", "only additive CREATE, ALTER TABLE ADD COLUMN, and PRAGMA optimize are supported");
}
function schemaObject(database, name) {
  return database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE").get(name);
}
function indexShape(database, object) {
  const table = object.tbl_name.toLowerCase();
  const index = database.prepare(`PRAGMA index_list(${quote(object.tbl_name)})`).all().find((item) => item.name.toLowerCase() === object.name.toLowerCase());
  const list = tokens(object.sql ?? ""), opening = list.findIndex((token) => token.value === "(" && token.kind === "symbol");
  const close = opening >= 0 ? closingParen(list, opening) : -1;
  const where = list.findIndex((token, position) => position > close && word(token, "where"));
  return {
    table, unique: index?.unique, origin: index?.origin, partial: index?.partial,
    keys: database.prepare(`PRAGMA index_xinfo(${quote(object.name)})`).all().filter((item) => item.key).map((item) => ({ name: item.name?.toLowerCase() ?? null, desc: item.desc, collation: item.coll?.toLowerCase() ?? null })),
    expressions: opening < 0 ? [] : splitParts(list.slice(opening + 1, close)).map((part) => {
      if (word(part.at(-1), "asc") || word(part.at(-1), "desc")) part = part.slice(0, -1);
      if (word(part.at(-2), "collate")) part = part.slice(0, -2);
      return expression(part, table);
    }),
    predicate: where < 0 ? null : expression(list.slice(where + 1).filter((token) => token.value !== ";" || token.kind !== "symbol"), table),
  };
}
function tableShape(database, name, unsupportedCode = "migration_schema_mismatch") {
  const object = schemaObject(database, name);
  if (object?.type !== "table" || !object.sql) fail("migration_schema_mismatch", `expected table ${name}`);
  const list = tokens(object.sql), opening = list.findIndex((token) => token.value === "(" && token.kind === "symbol");
  if (opening < 0) fail("migration_schema_mismatch", `unsupported table definition ${name}`);
  const parts = splitParts(list.slice(opening + 1, closingParen(list, opening)));
  const checks = [], extras = [];
  for (let part of parts) {
    if (word(part[0], "constraint")) part = part.slice(2);
    const scope = ["check", "unique", "primary", "foreign"].some((keyword) => word(part[0], keyword)) ? "table" : nameAt(part, 0);
    for (let index = 0; index < part.length; index++) {
      if (word(part[index], "check") && part[index + 1]?.value === "(") {
        const end = closingParen(part, index + 1);
        checks.push({ scope, expression: expression(part.slice(index + 2, end), name) }); index = end;
      }
      if (word(part[index], "collate")) extras.push({ scope, kind: "collate", value: nameAt(part, index + 1) });
      if (word(part[index], "on") && word(part[index + 1], "conflict")) fail(unsupportedCode, `ON CONFLICT schema is unsupported for ${name}`);
      if (word(part[index], "autoincrement")) extras.push({ scope, kind: "autoincrement" });
      // SQLite foreign_key_list omits deferral; table-scoped extras cannot bind it to each key.
      if (word(part[index], "deferrable") || word(part[index], "initially")) fail(unsupportedCode, `DEFERRABLE/INITIALLY schema is unsupported for ${name}`);
    }
  }
  const columns = database.prepare(`PRAGMA table_xinfo(${quote(name)})`).all();
  if (columns.some((column) => column.hidden !== 0)) fail(unsupportedCode, `generated or hidden column schema is unsupported for ${name}`);
  const foreign = new Map();
  for (const row of database.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all()) {
    const item = foreign.get(row.id) ?? { table: row.table.toLowerCase(), columns: [], onUpdate: row.on_update, onDelete: row.on_delete, match: row.match };
    item.columns.push({ from: row.from.toLowerCase(), to: row.to?.toLowerCase() ?? null }); foreign.set(row.id, item);
  }
  const details = database.prepare("PRAGMA table_list").all().find((row) => row.schema === "main" && row.name.toLowerCase() === name.toLowerCase());
  return {
    columns: columns.map((row) => ({ name: row.name.toLowerCase(), type: row.type.toUpperCase(), notnull: row.notnull, default: defaultValue(row.dflt_value, unsupportedCode, name), pk: row.pk, hidden: row.hidden })),
    checks: sorted(checks), extras: sorted(extras), foreignKeys: sorted([...foreign.values()]),
    unique: sorted(database.prepare(`PRAGMA index_list(${quote(name)})`).all().filter((row) => row.origin !== "c").map((row) => {
      const shape = indexShape(database, { name: row.name, tbl_name: name, sql: null });
      return { origin: shape.origin, keys: shape.keys };
    })),
    strict: details?.strict, withoutRowid: details?.wr,
  };
}
function triggerShape(object) {
  const list = tokens(object.sql);
  if (word(list[2], "if") && word(list[3], "not") && word(list[4], "exists")) list.splice(2, 3);
  if (list.at(-1)?.value === ";") list.pop();
  return { table: object.tbl_name.toLowerCase(), definition: expression(list, object.tbl_name.toLowerCase()) };
}
function validateTable(database, name, expected, required = expected.columns.map((column) => column.name)) {
  const actual = tableShape(database, name), present = new Set(actual.columns.map((column) => column.name));
  if (required.some((column) => !present.has(column))) fail("migration_schema_mismatch", `missing required column in ${name}`);
  const subset = {
    ...expected,
    columns: expected.columns.filter((column) => present.has(column.name)),
    checks: expected.checks.filter((check) => check.scope === "table" || present.has(check.scope)),
    extras: expected.extras.filter((extra) => extra.scope === "table" || present.has(extra.scope)),
    foreignKeys: expected.foreignKeys.filter((key) => key.columns.every((column) => present.has(column.from))),
  };
  // Column order is retained by this runner, but equivalent runtime declarations
  // may have a different physical order. Names and every column contract matter.
  actual.columns = sorted(actual.columns); subset.columns = sorted(subset.columns);
  // SQLite gives a column CHECK and the same table CHECK identical behavior.
  // Scope is retained above only to omit checks on later, absent columns.
  actual.checks = sorted(actual.checks.map((check) => check.expression));
  subset.checks = sorted(subset.checks.map((check) => check.expression));
  if (!equal(actual, subset)) fail("migration_schema_mismatch", `incompatible table ${name}`);
}
function validateObject(database, statement, reference) {
  const actual = schemaObject(database, statement.name), expected = schemaObject(reference, statement.name);
  if (!actual || actual.type !== statement.kind) fail("migration_schema_mismatch", `expected ${statement.kind} ${statement.name}`);
  const describe = statement.kind === "index" ? (object, db) => indexShape(db, object) : triggerShape;
  if (!equal(describe(actual, database), describe(expected, reference))) fail("migration_schema_mismatch", `incompatible ${statement.kind} ${statement.name}`);
}

function attachedShapes(database, table) {
  return sorted(database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name=? COLLATE NOCASE AND type IN ('index','trigger') AND sql IS NOT NULL").all(table)
    .map((object) => ({ type: object.type, name: object.name.toLowerCase(),
      shape: object.type === "index" ? indexShape(database, object) : triggerShape(object) })));
}
const comparableTable = (shape) => ({ ...shape, columns: sorted(shape.columns), checks: sorted(shape.checks.map((check) => check.expression)) });

function prepareModel3dRebuild(reference, migration, tableNames) {
  const names = new Set(MODEL3D_REBUILD.copies.map((copy) => copy.table));
  const before = new Map([...names].map((name) => [name, tableShape(reference, name, "migration_sql_unsupported")]));
  const dependencies = new Map([...tableNames].map((name) => [name, tableShape(reference, name, "migration_sql_unsupported")])
    .filter(([, shape]) => shape.foreignKeys.some((key) => names.has(key.table))));
  const guardedNames = new Set([...names, ...dependencies.keys(), "output_atomic_assertions"]);
  const attached = new Map([...guardedNames].map((name) => [name, attachedShapes(reference, name)]));
  // The fixed SQL neither restores triggers nor supports foreign-key actions.
  for (const name of [...names, "output_atomic_assertions"]) {
    if (attached.get(name).some((object) => object.type === "trigger")) fail("migration_sql_unsupported", `unreviewed trigger on ${name}`);
  }
  for (const [name, shape] of dependencies) {
    if (shape.foreignKeys.some((key) => names.has(key.table) && key.onDelete !== "NO ACTION")) fail("migration_sql_unsupported", `unreviewed delete action on ${name}`);
  }
  const assertions = tableShape(reference, "output_atomic_assertions", "migration_sql_unsupported");
  reference.exec("PRAGMA foreign_keys=ON; BEGIN");
  try {
    for (const statement of migration.statements) reference.exec(statement.sql);
    reference.exec("COMMIT");
  } catch (error) {
    if (reference.isTransaction) reference.exec("ROLLBACK");
    throw error;
  }
  const after = new Map([...names].map((name) => [name, tableShape(reference, name, "migration_sql_unsupported")]));
  for (const copy of MODEL3D_REBUILD.copies) {
    const oldCheck = expression(tokens(copy.before), copy.table), newCheck = expression(tokens(copy.after), copy.table);
    const expected = structuredClone(before.get(copy.table));
    const checks = expected.checks.filter((check) => equal(check.expression, oldCheck));
    if (checks.length !== 1) fail("migration_sql_unsupported", `unreviewed legacy contract for ${copy.table}`);
    checks[0].expression = newCheck;
    if (!equal(comparableTable(expected), comparableTable(after.get(copy.table)))) fail("migration_sql_unsupported", `unexpected rebuild contract for ${copy.table}`);
    if (!equal(attached.get(copy.table), attachedShapes(reference, copy.table))) fail("migration_sql_unsupported", `rebuild changes attached objects on ${copy.table}`);
  }
  return { names, before, after, dependencies, attached, assertions, migration };
}

function matchesTable(database, name, expected) {
  try { validateTable(database, name, expected); return true; }
  catch (error) {
    if (!String(error.message).startsWith("migration_schema_mismatch:")) throw error;
    return false;
  }
}
function model3dEpoch(database, rebuild, recorded, allowMissing = false) {
  const states = new Set();
  for (const name of rebuild.names) {
    if (!schemaObject(database, name)) states.add("missing");
    else if (matchesTable(database, name, rebuild.after.get(name))) states.add("after");
    else if (matchesTable(database, name, rebuild.before.get(name))) states.add("before");
    else fail("migration_schema_mismatch", `unrecognized rebuild state for ${name}`);
  }
  if ((states.has("after") && states.size !== 1) || (!allowMissing && states.has("missing")) || (recorded && !states.has("after")))
    fail("migration_schema_mismatch", "partial or receipt-inconsistent 3D schema");
  return states.has("after") ? "after" : "before";
}
function completeForeignKeyCheck(database) {
  if (database.prepare("PRAGMA foreign_key_check").get()) fail("migration_schema_mismatch", "foreign-key violations prevent the 3D rebuild");
}
function guardModel3dPragmas(database) {
  for (const [pragma, expected] of [["defer_foreign_keys", 0], ["foreign_keys", 1], ["ignore_check_constraints", 0], ["writable_schema", 0], ["legacy_alter_table", 0]]) {
    if (database.prepare(`PRAGMA ${pragma}`).get()?.[pragma] !== expected) fail("migration_schema_mismatch", `3D rebuild requires ${pragma}=${expected}`);
  }
}
function guardModel3dRebuild(database, rebuild) {
  guardModel3dPragmas(database);
  for (const copy of MODEL3D_REBUILD.copies) {
    if (schemaObject(database, copy.temporary)) fail("migration_schema_mismatch", `existing staging object ${copy.temporary}`);
  }
  validateTable(database, "output_atomic_assertions", rebuild.assertions);
  if (database.prepare("SELECT 1 FROM output_atomic_assertions WHERE token=?").get(MODEL3D_REBUILD.assertion)) fail("migration_schema_mismatch", "3D assertion token is already occupied");
  // Unknown inbound children could cascade or otherwise lose data during DROP.
  // Check all tables, not just the output_% names used in the historical SQL.
  for (const { name } of database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all()) {
    const inbound = database.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all().filter((key) => rebuild.names.has(key.table.toLowerCase()));
    if (!inbound.length) continue;
    const expected = rebuild.dependencies.get(name.toLowerCase());
    if (!expected || inbound.some((key) => key.on_delete !== "NO ACTION")) fail("migration_schema_mismatch", `unreviewed inbound foreign key on ${name}`);
    validateTable(database, name, expected);
  }
  for (const [name, expected] of rebuild.attached) {
    if (!equal(attachedShapes(database, name), expected)) fail("migration_schema_mismatch", `unexpected indexes or triggers on ${name}`);
  }
  completeForeignKeyCheck(database);
}

function rowFingerprint(database, name, shape) {
  const columns = shape.columns.map((column) => column.name).sort();
  const statement = database.prepare(`SELECT rowid AS __forma_rowid__,${columns.map(quote).join(",")} FROM ${quote(name)} ORDER BY rowid`);
  statement.setReadBigInts(true);
  const digest = createHash("sha256");
  for (const row of statement.iterate()) {
    const values = Object.values(row).map((value) => value === null ? ["null"] : typeof value === "bigint" ? ["integer", value.toString()]
      : typeof value === "number" ? ["real", Object.is(value, -0) ? "-0" : String(value)]
        : value instanceof Uint8Array ? ["blob", Buffer.from(value).toString("hex")] : ["text", value]);
    digest.update(JSON.stringify(values));
    digest.update("\n");
  }
  return digest.digest("hex");
}
function executeModel3dRebuild(database, rebuild, recorded) {
  const epoch = model3dEpoch(database, rebuild, recorded);
  guardModel3dRebuild(database, rebuild);
  if (epoch === "after") {
    // Reuse the exact reviewed SQL guards even when no parent needs rebuilding.
    // This also validates a historical local receipt without rewriting its hash.
    const statements = rebuild.migration.statements;
    for (const statement of [...statements.slice(0, MODEL3D_REBUILD.preflightCount), statements.at(-1)]) database.exec(statement.sql);
    return { executedStatements: 0, skippedStatements: statements.length };
  }
  const shapes = new Map([...rebuild.before, ...rebuild.dependencies, ["output_atomic_assertions", rebuild.assertions]]);
  const fingerprints = new Map([...shapes].map(([name, shape]) => [name, rowFingerprint(database, name, shape)]));
  for (const [index, statement] of rebuild.migration.statements.entries()) {
    // Prove every FK before the fixed statement that clears deferral.
    if (index === MODEL3D_REBUILD.clearsDeferralAt) completeForeignKeyCheck(database);
    database.exec(statement.sql);
    const copy = MODEL3D_REBUILD.copies.find((item) => item.copiedAt === index);
    if (copy && rowFingerprint(database, copy.temporary, shapes.get(copy.table)) !== fingerprints.get(copy.table))
      fail("migration_schema_mismatch", `3D copy changed rows before dropping ${copy.table}`);
  }
  if (model3dEpoch(database, rebuild, true) !== "after") fail("migration_schema_mismatch", "3D schema was not completed");
  for (const [name, shape] of shapes) {
    if (rowFingerprint(database, name, shape) !== fingerprints.get(name)) fail("migration_schema_mismatch", `3D rebuild changed existing rows in ${name}`);
  }
  guardModel3dRebuild(database, rebuild);
  return { executedStatements: rebuild.migration.statements.length, skippedStatements: 0 };
}

function prepareMigrations(migrations) {
  if (!Array.isArray(migrations)) fail("migration_journal_invalid", "migrations must be an array");
  const tags = new Set();
  return migrations.map((migration) => {
    if (!migration || typeof migration !== "object") fail("migration_journal_invalid", "invalid migration entry");
    const { tag, when, sql } = migration;
    if (typeof tag !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(tag) || tags.has(tag) || typeof sql !== "string" || !Number.isSafeInteger(when) || when < 0) fail("migration_journal_invalid", "invalid migration entry");
    tags.add(tag);
    const hash = hashSql(sql);
    if (migration.hash !== undefined && migration.hash !== hash) fail("migration_hash_mismatch", tag);
    const model3d = tag === MODEL3D_REBUILD.tag;
    if (model3d && hash !== MODEL3D_REBUILD.hash) fail("migration_hash_mismatch", tag);
    if (model3d && when !== MODEL3D_REBUILD.when) fail("migration_sql_unsupported", "unreviewed 3D migration timestamp");
    const statements = model3d ? sql.split("--> statement-breakpoint").filter((part) => part.trim()).map((part) => ({ kind: "model3d", sql: part }))
      : sql.split("--> statement-breakpoint").map(classify).filter(Boolean);
    if (model3d && statements.length !== MODEL3D_REBUILD.statementCount) fail("migration_sql_unsupported", "unreviewed 3D statement count");
    return { ...migration, hash, model3d, statements };
  });
}

/** Apply/reconcile additive migrations and the exact reviewed 3D rebuild locally.
 * Source SQL and any external migration ledger remain unchanged. */
export function migrateLocalDatabase(database, { migrations, dryRun = false }) {
  const plan = prepareMigrations(migrations), reference = new DatabaseSync(":memory:"), receiptReference = new DatabaseSync(":memory:");
  let transaction = false, rebuild = null;
  try {
    const tableNames = new Set(), objectNames = new Set();
    for (const migration of plan) {
      if (migration.model3d) { rebuild = prepareModel3dRebuild(reference, migration, tableNames); continue; }
      for (const statement of migration.statements) {
        if (["table", "index", "trigger"].includes(statement.kind)) {
          if (objectNames.has(statement.name)) fail("migration_sql_unsupported", `duplicate declaration ${statement.name}`);
          objectNames.add(statement.name);
        }
        if (statement.kind === "column") statement.beforeColumns = tableShape(reference, statement.table, "migration_sql_unsupported").columns.map((column) => column.name);
        if (statement.kind !== "optimize") reference.exec(statement.sql);
        if (statement.kind === "table") {
          tableNames.add(statement.name);
          statement.requiredColumns = tableShape(reference, statement.name, "migration_sql_unsupported").columns.map((column) => column.name);
        }
        if (statement.kind === "column") statement.requiredColumns = tableShape(reference, statement.table, "migration_sql_unsupported").columns.map((column) => column.name);
      }
    }
    const tables = new Map([...tableNames].map((name) => [name, tableShape(reference, name, "migration_sql_unsupported")]));
    if (rebuild) {
      // Later unrelated additions work normally. Changes to the rebuilt tables
      // or their guarded dependencies need a separately reviewed handler.
      for (const [name, shape] of tables) {
        if (shape.foreignKeys.some((key) => rebuild.names.has(key.table)) && !rebuild.dependencies.has(name))
          fail("migration_sql_unsupported", `later migration adds a 3D foreign-key dependency on ${name}`);
      }
      for (const [name, expected] of [...rebuild.after, ...rebuild.dependencies, ["output_atomic_assertions", rebuild.assertions]]) {
        if (!equal(comparableTable(tables.get(name)), comparableTable(expected)) || !equal(attachedShapes(reference, name), rebuild.attached.get(name)))
          fail("migration_sql_unsupported", `later migration changes the guarded 3D contract for ${name}`);
      }
    }
    receiptReference.exec(RECEIPT_SQL);
    const receiptShape = tableShape(receiptReference, RECEIPTS);
    if (database.isTransaction) fail("migration_transaction_active", "caller already has a transaction");
    // Reject unsupported caller settings before BEGIN: rolling a new transaction
    // back would otherwise reset a caller's existing defer_foreign_keys setting.
    if (rebuild) guardModel3dPragmas(database);
    // TEMP triggers can target main tables while remaining invisible in
    // main.sqlite_schema; they could otherwise run during receipt insertion.
    if (database.prepare("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get()) fail("migration_schema_mismatch", "local migration connections must have an empty TEMP schema");
    database.exec("BEGIN IMMEDIATE"); transaction = true;
    if (schemaObject(database, RECEIPTS)) {
      try { validateTable(database, RECEIPTS, receiptShape); }
      catch { fail("migration_receipt_mismatch", "incompatible local receipt table"); }
      if (database.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name=? COLLATE NOCASE AND type IN ('index','trigger') AND sql IS NOT NULL LIMIT 1").get(RECEIPTS)) fail("migration_receipt_mismatch", "unexpected objects attached to local receipt table");
    } else database.exec(RECEIPT_SQL);
    const receipts = new Map(database.prepare(`SELECT * FROM ${RECEIPTS}`).all().map((row) => [row.tag, row]));
    for (const receipt of receipts.values()) {
      const source = plan.find((migration) => migration.tag === receipt.tag);
      if (!source || source.when !== receipt.journal_when) fail("migration_receipt_mismatch", `unrecognized source metadata for ${receipt.tag}`);
      const legacyModel3d = source.model3d && receipt.hash === MODEL3D_REBUILD.legacyHash;
      if (source.hash !== receipt.hash && !legacyModel3d) fail("migration_hash_mismatch", receipt.tag);
      if (!Number.isSafeInteger(receipt.executed_statements) || receipt.executed_statements < 0
        || !Number.isSafeInteger(receipt.skipped_statements) || receipt.skipped_statements < 0
        || receipt.executed_statements + receipt.skipped_statements !== (legacyModel3d ? MODEL3D_REBUILD.legacyStatementCount : source.statements.length)
        || receipt.disposition !== (receipt.executed_statements ? "applied" : "verified-existing")
        || typeof receipt.recorded_at !== "string") fail("migration_receipt_mismatch", `invalid local receipt for ${receipt.tag}`);
      if (source.model3d && receipt.executed_statements !== 0 && receipt.skipped_statements !== 0)
        fail("migration_receipt_mismatch", "the 3D rebuild cannot have a partial execution receipt");
    }
    const currentTables = new Map(tables);
    if (rebuild && model3dEpoch(database, rebuild, receipts.has(MODEL3D_REBUILD.tag), true) === "before") {
      for (const [name, shape] of rebuild.before) currentTables.set(name, shape);
    }
    const report = [];
    for (const migration of plan) {
      const receipt = receipts.get(migration.tag);
      let executedStatements = 0, skippedStatements = 0;
      if (migration.model3d) {
        ({ executedStatements, skippedStatements } = executeModel3dRebuild(database, rebuild, Boolean(receipt)));
        for (const [name, shape] of rebuild.after) currentTables.set(name, shape);
      } else for (const statement of migration.statements) {
        let exists = false;
        if (statement.kind === "table") {
          exists = Boolean(schemaObject(database, statement.name));
          if (exists) validateTable(database, statement.name, currentTables.get(statement.name), statement.requiredColumns);
        } else if (statement.kind === "column") {
          validateTable(database, statement.table, currentTables.get(statement.table), statement.beforeColumns);
          exists = tableShape(database, statement.table).columns.some((column) => column.name === statement.name);
        // Planner maintenance is advisory, outside schema reconciliation. Never
        // run it here or turn an existing migration into an apparent apply.
        } else if (statement.kind === "optimize") exists = true;
        else {
          exists = Boolean(schemaObject(database, statement.name));
          if (exists) validateObject(database, statement, reference);
        }
        if (exists) { skippedStatements++; continue; }
        if (receipt) fail("migration_schema_mismatch", `${migration.tag} is recorded but ${statement.name ?? statement.kind} is missing`);
        database.exec(statement.sql); executedStatements++;
        if (statement.kind === "column") validateTable(database, statement.table, currentTables.get(statement.table), statement.requiredColumns);
      }
      const legacyModel3d = migration.model3d && receipt?.hash === MODEL3D_REBUILD.legacyHash;
      const status = legacyModel3d ? "verified-legacy-source" : receipt ? "already-applied" : executedStatements ? "applied" : "verified-existing";
      if (!receipt) database.prepare(`INSERT INTO ${RECEIPTS}(tag,hash,journal_when,disposition,executed_statements,skipped_statements,recorded_at) VALUES(?,?,?,?,?,?,?)`)
        .run(migration.tag, migration.hash, migration.when, status, executedStatements, skippedStatements, new Date().toISOString());
      report.push({ tag: migration.tag, status, executedStatements, skippedStatements,
        ...(legacyModel3d ? { recordedHash: receipt.hash, verifiedHash: migration.hash } : {}) });
    }
    for (const [name, expected] of tables) {
      validateTable(database, name, expected);
      const attached = (db) => sorted(db.prepare("SELECT type,name FROM sqlite_schema WHERE tbl_name=? COLLATE NOCASE AND type IN ('index','trigger') AND sql IS NOT NULL").all(name).map((row) => ({ type: row.type, name: row.name.toLowerCase() })));
      if (!equal(attached(database), attached(reference))) fail("migration_schema_mismatch", `unexpected indexes or triggers on ${name}`);
    }
    for (const migration of plan) for (const statement of migration.statements) if (["index", "trigger"].includes(statement.kind)) validateObject(database, statement, reference);
    database.exec(dryRun ? "ROLLBACK" : "COMMIT"); transaction = false;
    return { dryRun, migrations: report };
  } catch (error) {
    if (transaction) { try { database.exec("ROLLBACK"); } catch { /* Retain the original failure. */ } }
    throw error;
  } finally { reference.close(); receiptReference.close(); }
}
