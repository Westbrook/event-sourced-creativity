import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';
import { compileCacheMetrics } from './helpers/sqlite-compile-cache.mjs';
import { spawnSync } from 'node:child_process';

test('run-scoped compile reuse preserves schema, limits and binding identity; corrupt records recompile', t => {
  const directory = mkdtempSync(join(tmpdir(), 'forma-compile-cache-')), old = process.env.FORMA_SQLITE_CACHE_DIR;
  process.env.FORMA_SQLITE_CACHE_DIR = directory;
  const db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); if (old === undefined) delete process.env.FORMA_SQLITE_CACHE_DIR; else process.env.FORMA_SQLITE_CACHE_DIR = old; });
  const before = { ...compileCacheMetrics }, sql = 'SELECT ' + Array(125).fill('1').join(' AND ');
  const rejected = compileSqliteExpressionDepth(db, sql);
  assert.equal(rejected.ok, false);
  assert.deepEqual(compileSqliteExpressionDepth(db, sql), rejected);
  assert.equal(compileCacheMetrics.hits, before.hits + 1);
  assert.equal(compileSqliteExpressionDepth(db, sql, { limit: 1000 }).ok, true);
  db.exec('CREATE TABLE fresh(value TEXT)');
  assert.equal(compileSqliteExpressionDepth(db, sql).ok, false);
  assert.equal(compileCacheMetrics.misses, before.misses + 3);
  for (const file of readdirSync(directory)) writeFileSync(join(directory, file), 'partial');
  assert.equal(compileSqliteExpressionDepth(db, sql).ok, false);
  assert.equal(compileCacheMetrics.misses, before.misses + 4);
  assert.equal(compileSqliteExpressionDepth(db, 'SELECT ?', { bindings: ['one'] }).ok, true);
  assert.equal(compileSqliteExpressionDepth(db, 'SELECT ?', { bindings: ['two'] }).ok, true);
  assert.equal(compileCacheMetrics.misses, before.misses + 6);
});

test('a second isolated Node process reuses only the exact successful compile', t => {
  const directory = mkdtempSync(join(tmpdir(), 'forma-cross-process-compile-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const code = `import {DatabaseSync} from 'node:sqlite';
    import {compileSqliteExpressionDepth} from ${JSON.stringify(new URL('./helpers/d1-expression-depth.mjs', import.meta.url).href)};
    import {compileCacheMetrics} from ${JSON.stringify(new URL('./helpers/sqlite-compile-cache.mjs', import.meta.url).href)};
    const db = new DatabaseSync(':memory:');
    const result = compileSqliteExpressionDepth(db, 'SELECT 1'); db.close();
    console.log(JSON.stringify({result, metrics:compileCacheMetrics}));`;
  const run = () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, FORMA_SQLITE_CACHE_DIR: directory }, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
  };
  const cold = run(), warm = run();
  assert.equal(cold.result.ok, true); assert.deepEqual(warm.result, cold.result);
  assert.equal(cold.metrics.misses, 1); assert.equal(warm.metrics.hits, 1); assert.equal(warm.metrics.misses, 0);
});
