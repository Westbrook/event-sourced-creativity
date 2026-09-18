import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{GUEST_CUSTODY_SCHEMA,readGuestCustodyTerms,guestTokenHash},{canonicalJson,digest},
  {handleGuestSessionStart,handleGuestSessionRevoke,readGuestClaimProofCookies}]=await Promise.all([
  import('../worker/experience-guest-session.ts'),import('../src/experiences/compiler.ts'),import('../worker/experience-guest-http.ts')]);
const origin='https://guest.example.invalid',names=['__Host-forma-guest-session','__Host-forma-guest-claim'],encoder=new TextEncoder();
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const sessions=f=>rows(f,'experience_guest_sessions');
const schema=f=>f.sqlite.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name,type").all();
const body='{"version":1}';
function request({method='POST',url=`${origin}/unregistered-guest`,headers={},data=body,signal}={}){
  return new Request(url,{method,headers:{origin,'content-type':'application/json',...headers},...(method==='GET'||method==='HEAD'?{}:{body:data}),...(data instanceof ReadableStream?{duplex:'half'}:{}),...(signal?{signal}:{})});
}
const cookies=response=>response.headers.getSetCookie();
const cookieHeader=response=>cookies(response).map(value=>value.split(';')[0]).join('; ');
async function unavailable(response,status){assert.equal(response.status,status);const json=await response.json();assert.equal(json.version,1);assert.equal(json.status,'unavailable');assert.equal(cookies(response).length,0);assert.equal(response.headers.get('cache-control'),'private, no-store');return json;}
async function fixture(t,{maximumSessions=5,sessionLifetimeMs=300000,expiresIn=600000,install=true}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());if(install)for(const sql of GUEST_CUSTODY_SCHEMA)f.sqlite.exec(sql);
  const terms=readGuestCustodyTerms({version:1,policyId:'explicit-reviewed-policy',origin,startsAtMs:Date.now()-60000,expiresAtMs:Date.now()+expiresIn,
    sessionLifetimeMs,leaseLifetimeMs:Math.min(60000,sessionLifetimeMs),maximumSessions,maximumLeaseAcquisitions:2});
  if(install)f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const originalSchema=schema(f);t.mock.method(globalThis,'fetch',()=>{throw Error('network forbidden');});
  for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{throw Error('media forbidden');});
  return {...f,terms,start:(req=request())=>handleGuestSessionStart(req,f.env,{policyId:terms.policyId}),
    revoke:(cookie,changes={})=>handleGuestSessionRevoke(request({...changes,headers:{cookie,...changes.headers}}),f.env),
    inert:()=>{assert.deepEqual(schema(f),originalSchema);assert.deepEqual(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name),install?['experience_guest_claim_leases','experience_guest_policies','experience_guest_sessions']:[]);}};
}
function hook(f,predicate,action,{after=false,kind='first'}={}){const prepare=f.DB.prepare;let hit=false;f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
  statement.bind=function(...bindings){const bound=bind.call(this,...bindings),execute=bound[kind];bound[kind]=async function(){if(!hit&&predicate(sql,bindings)){hit=true;if(after){const result=await execute.call(this);await action(sql,bindings,result);return result;}await action(sql,bindings);}return execute.call(this);};return bound;};return statement;};
  return()=>{f.DB.prepare=prepare;assert.equal(hit,true,'native database hook executed');};}
async function assertNoSecrets(response,proof){const text=await response.clone().text(),headers=[...response.headers].filter(([name])=>name!=='set-cookie').map(entry=>entry.join(':')).join('\n');
  for(const value of [proof.sessionId,proof.sessionToken,proof.claimToken]){assert.ok(!text.includes(value));assert.ok(!headers.includes(value));}}
async function issued(f){const response=await f.start();assert.equal(response.status,201);const cookie=cookieHeader(response),proof=readGuestClaimProofCookies(request({headers:{cookie}}));return {response,cookie,proof};}

