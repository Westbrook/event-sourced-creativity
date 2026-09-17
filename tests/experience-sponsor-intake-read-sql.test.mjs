import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {packSponsorIntakeReadQuery} from '../worker/experience-sponsor-intake-read-sql.ts';

function equivalent(t,sql,bindings,setup=''){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());if(setup)db.exec(setup);
  const packed=packSponsorIntakeReadQuery(sql,bindings);
  assert.equal(packed.bindings.length,bindings.length?1:0);
  const expected=db.prepare(sql).all(...bindings),actual=db.prepare(packed.sql).all(...packed.bindings);
  assert.deepEqual(actual,expected);return {db,packed,actual};
}

test('packed scalar bindings preserve SQLite values and types including NUL, Unicode, null, and finite numbers',t=>{
  const values=["O'Reilly \"quoted\" `tick` [bracket] ? -- /* */",'before\0after','日本語 café 👩🏾‍💻',null,0,-0,1,-2,1.25,Number.MAX_SAFE_INTEGER,1e20,Number.MIN_VALUE,Number.MAX_VALUE];
  const sql=`SELECT ${values.map((_,i)=>`? AS value_${i},typeof(?) AS type_${i},hex(?) AS hex_${i}`).join(',')}`;
  equivalent(t,sql,values.flatMap(v=>[v,v,v]));
});

test('quoted strings, doubled quotes, quoted identifiers and comments retain embedded question marks',t=>{
  equivalent(t,`/* lead ? :named */ SELECT '?' AS "double?", 'a''?b' AS [bracket?], ? AS \`tick?\`, '"?' AS value /* ignored ? ?2 */ -- ? @x\n`,['kept']);
});

test('WITH and RECURSIVE queries merge parameters without changing CTE dependencies or parameter order',t=>{
  equivalent(t,'-- before ?\n WITH /* nested ? */ original(x) AS (SELECT ?), second(y) AS (SELECT x||? FROM original) SELECT ?||y AS value FROM second;',['a','b','c']);
  equivalent(t,'WITH RECURSIVE n(x) AS (SELECT ? UNION ALL SELECT x+1 FROM n WHERE x<?) SELECT sum(x) AS total FROM n',[1,5]);
});

test('parameter CTE name cannot shadow original quoted or unquoted identifiers',t=>{
  equivalent(t,'WITH sponsor_intake_parameters(json) AS (SELECT ?), "sponsor_intake_parameters_1"(v) AS (SELECT ?) SELECT json||v AS value FROM sponsor_intake_parameters,"sponsor_intake_parameters_1"',['a','b']);
});

test('native integer affinity, NULL comparisons, JSON extraction, and OR/AND predicates stay equivalent',t=>{
  equivalent(t,`SELECT id,typeof(id) AS type FROM records WHERE (owner=? AND (amount>=? OR amount IS ?)) AND json_extract(data,'$.key')=? ORDER BY id`,['actor',2,null,'v'],
    `CREATE TABLE records(id INTEGER PRIMARY KEY,owner TEXT,amount INTEGER,data TEXT); INSERT INTO records VALUES(1,'actor',3,'{"key":"v"}'),(2,'actor',NULL,'{"key":"v"}'),(3,'other',4,'{"key":"v"}');`);
});

test('numeric parameters retain no expression affinity in mixed-type comparisons',t=>{
  equivalent(t,`SELECT ? = '1' AS literal_equal, ? = ? AS parameter_equal, ? BETWEEN '1' AND '2' AS between_text, ? IN ('1','2') AS in_text, ? IS ? AS is_text, typeof(?) AS native_type`,[1,1,'1',1,1,1,'1',1]);
  equivalent(t,`SELECT id FROM records WHERE ? = value ORDER BY id`,[1],`CREATE TABLE records(id INTEGER,value TEXT); INSERT INTO records VALUES(1,'1'),(2,'1.0'),(3,'2');`);
});

