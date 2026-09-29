import assert from 'node:assert/strict';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const {canonicalJson,digest}=await import('../src/experiences/compiler.ts');
const {nativeMemoryAnswerExclusion}=await import('../worker/memory-native-boundary.ts');
const {GUEST_IMAGE_STAGE_CUSTODY_SCHEMA,GUEST_IMAGE_STAGE_CUSTODY_COLUMNS,GUEST_IMAGE_STAGE_COPY_COLUMNS,
  guestImageStageHistoryRoles,readGuestImageStageClaimLineage,guestImageStageHistoryStorageValue,
  guestImageStageHistoryIdentity,inspectGuestImageStageCustodySchema,readGuestImageStageCustodyMapping,
  guestImageStageCustodyMappingProof,guestImageStageCopyBodyProof,guestImageStageCopyMetadataProof,guestImageStageCopyBodiesProof}=await import('../worker/experience-guest-image-stage-custody.ts');
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,hash=n=>`sha256:${String(n).repeat(64)}`;
const stamp='2020-01-01T00:00:00.000Z',quoteStamp='2020-01-01T00:00:01.000Z',expiry='2020-01-01T00:01:00.000Z';
const sessionId=id(1),guest=`guest:${id(2)}`,destination='canonical-fixture',projectId=id(3),documentId=id(4),planRevisionId=id(5),confirmId=id(6),quoteId=id(7),saveId=id(8),preflightId=id(9);
const resource=(operation='text-intake')=>({resource_id:`fixture-driver:${operation==='preflight'?'preflight':'text'}`,campaign_id:'original-campaign',policy_digest:hash('a'),limits_digest:hash('b'),
  actor_user_id:guest,session_digest:hash('c'),operation,intent_key:'original-intent',payload_digest:hash('d'),text_bytes:128,issued_grant_id:null,recorded_at_ms:Date.parse(stamp)});