test('explicit guest policy issues only paired secure HttpOnly credentials with source-free JSON and hash-only native storage',async t=>{
  const f=await fixture(t),{response,cookie,proof}=await issued(f),json=await response.clone().json();assert.deepEqual(Object.keys(json).sort(),['expiresAtMs','status','version']);assert.equal(json.status,'started');
  assert.equal(cookies(response).length,2);assert.ok(Object.isFrozen(proof));assert.ok(proof.sessionToken!==proof.claimToken);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  for(const value of cookies(response)){assert.ok(/; Path=\/; Secure; HttpOnly; SameSite=Lax; Expires=/u.test(value));assert.ok(!value.includes('Domain='));assert.equal(Date.parse(value.split('Expires=')[1]),Math.floor(json.expiresAtMs/1000)*1000);}
  const [row]=sessions(f);assert.equal(row.session_id,proof.sessionId);assert.equal(row.session_hash,await guestTokenHash(proof.sessionToken,'session'));assert.equal(row.claim_hash,await guestTokenHash(proof.claimToken,'claim'));
  assert.equal(row.expires_at_ms,json.expiresAtMs);assert.ok(row.expires_at_ms<=f.terms.expiresAtMs);assert.ok(!JSON.stringify(row).includes(proof.sessionToken));assert.ok(!JSON.stringify(row).includes(proof.claimToken));
  await assertNoSecrets(response,proof);assert.equal(readGuestClaimProofCookies(request({headers:{cookie:`unrelated=x; ${cookie}; unrelated2=y`}})).sessionId,proof.sessionId);f.inert();
});
test('native proof-matched revocation clears both cookie paths once and preserves immutable history',async t=>{
  const f=await fixture(t),{cookie,proof}=await issued(f),before=sessions(f)[0],response=await f.revoke(cookie);assert.equal(response.status,200);assert.deepEqual(await response.clone().json(),{version:1,status:'revoked'});
  for(const value of cookies(response))assert.match(value,/=; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT$/);
  const after=sessions(f)[0];assert.ok(after.revoked_at_ms>=before.created_at_ms);assert.deepEqual({...after,revoked_at_ms:null},{...before});await assertNoSecrets(response,proof);
  const replay=await f.revoke(cookie);assert.equal(replay.status,200);assert.deepEqual(sessions(f)[0],after);assert.deepEqual(cookies(replay),cookies(response));f.inert();
});
test('strict documented D1 limits qualify actual transport issuance and proof-matched revocation SQL',async t=>{
  const f=await fixture(t),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{const {cookie}=await issued(f);assert.equal((await f.revoke(cookie)).status,200);assert.equal((await f.revoke(cookie)).status,200);limits.assertVerified();
    t.diagnostic(JSON.stringify({queries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}f.inert();
});
test('missing native schema fails closed without initializing tables, accounts or policies',async t=>{
  const f=await fixture(t,{install:false});await unavailable(await f.start(),409);await unavailable(await f.revoke(''),409);f.inert();
});
test('unprovisioned or revoked explicit policy cannot issue a transport session',async t=>{
  const f=await fixture(t);await unavailable(await handleGuestSessionStart(request(),f.env,{policyId:'missing'}),409);f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');await unavailable(await f.start(),409);assert.equal(sessions(f).length,0);f.inert();
});
test('POST method and mandatory same-origin secure envelope are checked before native allocation',async t=>{
  const f=await fixture(t);for(const options of [{method:'GET'},{method:'PUT'},{url:'http://guest.example.invalid/x',headers:{origin:'http://guest.example.invalid'}},
    {headers:{origin:'https://other.invalid'}},{headers:{origin:''}},{headers:{'sec-fetch-site':'cross-site'}},{headers:{'sec-fetch-site':'same-site'}}]){
    const response=await f.start(request(options));await unavailable(response,['GET','PUT'].includes(options.method)?405:403);}
  assert.equal(sessions(f).length,0);f.inert();
});
test('queries and fragments cannot carry alternative guest transport state',async t=>{
  const f=await fixture(t);for(const suffix of ['?version=1','?policy=other','#fragment'])await unavailable(await f.start(request({url:`${origin}/x${suffix}`})),400);assert.equal(sessions(f).length,0);f.inert();
});
test('content type, coding and declared length use a closed bounded header grammar',async t=>{
  const f=await fixture(t);for(const headers of [{'content-type':''},{'content-type':'text/plain'},{'content-type':'application/json; charset=utf-16'},{'content-type':'application/json; other=x'},
    {'content-type':'application/json, text/plain'},{'content-encoding':'gzip'},{'content-encoding':'identity, gzip'},{'content-length':'513'},{'content-length':'-1'},{'content-length':'0012'},{'content-length':'1.2'},{'content-length':'Infinity'}])
    await unavailable(await f.start(request({headers})),400);
  assert.equal(sessions(f).length,0);assert.equal((await f.start(request({headers:{'content-type':'APPLICATION/JSON; CHARSET=UTF-8','content-encoding':'IDENTITY','sec-fetch-site':'none'}}))).status,201);f.inert();
});
test('only the literal single version property is accepted with ordinary JSON whitespace',async t=>{
  const f=await fixture(t);for(const data of ['','null','[]','{}','{"version":2}','{"version":true}','{"version":1,"extra":1}','{"version":2,"version":1}','{"version":1,"version":1}',
    '{"version":1.0}','{"version":1e0}','{"\\u0076ersion":1}','{"__proto__":{"version":1}}','{"version":1} trailing'])await unavailable(await f.start(request({data})),400);
  assert.equal(sessions(f).length,0);assert.equal((await f.start(request({data:' \r\n { \t"version" : 1 } \n'}))).status,201);f.inert();
});
test('fatal UTF-8 rejects malformed bytes and a literal JSON body is assembled across byte chunks',async t=>{
  const f=await fixture(t);for(const data of [new Uint8Array([0xc3,0x28]),new Uint8Array([0xff]),new Uint8Array([0x7b,0x22,0x76,0x65,0x72,0x73,0x69,0x6f,0x6e,0x22,0x3a,0x31,0x7d,0xe2])])await unavailable(await f.start(request({data})),400);
  const bytes=encoder.encode(body),stream=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}});
  assert.equal((await f.start(request({data:stream}))).status,201);f.inert();
});
test('UTF-8 BOM is not an alternate spelling of the closed literal JSON envelope',async t=>{
  const f=await fixture(t),data=new Uint8Array([0xef,0xbb,0xbf,...encoder.encode(body)]);await unavailable(await f.start(request({data})),400);assert.equal(sessions(f).length,0);f.inert();
});
test('actual body bytes allow exactly512 and refuse513 independently of declared length',async t=>{
  const f=await fixture(t),at=body+' '.repeat(512-encoder.encode(body).byteLength);assert.equal(encoder.encode(at).byteLength,512);
  assert.equal((await f.start(request({data:at}))).status,201);await unavailable(await f.start(request({data:at+' ',headers:{'content-length':'12'}})),400);assert.equal(sessions(f).length,1);f.inert();
});
test('oversized streaming body cannot stall rejection through a nonsettling cancellation promise',async t=>{
  const f=await fixture(t);let cancelled=0;const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(513));},cancel(){cancelled++;return new Promise(()=>{});}}),started=performance.now();
  const response=await Promise.race([f.start(request({data:stream})),delay(1000).then(()=>{throw Error('body cancellation blocked response');})]);await unavailable(response,400);
  assert.equal(cancelled,1);assert.ok(performance.now()-started<1000);assert.equal(sessions(f).length,0);f.inert();
});
test('a stalled body reaches the actual five-second deadline even when cancellation never settles',async t=>{
  const f=await fixture(t);let cancelled=0;const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;return new Promise(()=>{});}}),started=performance.now();
  const response=await Promise.race([f.start(request({data:stream})),delay(6500).then(()=>{throw Error('body deadline failed');})]);await unavailable(response,400);
  assert.ok(performance.now()-started>=4800);assert.ok(performance.now()-started<6500);assert.equal(cancelled,1);assert.equal(sessions(f).length,0);f.inert();
});
test('aborting a stalled body promptly cancels transport without waiting for its deadline',async t=>{
  const f=await fixture(t),abort=new AbortController();let cancelled=0;const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;return new Promise(()=>{});}});
  const pending=f.start(request({data:stream,signal:abort.signal}));abort.abort();await unavailable(await Promise.race([pending,delay(1000).then(()=>{throw Error('abort failed');})]),400);
  assert.equal(sessions(f).length,0);assert.equal(cancelled,1);f.inert();
});
test('already aborted requests and rejected body readers never reach native issuance',async t=>{
  const f=await fixture(t),abort=new AbortController();abort.abort();await unavailable(await f.start(request({signal:abort.signal})),400);
  const stream=new ReadableStream({pull(){throw Error('private reader detail must not escape');}});const denied=await f.start(request({data:stream}));assert.ok(!(await denied.clone().text()).includes('private reader'));await unavailable(denied,400);assert.equal(sessions(f).length,0);f.inert();
});
test('existing valid cookies refuse replacement and reveal no original secrets in the denial',async t=>{
  const f=await fixture(t),{cookie,proof}=await issued(f),before=sessions(f),response=await f.start(request({headers:{cookie}}));await assertNoSecrets(response,proof);await unavailable(response,409);assert.deepEqual(sessions(f),before);f.inert();
});
test('malformed, duplicate, partial, mixed-session and wrong-purpose cookies deny without overwrite',async t=>{
  const f=await fixture(t),a=await issued(f),b=await issued(f),first=a.cookie.split('; '),second=b.cookie.split('; '),before=sessions(f);
  const invalid=[first[0],first[1],`${first[0]}; ${first[0]}; ${first[1]}`,`${first[0]}; ${second[1]}`,
    `${names[0]}=${first[1].slice(first[1].indexOf('=')+1)}; ${first[1]}`,`${names[0]}=; ${first[1]}`,`${names[0]}; ${first[1]}`,
    a.cookie.replace('v1.','v2.'),a.cookie.replace('forma-guest-session-v1.','forma-guest-session-v1.%'),a.cookie.replace(a.proof.sessionId,a.proof.sessionId.replace(/^[a-f0-9]/u,'A'))];
  for(const cookie of invalid){assert.throws(()=>readGuestClaimProofCookies(request({headers:{cookie}})));await unavailable(await f.start(request({headers:{cookie}})),409);await unavailable(await f.revoke(cookie),409);}
  assert.deepEqual(sessions(f),before);f.inert();
});
test('oversized cookie headers use UTF-8 byte length and do not allocate even with no recognized names',async t=>{
  const f=await fixture(t),cookie=`unrelated=${'é'.repeat(4096)}`;assert.ok(encoder.encode(cookie).byteLength>8192);await unavailable(await f.start(request({headers:{cookie}})),409);
  assert.throws(()=>readGuestClaimProofCookies(request({headers:{cookie}})));assert.equal(sessions(f).length,0);
  const exact='x='+ 'a'.repeat(8190);assert.equal(encoder.encode(exact).byteLength,8192);assert.equal((await f.start(request({headers:{cookie:exact}}))).status,201);f.inert();
});
test('cookie-free revocation cannot clear client credentials without a matched native proof',async t=>{
  const f=await fixture(t);await unavailable(await f.revoke(''),409);assert.throws(()=>readGuestClaimProofCookies(request()),/proof_unavailable/);assert.equal(sessions(f).length,0);f.inert();
});
test('well-formed forged proofs cannot revoke or acknowledge another native session',async t=>{
  const f=await fixture(t),a=await issued(f),b=await issued(f),before=sessions(f),cookie=a.cookie.replace(a.proof.claimToken,b.proof.claimToken);
  assert.equal(readGuestClaimProofCookies(request({headers:{cookie}})).sessionId,a.proof.sessionId);await unavailable(await f.revoke(cookie),409);assert.deepEqual(sessions(f),before);f.inert();
});
test('concurrent cookie-free issuance atomically respects a one-session native ceiling',async t=>{
  const f=await fixture(t,{maximumSessions:1}),results=await Promise.all([f.start(),f.start(),f.start()]);assert.equal(results.filter(response=>response.status===201).length,1);assert.equal(sessions(f).length,1);
  for(const denied of results.filter(response=>response.status!==201))await unavailable(denied,409);f.inert();
});
test('two concurrent cookie-free starts intentionally create two distinct free sessions when the policy permits them',async t=>{
  const f=await fixture(t,{maximumSessions:2}),results=await Promise.all([f.start(),f.start()]);assert.ok(results.every(response=>response.status===201));assert.equal(sessions(f).length,2);
  assert.ok(cookieHeader(results[0])!==cookieHeader(results[1]));assert.notEqual(sessions(f)[0].session_hash,sessions(f)[1].session_hash);f.inert();
});
test('lost native issuance acknowledgment never retries allocation or fabricates recoverable raw cookies',async t=>{
  const f=await fixture(t,{maximumSessions:1}),done=hook(f,sql=>sql.startsWith('INSERT INTO experience_guest_sessions'),()=>{throw Error('lost issuer ack');},{after:true});
  await unavailable(await f.start(),409);done();assert.equal(sessions(f).length,1);await unavailable(await f.start(),409);assert.equal(sessions(f).length,1);f.inert();
});
test('lost native revocation acknowledgment recovers the exact proof-matched revoked row without another UPDATE',async t=>{
  const f=await fixture(t),{cookie}=await issued(f);let updates=0;const prepare=f.DB.prepare;f.DB.prepare=function(sql){if(sql.startsWith('UPDATE experience_guest_sessions'))updates++;return prepare.call(this,sql);};
  const done=hook(f,sql=>sql.startsWith('UPDATE experience_guest_sessions'),()=>{throw Error('lost revoke ack');},{after:true,kind:'run'});
  const response=await f.revoke(cookie);done();assert.equal(response.status,200);assert.equal(updates,1);const original=sessions(f)[0];assert.equal((await f.revoke(cookie)).status,200);assert.equal(updates,1);assert.deepEqual(sessions(f)[0],original);f.DB.prepare=prepare;f.inert();
});
test('unacknowledged native revocation that never commits cannot clear either cookie',async t=>{
  const f=await fixture(t),{cookie}=await issued(f),done=hook(f,sql=>sql.startsWith('UPDATE experience_guest_sessions'),()=>{throw Error('write never committed');},{kind:'run'});
  await unavailable(await f.revoke(cookie),409);done();assert.equal(sessions(f)[0].revoked_at_ms,null);f.inert();
});
test('current revoked policy denies both first revocation and acknowledgment replay',async t=>{
  for(const revoked of [false,true]){const f=await fixture(t),{cookie}=await issued(f);if(revoked)assert.equal((await f.revoke(cookie)).status,200);f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');
    const before=sessions(f);await unavailable(await f.revoke(cookie),409);assert.deepEqual(sessions(f),before);f.inert();}
});
test('expired policy cannot acknowledge a previously revoked session despite a matched proof',async t=>{
  const f=await fixture(t,{expiresIn:150}),{cookie}=await issued(f);assert.equal((await f.revoke(cookie)).status,200);
  while(!f.sqlite.prepare("SELECT expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS expired FROM experience_guest_sessions").get().expired)await delay(5);
  await unavailable(await f.revoke(cookie),409);f.inert();
});
for(const damage of ['revocation','policy revocation','expiry'])test(`final issuance guard detects native ${damage} before delivering raw cookies`,async t=>{
  const f=await fixture(t,{sessionLifetimeMs:damage==='expiry'?100:300000}),done=hook(f,sql=>sql.startsWith('SELECT expires_at_ms FROM experience_guest_sessions'),async()=>{
    if(damage==='revocation')f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');else if(damage==='policy revocation')f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');else await delay(130);});
  await unavailable(await f.start(),409);done();assert.equal(sessions(f).length,1);f.inert();
});
for(const stage of ['body','issuer','final'])test(`database replacement during ${stage} processing never delivers guest secrets`,async t=>{
  const f=await fixture(t);let req=request(),done;
  if(stage==='body'){req=request({data:new ReadableStream({pull(controller){f.env.DB={...f.DB};controller.enqueue(encoder.encode(body));controller.close();}})});}
  else done=hook(f,sql=>sql.startsWith(stage==='issuer'?'INSERT INTO experience_guest_sessions':'SELECT expires_at_ms FROM experience_guest_sessions'),()=>{f.env.DB={...f.DB};},{after:true});
  await unavailable(await f.start(req),409);done?.();assert.equal(sessions(f).length,stage==='body'?0:1);f.inert();
});
for(const stage of ['issuer','final'])test(`abort after ${stage} await suppresses delivery without retrying native allocation`,async t=>{
  const f=await fixture(t),abort=new AbortController(),done=hook(f,sql=>sql.startsWith(stage==='issuer'?'INSERT INTO experience_guest_sessions':'SELECT expires_at_ms FROM experience_guest_sessions'),()=>abort.abort(),{after:true});
  await unavailable(await f.start(request({signal:abort.signal})),409);done();assert.equal(sessions(f).length,1);f.inert();
});
test('database replacement after revocation mutation denies clearing while preserving its single original revocation',async t=>{
  const f=await fixture(t),{cookie}=await issued(f),done=hook(f,sql=>sql.startsWith('UPDATE experience_guest_sessions'),()=>{f.env.DB={...f.DB};},{after:true,kind:'run'});
  await unavailable(await f.revoke(cookie),409);done();assert.ok(sessions(f)[0].revoked_at_ms);f.env.DB=f.DB;assert.equal((await f.revoke(cookie)).status,200);f.inert();
});
test('abort after native revocation preserves the write but does not clear transport cookies on an abandoned response',async t=>{
  const f=await fixture(t),{cookie}=await issued(f),abort=new AbortController(),done=hook(f,sql=>sql.startsWith('UPDATE experience_guest_sessions'),()=>abort.abort(),{after:true,kind:'run'});
  await unavailable(await f.revoke(cookie,{signal:abort.signal}),409);done();assert.ok(sessions(f)[0].revoked_at_ms);assert.equal((await f.revoke(cookie)).status,200);f.inert();
});
test('final revoked-row proof rechecks policy revocation and database identity before clearing credentials',async t=>{
  for(const mutation of ['policy','database']){const f=await fixture(t),{cookie}=await issued(f);assert.equal((await f.revoke(cookie)).status,200);
    const done=hook(f,sql=>sql.startsWith('SELECT 1 AS present FROM experience_guest_sessions'),()=>{if(mutation==='policy')f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');else f.env.DB={...f.DB};});
    await unavailable(await f.revoke(cookie),409);done();f.inert();}
});

test('internal streaming robustness bounds excessive zero-byte chunks before a valid literal body',async t=>{
  const f=await fixture(t);const stream=new ReadableStream({start(controller){for(let index=0;index<1025;index++)controller.enqueue(new Uint8Array());controller.enqueue(encoder.encode(body));controller.close();}});
  await unavailable(await f.start(request({data:stream})),400);assert.equal(sessions(f).length,0);f.inert();
});

test('already locked request bodies fail closed without throwing or issuing a session',async t=>{
  const f=await fixture(t),req=request(),reader=req.body.getReader();try{await unavailable(await f.start(req),400);}finally{reader.releaseLock();}
  assert.equal(sessions(f).length,0);f.inert();
});
test('the revoke entry point applies the same origin and body boundary before touching a valid native session',async t=>{
  const f=await fixture(t),{cookie}=await issued(f),before=sessions(f);
  await unavailable(await f.revoke(cookie,{headers:{origin:'https://other.invalid'}}),403);await unavailable(await f.revoke(cookie,{data:'{"version":1,"extra":1}'}),400);
  assert.deepEqual(sessions(f),before);f.inert();
});
test('session expiry denies new revocation but preserves proof-matched acknowledgment of an already revoked row under current policy',async t=>{
  for(const revoked of [false,true]){const f=await fixture(t,{sessionLifetimeMs:150}),{cookie}=await issued(f);if(revoked)assert.equal((await f.revoke(cookie)).status,200);const before=sessions(f);
    while(!f.sqlite.prepare("SELECT expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS expired FROM experience_guest_sessions").get().expired)await delay(5);
    if(revoked)assert.equal((await f.revoke(cookie)).status,200);else await unavailable(await f.revoke(cookie),409);assert.deepEqual(sessions(f),before);f.inert();}
});

test('internal stream accepts the exact1024-chunk boundary including its literal body chunk',async t=>{
  const f=await fixture(t);const stream=new ReadableStream({start(controller){for(let index=0;index<1023;index++)controller.enqueue(new Uint8Array());controller.enqueue(encoder.encode(body));controller.close();}});
  assert.equal((await f.start(request({data:stream}))).status,201);assert.equal(sessions(f).length,1);f.inert();
});