test('INSERT and UPDATE preserve bound values under column affinity',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE records(a INTEGER,b TEXT,c REAL)');
  let packed=packSponsorIntakeReadQuery('INSERT INTO records VALUES(?,?,?) RETURNING a,typeof(a) AS a_type,b,c,typeof(c) AS c_type',[7,'text\0tail',1.5]);
  assert.deepEqual({...db.prepare(packed.sql).get(...packed.bindings)},{a:7,a_type:'integer',b:'text\0tail',c:1.5,c_type:'real'});
  packed=packSponsorIntakeReadQuery('UPDATE records SET b=? WHERE a=? RETURNING b',['updated',7]);
  assert.equal(db.prepare(packed.sql).get(...packed.bindings).b,'updated');
});

test('zero bindings preserve the original query byte for byte',()=>{
  const sql="/* ? */ SELECT '?' AS x -- ?\n";assert.deepEqual(packSponsorIntakeReadQuery(sql,[]),{sql,bindings:[]});
});

test('many existing predicates use one transport parameter without changing their results',t=>{
  const conditions=Array.from({length:120},()=>'? = ?');
  const {packed,actual}=equivalent(t,`SELECT CASE WHEN ${conditions.join(' AND ')} THEN 1 ELSE 0 END AS current`,Array.from({length:240},(_,i)=>`same-${Math.floor(i/2)}`));
  assert.equal(packed.bindings.length,1);assert.equal(actual[0].current,1);
});

for(const [name,sql,bindings] of [
  ['too few','SELECT ?',[ ]],['too many','SELECT 1',[1]],['numbered','SELECT ?1',[1]],['zero numbered','SELECT ?0',[1]],
  ['colon named','SELECT :name',[1]],['at named','SELECT @name',[1]],['dollar named','SELECT $name',[1]],
  ['unterminated string',"SELECT 'broken ?",[]],['unterminated identifier','SELECT "broken ?',[]],['unterminated comment','SELECT 1 /* ?',[]],
  ['multiple statements','SELECT ?; SELECT ?',[1,2]],['SQL NUL','SELECT ?\0',[1]],['unsupported prefix','PRAGMA table_info(?)',['x']],
])test(`rejects ${name} without returning partially packed SQL`,()=>{assert.throws(()=>packSponsorIntakeReadQuery(sql,bindings),{code:'sponsor_intake_read_query_invalid'});});

for(const [name,value] of [['undefined',undefined],['NaN',NaN],['infinity',Infinity],['boolean',true],['object',{}],['array',[]],['bigint',1n],['typed bytes',new Uint8Array([1])]])test(`rejects ${name} binding rather than coercing it`,()=>{
  assert.throws(()=>packSponsorIntakeReadQuery('SELECT ?',[value]),{code:'sponsor_intake_read_query_invalid'});
});

test('sparse or accessor binding arrays are refused without invoking accessors',()=>{
  assert.throws(()=>packSponsorIntakeReadQuery('SELECT ?',new Array(1)),{code:'sponsor_intake_read_query_invalid'});
  const values=[];let invoked=0;Object.defineProperty(values,'0',{get(){invoked++;return 1;}});
  assert.throws(()=>packSponsorIntakeReadQuery('SELECT ?',values),{code:'sponsor_intake_read_query_invalid'});assert.equal(invoked,0);
});

test('SQL and JSON limits count UTF-8 bytes and include expansion overhead',()=>{
  const atLimit='x'.repeat(1_900_000-4);assert.equal(new TextEncoder().encode(packSponsorIntakeReadQuery('SELECT ?',[atLimit]).bindings[0]).byteLength,1_900_000);
  assert.throws(()=>packSponsorIntakeReadQuery('SELECT ?',[atLimit+'x']),{code:'sponsor_intake_read_query_too_large'});
  assert.throws(()=>packSponsorIntakeReadQuery('SELECT ?',['é'.repeat(950_000)]),{code:'sponsor_intake_read_query_too_large'});
  const exact='SELECT 1'+' '.repeat(100_000-8);assert.equal(packSponsorIntakeReadQuery(exact,[]).sql,exact);
  assert.throws(()=>packSponsorIntakeReadQuery(exact+' ',[]),{code:'sponsor_intake_read_query_too_large'});
  assert.throws(()=>packSponsorIntakeReadQuery('SELECT ?'+' '.repeat(100_000-8),[1]),{code:'sponsor_intake_read_query_too_large'});
});