const command=(action,event,created=stamp)=>({scope_key:`personal:${guest}:${projectId}`,actor_user_id:guest,command_key:`fixture-${action}`,request_digest:'e'.repeat(64),action,event_id:event,created_at:created});
const confirmationContent=JSON.stringify({plan_revision_id:planRevisionId,confirmed_plan:{fixture:'pure shape only'},output_command_envelope:{action:'confirm'},project_id:projectId,document_id:documentId,actor_user_id:guest});
const quoteContent=JSON.stringify({preflight_id:preflightId,plan_revision_id:planRevisionId,preflight:{fixture:'pure shape only'},guest_sponsor_quote_transport:{fixture:'pure shape only'},output_command_envelope:{action:'preflight'},project_id:projectId,document_id:documentId,actor_user_id:guest});
const constructionContent=canonicalJson({stage:{driver_id:'fixture-driver',stage:'preflight',command_json:'{"action":"preflight"}',command_digest:'e'.repeat(64)},resource:resource('preflight')});
// These fixtures exercise pure metadata shape and inert SQL constraints only.
// They are never native guest inventory, completed custody or successful authority.
async function lineage(state='quoted'){
  const value={version:1,kind:'original-image-stage-custody',sessionId,guestSubject:guest,destinationUserId:destination,projectId,documentId,
    manifestDigest:hash('a'),nativeSnapshotDigest:hash('f'),contextLineageDigest:hash('b'),saveLineageDigest:hash('c'),source:{head:3,saveHead:4,stageHead:state==='quoted'?6:5,state,expiresAt:expiry,
      originalPayerUserId:'original-payer',saveEventId:saveId,confirmation:{id:confirmId,sequence:5,occurred:stamp,recorded:stamp,
        public:JSON.stringify({plan_revision_id:planRevisionId,project_id:projectId,document_id:documentId,actor_user_id:guest,_private_ref:confirmId}),privateDigest:await digest(confirmationContent)},
      confirmationCommand:command('confirm',confirmId),confirmationResource:resource(),quote:null,quoteCommand:null,construction:null},copies:[]};
  if(state==='quoted'){
    value.source.quote={id:quoteId,sequence:6,occurred:quoteStamp,recorded:quoteStamp,
      public:JSON.stringify({preflight_id:preflightId,plan_revision_id:planRevisionId,project_id:projectId,document_id:documentId,actor_user_id:guest,_private_ref:quoteId}),
      privateDigest:await digest(quoteContent),preflightId,planRevisionId,expiresAt:expiry,termsDigest:'f'.repeat(64)};
    value.source.quoteCommand=command('preflight',quoteId,quoteStamp);
  }
  if(state!=='confirmed')value.source.construction={driverId:'fixture-driver',commandDigest:'e'.repeat(64),resource:resource('preflight')};
  const content={confirmation:confirmationContent,quote:quoteContent,construction:constructionContent};
  for(const role of guestImageStageHistoryRoles(state)){
    const originalDigest=await digest(content[role]);
    value.copies.push({role,contentId:await guestImageStageHistoryIdentity({sessionId,destinationUserId:destination,manifestDigest:value.manifestDigest,role,originalDigest}),digest:originalDigest,bytes:Buffer.byteLength(content[role])});
  }
  return value;
}
function fixture(t,sqls=GUEST_IMAGE_STAGE_CUSTODY_SCHEMA){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  f.sqlite.exec('CREATE TABLE experience_guest_image_claims(session_id TEXT PRIMARY KEY NOT NULL); CREATE TABLE private_content(content_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,redacted_at TEXT);');
  for(const sql of sqls)f.sqlite.exec(sql);return f;
}
function insert(f,table,row){const keys=Object.keys(row);f.sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));}
async function seedMetadata(f,state='quoted'){
  const value=await lineage(state),row={session_id:sessionId,destination_user_id:destination,lease_id:'fixture-lease',request_id:'fixture-request',manifest_digest:value.manifestDigest,
    context_lineage_digest:value.contextLineageDigest,save_lineage_digest:value.saveLineageDigest,lineage_json:canonicalJson(value),lineage_digest:await digest(value),created_at_ms:Date.parse(stamp)};
  f.sqlite.prepare('INSERT INTO experience_guest_image_claims VALUES(?)').run(sessionId);
  insert(f,'experience_guest_image_stage_custodies',row);
  const copies=value.copies.map(copy=>({session_id:sessionId,role:copy.role,content_id:copy.contentId,original_digest:copy.digest,byte_length:copy.bytes,created_at:stamp,expires_at:'2020-01-02T00:00:00.000Z'}));
  for(const copy of copies){insert(f,'private_content',{content_id:copy.content_id,owner_id:destination,kind:'guest-image-stage-history',content:'fixture',created_at:copy.created_at,expires_at:copy.expires_at,redacted_at:null});insert(f,'experience_guest_image_stage_copies',copy);}
  return {value,row,copies};
}
for(const state of ['confirmed','preflight-claimed-unknown','quoted'])test(`${state} closed immutable lineage and source-free metadata retain exact historical state`,async t=>{
  const f=fixture(t),{value,row,copies}=await seedMetadata(f,state),before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
  const parsed=readGuestImageStageClaimLineage(canonicalJson(value));assert.deepEqual(parsed,value);assert.ok(Object.isFrozen(parsed));assert.ok(Object.isFrozen(parsed.copies));assert.ok(Object.isFrozen(parsed.source.confirmation));
  const read=await readGuestImageStageCustodyMapping(f.env,{sessionId});assert.deepEqual(JSON.parse(JSON.stringify(read.row)),row);assert.deepEqual(JSON.parse(JSON.stringify(read.copies)),copies);
  assert.equal((await f.DB.prepare(`SELECT 1 AS current WHERE ${read.proof.sql}`).bind(...read.proof.bindings).first()).current,1);
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before);
  assert.equal(canonicalJson(read).includes('pure shape only'),false,'metadata includes no source bodies');assert.equal(canonicalJson(read).includes('command_json'),false);
});
for(const [name,mutate]of [
  ['extra root',v=>{v.secret='text';}],['guest destination',v=>{v.destinationUserId=guest;}],['missing native snapshot',v=>{delete v.nativeSnapshotDigest;}],
  ['wrong SAVE head',v=>{v.source.saveHead++;}],['wrong stage head',v=>{v.source.stageHead++;}],['body in public metadata',v=>{v.source.confirmation.creative='text';}],
  ['source actor mismatch',v=>{v.source.confirmationCommand.actor_user_id=destination;}],['resource actor mismatch',v=>{v.source.confirmationResource.actor_user_id=destination;}],
  ['invented charged stage',v=>{v.source.construction.command_json='secret';}],['unknown receipt refund',v=>{v.source.construction.resource.refund=1;}],
  ['reused confirmation ID',v=>{v.source.quote.id=confirmId;}],['quote expiry extension',v=>{v.source.quote.expiresAt='2020-01-01T00:16:01.001Z';}],
  ['quote digest mismatch',v=>{v.copies[1].digest=hash('b');}],['out of order roles',v=>{v.copies.reverse();}],['duplicate copy identity',v=>{v.copies[1].contentId=v.copies[0].contentId;}],
  ['oversized confirmation',v=>{v.copies[0].bytes=65537;}],['oversized construction',v=>{v.copies[2].bytes=131073;}],['unknown role',v=>{v.copies[0].role='live-quote';}],
])test(`closed lineage rejects ${name}`,async()=>{const value=await lineage();mutate(value);assert.throws(()=>readGuestImageStageClaimLineage(canonicalJson(value)),/image_stage_custody_invalid/u);});
test('lineage rejects noncanonical serialization, malformed UTF-8, byte overflow and empty input',async()=>{
  const value=await lineage();assert.throws(()=>readGuestImageStageClaimLineage(JSON.stringify(value)));assert.throws(()=>readGuestImageStageClaimLineage(''));
  assert.throws(()=>readGuestImageStageClaimLineage('{"x":"\ud800"}'));assert.throws(()=>readGuestImageStageClaimLineage('{"x":"'+'é'.repeat(32768)+'"}'));
});
test('role storage preparation preserves exact original bytes and rejects cross-role or extra bodies',()=>{
  for(const [role,raw]of [['confirmation',confirmationContent],['quote',quoteContent],['construction',constructionContent]])assert.equal(guestImageStageHistoryStorageValue(role,raw),raw);
  assert.throws(()=>guestImageStageHistoryStorageValue('quote',confirmationContent));assert.throws(()=>guestImageStageHistoryStorageValue('confirmation',quoteContent));
  assert.throws(()=>guestImageStageHistoryStorageValue('construction',canonicalJson({...JSON.parse(constructionContent),quote:JSON.parse(quoteContent)})));
  assert.throws(()=>guestImageStageHistoryStorageValue('construction',constructionContent+' '));
  assert.throws(()=>guestImageStageHistoryStorageValue('confirmation',confirmationContent.replace('pure shape only','é'.repeat(32768))));
});
test('history identity commits every namespace field without body text and rejects extras',async()=>{
  const input={sessionId,destinationUserId:destination,manifestDigest:hash('a'),role:'confirmation',originalDigest:hash('b')};
  const first=await guestImageStageHistoryIdentity(input);assert.match(first,/^guest-image-stage-history-[a-f0-9]{64}$/u);assert.equal(await guestImageStageHistoryIdentity({...input}),first);
  for(const change of [{sessionId:id(10)},{destinationUserId:'another-owner'},{manifestDigest:hash('c')},{role:'quote'},{originalDigest:hash('d')}])assert.notEqual(await guestImageStageHistoryIdentity({...input,...change}),first);
  await assert.rejects(guestImageStageHistoryIdentity({...input,body:'secret'}));await assert.rejects(guestImageStageHistoryIdentity({...input,role:'run'}));
});
test('schema qualification includes the external identity trigger and pins later schema drift',async t=>{
  const f=fixture(t),schema=await inspectGuestImageStageCustodySchema(f.env);assert.match(schema.snapshot,/experience_guest_image_stage_content_identity/u);
  assert.equal((await f.DB.prepare(`SELECT 1 WHERE ${schema.proof.sql}`).bind(...schema.proof.bindings).first())!==null,true);
  f.sqlite.exec('DROP TRIGGER experience_guest_image_stage_content_identity');
  assert.equal(await f.DB.prepare(`SELECT 1 WHERE ${schema.proof.sql}`).bind(...schema.proof.bindings).first(),null);
  await assert.rejects(inspectGuestImageStageCustodySchema(f.env),/schema_unavailable/u);
});
for(const [name,sqls]of [
  ['absent',[]],['tables only',GUEST_IMAGE_STAGE_CUSTODY_SCHEMA.filter(sql=>sql.startsWith('CREATE TABLE'))],
  ['missing copy delete guard',GUEST_IMAGE_STAGE_CUSTODY_SCHEMA.filter(sql=>!sql.startsWith('CREATE TRIGGER experience_guest_image_stage_copies_no_delete'))],
  ['changed identity trigger',GUEST_IMAGE_STAGE_CUSTODY_SCHEMA.map(sql=>sql.startsWith('CREATE TRIGGER experience_guest_image_stage_content_identity')?sql.replace("SELECT RAISE(ABORT,'guest image stage content identity immutable')",'SELECT 1'):sql)],
  ['unknown family index',[...GUEST_IMAGE_STAGE_CUSTODY_SCHEMA,'CREATE INDEX unknown_copy ON experience_guest_image_stage_copies(role)']],
])test(`whole schema refuses ${name}`,async t=>{const f=fixture(t,sqls);await assert.rejects(inspectGuestImageStageCustodySchema(f.env),/schema_unavailable/u);});
test('both mapping tables reject replacement/update/delete and mapped body identity changes while allowing native tombstones',async t=>{
  const f=fixture(t),{row,copies}=await seedMetadata(f),copy=copies[0];
  for(const [table,columns,value]of [['experience_guest_image_stage_custodies',GUEST_IMAGE_STAGE_CUSTODY_COLUMNS,row],['experience_guest_image_stage_copies',GUEST_IMAGE_STAGE_COPY_COLUMNS,copy]]){
    assert.throws(()=>f.sqlite.prepare(`UPDATE ${table} SET session_id=session_id WHERE session_id=?`).run(sessionId),/immutable/u);
    assert.throws(()=>f.sqlite.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(sessionId),/immutable/u);
    assert.throws(()=>f.sqlite.prepare(`INSERT OR REPLACE INTO ${table}(${columns}) VALUES(${columns.split(',').map(()=>'?').join(',')})`).run(...columns.split(',').map(key=>value[key])),/exists/u);
  }
  for(const [column,value]of [['content_id','different-content'],['owner_id','foreign-owner'],['kind','chat-assistant']])assert.throws(()=>f.sqlite.prepare(`UPDATE private_content SET ${column}=? WHERE content_id=?`).run(value,copy.content_id),/identity immutable/u);
  assert.equal(f.sqlite.prepare('UPDATE private_content SET content_id=content_id,owner_id=owner_id,kind=kind WHERE content_id=?').run(copy.content_id).changes,1);
  assert.equal(f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(expiry,copy.content_id).changes,1);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal((await readGuestImageStageCustodyMapping(f.env,{sessionId})).copies.length,3,'metadata remains available after native tombstone');
  insert(f,'private_content',{content_id:'ordinary',owner_id:'owner',kind:'chat-user',content:'ordinary',created_at:stamp,expires_at:expiry,redacted_at:null});
  assert.equal(f.sqlite.prepare("UPDATE private_content SET owner_id='different',kind='chat-assistant' WHERE content_id='ordinary'").run().changes,1,'unmapped ordinary content behavior unchanged');
});
test('mapping proof is an exact ordered manifest and preserves independent canonical retention',async t=>{
  const f=fixture(t),{row,copies}=await seedMetadata(f),proof=guestImageStageCustodyMappingProof(row,copies);
  assert.equal((await f.DB.prepare(`SELECT 1 WHERE ${proof.sql}`).bind(...proof.bindings).first())!==null,true);
  assert.equal(copies[0].expires_at>JSON.parse(row.lineage_json).source.expiresAt,true);
  assert.equal(await f.DB.prepare(`SELECT 1 WHERE ${guestImageStageCustodyMappingProof(row,copies.slice(0,2)).sql}`).bind(...guestImageStageCustodyMappingProof(row,copies.slice(0,2)).bindings).first(),null);
  assert.equal(await f.DB.prepare(`SELECT 1 WHERE ${guestImageStageCustodyMappingProof({...row,request_id:'changed'},copies).sql}`).bind(...guestImageStageCustodyMappingProof({...row,request_id:'changed'},copies).bindings).first(),null);
});
test('schema and metadata reads refuse database substitution across an await',async t=>{
  const f=fixture(t),original=f.DB.prepare;let substituted=false;
  f.DB.prepare=sql=>{const statement=original(sql),first=statement.first;statement.first=async()=>{const row=await first.call(statement);if(!substituted){substituted=true;f.env.DB={prepare(){throw Error('substitute must never be queried');}};}return row;};return statement;};
  await assert.rejects(inspectGuestImageStageCustodySchema(f.env),/database_changed/u);
});

