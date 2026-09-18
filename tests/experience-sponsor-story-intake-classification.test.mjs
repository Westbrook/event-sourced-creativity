import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {outputTestDatabase,registerOutputSourceImports} from './output-server-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

const originalFetch=globalThis.fetch;let egress=0;
registerOutputSourceImports();
globalThis.fetch=()=>{egress++;throw Error('Intake classification forbids network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(egress,0);});
const [{classifySponsorStoryIntakeDraft:classify},{classifySponsorIntakeDraft:imageClassify},{SPONSOR_INTAKE_SCHEMA}]=await Promise.all([
  import('../worker/experience-sponsor-story-intake-classification.ts'),import('../worker/experience-sponsor-intake-classification.ts'),
  import('../worker/experience-sponsor-intake.ts'),
]);
const table='experience_sponsor_story_intakes',draftId='experience-draft-'+ 'a'.repeat(64),otherId='experience-draft-'+ 'b'.repeat(64);
const validSchema=`CREATE TABLE ${table}(draft_id TEXT PRIMARY KEY NOT NULL,receipt_id TEXT) WITHOUT ROWID`;
const secret='PRIVATE-CONTENT-CLASSIFIER-SENTINEL';
const imageCatalog="SELECT type,sql FROM sqlite_master WHERE lower(name)=? AND type IN('table','view')";
const imageLookup='SELECT 1 AS sponsored FROM experience_sponsor_intakes WHERE draft_id=? LIMIT 1';
const isStoryLookup=sql=>/^SELECT 1 AS sponsored FROM (?:main\.)?experience_sponsor_story_intakes WHERE draft_id(?: COLLATE BINARY)?=\? LIMIT 1$/u.test(sql);
const marker="CASE WHEN json_valid(content) THEN json_type(content,'$.sponsor_intake') IS NOT NULL ELSE 0 END";
const quote=value=>'"'+value.replaceAll('"','""')+'"';
function snapshot(f){
  const result={};
  for(const namespace of ['main','temp']){
    const schema=structuredClone(f.sqlite.prepare(`SELECT type,name,tbl_name,sql FROM ${namespace}.sqlite_schema ORDER BY type,name`).all());
    result[namespace]={schema,rows:Object.fromEntries(schema.filter(row=>row.type==='table'&&!row.name.startsWith('sqlite_')).map(row=>
      [row.name,structuredClone(f.sqlite.prepare(`SELECT * FROM ${namespace}.${quote(row.name)}`).all()).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]))};
  }
  return result;
}
function installImage(f){
  f.sqlite.exec('CREATE TABLE experience_sponsor_resource_receipts(resource_id TEXT PRIMARY KEY NOT NULL)');
  for(const sql of SPONSOR_INTAKE_SCHEMA)f.sqlite.exec(sql);
}
function imageRow(f,id=draftId){
  // Deliberately unvalidated raw linkage using the actual Image DDL. This
  // minimal resource identity is not a debit, campaign approval or authority.
  const token=id.slice(-8);f.sqlite.prepare('INSERT INTO experience_sponsor_resource_receipts(resource_id) VALUES(?)').run('raw-resource-'+token);
  const columns=f.sqlite.prepare('PRAGMA table_info(experience_sponsor_intakes)').all();
  const values=columns.map(column=>column.name==='draft_id'?id:column.name==='resource_id'?'raw-resource-'+token:column.type==='INTEGER'?1:'raw-'+column.name+'-'+token);
  f.sqlite.prepare(`INSERT INTO experience_sponsor_intakes(${columns.map(column=>quote(column.name)).join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...values);
}
const storyRow=(f,id=draftId)=>f.sqlite.prepare(`INSERT INTO main.${table}(draft_id,receipt_id) VALUES(?,?)`).run(id,'not-a-validated-receipt');
const marked=(f,value,id=draftId)=>f.sqlite.prepare('INSERT OR REPLACE INTO private_content(content_id,content) VALUES(?,?)').run(id,JSON.stringify({privateText:secret,sponsor_intake:value}));
function fixture(t,{story=null,image=false,strict=false}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  f.sqlite.exec('CREATE TABLE private_content(content_id TEXT PRIMARY KEY NOT NULL,content TEXT)');
  f.sqlite.prepare('INSERT INTO private_content VALUES(?,?)').run(draftId,JSON.stringify({privateText:secret}));
  if(story)f.sqlite.exec(story);if(image)installImage(f);
  const originalDb=f.DB,trace=[],violations=[];let media=0;
  for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{media++;throw Error('No media in intake classification');};
  const inspect=sql=>{
    try{
      assert.match(sql,/^\s*(SELECT|WITH)\b/iu);
      assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|ATTACH|DETACH|PRAGMA)\b/iu);
      assert.doesNotMatch(sql,/\b(?:events|event_private_payloads|document_jobs|output_operation_slots|output_execution_grants|output_plan_revisions|experience_sponsor_consumptions|budget_reservations|cost_budget_reservations)\b/iu);
      if(/\bprivate_content\b/u.test(sql)){assert.ok(sql.includes(marker));assert.doesNotMatch(sql,/\bSELECT\s+(?:\w+\.)?content\b/iu);}
    }catch(error){violations.push(String(error));throw error;}
  };
  const wrap=(sql,bindings=[])=>{
    inspect(sql);const original=originalDb.prepare(sql).bind(...bindings),statement={sql,bindings,bind:(...values)=>wrap(sql,values)};
    for(const method of ['first','all'])statement[method]=async()=>{
      const entry={sql,bindings,method};trace.push(entry);if(f.before)await f.before(entry);
      const changes=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
      const schemas=['main','temp'].map(name=>f.sqlite.prepare(`PRAGMA ${name}.schema_version`).get().schema_version);
      const result=await original[method]();
      try{
        assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,changes);
        assert.deepEqual(['main','temp'].map(name=>f.sqlite.prepare(`PRAGMA ${name}.schema_version`).get().schema_version),schemas);
        assert.ok(!JSON.stringify(result).includes(secret),'Only scalar/catalog evidence may cross the DB boundary');
      }catch(error){violations.push(String(error));throw error;}
      entry.result=structuredClone(result);
      return f.after?await f.after(entry,result):result;
    };
    statement.run=()=>{violations.push('run');throw Error('No writes');};return statement;
  };
  const DB={prepare:sql=>wrap(sql),batch:()=>{violations.push('batch');throw Error('Classifier requires only scalar queries');}};
  f.env.DB=DB;f.observedDb=DB;f.trace=trace;f.request=()=>new Request('https://forma.test/__fixture/intake-classification',{headers:{'oai-authenticated-user-id':'fixture-actor','oai-authenticated-user-email':'fixture@example.invalid',cookie:'fixture=1'}});
  f.classify=async(request=f.request(),id=draftId)=>{
    const before=snapshot(f),result=await classify(request,f.env,id);
    if(!f.allowMutation)assert.deepEqual(snapshot(f),before);
    assert.ok(Object.isFrozen(result));assert.deepEqual(Object.keys(result).sort(),result.kind==='ordinary'?['guard','kind']:['kind']);
    if(result.kind==='ordinary'){assert.ok(Object.isFrozen(result.guard));assert.ok(Object.isFrozen(result.guard.bindings));assert.deepEqual(Object.keys(result.guard).sort(),['bindings','sql']);}
    return result;
  };
  f.guard=async guard=>(await DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END AS current`).bind(...guard.bindings).first()).current;
  if(strict){f.limits=enforceD1ExpressionDepth({sqlite:f.sqlite,env:{DB}},{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>{f.limits.assertVerified();f.limits.restore();});}
  t.after(()=>{assert.deepEqual(violations,[]);assert.equal(media,0);assert.equal(egress,0);});
  return f;
}

test('imported Image classifier source remains unchanged',async()=>{
  assert.equal(createHash('sha256').update(await readFile(new URL('../worker/experience-sponsor-intake-classification.ts',import.meta.url))).digest('hex'),'b14012edaa6c220e5dc8f98181de98e95698b56f26e7ce117758e5ef40df18c5');
});
for(const [name,story] of [['absent',null],['empty',validSchema],['future receipt columns',`CREATE TABLE ${table}(draft_id TEXT PRIMARY KEY NOT NULL,receipt_id TEXT,receipt_digest TEXT,extra INTEGER) WITHOUT ROWID`]])
  test(`${name} Story sidecar preserves the actual Image guard and strict bounded ordinary SQL`,async t=>{
    const f=fixture(t,{story,image:true,strict:true}),image=await imageClassify(f.env,draftId);f.trace.length=0;
    assert.equal(image.kind,'ordinary');const result=await f.classify();assert.equal(result.kind,'ordinary');
    assert.ok(result.guard.sql.includes(image.guard.sql));assert.deepEqual(result.guard.bindings.slice(0,image.guard.bindings.length),image.guard.bindings);
    assert.equal(await f.guard(result.guard),1);
    assert.ok(f.trace.some(entry=>entry.sql===imageCatalog&&entry.method==='all'));
    assert.ok(f.trace.some(entry=>entry.sql===imageLookup&&entry.method==='all'));
    t.diagnostic(JSON.stringify({case:name,strictSqlShapes:f.limits.records.length,maximumBindings:Math.max(...f.limits.boundCounts),expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000}));
  });

for(const [name,value] of [['null',null],['false',false],['zero',0],['string','unknown-family'],['array',[]],['orphan',{version:99,receiptId:'missing'}]])
  test(`marker-only ${name} preserves unknown-family sponsored refusal`,async t=>{
    const f=fixture(t,{story:validSchema,image:true});marked(f,value);assert.deepEqual(await f.classify(),{kind:'sponsored'});
    storyRow(f);assert.deepEqual(await f.classify(),{kind:'story-sponsored'});
  });
test('raw Story lookup refuses ordinary even with erased body and no valid receipt; real Image sidecar conflicts',async t=>{
  const f=fixture(t,{story:validSchema,image:true});storyRow(f);f.sqlite.prepare('DELETE FROM private_content').run();
  assert.deepEqual(await f.classify(),{kind:'story-sponsored'});imageRow(f);assert.deepEqual(await f.classify(),{kind:'unavailable'});
});
test('actual raw Image sidecar without Story preserves sponsored refusal',async t=>{
  const f=fixture(t,{story:validSchema,image:true});imageRow(f);assert.deepEqual(await f.classify(),{kind:'sponsored'});
});
test('unrelated Story/Image/marker rows and malformed ordinary JSON do not confer sponsorship',async t=>{
  const f=fixture(t,{story:validSchema,image:true});storyRow(f,otherId);imageRow(f,otherId);marked(f,null,otherId);
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run('{ malformed ordinary JSON '+secret,draftId);
  const result=await f.classify();assert.equal(result.kind,'ordinary');assert.equal(await f.guard(result.guard),1);
});

const unsupported=[
  ['partial',`CREATE TABLE experience_sponsor_story_intake_receipts(receipt_id TEXT)`],
  ['view',`CREATE VIEW ${table} AS SELECT '${draftId}' AS draft_id`],
  ['mixed-case',`CREATE TABLE Experience_Sponsor_Story_Intakes(draft_id TEXT PRIMARY KEY NOT NULL) WITHOUT ROWID`],
  ['no unique index',`CREATE TABLE ${table}(draft_id TEXT NOT NULL)`],
  ['nullable key',`CREATE TABLE ${table}(draft_id TEXT UNIQUE)`],
  ['rowid primary key',`CREATE TABLE ${table}(draft_id TEXT PRIMARY KEY NOT NULL)`],
  ['composite primary key',`CREATE TABLE ${table}(draft_id TEXT NOT NULL,part TEXT NOT NULL,PRIMARY KEY(draft_id,part)) WITHOUT ROWID`],
  ['descending key',`CREATE TABLE ${table}(draft_id TEXT PRIMARY KEY DESC NOT NULL) WITHOUT ROWID`],
  ['nontext key',`CREATE TABLE ${table}(draft_id INTEGER PRIMARY KEY NOT NULL) WITHOUT ROWID`],
  ['NOCASE key',`CREATE TABLE ${table}(draft_id TEXT COLLATE NOCASE PRIMARY KEY NOT NULL) WITHOUT ROWID`],
];
for(const [name,story] of unsupported)test(`unsupported ${name} Story declaration fails closed`,async t=>{
  const f=fixture(t,{story});assert.deepEqual(await f.classify(),{kind:'unavailable'});
});
test('oversized catalog metadata is capped in actual SQL before transport',async t=>{
  const f=fixture(t,{story:`CREATE TABLE ${table}(draft_id TEXT PRIMARY KEY NOT NULL /*${'x'.repeat(33000)}*/) WITHOUT ROWID`});
  assert.deepEqual(await f.classify(),{kind:'unavailable'});
  const catalog=f.trace.find(entry=>entry.sql.includes('AS schema_snapshot'));assert.equal(catalog.result.results[0].schema_snapshot,null);
});

for(const change of ['Story row','Image row','marker','Story schema appearance','Story schema alteration','partial declaration'])
  test(`actual ordinary SQL witness refuses after ${change}`,async t=>{
    const f=fixture(t,{story:change==='Story schema appearance'?null:validSchema,image:true});
    const result=await f.classify();assert.equal(result.kind,'ordinary');assert.equal(await f.guard(result.guard),1);
    if(change==='Story row')storyRow(f);else if(change==='Image row')imageRow(f);else if(change==='marker')marked(f,null);
    else if(change==='Story schema appearance')f.sqlite.exec(validSchema);else if(change==='Story schema alteration')f.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN future TEXT`);
    else f.sqlite.exec('CREATE TABLE experience_sponsor_story_intake_future(id TEXT)');
    const afterMutation=snapshot(f);assert.equal(await f.guard(result.guard),0);assert.deepEqual(snapshot(f),afterMutation);
  });
test('a dropped Story table causes old ordinary SQL to refuse at preparation',async t=>{
  const f=fixture(t,{story:validSchema}),result=await f.classify();assert.equal(result.kind,'ordinary');f.sqlite.exec(`DROP TABLE ${table}`);
  await assert.rejects(f.guard(result.guard),/no such table/u);
});
for(const change of ['Story row','marker'])test(`final real scalar witness observes late ${change}`,async t=>{
  const f=fixture(t,{story:validSchema});f.allowMutation=true;let injected=false,afterMutation;
  f.before=entry=>{if(entry.sql.endsWith(' AS current')&&!injected){injected=true;if(change==='Story row')storyRow(f);else marked(f,null);afterMutation=snapshot(f);}};
  assert.deepEqual(await f.classify(),{kind:'unavailable'});assert.equal(injected,true);assert.deepEqual(snapshot(f),afterMutation);
  assert.equal(f.trace.at(-1).result.results[0].current,0);
});

test('main Story evidence cannot be hidden by an empty TEMP shadow table',async t=>{
  const f=fixture(t,{story:validSchema});storyRow(f);f.sqlite.exec(`CREATE TEMP TABLE ${table}(draft_id TEXT PRIMARY KEY NOT NULL,receipt_id TEXT) WITHOUT ROWID`);
  const result=await f.classify();assert.notEqual(result.kind,'ordinary','Main catalog witness must use the same main sidecar for lookup');
});
test('ordinary witness tracks main Story insertion despite an empty TEMP shadow',async t=>{
  const f=fixture(t,{story:validSchema});f.sqlite.exec(`CREATE TEMP TABLE ${table}(draft_id TEXT PRIMARY KEY NOT NULL,receipt_id TEXT) WITHOUT ROWID`);
  const result=await f.classify();
  if(result.kind==='unavailable')return;
  assert.equal(result.kind,'ordinary');assert.equal(await f.guard(result.guard),1);storyRow(f);assert.equal(await f.guard(result.guard),0);
});
test('declared NOCASE column with BINARY primary key still uses the verified indexed equality',async t=>{
  const f=fixture(t,{story:`CREATE TABLE ${table}(draft_id TEXT COLLATE NOCASE NOT NULL,receipt_id TEXT,PRIMARY KEY(draft_id COLLATE BINARY)) WITHOUT ROWID`});
  const result=await f.classify();assert.equal(result.kind,'ordinary');
  const lookup=f.trace.find(entry=>isStoryLookup(entry.sql));assert.ok(lookup);
  const queryPlan=f.sqlite.prepare('EXPLAIN QUERY PLAN '+lookup.sql).all(...lookup.bindings);
  assert.match(queryPlan.map(row=>row.detail).join('\n'),/SEARCH .*USING PRIMARY KEY/iu);
  storyRow(f,draftId.toUpperCase());assert.equal(await f.guard(result.guard),1,'Different BINARY draft identity must remain unrelated');
});

for(const fault of ['DB','header','cookie','URL','method','signal','cohort','admins','abort','deadline'])test(`${fault} drift across an imported scalar await refuses before further reads`,async t=>{
  const f=fixture(t),controller=new AbortController(),request=new Request(f.request(),{signal:controller.signal});let changed=false,substituteReads=0;
  f.after=(entry,value)=>{if(!changed){changed=true;
    if(fault==='DB')f.env.DB={prepare(){substituteReads++;throw Error('substitute database must not be used');}};
    else if(fault==='header')request.headers.set('oai-authenticated-user-email','changed@example.invalid');
    else if(fault==='cookie')request.headers.set('cookie','changed=1');
    else if(fault==='URL')Object.defineProperty(request,'url',{value:'https://forma.test/changed'});
    else if(fault==='method')Object.defineProperty(request,'method',{value:'POST'});
    else if(fault==='signal')Object.defineProperty(request,'signal',{value:new AbortController().signal});
    else if(fault==='cohort')f.env.FORMA_PILOT_COHORT_ID='changed';else if(fault==='admins')f.env.FORMA_ADMIN_EMAILS='changed@example.invalid';
    else if(fault==='abort')controller.abort();else{const later=performance.now()+31_000;t.mock.method(performance,'now',()=>later);}
  }return value;};
  assert.deepEqual(await f.classify(request),{kind:'unavailable'});assert.equal(changed,true);assert.equal(f.trace.length,1);assert.equal(substituteReads,0);
});
test('aborted requests and invalid draft identities fail before SQL',async t=>{
  const f=fixture(t),controller=new AbortController();controller.abort();
  assert.deepEqual(await f.classify(new Request(f.request(),{signal:controller.signal})),{kind:'unavailable'});
  for(const value of ['invalid',null,{},'experience-draft-'+ 'A'.repeat(64)])assert.deepEqual(await f.classify(f.request(),value),{kind:'unavailable'});
  assert.equal(f.trace.length,0);
});

function altered(value,key,mode,counter){
  const copy={...value};delete copy[key];const property=Object.getOwnPropertyDescriptor(value,key)?.value;
  if(mode==='inherited')return Object.assign(Object.create({[key]:property}),copy);
  Object.defineProperty(copy,key,mode==='accessor'?{enumerable:true,get(){counter.calls++;return property;}}:{enumerable:false,value:property});return copy;
}
for(const [name,transform] of [
  ['inherited success',(value,counter)=>altered(value,'success','inherited',counter)],
  ['accessor success',(value,counter)=>altered(value,'success','accessor',counter)],
  ['nonenumerable results',(value,counter)=>altered(value,'results','hidden',counter)],
  ['inherited results',(value,counter)=>altered(value,'results','inherited',counter)],
  ['accessor results',(value,counter)=>altered(value,'results','accessor',counter)],
  ['sparse result',value=>({...value,results:new Array(1)})],
  ['inherited result index',value=>({...value,results:Object.setPrototypeOf(new Array(1),{0:value.results[0]})})],
  ['accessor row field',(value,counter)=>({...value,results:[altered(value.results[0],'type','accessor',counter)]})],
  ['inherited row field',(value,counter)=>({...value,results:[altered(value.results[0],'sql','inherited',counter)]})],
  ['failed acknowledgment',value=>({...value,success:false})],
  ['extra row field',value=>({...value,results:[{...value.results[0],untrusted:'extra'}]})],
])test(`new facade rejects ${name} from the unchanged imported Image catalog`,async t=>{
  const f=fixture(t,{image:true}),counter={calls:0};let injected=false;
  f.after=(entry,value)=>{if(!injected&&entry.sql===imageCatalog){assert.equal(entry.method,'all');injected=true;return transform(value,counter);}return value;};
  assert.deepEqual(await f.classify(),{kind:'unavailable'});assert.equal(injected,true);assert.equal(counter.calls,0);
});
for(const [name,match,field,story] of [
  ['catalog',sql=>sql.includes('AS schema_snapshot'),'schema_snapshot',validSchema],
  ['shape',sql=>sql.endsWith(' AS supported'),'supported',validSchema],
  ['Story point',isStoryLookup,'sponsored',validSchema],
  ['final',sql=>sql.endsWith(' AS current'),'current',validSchema],
])for(const fault of ['inherited','accessor','hidden','null','false'])test(`new ${name} probe rejects ${fault} scalar data`,async t=>{
  const f=fixture(t,{story}),counter={calls:0};if(name==='Story point')storyRow(f);let injected=false;
  f.after=(entry,value)=>{if(!injected&&match(entry.sql)){injected=true;const row=value.results[0];
    return {...value,results:[['null','false'].includes(fault)?{...row,[field]:fault==='null'?null:false}:altered(row,field,fault,counter)]};}return value;};
  assert.deepEqual(await f.classify(),{kind:'unavailable'});assert.equal(injected,true);assert.equal(counter.calls,0);
});
for(const kind of ['nested scalar','inherited row serializer'])test(`malformed ${kind} cannot execute a serialization hook`,async t=>{
  const f=fixture(t,{story:validSchema});storyRow(f);let injected=false,calls=0;
  f.after=(entry,value)=>{if(!injected&&entry.sql.includes('AS sponsored')&&entry.sql.includes(table)){
    injected=true;return {...value,results:[kind==='nested scalar'?{sponsored:{toJSON(){calls++;return 1;}}}:Object.assign(Object.create({toJSON(){calls++;return {sponsored:1};}}),{sponsored:1})]};
  }return value;};
  const result=await f.classify();assert.equal(injected,true);assert.equal(calls,0);
  assert.deepEqual(result,{kind:kind==='nested scalar'?'unavailable':'story-sponsored'});
});
test('database failure remains unavailable without a fallback query',async t=>{
  const f=fixture(t);f.before=()=>{throw Error('fixture_read_failure');};assert.deepEqual(await f.classify(),{kind:'unavailable'});assert.equal(f.trace.length,1);
});

test('fixed technical timeout refuses an unsettled scalar without permitting fallback',async t=>{
  const f=fixture(t);let arrive,resume;
  const entered=new Promise(resolve=>{arrive=resolve;}),blocked=new Promise(resolve=>{resume=resolve;});
  t.mock.timers.enable({apis:['setTimeout']});
  f.after=async(_entry,value)=>{arrive();await blocked;return value;};
  const pending=f.classify();await entered;t.mock.timers.tick(30_001);
  try{assert.deepEqual(await pending,{kind:'unavailable'});assert.equal(f.trace.length,1);}
  finally{resume();await Promise.resolve();}
});

const d1Sources=['worker/experience-sponsor-story-intake-classification.ts','worker/experience-sponsor-intake-classification.ts',
  'worker/experience-sponsor-intake.ts','src/experiences/intake.ts','tests/output-server-test-helpers.mjs',
  'tests/helpers/d1-expression-depth.mjs','tests/experience-sponsor-story-intake-classification.test.mjs'];
const sourceHashes=async()=>Object.fromEntries(await Promise.all(d1Sources.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));

// Separately authorized, single-group runtime qualification. Normal focused
// runs skip it; the dedicated command sets the flag and filters this exact name.
test('actual D1: source-free Story catalog pragmas and negative guards use the exact local engine',
  {skip:process.env.FORMA_STORY_INTAKE_D1!=='1',timeout:60_000},async t=>{
    await rm('/private/tmp/forma-story-intake-classification-d1-evidence.json',{force:true});
    const beforeHashes=await sourceHashes();
    const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
    let external=0;
    t.mock.method(globalThis,'fetch',(input,options)=>{
      const url=new URL(input instanceof Request?input.url:String(input));
      if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))return originalFetch(input,{...options,redirect:'error'});
      external++;throw Error('Classifier D1 qualification forbids external network');
    });
    const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE),d1Databases:['DB'],
      script:'export default {fetch(){return new Response("local source-free classifier qualification")}}',
      outboundService(){external++;throw Error('external_network_forbidden');}});
    const trace=[],violations=[];
    try{
      const database=await mf.getD1Database('DB');
      // Empty native marker table only; there is no creative draft body, payer,
      // generation, storage receipt, HTTP application handler or donor fixture.
      await database.prepare('CREATE TABLE private_content(content_id TEXT PRIMARY KEY NOT NULL,content TEXT)').run();
      const wrap=(sql,bindings=[])=>({bind:(...values)=>wrap(sql,values),all:async()=>{
        try{
          assert.match(sql,/^\s*(SELECT|WITH)\b/iu);
          assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|ATTACH|DETACH|PRAGMA)\b/iu);
          assert.ok(bindings.length<=100);assert.ok(Buffer.byteLength(sql)<=100_000);
        }catch(error){violations.push(String(error));throw error;}
        const entry={sql,bindings};trace.push(entry);
        try{const result=await database.prepare(sql).bind(...bindings).all();entry.result=result;
          assert.equal(result.meta.changes,0);assert.ok(!JSON.stringify(result).includes(secret));return result;}
        catch(error){entry.error=String(error);throw error;}
      }});
      const env={DB:{prepare:sql=>wrap(sql)}},request=new Request('https://forma.test/__fixture/source-free-classifier');
      const state=async()=>({schema:(await database.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()).results,
        privateCount:(await database.prepare('SELECT COUNT(*) AS n FROM private_content').first()).n,
        storyRows:(await database.prepare("SELECT 1 AS present FROM main.sqlite_schema WHERE type='table' AND name=?").bind(table).first())
          ?(await database.prepare(`SELECT draft_id,receipt_id FROM main.${table} ORDER BY draft_id COLLATE BINARY`).all()).results:[]});
      const invoke=async()=>{const before=await state(),result=await classify(request,env,draftId);assert.deepEqual(await state(),before);return result;};
      const proof=async guard=>(await database.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END AS current`).bind(...guard.bindings).first()).current;
      const absent=await invoke();assert.equal(absent.kind,'ordinary');assert.equal(await proof(absent.guard),1);
      await database.prepare(validSchema).run();assert.equal(await proof(absent.guard),0);
      const empty=await invoke();assert.equal(empty.kind,'ordinary');assert.equal(await proof(empty.guard),1);
      await database.prepare(`INSERT INTO main.${table}(draft_id,receipt_id) VALUES(?,?)`).bind(draftId,'raw-unvalidated-sidecar').run();
      assert.equal(await proof(empty.guard),0);assert.deepEqual(await invoke(),{kind:'story-sponsored'});
      assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM private_content').first()).n,0);
      assert.equal(external,0);assert.deepEqual(violations,[]);const afterHashes=await sourceHashes();assert.deepEqual(afterHashes,beforeHashes);
      const evidence={success:true,engine:'local Miniflare/workerd D1',execution:'Node-hosted production classifier, not bundled Worker or HTTP endpoint',
        classifierStatements:trace.length,maximumBindings:Math.max(...trace.map(entry=>entry.bindings.length)),maximumSqlBytes:Math.max(...trace.map(entry=>Buffer.byteLength(entry.sql))),
        actualTableValuedPragmaForms:['pragma_table_list','pragma_table_xinfo','pragma_index_list','pragma_index_xinfo'],
        absentGuardPasses:true,schemaAppearanceRefuses:true,supportedEmptyPasses:true,rawStoryRefuses:true,lateRawStoryGuardRefuses:true,
        creativeBodyRows:0,providerCalls:0,externalRequests:external,classifierWrites:0,beforeSourceHashes:beforeHashes,afterSourceHashes:afterHashes};
      await writeFile('/private/tmp/forma-story-intake-classification-d1-evidence.json',JSON.stringify(evidence,null,2)+'\n');t.diagnostic(JSON.stringify(evidence));
    }catch(error){await writeFile('/private/tmp/forma-story-intake-classification-d1-failed-trace.json',JSON.stringify({error:String(error),trace},null,2)+'\n');throw error;}
    finally{await mf.dispose();}
  });
