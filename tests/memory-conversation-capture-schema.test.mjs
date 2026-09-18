import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// The optional candidate is never enrolled in the native migration journal or
// executed by application startup. All databases in this file are disposable.
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const original = readFileSync(new URL("../drizzle/0032_memory_structured_conversation_ledger.sql", import.meta.url), "utf8");
const candidate = readFileSync(new URL("../db/memory-conversation-capture.pending.sql", import.meta.url), "utf8");
const statements = text => text.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean);
const migration = statements(candidate);
const tables = ["memory_structured_conversation_heads", "memory_structured_conversation_revisions"];
const oldHash = "4eac78f116b620e9fc22949faf7d4e3a5abfe8fab083e1c2827bd6091cae2a79";
const newHash = "075a857266dad2a438313faf7641ddae71aa96ebdaed8c0a6e1af373de2e09e8";
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object'
  ? '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  : JSON.stringify(value);
const schemaQuery = "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN('memory_structured_conversation_heads','memory_structured_conversation_revisions') ORDER BY name";
const hash = rows => createHash("sha256").update(canonical(rows)).digest("hex");
const seed = [
  `INSERT INTO memory_structured_conversation_heads VALUES('${'a'.repeat(64)}','owner','owner',NULL,NULL,'project','document','enrolled',1,'epoch','policy',1,'body','${'b'.repeat(64)}',1,0,2,'active',NULL,0,'2027-01-01','2026-01-01','2026-01-01')`,
  `INSERT INTO memory_structured_conversation_revisions VALUES('${'a'.repeat(64)}',1,0,NULL,'body','${'b'.repeat(64)}',1,'native-declared-ledger-v1',1,0,2,'2026-01-01','2027-01-01')`,
  `INSERT INTO memory_structured_conversation_heads VALUES('${'c'.repeat(64)}','guest','owner','org','access','project','document','shared-enrolled',1,'epoch','policy',1,'shared-body','${'d'.repeat(64)}',1,2,4,'active',NULL,0,'2027-01-01','2026-01-01','2026-01-01')`,
  `INSERT INTO memory_structured_conversation_revisions VALUES('${'c'.repeat(64)}',1,0,NULL,'shared-body','${'d'.repeat(64)}',1,'native-declared-ledger-v1',1,2,4,'2026-01-01','2027-01-01')`,
  `INSERT INTO memory_structured_conversation_heads VALUES('${'e'.repeat(64)}','retired','retired',NULL,NULL,'project','document',NULL,NULL,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,'retired','2026-01-02',0,NULL,'2026-01-01','2026-01-02')`,
  `UPDATE memory_structured_conversation_heads SET rowid=9007199254740993,policy_version=X'00FF80' WHERE ledger_id='${'a'.repeat(64)}'`,
  `UPDATE memory_structured_conversation_revisions SET rowid=9007199254740995 WHERE ledger_id='${'a'.repeat(64)}'`,
];
function database(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON'); sqlite.exec(original); seed.forEach(sql => sqlite.exec(sql)); return sqlite;
}
function snapshot(sqlite) {
  return { schema: sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all(), rows: Object.fromEntries(tables.map(table => {
    const columns = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all();
    const statement=sqlite.prepare(`SELECT rowid AS original_rowid,${columns.flatMap(({ name }) => [
      `typeof(${quote(name)}) AS ${quote(name + '_type')}`, `${quote(name)} AS ${quote(name + '_value')}`,
    ]).join(',')} FROM ${quote(table)} ORDER BY rowid`);
    statement.setReadBigInts(true);
    return [table, statement.all()];
  })) };
}
function migrate(sqlite, suffix = []) {
  sqlite.exec('BEGIN IMMEDIATE');
  try { [...migration, ...suffix].forEach(sql => sqlite.exec(sql)); sqlite.exec('COMMIT'); }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
}

test('pending reference-only schema preserves every original row, type, rowid, identity, index and FK', t => {
  const sqlite = database(t);
  sqlite.prepare('UPDATE memory_structured_conversation_heads SET policy_version=? WHERE ledger_id=?').run('binary\0text','c'.repeat(64));
  const before = snapshot(sqlite);
  assert.equal(hash(sqlite.prepare(schemaQuery).all()), oldHash);
  migrate(sqlite);
  assert.deepEqual(snapshot(sqlite).rows, before.rows);
  const current = sqlite.prepare(schemaQuery).all();
  assert.equal(hash(current), newHash);
  assert.deepEqual(current.map(row => ({ ...row })), before.schema.map(row => ({ ...row,
    sql: row.type === 'table' ? row.sql.replaceAll('annotation_count BETWEEN 1 AND 256', 'annotation_count BETWEEN 0 AND 256') : row.sql,
  })));
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  sqlite.exec('UPDATE memory_structured_conversation_heads SET annotation_count=0 WHERE state=\'active\'');
  sqlite.exec('UPDATE memory_structured_conversation_revisions SET annotation_count=0');
  for (const value of [-1, 257, 0.5]) for (const table of tables) {
    assert.throws(() => sqlite.exec(`UPDATE ${quote(table)} SET annotation_count=${value}`), /constraint failed/);
  }
  const journal = readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8');
  assert.ok(!journal.includes('memory-conversation-capture'));
  assert.ok(!/\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/iu.test(candidate));
  assert.ok(!/PRAGMA\s+(?:foreign_keys\s*=\s*(?:0|OFF)|writable_schema)/iu.test(candidate));
});