test('immutable custody blocks replacement through a foreign session using the same unique lease',async t=>{
  const f=fixture(t),value=await lineage('confirmed'),row={session_id:sessionId,destination_user_id:destination,lease_id:'shared-fixture-lease',request_id:'fixture-request',manifest_digest:value.manifestDigest,
    context_lineage_digest:value.contextLineageDigest,save_lineage_digest:value.saveLineageDigest,lineage_json:canonicalJson(value),lineage_digest:await digest(value),created_at_ms:Date.parse(stamp)};
  for(const session of [sessionId,id(10)])f.sqlite.prepare('INSERT INTO experience_guest_image_claims VALUES(?)').run(session);
  insert(f,'experience_guest_image_stage_custodies',row);
  assert.equal(f.sqlite.prepare('PRAGMA recursive_triggers').get().recursive_triggers,0);
  const replacement={...row,session_id:id(10)};
  assert.throws(()=>f.sqlite.prepare(`INSERT OR REPLACE INTO experience_guest_image_stage_custodies(${GUEST_IMAGE_STAGE_CUSTODY_COLUMNS}) VALUES(${GUEST_IMAGE_STAGE_CUSTODY_COLUMNS.split(',').map(()=>'?').join(',')})`).run(...GUEST_IMAGE_STAGE_CUSTODY_COLUMNS.split(',').map(key=>replacement[key])),/exists/u);
});
test('immutable copies block replacement through another role using the same unique content ID',async t=>{
  const f=fixture(t),{copies}=await seedMetadata(f,'confirmed'),replacement={...copies[0],role:'quote'};
  assert.equal(f.sqlite.prepare('PRAGMA recursive_triggers').get().recursive_triggers,0);
  assert.throws(()=>f.sqlite.prepare(`INSERT OR REPLACE INTO experience_guest_image_stage_copies(${GUEST_IMAGE_STAGE_COPY_COLUMNS}) VALUES(${GUEST_IMAGE_STAGE_COPY_COLUMNS.split(',').map(()=>'?').join(',')})`).run(...GUEST_IMAGE_STAGE_COPY_COLUMNS.split(',').map(key=>replacement[key])),/exists/u);
});

