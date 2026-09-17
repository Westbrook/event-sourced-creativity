import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { readLocalMigrations, migrateLocalDatabase } from "../scripts/lib/local-migrations.mjs";
import { SELECTED_OUTPUT_SHARE_SCHEMA } from "../worker/selected-output-share-schema.ts";

const directory = new URL("../drizzle/", import.meta.url);
const tag = "0040_selected_output_shares", table = "selected_output_shares", receiptTable = "__forma_local_migrations";
// Repository source metadata captured before this additive migration. These
// checksums are not receipts that any production database applied the SQL.
const originalFileSha256 = "28b5695926808fb7f3f88d9c13ef074034ce4556c659975a2e50f28f9e828b64";
const originalJournalSha256 = "b45746a42d787c63097e1b5c612dbd1220c8356ca7637ad60ec25de054102bc7";
const hash = value => createHash("sha256").update(value).digest("hex");
const quote = value => `"${value.replaceAll('"', '""')}"`;
const json = path => JSON.parse(readFileSync(new URL(path, directory), "utf8"));
const plain = rows => rows.map(row => ({ ...row }));
function plan() {
  const migrations = readLocalMigrations(directory);
  const index = migrations.findIndex(value => value.tag === tag);
  assert.equal(index, 36, "The new migration follows the unchanged 0039 journal entry");
  return { migrations, prior: migrations.slice(0, index), addition: migrations[index] };
}
function database(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  t.after(() => db.close());
  return db;
}
function canonical(t) {
  const db = database(t);
  for (const sql of SELECTED_OUTPUT_SHARE_SCHEMA) db.exec(sql);
  return db;
}
function catalog(db) {
  return plain(db.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all());
}
function shareCatalog(db) { return catalog(db).filter(row => row.tbl_name === table); }
function insert(db, name, row) {
  const fields = Object.keys(row);
  db.prepare(`INSERT INTO ${quote(name)}(${fields.map(quote).join(",")}) VALUES(${fields.map(() => "?").join(",")})`).run(...Object.values(row));
}
function preservedRows(db) {
  return Object.fromEntries(catalog(db).filter(row => row.type === "table" && row.name !== table).map(row => {
    const hasRowid = !/\bWITHOUT\s+ROWID\s*$/iu.test(row.sql);
    const statement = db.prepare(`SELECT ${hasRowid ? "rowid AS __original_rowid," : ""}* FROM ${quote(row.name)}${hasRowid ? " ORDER BY rowid" : ""}`);
    statement.setReadBigInts(true);
    return [row.name, plain(statement.all()).filter(value => row.name !== receiptTable || value.tag !== tag)];
  }));
}
function seedProtectedRows(db) {
  const now = "2026-09-17T00:00:00.000Z", expires = "2027-09-17T00:00:00.000Z", owner = "migration-synthetic-owner";
  insert(db, "users", { user_id: owner, email: "migration-owner@example.test", display_name: "Synthetic owner", role: "creator", created_at: now, updated_at: now });
  insert(db, "events", { event_id: "migration-original-event", stream_id: `creative:${owner}`, sequence: 1, occurred_at: now, recorded_at: now,
    actor: `user:${owner}`, client_id: "migration-fixture", correlation_id: "migration-original", type: "DocumentCreated",
    payload: '{"document_id":"migration-document","project_id":"migration-project","title":"PRIVATE 日本語"}' });
  insert(db, "private_content", { content_id: "migration-original-content", owner_id: owner, kind: "document-artifact",
    content: '\ufeff  PRIVATE مرحبا 日本語\r\n{"original":true}  ', created_at: now, expires_at: expires, redacted_at: null });
  insert(db, "document_jobs", { job_id: "migration-original-job", owner_id: owner, stream_id: `creative:${owner}`, document_id: "migration-document",
    kind: "render_document", status: "completed", source_surface: "document", correlation_id: "migration-original-job:attempt:1",
    request_json: '{"artifactKind":"short_story","privateInput":"KEEP"}', result_json: '{"artifactId":"migration-artifact"}',
    requested_sequence: 1, attempt_count: 1, requested_at: now, started_at: now, completed_at: now, expires_at: expires, updated_at: now });
  insert(db, "budget_counters", { scope: "user", scope_id: owner, period: "2026-09", used_tokens: 17, reserved_tokens: 41,
    hard_limit_tokens: 1000, updated_at: now });
  insert(db, "cost_budget_counters", { scope: "user", scope_id: owner, period: "2026-09", used_microusd: 19, reserved_microusd: 43,
    hard_limit_microusd: 10000, updated_at: now });
  const common = { owner_id: owner, stream_id: `creative:${owner}`, correlation_id: "migration-original-job:attempt:1",
    operation: "document-render:short_story", period: "2026-09", created_at: now, updated_at: now, settled_at: null };
  insert(db, "budget_reservations", { ...common, reservation_id: "migration-original-token-hold", reserved_tokens: 41, used_tokens: 0, status: "active", settlement_reason: null });
  insert(db, "cost_budget_reservations", { ...common, reservation_id: "migration-original-cost-hold", workspace_id: "forma",
    reserved_microusd: 43, used_microusd: 0, status: "executing", allow_user_overage: 0 });
}