test('candidate is one-shot and repeated application fails without changing upgraded state', t => {
  const sqlite = database(t); migrate(sqlite); const before = snapshot(sqlite);
  assert.throws(() => migrate(sqlite), /NOT NULL constraint failed/); assert.deepEqual(snapshot(sqlite), before);
});

test('a failure after the completed rebuild atomically restores all source schema and data', t => {
  const sqlite = database(t), before = snapshot(sqlite);
  assert.throws(() => migrate(sqlite, ["SELECT json('intentional late failure')"]), /malformed JSON/);
  assert.deepEqual(snapshot(sqlite), before); assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

for (const [label, sql] of [
  ['unknown trigger', "CREATE TRIGGER extra_memory_trigger AFTER UPDATE ON memory_structured_conversation_heads BEGIN SELECT 1; END"],
  ['unknown index', "CREATE INDEX extra_memory_index ON memory_structured_conversation_heads(policy_version)"],
  ['missing expected index', "DROP INDEX idx_memory_structured_heads_cleanup"],
  ['unknown external view', "CREATE VIEW external_memory_view AS SELECT ledger_id FROM memory_structured_conversation_heads"],
  ['unknown cascading child', `CREATE TABLE child(id TEXT PRIMARY KEY,ledger_id TEXT REFERENCES memory_structured_conversation_heads(ledger_id) ON DELETE CASCADE); INSERT INTO child VALUES('kept','${'a'.repeat(64)}')`],
  ['staging collision', "CREATE TABLE __memory_conversation_capture_heads(value TEXT); INSERT INTO __memory_conversation_capture_heads VALUES('kept')"],
  ['disabled foreign keys', "PRAGMA foreign_keys=OFF"],
  ['disabled check constraints', "PRAGMA ignore_check_constraints=ON"],
  ['temp-schema ambiguity', "CREATE TEMP TABLE memory_structured_conversation_heads(value TEXT)"],
]) test('candidate fails closed on ' + label + ' without removing original data', t => {
  const sqlite = database(t); sqlite.exec(sql); const before = snapshot(sqlite);
  assert.throws(() => migrate(sqlite), /NOT NULL constraint failed|already exists/);
  assert.deepEqual(snapshot(sqlite), before);
  if (label === 'unknown cascading child') assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM child').get().n, 1);
});

// Actual pinned workerd D1 confirms batch semantics locally, not hosted Sites
// qualification. No external fetch, provider credential, or live data is used.
test('actual local D1 atomically rebuilds the candidate and rolls back a late failure', { timeout: 90_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'forma-memory-capture-d1-')), egress = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default { fetch() { return new Response('Local D1 only', {status:404}); } };",
    d1Databases: ['Upgrade', 'Rollback', 'Dependency'], d1Persist: directory, log: new Log(LogLevel.NONE),
    outboundService: request => { egress.push(request.url); throw new Error('External fetch forbidden'); },
  });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); });
  async function install(name) {
    const db = await mf.getD1Database(name);
    await db.batch([...statements(original), ...seed].map(sql => db.prepare(sql))); return db;
  }
  async function capture(db) {
    const schema = (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE \'_cf_%\' ORDER BY name').all()).results;
    const rows = {};
    for (const table of tables) {
      const columns = (await db.prepare(`PRAGMA table_info(${quote(table)})`).all()).results;
      rows[table] = (await db.prepare(`SELECT CAST(rowid AS TEXT) AS original_rowid,${columns.flatMap(({ name }) => [
        `typeof(${quote(name)}) AS ${quote(name + '_type')}`, `quote(${quote(name)}) AS ${quote(name + '_value')}`,
      ]).join(',')} FROM ${quote(table)} ORDER BY rowid`).all()).results;
    }
    return { schema, rows };
  }
  const upgrade = await install('Upgrade'), before = await capture(upgrade);
  try { await upgrade.batch(migration.map(sql => upgrade.prepare(sql))); }
  catch (error) {
    for (let index = 0; index < migration.length; index++) {
      try { await upgrade.batch([...migration.slice(0, index + 1), "SELECT json('diagnostic rollback')"].map(sql => upgrade.prepare(sql))); }
      catch (diagnostic) { if (!String(diagnostic).includes('malformed JSON')) { t.diagnostic('First failing candidate statement: ' + index + '; ' + String(diagnostic)); break; } }
    }
    throw error;
  }
  assert.deepEqual((await capture(upgrade)).rows, before.rows);
  assert.equal(hash((await upgrade.prepare(schemaQuery).all()).results), newHash);
  assert.deepEqual((await upgrade.prepare('PRAGMA foreign_key_check').all()).results, []);
  await upgrade.batch(tables.map(table => upgrade.prepare(`UPDATE ${quote(table)} SET annotation_count=0 WHERE annotation_count IS NOT NULL`)));
  const rollback = await install('Rollback'), rollbackBefore = await capture(rollback);
  await assert.rejects(rollback.batch([...migration, "SELECT json('intentional late failure')"].map(sql => rollback.prepare(sql))), /malformed JSON/);
  assert.deepEqual(await capture(rollback), rollbackBefore);
  const dependency = await install('Dependency');
  await dependency.batch([
    dependency.prepare('CREATE TABLE child(id TEXT PRIMARY KEY,ledger_id TEXT REFERENCES memory_structured_conversation_heads(ledger_id) ON DELETE CASCADE)'),
    dependency.prepare(`INSERT INTO child VALUES('kept','${'a'.repeat(64)}')`),
  ]);
  const dependencyBefore = await capture(dependency);
  await assert.rejects(dependency.batch(migration.map(sql => dependency.prepare(sql))), /NOT NULL constraint failed/);
  assert.deepEqual(await capture(dependency), dependencyBefore);
  assert.equal((await dependency.prepare('SELECT COUNT(*) AS n FROM child').first()).n, 1);
  assert.deepEqual(egress, []);
});