test('construction component preserves a bounded original command JSON longer than 8192 characters',()=>{
  const commandJson=canonicalJson({action:'preflight',...Object.fromEntries(Array.from({length:20},(_,i)=>[`fixture${i}`,'x'.repeat(512)]))});
  assert.ok(Buffer.byteLength(commandJson)>8192);assert.ok(Buffer.byteLength(commandJson)<65536);
  const raw=canonicalJson({...JSON.parse(constructionContent),stage:{...JSON.parse(constructionContent).stage,command_json:commandJson}});
  assert.equal(guestImageStageHistoryStorageValue('construction',raw),raw);
});

// Independently retained original scalar predicate from source 892cea78. It is
// the equivalence oracle, not a second implementation of the new tuple helper.
function originalScalarBodyProof(owner,copy,body,exclusion){
  const now="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  return {sql:`EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=? AND content.owner_id=?
    AND content.kind='guest-image-stage-history' AND content.content=? AND length(CAST(content.content AS BLOB))=?
    AND content.created_at=? AND content.expires_at=? AND content.created_at<=${now} AND content.expires_at>${now}
    AND content.redacted_at IS NULL AND (NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=content.content_id)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=content.content_id)) AND (${exclusion.sql}))`,
    bindings:[copy.content_id,owner,body,copy.byte_length,copy.created_at,copy.expires_at,...exclusion.bindings]};
}
async function tupleFixture(t){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  // Intentionally nullable/adverse rows test SQL NULL/type semantics. These
  // are not native claim storage or a completed-custody authority fixture.
  f.sqlite.exec(`CREATE TABLE private_content(content_id TEXT,owner_id TEXT,kind TEXT,content TEXT,created_at TEXT,expires_at TEXT,redacted_at TEXT);
    CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);
    CREATE TABLE private_content_retention_scopes(content_id TEXT);
    CREATE TABLE events(event_id TEXT,type TEXT,payload TEXT,actor TEXT);`);
  const owner='canonical-owner',body='{"history":"é🦆"}',copy={session_id:sessionId,role:'confirmation',content_id:`guest-image-stage-history-${'a'.repeat(64)}`,
    original_digest:hash('b'),byte_length:Buffer.byteLength(body),created_at:'2000-01-01T00:00:00.000Z',expires_at:'2999-01-01T00:00:00.000Z'};
  const row={content_id:copy.content_id,owner_id:owner,kind:'guest-image-stage-history',content:body,created_at:copy.created_at,expires_at:copy.expires_at,redacted_at:null};
  insert(f,'private_content',row);
  const exclusion=await nativeMemoryAnswerExclusion(f.env,{answerAlias:'content'});
  const strict=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>strict.restore());
  const value=async proof=>(await f.DB.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`).bind(...proof.bindings).first()).current;
  return {...f,owner,body,copy,row,exclusion,strict,value};
}
test('six-field tuple exactly matches old scalar positive and each field mutation under strict SQLite',async t=>{
  const f=await tupleFixture(t),old=originalScalarBodyProof(f.owner,f.copy,f.body,f.exclusion),next=guestImageStageCopyBodyProof(f.owner,f.copy,f.body,f.exclusion);
  assert.equal(old.bindings.length-next.bindings.length,5);assert.deepEqual(next.bindings.slice(1),f.exclusion.bindings);
  assert.equal(await f.value(old),1);assert.equal(await f.value(next),1);
  for(const [field,value]of [['content_id','different-content'],['owner_id','different-owner'],['content','{"history":"é🦅"}'],['content',f.body+' '],
    ['created_at','2000-01-01T00:00:01.000Z'],['expires_at','2999-01-01T00:00:01.000Z']]){
    f.sqlite.prepare(`UPDATE private_content SET ${field}=?`).run(value);
    assert.equal(await f.value(old),0,`old ${field}`);assert.equal(await f.value(next),0,`tuple ${field}`);
    f.sqlite.prepare(`UPDATE private_content SET ${field}=?`).run(f.row[field]);
  }
  const wrongLength={...f.copy,byte_length:f.copy.byte_length+1};assert.equal(await f.value(originalScalarBodyProof(f.owner,wrongLength,f.body,f.exclusion)),0);
  assert.throws(()=>guestImageStageCopyBodyProof(f.owner,wrongLength,f.body,f.exclusion),/body_unavailable/u,'captured byte count cannot disagree with actual UTF-8');
  const realInteger={...f.copy,byte_length:Number(`${f.copy.byte_length}.0`)};
  assert.equal(await f.value(guestImageStageCopyBodyProof(f.owner,realInteger,f.body,f.exclusion)),1);
  f.strict.assertVerified();t.diagnostic(JSON.stringify({strictUniqueSql:f.strict.records.length,maxBindings:Math.max(...f.strict.boundCounts),depth:100,arity:32,parameters:100,sqlBytes:100000}));
});
test('six-field tuple keeps old NULL and storage-type denial; malformed captured operands fail before JSON serialization',async t=>{
  const f=await tupleFixture(t),old=originalScalarBodyProof(f.owner,f.copy,f.body,f.exclusion),next=guestImageStageCopyBodyProof(f.owner,f.copy,f.body,f.exclusion);
  for(const field of ['content_id','owner_id','content','created_at','expires_at'])for(const value of [null,17]){
    f.sqlite.prepare(`UPDATE private_content SET ${field}=?`).run(value);
    assert.equal(await f.value(old),0,`old ${field} ${value}`);assert.equal(await f.value(next),0,`tuple ${field} ${value}`);
    f.sqlite.prepare(`UPDATE private_content SET ${field}=?`).run(f.row[field]);
  }
  for(const value of [null,undefined,17,true,{},[]]){
    assert.throws(()=>guestImageStageCopyBodyProof(value,f.copy,f.body,f.exclusion),/body_unavailable/u);
    assert.throws(()=>guestImageStageCopyBodyProof(f.owner,f.copy,value,f.exclusion),/body_unavailable/u);
    for(const field of ['content_id','byte_length','created_at','expires_at'])assert.throws(()=>guestImageStageCopyBodyProof(f.owner,{...f.copy,[field]:value},f.body,f.exclusion),/body_unavailable/u,`${field} malformed capture`);
  }
  assert.throws(()=>guestImageStageCopyBodyProof(f.owner,{...f.copy,byte_length:String(f.copy.byte_length)},f.body,f.exclusion),/body_unavailable/u);
  assert.throws(()=>guestImageStageCopyBodyProof(f.owner,{...f.copy,byte_length:NaN},f.body,f.exclusion),/body_unavailable/u);
  assert.throws(()=>guestImageStageCopyBodyProof(f.owner,{...f.copy,byte_length:Infinity},f.body,f.exclusion),/body_unavailable/u);
  assert.throws(()=>guestImageStageCopyBodyProof(f.owner,{...f.copy,byte_length:f.copy.byte_length+0.5},f.body,f.exclusion),/body_unavailable/u);
  const allNull={...f.copy,content_id:null,created_at:null,expires_at:null,byte_length:null};
  f.sqlite.prepare('UPDATE private_content SET content_id=NULL,owner_id=NULL,content=NULL,created_at=NULL,expires_at=NULL').run();
  assert.equal(await f.value(originalScalarBodyProof(null,allNull,null,f.exclusion)),0);
  assert.throws(()=>guestImageStageCopyBodyProof(null,allNull,null,f.exclusion),/body_unavailable/u,'JSON null equality cannot replace scalar SQL NULL refusal');
  f.strict.assertVerified();
});
test('six-field tuple retains exact kind, redaction, time, native Memory and personal-scope refusals',async t=>{
  const f=await tupleFixture(t);
  async function compare(copy=f.copy){const old=originalScalarBodyProof(f.owner,copy,f.body,f.exclusion),next=guestImageStageCopyBodyProof(f.owner,copy,f.body,f.exclusion);
    assert.equal(await f.value(old),0);assert.equal(await f.value(next),0);}
  f.sqlite.prepare("UPDATE private_content SET kind='chat-user'").run();await compare();f.sqlite.prepare("UPDATE private_content SET kind='guest-image-stage-history'").run();
  f.sqlite.prepare('UPDATE private_content SET redacted_at=?').run(stamp);await compare();f.sqlite.prepare('UPDATE private_content SET redacted_at=NULL').run();
  const future={...f.copy,created_at:'2998-01-01T00:00:00.000Z'};f.sqlite.prepare('UPDATE private_content SET created_at=?').run(future.created_at);await compare(future);
  f.sqlite.prepare('UPDATE private_content SET created_at=?').run(f.copy.created_at);
  const expired={...f.copy,expires_at:'2001-01-01T00:00:00.000Z'};f.sqlite.prepare('UPDATE private_content SET expires_at=?').run(expired.expires_at);await compare(expired);
  f.sqlite.prepare('UPDATE private_content SET expires_at=?').run(f.copy.expires_at);
  insert(f,'project_resource_scopes',{resource_kind:'content',resource_id:f.copy.content_id});await compare();f.sqlite.exec('DELETE FROM project_resource_scopes');
  insert(f,'private_content_retention_scopes',{content_id:f.copy.content_id});await compare();f.sqlite.exec('DELETE FROM private_content_retention_scopes');
  insert(f,'events',{event_id:'adverse-memory-marker',type:'AssistantReasoned',payload:JSON.stringify({memory_origin_version:1,content_ref:f.copy.content_id}),actor:'foreign-marker'});await compare();
  f.strict.assertVerified();
});

