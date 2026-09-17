import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {compileSqliteExpressionDepth,enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
import {outputTestDatabase} from './output-execution-test-helpers.mjs';

const queryLimits={functionArguments:32,parameters:100,sqlBytes:100000};
const coalesce=n=>`SELECT coalesce(${Array.from({length:n},()=>"'value'").join(',')})`;
function sqlite(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());return db;}

test('optional actual SQLite parser admits32 function args and refuses33; default depth-only remains unchanged',t=>{
  const db=sqlite(t);assert.equal(compileSqliteExpressionDepth(db,coalesce(32),{queryLimits}).ok,true);
  assert.match(compileSqliteExpressionDepth(db,coalesce(33),{queryLimits}).error,/too many arguments/u);
  const ordinary=compileSqliteExpressionDepth(db,coalesce(33));assert.equal(ordinary.ok,true);assert.equal(Object.hasOwn(ordinary,'queryLimits'),false);
});
test('parser checks nested function arguments without counting commas in SQL strings as arguments',t=>{
  const db=sqlite(t),sql=`SELECT json_set(json_object('literal','a,b,c'),'$.value',coalesce(${Array.from({length:32},()=>"'comma,inside'").join(',')}))`;
  assert.equal(compileSqliteExpressionDepth(db,sql,{queryLimits}).ok,true);
  assert.match(compileSqliteExpressionDepth(db,sql.replace("coalesce(","coalesce('extra',"),{queryLimits}).error,/too many arguments/u);
});
test('actual SQLite variable-index boundary accepts100 and refuses101',t=>{
  const db=sqlite(t),accepted=compileSqliteExpressionDepth(db,'SELECT ?100',{queryLimits});
  assert.equal(accepted.ok,true);assert.equal(accepted.parameterCount,100);
  assert.match(compileSqliteExpressionDepth(db,'SELECT ?101',{queryLimits}).error,/variable number/u);
});
test('SQL byte ceiling accepts exactly100000 UTF-8 bytes including EXPLAIN framing and rejects100001',t=>{
  const db=sqlite(t),sql='SELECT 1 /*'+'é'.repeat(49993)+' */';assert.equal(Buffer.byteLength(sql),100000);
  const accepted=compileSqliteExpressionDepth(db,sql,{queryLimits});assert.equal(accepted.ok,true);assert.equal(accepted.statementBytes,100000);
  assert.match(compileSqliteExpressionDepth(db,sql+' ',{queryLimits}).error,/byte limit exceeded/u);
});
test('strict query qualification cannot reuse depth-only cached success',t=>{
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());const sql=coalesce(33),ordinary=enforceD1ExpressionDepth(f);
  try{f.env.DB.prepare(sql);ordinary.assertVerified();}finally{ordinary.restore();}
  const strict=enforceD1ExpressionDepth(f,{queryLimits});
  try{assert.throws(()=>f.env.DB.prepare(sql),/too many arguments/u);assert.throws(()=>strict.assertVerified());}finally{strict.restore();}
});
test('actual bound arrays remain capped on initial and rebound statements',async t=>{
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());const checks=enforceD1ExpressionDepth(f,{queryLimits});
  try{const statement=f.env.DB.prepare('SELECT ?100 AS last').bind(...Array(100).fill(7));assert.equal((await statement.first()).last,7);
    checks.assertVerified();assert.throws(()=>statement.bind(...Array(101).fill(7)),/bound parameter/u);assert.throws(()=>checks.assertVerified());
  }finally{checks.restore();}
});
test('grouped event witness preserves exact field order and explicit null/string/number values',t=>{
  const db=sqlite(t),names=['event_id','stream_id','sequence','occurred_at','recorded_at','actor','client_id','correlation_id','causation_id','compensates_event_id','schema_version','type','payload',
    'owner_id','project_id','document_id','private_json','created_at','redacted_at','receipt_key','receipt_created_at'];
  const original=`json_object(${names.flatMap((name,i)=>[`'${name}'`,`?${i+1}`]).join(',')})`;
  const grouped=`json_set(json_object(${names.slice(0,13).flatMap((name,i)=>[`'${name}'`,`?${i+1}`]).join(',')}),${names.slice(13).flatMap((name,i)=>[`'$.${name}'`,`?${i+14}`]).join(',')})`;
  const cases=[names.map(()=>null),names.map((name,i)=>i%3===0?null:i%3===1?i:name),names.map(name=>`quote ' " \\ newline\n ${name}`)];
  for(const bindings of cases){const row=db.prepare(`SELECT ${original} AS original,${grouped} AS grouped`).get(...bindings);
    assert.equal(row.grouped,row.original);assert.deepEqual(Object.keys(JSON.parse(row.grouped)),names);}
  assert.equal(compileSqliteExpressionDepth(db,`SELECT ${grouped}`,{queryLimits}).ok,true);
  assert.match(compileSqliteExpressionDepth(db,`SELECT ${original}`,{queryLimits}).error,/too many arguments/u);
});