for(let after=1;after<=30;after++)test('candidate rollback restores exact source after statement '+after,t=>{
  const sqlite=database(t),before=snapshot(sqlite);
  sqlite.exec('BEGIN IMMEDIATE');
  try{
    migration.slice(0,after).forEach(sql=>sqlite.exec(sql));
    assert.throws(()=>sqlite.exec("SELECT json('intentional injected failure')"),/malformed JSON/);
  }finally{sqlite.exec('ROLLBACK');}
  assert.equal(sqlite.isTransaction,false);assert.deepEqual(snapshot(sqlite),before);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);assert.deepEqual(sqlite.prepare('SELECT * FROM temp.sqlite_schema').all(),[]);
});

test('processing checkpoint migration and invalidation run atomically on local D1', {timeout:90000}, async t=>{
  const directory=await mkdtemp(join(tmpdir(),'forma-memory-checkpoint-d1-')),egress=[];
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',host:'127.0.0.1',port:0,script:"export default {fetch(){return new Response('local-only',{status:404})}}",d1Databases:['Checkpoint'],d1Persist:directory,log:new Log(LogLevel.NONE),outboundService:request=>{egress.push(request.url);throw Error('External fetch forbidden');}});
  t.after(async()=>{await mf.dispose();await rm(directory,{recursive:true,force:true});assert.deepEqual(egress,[]);});
  const db=await mf.getD1Database('Checkpoint');
  for(const file of ['0025_memory_live_base.sql','0026_memory_live_conversation.sql','0041_memory_live_change_checkpoints.sql'])await db.batch(statements(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8')).map(sql=>db.prepare(sql)));
  await db.prepare(`INSERT INTO memory_live_enrollments(enrollment_id,actor_user_id,owner_user_id,project_id,document_id,permission_epoch,policy_version,revision,learn_enabled,recall_enabled,background_enabled,retention_days,time_zone,enrolled_at,expires_at,cursor_sequence,next_due_at,attempts)
    VALUES('e','actor','actor','project','document','epoch','personal-memory-v2',1,1,1,1,1,'UTC','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',0,'2026-01-01T00:00:00.000Z',0)`).run();
  await db.prepare("INSERT INTO memory_live_sources(enrollment_id,event_id,sequence,expires_at) VALUES('e','event',1,'2027-01-01T00:00:00.000Z')").run();
  const checkpoint=db.prepare(`INSERT INTO memory_live_change_checkpoints VALUES('e',1,'${'a'.repeat(32)}',0,1,1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z')`);
  await assert.rejects(()=>db.batch([checkpoint,db.prepare("SELECT json('late-checkpoint-failure')")]));
  assert.equal(await db.prepare('SELECT count(*) AS n FROM memory_live_change_checkpoints').first('n'),0);
  await checkpoint.run();await db.prepare('UPDATE memory_live_sources SET conversation_segmented=1').run();
  assert.equal(await db.prepare('SELECT count(*) AS n FROM memory_live_change_checkpoints').first('n'),1);
  await db.prepare('UPDATE memory_live_enrollments SET revision=2').run();
  assert.equal(await db.prepare('SELECT count(*) AS n FROM memory_live_change_checkpoints').first('n'),0);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