// Independently retained preread scalar predicate from source 9438d5f5. This
// partial metadata proof intentionally does not attest to exact body bytes.
function originalScalarMetadataProof(owner,copy,exclusion){
  const now="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  return {sql:`EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=? AND content.owner_id=?
    AND content.kind='guest-image-stage-history' AND content.redacted_at IS NULL AND content.created_at=? AND content.expires_at=?
    AND content.created_at<=${now} AND content.expires_at>${now} AND length(CAST(content.content AS BLOB))=?
    AND (NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=content.content_id)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=content.content_id)) AND (${exclusion.sql}))`,
    bindings:[copy.content_id,owner,copy.created_at,copy.expires_at,copy.byte_length,...exclusion.bindings]};
}
test('five-field metadata tuple matches scalar positives and each operand mutation under strict SQLite',async t=>{
  const f=await tupleFixture(t),old=originalScalarMetadataProof(f.owner,f.copy,f.exclusion),next=guestImageStageCopyMetadataProof(f.owner,f.copy,f.exclusion);
  assert.equal(old.bindings.length-next.bindings.length,4);assert.deepEqual(next.bindings.slice(1),f.exclusion.bindings);
  assert.equal(await f.value(old),1);assert.equal(await f.value(next),1);
  for(const [field,value]of [['content_id','different-content'],['owner_id','different-owner'],['created_at','2000-01-01T00:00:01.000Z'],
    ['expires_at','2999-01-01T00:00:01.000Z'],['content',f.body+' ']]){
    f.sqlite.prepare(`UPDATE private_content SET ${field}=?`).run(value);
    assert.equal(await f.value(old),0,`old stored ${field}`);assert.equal(await f.value(next),0,`tuple stored ${field}`);
    f.sqlite.prepare(`UPDATE private_content SET ${field}=?`).run(f.row[field]);
  }
  for(const change of [{content_id:`guest-image-stage-history-${'c'.repeat(64)}`},{created_at:'2000-01-01T00:00:01.000Z'},
    {expires_at:'2999-01-01T00:00:01.000Z'},{byte_length:f.copy.byte_length+1}]){
    const copy={...f.copy,...change};assert.equal(await f.value(originalScalarMetadataProof(f.owner,copy,f.exclusion)),0);
    assert.equal(await f.value(guestImageStageCopyMetadataProof(f.owner,copy,f.exclusion)),0);
  }
  assert.equal(await f.value(originalScalarMetadataProof('another-owner',f.copy,f.exclusion)),0);
  assert.equal(await f.value(guestImageStageCopyMetadataProof('another-owner',f.copy,f.exclusion)),0);
  const realInteger={...f.copy,byte_length:Number(`${f.copy.byte_length}.0`)};
  assert.equal(await f.value(originalScalarMetadataProof(f.owner,realInteger,f.exclusion)),1);
  assert.equal(await f.value(guestImageStageCopyMetadataProof(f.owner,realInteger,f.exclusion)),1);
  f.strict.assertVerified();t.diagnostic(JSON.stringify({strictUniqueSql:f.strict.records.length,maxBindings:Math.max(...f.strict.boundCounts),depth:100,arity:32,parameters:100,sqlBytes:100000}));
});
test('five-field metadata tuple denies NULL and invalid types before JSON null equality can weaken scalar refusal',async t=>{
  const f=await tupleFixture(t),old=originalScalarMetadataProof(f.owner,f.copy,f.exclusion),next=guestImageStageCopyMetadataProof(f.owner,f.copy,f.exclusion);
  for(const field of ['content_id','owner_id','created_at','expires_at','content'])for(const value of [null,17]){
    f.sqlite.prepare(`UPDATE private_content SET ${field}=?`).run(value);
    assert.equal(await f.value(old),0,`old ${field} ${value}`);assert.equal(await f.value(next),0,`tuple ${field} ${value}`);
    f.sqlite.prepare(`UPDATE private_content SET ${field}=?`).run(f.row[field]);
  }
  for(const value of [null,undefined,17,true,{},[]]){
    assert.throws(()=>guestImageStageCopyMetadataProof(value,f.copy,f.exclusion),/body_unavailable/u);
    for(const field of ['session_id','role','content_id','original_digest','byte_length','created_at','expires_at']){
      const copy={...f.copy,[field]:value};
      if(field==='byte_length'&&value===17){
        // A positive integer is valid metadata. Its mismatch refuses in SQL;
        // only the later body helper can compare it to captured raw bytes.
        assert.equal(await f.value(originalScalarMetadataProof(f.owner,copy,f.exclusion)),0);
        assert.equal(await f.value(guestImageStageCopyMetadataProof(f.owner,copy,f.exclusion)),0);
      }else assert.throws(()=>guestImageStageCopyMetadataProof(f.owner,copy,f.exclusion),/body_unavailable/u,`${field} malformed capture`);
    }
  }
  for(const value of [String(f.copy.byte_length),NaN,Infinity,f.copy.byte_length+0.5])
    assert.throws(()=>guestImageStageCopyMetadataProof(f.owner,{...f.copy,byte_length:value},f.exclusion),/body_unavailable/u);
  const allNull={...f.copy,content_id:null,created_at:null,expires_at:null,byte_length:null};
  f.sqlite.prepare('UPDATE private_content SET content_id=NULL,owner_id=NULL,content=NULL,created_at=NULL,expires_at=NULL').run();
  assert.equal(await f.value(originalScalarMetadataProof(null,allNull,f.exclusion)),0);
  assert.throws(()=>guestImageStageCopyMetadataProof(null,allNull,f.exclusion),/body_unavailable/u);
  f.strict.assertVerified();
});
test('five-field metadata tuple preserves kind, redaction, time, personal scope and native Memory gates',async t=>{
  const f=await tupleFixture(t);
  async function compare(copy=f.copy){assert.equal(await f.value(originalScalarMetadataProof(f.owner,copy,f.exclusion)),0);
    assert.equal(await f.value(guestImageStageCopyMetadataProof(f.owner,copy,f.exclusion)),0);}
  f.sqlite.prepare("UPDATE private_content SET kind='chat-user'").run();await compare();f.sqlite.prepare("UPDATE private_content SET kind='guest-image-stage-history'").run();
  f.sqlite.prepare('UPDATE private_content SET redacted_at=?').run(stamp);await compare();f.sqlite.prepare('UPDATE private_content SET redacted_at=NULL').run();
  const future={...f.copy,created_at:'2998-01-01T00:00:00.000Z'};f.sqlite.prepare('UPDATE private_content SET created_at=?').run(future.created_at);await compare(future);
  f.sqlite.prepare('UPDATE private_content SET created_at=?').run(f.copy.created_at);
  const expired={...f.copy,expires_at:'2001-01-01T00:00:00.000Z'};f.sqlite.prepare('UPDATE private_content SET expires_at=?').run(expired.expires_at);await compare(expired);
  f.sqlite.prepare('UPDATE private_content SET expires_at=?').run(f.copy.expires_at);
  insert(f,'project_resource_scopes',{resource_kind:'content',resource_id:f.copy.content_id});await compare();f.sqlite.exec('DELETE FROM project_resource_scopes');
  insert(f,'private_content_retention_scopes',{content_id:f.copy.content_id});await compare();f.sqlite.exec('DELETE FROM private_content_retention_scopes');
  insert(f,'events',{event_id:'adverse-memory-marker',type:'AssistantReasoned',payload:JSON.stringify({memory_origin_version:1,content_ref:f.copy.content_id}),actor:'foreign-marker'});await compare();
  f.strict.assertVerified();
});
test('five-field metadata tuple remains partial and outer ID and role byte bounds remain independent',async t=>{
  const f=await tupleFixture(t),old=originalScalarMetadataProof(f.owner,f.copy,f.exclusion),next=guestImageStageCopyMetadataProof(f.owner,f.copy,f.exclusion);
  f.sqlite.prepare('UPDATE private_content SET content=?').run('{"history":"é🦅"}');
  assert.equal(await f.value(old),1);assert.equal(await f.value(next),1,'same UTF-8 length is metadata only; later hash and body witness must verify bytes');
  assert.equal(await f.value(guestImageStageCopyBodyProof(f.owner,f.copy,f.body,f.exclusion)),0,'the independent final body witness rejects changed bytes');
  for(const proof of [old,next]){
    const query=`SELECT content FROM private_content WHERE content_id=? AND length(CAST(content AS BLOB)) BETWEEN 1 AND ? AND ${proof.sql}`;
    assert.notEqual(await f.DB.prepare(query).bind(f.copy.content_id,65536,...proof.bindings).first(),null);
    assert.equal(await f.DB.prepare(query).bind('different-content',65536,...proof.bindings).first(),null,'outer selected identity remains exact');
    assert.equal(await f.DB.prepare(query).bind(f.copy.content_id,f.copy.byte_length-1,...proof.bindings).first(),null,'outer byte maximum is independent');
  }
  f.strict.assertVerified();
});

async function bodySetFixture(t,count=3){
  const f=await tupleFixture(t),roles=['confirmation','quote','construction'];
  const copies=roles.slice(0,count).map((role,i)=>({...f.copy,role,content_id:`guest-image-stage-history-${String.fromCharCode(97+i).repeat(64)}`}));
  const contents=copies.map(()=>f.body),rows=copies.map(copy=>({...f.row,content_id:copy.content_id}));
  for(const row of rows.slice(1))insert(f,'private_content',row);
  // Retain the former reader's conjunction independently. Each component uses
  // the original scalar witness already compared to the six-field tuple.
  const prior=(owner=f.owner,values=copies,bodies=contents)=>{
    const parts=values.map((copy,i)=>originalScalarBodyProof(owner,copy,bodies[i],f.exclusion));
    return {sql:`EXISTS(WITH ${parts.map((part,i)=>`prior_body_${i} AS MATERIALIZED(SELECT 1 WHERE ${part.sql})`).join(',')}
      SELECT 1 FROM ${parts.map((_,i)=>`prior_body_${i}`).join(',')})`,bindings:parts.flatMap(part=>part.bindings)};
  };
  return {...f,copies,contents,rows,prior};
}
for(const count of [1,2,3])test(`body-set ${count} rows match the prior conjunction and refuse each missing or altered body`,async t=>{
  const f=await bodySetFixture(t,count),old=f.prior(),next=guestImageStageCopyBodiesProof(f.owner,f.copies,f.contents,f.exclusion);
  assert.equal(await f.value(old),1);assert.equal(await f.value(next),1);assert.equal(next.bindings.length,f.exclusion.bindings.length+2);
  for(const [i,copy]of f.copies.entries()){
    for(const [field,value]of [['content_id','different-content'],['owner_id','different-owner'],['content','{"history":"é🦅"}'],['content',f.body+' '],
      ['created_at','2000-01-01T00:00:01.000Z'],['expires_at','2999-01-01T00:00:01.000Z'],
      ...['content_id','owner_id','content','created_at','expires_at'].flatMap(field=>[[field,null],[field,17]])]){
      f.sqlite.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`).run(value,copy.content_id);
      assert.equal(await f.value(old),0,`old row${i} ${field}`);assert.equal(await f.value(next),0,`set row${i} ${field}`);
      if(field==='content_id')f.sqlite.prepare('UPDATE private_content SET content_id=? WHERE content_id IS ?').run(copy.content_id,value);
      else f.sqlite.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`).run(f.rows[i][field],copy.content_id);
    }
    f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(copy.content_id);
    assert.equal(await f.value(old),0,`missing old row${i}`);assert.equal(await f.value(next),0,`missing set row${i}`);insert(f,'private_content',f.rows[i]);
    const changed=f.contents.map((body,j)=>j===i?body.replace('🦆','🦅'):body);
    assert.equal(await f.value(f.prior(f.owner,f.copies,changed)),0);
    assert.equal(await f.value(guestImageStageCopyBodiesProof(f.owner,f.copies,changed,f.exclusion)),0);
  }
  assert.equal(await f.value(f.prior('different-owner')),0);
  assert.equal(await f.value(guestImageStageCopyBodiesProof('different-owner',f.copies,f.contents,f.exclusion)),0);
  const integerCopies=f.copies.map(copy=>({...copy,byte_length:Number(`${copy.byte_length}.0`)}));
  assert.equal(await f.value(guestImageStageCopyBodiesProof(f.owner,integerCopies,f.contents,f.exclusion)),1);
  f.strict.assertVerified();t.diagnostic(JSON.stringify({rows:count,strictUniqueSql:f.strict.records.length,maxBindings:Math.max(...f.strict.boundCounts),depth:100,arity:32,parameters:100,sqlBytes:100000}));
});
test('body-set refuses empty, duplicate, sparse, inherited, accessor, mismatched and malformed captured operands',async t=>{
  const f=await bodySetFixture(t),proof=(copies=f.copies,contents=f.contents,owner=f.owner)=>guestImageStageCopyBodiesProof(owner,copies,contents,f.exclusion);
  assert.throws(()=>proof([],[]),/body_unavailable/u);assert.throws(()=>proof([...f.copies,f.copies[0]],[...f.contents,f.body]),/body_unavailable/u);
  assert.throws(()=>proof(f.copies,f.contents.slice(0,2)),/body_unavailable/u);
  for(const mutate of [values=>{delete values[1];},values=>{values.extra='extra';},values=>{Object.defineProperty(values,'1',{get(){throw Error('getter must not run');},enumerable:true});},
    values=>{Object.defineProperty(values,'1',{value:values[1],enumerable:false});},values=>{values[Symbol('extra')]='extra';},
    values=>{const inherited=values[1];delete values[1];Object.setPrototypeOf(values,{1:inherited});}]){
    const copies=[...f.copies];mutate(copies);assert.throws(()=>proof(copies),/body_unavailable/u);
    const contents=[...f.contents];mutate(contents);assert.throws(()=>proof(f.copies,contents),/body_unavailable/u);
  }
  assert.throws(()=>proof(f.copies.map((copy,i)=>i===1?{...copy,content_id:f.copies[0].content_id}:copy)),/body_unavailable/u);
  assert.throws(()=>proof(f.copies.map((copy,i)=>i===1?{...copy,role:f.copies[0].role}:copy)),/body_unavailable/u);
  for(const value of [null,undefined,17,true,{},[]]){
    assert.throws(()=>guestImageStageCopyBodiesProof(value,f.copies,f.contents,f.exclusion),/body_unavailable/u);
    for(const i of [0,1,2]){
      const contents=[...f.contents];contents[i]=value;assert.throws(()=>proof(f.copies,contents),/body_unavailable/u);
      for(const field of ['content_id','created_at','expires_at','byte_length']){
        const copies=f.copies.map((copy,j)=>j===i?{...copy,[field]:value}:copy);assert.throws(()=>proof(copies),/body_unavailable/u);
      }
    }
  }
  for(const value of [String(f.copy.byte_length),NaN,Infinity,f.copy.byte_length+0.5,f.copy.byte_length+1]){
    const copies=f.copies.map((copy,i)=>i===1?{...copy,byte_length:value}:copy);assert.throws(()=>proof(copies),/body_unavailable/u);
  }
  assert.throws(()=>proof(f.copies,f.contents.map((body,i)=>i===1?'\ud800':body)),/body_unavailable/u);
});
test('body-set retains every per-row kind, redaction, time, personal and native Memory refusal',async t=>{
  const f=await bodySetFixture(t);
  async function compare(copies=f.copies){assert.equal(await f.value(f.prior(f.owner,copies)),0);
    assert.equal(await f.value(guestImageStageCopyBodiesProof(f.owner,copies,f.contents,f.exclusion)),0);}
  for(const [i,copy]of f.copies.entries()){
    f.sqlite.prepare("UPDATE private_content SET kind='chat-user' WHERE content_id=?").run(copy.content_id);await compare();
    f.sqlite.prepare("UPDATE private_content SET kind='guest-image-stage-history' WHERE content_id=?").run(copy.content_id);
    f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(stamp,copy.content_id);await compare();
    f.sqlite.prepare('UPDATE private_content SET redacted_at=NULL WHERE content_id=?').run(copy.content_id);
    for(const [field,value]of [['created_at','2998-01-01T00:00:00.000Z'],['expires_at','2001-01-01T00:00:00.000Z']]){
      f.sqlite.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`).run(value,copy.content_id);
      await compare(f.copies.map((item,j)=>j===i?{...item,[field]:value}:item));
      f.sqlite.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`).run(copy[field],copy.content_id);
    }
    insert(f,'project_resource_scopes',{resource_kind:'content',resource_id:copy.content_id});await compare();f.sqlite.exec('DELETE FROM project_resource_scopes');
    insert(f,'private_content_retention_scopes',{content_id:copy.content_id});await compare();f.sqlite.exec('DELETE FROM private_content_retention_scopes');
    insert(f,'events',{event_id:`adverse-memory-marker-${i}`,type:'AssistantReasoned',payload:JSON.stringify({memory_origin_version:1,content_ref:copy.content_id}),actor:'foreign-marker'});
    await compare();f.sqlite.exec('DELETE FROM events');
  }
  f.strict.assertVerified();
});
