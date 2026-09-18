import assert from 'node:assert/strict';
const quote = name => '"' + name.replaceAll('"', '""') + '"';

// Synthetic databases only. Preserve scalar types, schema and rowids exactly.
export function exportSynthetic(sqlite) {
  const schema = sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  // Native Memory privacy inverses add real schema objects; keep the export bounded.
  assert(schema.length <= 1024);
  assert(schema.every(row => !row.name.startsWith('sqlite_') || row.sql === null));
  const tables = schema.filter(row => row.type === 'table'), inserts = [], rows = {};
  for (const { name } of tables) {
    const columns = sqlite.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
    const expressions = ['CAST(rowid AS TEXT) AS original_rowid', ...columns.map((column, i) => `quote(${quote(column)}) AS c${i}`)];
    rows[name] = structuredClone(sqlite.prepare(`SELECT ${expressions.join(',')} FROM ${quote(name)} ORDER BY rowid`).all());
    for (const row of rows[name]) {
      assert(/^[0-9]+$/.test(row.original_rowid));
      const sql = `INSERT INTO ${quote(name)}(rowid,${columns.map(quote).join(',')}) VALUES(${row.original_rowid},${columns.map((_, i) => row['c' + i]).join(',')})`;
      assert(Buffer.byteLength(sql) < 90000);
      inserts.push(sql);
    }
  }
  assert(inserts.length <= 2048);
  return { schema: structuredClone(schema), tables: tables.map(row => row.name), rows, inserts };
}
export async function rowsSnapshot(db, tables) {
  const result = {};
  for (const name of tables) {
    const columns = (await db.prepare(`PRAGMA table_info(${quote(name)})`).all()).results.map(row => row.name);
    const expressions = ['CAST(rowid AS TEXT) AS original_rowid', ...columns.map((column, i) => `quote(${quote(column)}) AS c${i}`)];
    result[name] = (await db.prepare(`SELECT ${expressions.join(',')} FROM ${quote(name)} ORDER BY rowid`).all()).results;
  }
  return result;
}
export async function install(db, exported) {
  await db.batch(exported.schema.filter(row => row.type === 'table').map(row => db.prepare(row.sql)));
  await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'), ...exported.inserts.map(sql => db.prepare(sql))]);
  await db.batch(exported.schema.filter(row => row.sql && row.type !== 'table').map(row => db.prepare(row.sql)));
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.deepEqual(await rowsSnapshot(db, exported.tables), exported.rows);
  const names = new Set(exported.schema.map(row => row.name));
  assert.deepEqual((await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results.filter(row => names.has(row.name)), exported.schema);
}