// Compare expression tokens without erasing literal case, whitespace, or quoted
// apostrophes. Drizzle may quote/qualify identifiers without changing a CHECK.
function expression(value) {
  const tokens = value.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]])*\]|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[^\s]/gu) ?? [];
  return tokens.map(token => token.startsWith("'") ? token : (["\"", "`", "["].includes(token[0]) ? token.slice(1, -1) : token).toLowerCase())
    .filter((token, index, all) => !(token === table && all[index + 1] === ".") && !(token === "." && all[index - 1] === table)).join(" ");
}
function checks(sql) {
  const values = [], pattern = /\bCHECK\s*\(/giu;
  while (pattern.exec(sql)) {
    let cursor = pattern.lastIndex, depth = 1, quoted = false;
    const start = cursor;
    while (cursor < sql.length && depth) {
      const char = sql[cursor++];
      if (char === "'") {
        if (quoted && sql[cursor] === "'") { cursor++; continue; }
        quoted = !quoted;
      }
      if (!quoted) { if (char === "(") depth++; else if (char === ")") depth--; }
    }
    assert.equal(depth, 0, "Every CHECK expression must remain balanced");
    values.push(expression(sql.slice(start, cursor - 1)));
    pattern.lastIndex = cursor;
  }
  return values.sort();
}
function tableShape(db) {
  const definition = db.prepare("SELECT sql FROM main.sqlite_schema WHERE type='table' AND name=?").get(table)?.sql;
  assert.equal(typeof definition, "string");
  const columns = plain(db.prepare(`PRAGMA table_xinfo(${quote(table)})`).all()).map(row => ({
    name: row.name, type: row.type.toUpperCase(), notnull: row.notnull, pk: row.pk, default: row.dflt_value, hidden: row.hidden,
  }));
  const indexes = plain(db.prepare(`PRAGMA index_list(${quote(table)})`).all()).map(row => ({
    // SQLite assigns names differently for inline UNIQUE and a named Drizzle
    // unique index. Compare their actual key semantics, preserving nonunique names.
    ...(row.unique ? {} : { name: row.name }), unique: row.unique, primary: row.origin === "pk", partial: row.partial,
    keys: plain(db.prepare(`PRAGMA index_xinfo(${quote(row.name)})`).all()).filter(key => key.key).map(key => ({ name: key.name, descending: key.desc, collation: key.coll })),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { columns, indexes, checks: checks(definition), foreignKeys: plain(db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all()) };
}

test("selected share migration: source history stays byte-exact and 0040 is uniquely journaled", () => {
  const { migrations, addition } = plan(), journal = json("meta/_journal.json");
  assert.equal(hash(JSON.stringify(journal.entries.slice(0, 36))), originalJournalSha256);
  const paths = [...migrations.slice(0, 36).map(entry => `drizzle/${entry.tag}.sql`),
    ...Array.from({ length: 35 }, (_, index) => `drizzle/meta/${String(index).padStart(4, "0")}_snapshot.json`)].sort();
  const checksum = createHash("sha256");
  for (const path of paths) checksum.update(path).update("\0").update(readFileSync(new URL(`../${path}`, import.meta.url))).update("\0");
  assert.equal(paths.length, 71); assert.equal(checksum.digest("hex"), originalFileSha256);
  assert.equal(migrations.filter(entry => entry.tag === tag).length, 1);
  assert.equal(addition.idx, 36); assert.equal(addition.version, "6"); assert.equal(addition.breakpoints, true);
  assert.ok(addition.when > migrations[35].when);
});

test("selected share migration: actual full journal installs the exact canonical catalog and reruns without writes", t => {
  const db = database(t), expected = canonical(t), { migrations } = plan();
  const applied = migrateLocalDatabase(db, { migrations });
  assert.equal(applied.migrations.find(entry => entry.tag === tag)?.status, "applied");
  assert.deepEqual(shareCatalog(db), shareCatalog(expected));
  assert.deepEqual(tableShape(db), tableShape(expected));
  assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0, "Installing storage creates no share or token");
  const beforeCatalog = catalog(db), beforeRows = preservedRows(db);
  const replayed = migrateLocalDatabase(db, { migrations });
  assert.ok(replayed.migrations.every(entry => entry.status === "already-applied"));
  assert.deepEqual(catalog(db), beforeCatalog); assert.deepEqual(preservedRows(db), beforeRows);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
});

test("selected share migration: upgrading populated prior history preserves every original row and schema object", t => {
  const db = database(t), expected = canonical(t), { migrations, prior } = plan();
  migrateLocalDatabase(db, { migrations: prior });
  seedProtectedRows(db);
  const beforeRows = preservedRows(db), beforeCatalog = catalog(db);
  const report = migrateLocalDatabase(db, { migrations });
  assert.deepEqual(report.migrations.filter(entry => entry.status === "applied").map(entry => entry.tag), [tag]);
  assert.deepEqual(preservedRows(db), beforeRows, "Original content, jobs, history, holds, counters, and old receipts stay unchanged");
  assert.deepEqual(catalog(db).filter(row => row.tbl_name !== table), beforeCatalog);
  assert.deepEqual(shareCatalog(db), shareCatalog(expected));
  assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
  assert.throws(() => db.exec("UPDATE events SET payload='changed' WHERE event_id='migration-original-event'"), /append-only/u);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("selected share migration: executed Drizzle table DDL preserves columns, CHECKs, indexes and uniqueness", async t => {
  const schema = await import("../db/schema.ts");
  const generated = JSON.parse(JSON.stringify(await generateSQLiteDrizzleJson(schema)));
  assert.ok(generated.tables[table], "The real db/schema.ts declares selected output shares");
  const subset = { ...generated, tables: { [table]: generated.tables[table] }, views: {} };
  const empty = { ...subset, tables: {}, id: "00000000-0000-0000-0000-000000000000" };
  const statements = await generateSQLiteMigration(empty, subset);
  const declared = database(t), expected = canonical(t);
  for (const sql of statements) declared.exec(sql);
  assert.deepEqual(tableShape(declared), tableShape(expected));
  // Drizzle's SQLite table model cannot declare WITHOUT ROWID or triggers;
  // the source-owned migration/canonical catalog comparison above checks both.
  assert.equal(expected.prepare("SELECT wr FROM pragma_table_list WHERE schema='main' AND name=?").get(table).wr, 1);
  assert.equal(declared.prepare("SELECT wr FROM pragma_table_list WHERE schema='main' AND name=?").get(table).wr, 0);
  assert.equal(declared.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type='trigger' AND tbl_name=?").get(table).count, 0);
  assert.ok(shareCatalog(expected).some(row => row.type === "trigger"));
});

test("selected share migration: new snapshot chains to 0034 and the latest full snapshot produces no duplicate SQL", async () => {
  const previous = json("meta/0034_snapshot.json"), added = json("meta/0036_snapshot.json");
  assert.equal(added.prevId, previous.id);
  assert.match(added.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
  assert.notEqual(added.id, previous.id); assert.equal(added.version, "6"); assert.equal(added.dialect, "sqlite");
  assert.ok(added.tables[table]);
  assert.ok(added.tables.document_jobs.columns.scene_source_version_json, "Already-migrated 0039 columns belong in the new source snapshot");
  assert.ok(added.tables.document_jobs.columns.scene_source_protocol);
  const latestName = readdirSync(new URL("meta/", directory)).filter(name => /^\d{4}_snapshot\.json$/u.test(name)).sort().at(-1);
  const saved = json(`meta/${latestName}`), schema = await import("../db/schema.ts");
  const generated = JSON.parse(JSON.stringify(await generateSQLiteDrizzleJson(schema, saved.prevId)));
  const { id: _savedId, ...savedShape } = saved, { id: _generatedId, ...generatedShape } = generated;
  assert.deepEqual(savedShape, generatedShape, "The checked-in snapshot comes from the current full Drizzle declaration");
  assert.deepEqual(await generateSQLiteMigration(saved, generated), [], "An unchanged schema must not propose duplicate or historical SQL");
});
