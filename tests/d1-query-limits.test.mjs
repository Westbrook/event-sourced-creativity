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

test('compound limit: strict SQLite parser accepts five terms and refuses six without changing depth-only behavior or receipt shape',t=>{
  const db=sqlite(t),limits=Object.freeze({...queryLimits}),options=Object.freeze({queryLimits:limits});
  for(const operator of ['UNION ALL','UNION','INTERSECT','EXCEPT']){
    const compound=n=>Array.from({length:n},(_,i)=>`SELECT ${i+1}`).join(` ${operator} `);
    const five=compound(5),six=compound(6),accepted=compileSqliteExpressionDepth(db,five,options);
    assert.equal(accepted.ok,true,operator);
    assert.deepEqual(Object.keys(accepted).sort(),['ok','limit','queryLimits','statementBytes','parameterCount','sqliteVersion'].sort());
    assert.deepEqual(accepted.queryLimits,queryLimits);assert.equal(accepted.limit,100);
    assert.equal(accepted.statementBytes,Buffer.byteLength(five));assert.equal(accepted.parameterCount,0);
    const rejected=compileSqliteExpressionDepth(db,six,options);
    assert.equal(rejected.ok,false,`${operator}: six terms must fail strict qualification`);
    assert.match(rejected.error,/too many terms in compound SELECT/iu);
    const ordinary=compileSqliteExpressionDepth(db,six);
    assert.equal(ordinary.ok,true);assert.equal(Object.hasOwn(ordinary,'queryLimits'),false);
  }
  assert.deepEqual(options,{queryLimits});assert.deepEqual(Object.keys(limits).sort(),['functionArguments','parameters','sqlBytes']);
});

test('compound limit: grouped CTEs preserve eleven immutable bound values while flat and nested oversized compounds fail',t=>{
  const db=sqlite(t),bindings=Object.freeze([null,0,'quote \' " \\','日本語 · العربية',-7,'',42,'line\nbreak',null,'UNION ALL, literal',3.5]);
  const terms=Object.freeze(bindings.map((_,i)=>`SELECT ${i+1} AS ordinal,?${i+1} AS value`));
  const queries=Object.freeze({
    flat:terms.join(' UNION ALL ')+' ORDER BY ordinal',
    grouped:`WITH a AS (${terms.slice(0,4).join(' UNION ALL ')}),b AS (${terms.slice(4,8).join(' UNION ALL ')}),c AS (${terms.slice(8).join(' UNION ALL ')}) SELECT * FROM a UNION ALL SELECT * FROM b UNION ALL SELECT * FROM c ORDER BY ordinal`,
    nested:`WITH oversized AS (${terms.slice(0,6).join(' UNION ALL ')}) SELECT * FROM oversized`,
  });
  const originalBindings=[...bindings],originalQueries={...queries},options=Object.freeze({queryLimits:Object.freeze({...queryLimits}),bindings});
  const rejected=compileSqliteExpressionDepth(db,queries.flat,options);
  assert.equal(rejected.ok,false,'eleven flat terms must fail strict qualification');
  assert.match(rejected.error,/too many terms in compound SELECT/iu);
  const nested=compileSqliteExpressionDepth(db,queries.nested,{queryLimits,bindings:bindings.slice(0,6)});
  assert.equal(nested.ok,false);assert.match(nested.error,/too many terms in compound SELECT/iu);
  const grouped=compileSqliteExpressionDepth(db,queries.grouped,options);
  assert.equal(grouped.ok,true);assert.equal(grouped.parameterCount,11);
  assert.equal(grouped.statementBytes,Buffer.byteLength(queries.grouped));assert.deepEqual(grouped.queryLimits,queryLimits);
  assert.equal(compileSqliteExpressionDepth(db,queries.flat,{bindings}).ok,true);
  const flatRows=db.prepare(queries.flat).all(...bindings),groupedRows=db.prepare(queries.grouped).all(...bindings);
  assert.deepEqual(groupedRows,flatRows);
  assert.deepEqual(groupedRows.map(row=>[row.ordinal,row.value]),bindings.map((value,i)=>[i+1,value]));
  assert.deepEqual(bindings,originalBindings);assert.deepEqual(queries,originalQueries);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n,0,'constant SELECT probes create no schema or fixture rows');
});

test('compound limit: strict enforcement rejects a depth-only cached compound before fixture prepare and retains the failure',t=>{
  const db=sqlite(t),sql=Array.from({length:6},(_,i)=>`SELECT ${7101+i} AS compound_cache_probe`).join(' UNION ALL ');
  let prepared=0;
  const state={sqlite:db,env:{DB:{prepare(){prepared++;return {};}}}},ordinary=enforceD1ExpressionDepth(state);
  try{state.env.DB.prepare(sql);ordinary.assertVerified();assert.equal(prepared,1);}finally{ordinary.restore();}
  const strict=enforceD1ExpressionDepth(state,{queryLimits});
  try{
    assert.throws(()=>state.env.DB.prepare(sql),/too many terms in compound SELECT/iu);
    assert.equal(prepared,1,'strict rejection must precede the underlying prepare');
    assert.equal(strict.records.length,1);assert.equal(strict.records[0].ok,false);
    assert.equal(strict.failures.length,1);assert.match(strict.failures[0].error,/too many terms in compound SELECT/iu);
    assert.throws(()=>strict.assertVerified());
  }finally{strict.restore();}
});
