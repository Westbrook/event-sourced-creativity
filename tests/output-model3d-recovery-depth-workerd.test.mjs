import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const { compactModel3dRecoveryAssertions: compact } = await import('../worker/output-model3d-recovery-assertions.ts');
const { outputAssertionStatements: statements } = await import('../worker/output-command-core.ts');
const require = createRequire(import.meta.url), wrangler = createRequire(require.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = wrangler('miniflare');

test('opaque near-limit proof stays executable through repeated real D1 compaction and fails atomically', { timeout: 60000 }, async () => {
  const mf = new Miniflare({modules:true, compatibilityDate:'2026-05-22', host:'127.0.0.1', port:0,
    log:new Log(LogLevel.NONE), d1Databases:['DB'], script:'export default {fetch(){return new Response("local only")}}',
    outboundService(){throw Error('network_forbidden');}});
  try {
    const DB=await mf.getD1Database('DB'), env={DB};
    await DB.exec('CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1)); CREATE TABLE witness(value INTEGER); INSERT INTO witness VALUES(1); CREATE TABLE sentinel(value INTEGER);');
    const makeProof=n=>({sql:`(EXISTS(SELECT 1 FROM witness WHERE ${Array(n).fill('value=1').join(' AND ')} AND value=?))`,bindings:[1],deadlineMs:123456});
    // Find the runtime's real single-statement boundary, rather than assuming
    // SQLite's internal wrapper consumes a fixed number of expression levels.
    let lower=1,upper=100;
    while(lower<upper) {
      const middle=Math.ceil((lower+upper)/2);
      try {await DB.batch(statements(env,makeProof(middle)));lower=middle;}
      catch(error){assert.match(String(error),/Expression tree is too large/);upper=middle-1;}
    }
    assert(lower>10);
    const proof=makeProof(lower-6);
    await DB.batch(statements(env,proof));
    let legacy=proof;
    for(let i=0;i<32;i++)legacy={...legacy,sql:`(${legacy.sql} AND (1=1))`};
    await assert.rejects(DB.batch(statements(env,legacy)),/Expression tree is too large/);
    for(const count of [0,1,7,8,9,31,90,100]) {
      let current=compact([...Array.from({length:count},(_,i)=>({sql:'?=?',bindings:[i,i]})),proof]);
      for(let cycle=0;cycle<5;cycle++) {
        assert.deepEqual(compact(current),current);
        assert(current.some(a=>a.sql.includes(proof.sql)));
        await DB.batch(current.flatMap(a=>statements(env,a)));
        current=compact([...current,{sql:'1=1',bindings:[]}]);
      }
    }
    await DB.prepare('UPDATE witness SET value=0').run();
    await assert.rejects(DB.batch([DB.prepare('INSERT INTO sentinel VALUES(1)'),...compact([proof]).flatMap(a=>statements(env,a))]));
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM sentinel').first()).n,0);
  } finally {await mf.dispose();}
});
