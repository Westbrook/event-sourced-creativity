import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import test from 'node:test';

// Inlined reviewed host guard: guest-r2-conditional-copy-contract-corrective-20260918/host-network-guard.mjs
// Supplier SHA256 a15a6a33740bc53d6148975c13a0ff8d6cf50f4777ad6df5d70308686d5d4b23.
// Function body is unchanged; only its module imports and export declaration are adapted.
// Install before loading Miniflare. This contains these Node entry points, not native subprocesses.
function installHostNetworkGuard(miniflareEntry){
 const require=createRequire(import.meta.url),mfRequire=createRequire(miniflareEntry);
 const net=require('node:net'),tls=require('node:tls'),http=require('node:http'),https=require('node:https'),dns=require('node:dns'),dgram=require('node:dgram');
 const events=[],allowed={},state={phase:'setup'};
 function deny(transport,target){const e=new Error('FORMA_HOST_EGRESS_DENIED '+transport+' '+String(target));e.code='FORMA_HOST_EGRESS_DENIED';events.push({phase:state.phase,transport,target:String(target)});throw e;}
 function host(transport,value){const h=String(value??'localhost').toLowerCase();if(!['localhost','127.0.0.1','::1','[::1]'].includes(h))deny(transport,h);allowed[transport]=(allowed[transport]??0)+1;return h;}
 function origin(transport,value){let u;try{u=new URL(String(value));}catch{deny(transport,'invalid origin');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)deny(transport,'invalid origin');host(transport,u.hostname);}
 function socket(transport,args){let a=args;if(Array.isArray(a[0]))a=a[0];const first=a[0];let o;
  if(first&&typeof first==='object')o=first;
  else if(typeof first==='number'||typeof first==='string'&&/^\d+$/.test(first))o={port:first,host:typeof a[1]==='string'?a[1]:'localhost'};
  else deny(transport,'unsupported socket arguments');
  if(o.path!==undefined||o.socketPath!==undefined||o.fd!==undefined||o.lookup!==undefined||o.socket!==undefined)deny(transport,'unreviewed socket path/fd/lookup/socket');
  if(!Number.isInteger(Number(o.port))||Number(o.port)<1||Number(o.port)>65535)deny(transport,'invalid port');
  host(transport,o.host??o.hostname??'localhost');
 }
 for(const name of ['connect','createConnection']){const original=net[name];net[name]=function(...args){socket('net.'+name,args);return original.apply(this,args);};}
 const socketConnect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){socket('net.Socket.connect',args);return socketConnect.apply(this,args);};
 const tlsConnect=tls.connect;tls.connect=function(...args){socket('tls.connect',args);return tlsConnect.apply(this,args);};
 function request(transport,args){const first=args[0];let o={};if(typeof first==='string'||first instanceof URL){origin(transport,first);if(args[1]&&typeof args[1]==='object')o=args[1];}else if(first&&typeof first==='object')o=first;else deny(transport,'invalid request arguments');
  if(o.socketPath!==undefined)deny(transport,'unreviewed socket path');
  if(o.hostname!==undefined)host(transport,o.hostname);else if(o.host!==undefined){let u;try{u=new URL('http://'+o.host);}catch{deny(transport,'invalid host');}host(transport,u.hostname);}else if(typeof first!=='string'&&!(first instanceof URL))host(transport,'localhost');
 }
 for(const [label,module] of [['http',http],['https',https]])for(const name of ['request','get']){const original=module[name];module[name]=function(...args){request(label+'.'+name,args);return original.apply(this,args);};}
 function lookupValue(name,options){const h=host('dns.lookup',name),family=typeof options==='number'?options:options?.family;const v6=h==='::1'||h==='[::1]'||h==='localhost'&&family===6;const value={address:v6?'::1':'127.0.0.1',family:v6?6:4};return options?.all?[value]:value;}
 dns.lookup=function(name,options,callback){if(typeof options==='function'){callback=options;options={};}if(typeof callback!=='function')throw new TypeError('lookup callback required');let value;try{value=lookupValue(name,options);}catch(e){queueMicrotask(()=>callback(e));return;}queueMicrotask(()=>Array.isArray(value)?callback(null,value):callback(null,value.address,value.family));};
 dns.promises.lookup=async function(name,options){return lookupValue(name,options);};
 for(const object of [dns,dns.promises,dns.Resolver.prototype,dns.promises.Resolver.prototype])for(const name of Object.getOwnPropertyNames(object))if(name==='reverse'||name.startsWith('resolve')){
  if(typeof object[name]==='function')object[name]=function(...args){return deny('dns.'+name,args[0]??'');};
 }
 for(const name of ['send','connect'])dgram.Socket.prototype[name]=function(){return deny('dgram.'+name,'UDP is unnecessary for this probe');};
 const nativeFetch=globalThis.fetch;globalThis.fetch=function(input,...args){origin('global.fetch',typeof input==='string'||input instanceof URL?input:input.url);return nativeFetch.call(this,input,...args);};
 syncBuiltinESMExports();
 const undiciEntry=mfRequire.resolve('undici'),undici=mfRequire('undici'),previous=undici.getGlobalDispatcher();
 class LoopbackDispatcher extends undici.Dispatcher{dispatch(options,handler){origin('miniflare.undici.dispatch',options.origin);return previous.dispatch(options,handler);}close(...args){return previous.close(...args);}destroy(...args){return previous.destroy(...args);}}
 undici.setGlobalDispatcher(new LoopbackDispatcher());
 const identity={miniflareEntry,undiciEntry,undiciEntrySha256:createHash('sha256').update(readFileSync(undiciEntry)).digest('hex'),undiciPackage:mfRequire.resolve('undici/package.json'),undiciVersion:mfRequire('undici/package.json').version};
 return {identity,setPhase(phase){state.phase=phase;},snapshot(){return {identity,phase:state.phase,denials:structuredClone(events),allowed:structuredClone(allowed)};},
  async verifyGuards(){state.phase='guard-selfcheck';const expected=[];
   // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Preserve the exact reviewed supplier guard function.
   async function rejected(name,action){const before=events.length;let rejected=false;try{await action();}catch(e){rejected=true;}if(!rejected||events.length!==before+1)throw Error('Guard selfcheck failed: '+name);expected.push(name);}
   await rejected('actual Miniflare undici global dispatcher',()=>undici.fetch('https://forbidden.invalid/guard'));
   await rejected('Node global fetch',()=>globalThis.fetch('https://forbidden.invalid/guard'));
   await rejected('Node http request',()=>http.request('http://forbidden.invalid/guard'));
   await rejected('Node https request',()=>https.request('https://forbidden.invalid/guard'));
   await rejected('Node net connector',()=>net.connect({host:'forbidden.invalid',port:443}));
   await rejected('Node TLS connector',()=>tls.connect({host:'forbidden.invalid',port:443}));
   await rejected('Node DNS lookup',()=>dns.promises.lookup('forbidden.invalid'));
   state.phase='runtime';return {passed:true,expectedBlockedControls:expected,denials:structuredClone(events)};
  }
 };
}


const phase = (name, details = {}) => process.stderr.write(`[guest-result-copy-schema] ${JSON.stringify({ phase: name,
  pid: process.pid, ppid: process.ppid, runnerPgid: process.env.FORMA_TEST_PGID ?? null, ...details })}\n`);
const sourcePaths = ['worker/experience-guest-image-result-copy-schema.ts', 'tests/experience-guest-image-result-copy-schema.test.mjs'];
const sourcePins = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path,
  createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex')])));
const initialPins = await sourcePins();
phase('source-before-import', { sourcePins: initialPins });
const { GUEST_IMAGE_RESULT_COPY_SCHEMA: schema, GUEST_IMAGE_RESULT_COPY_SCHEMA_FAMILY: family } = await import('../worker/experience-guest-image-result-copy-schema.ts');
phase('dormant-schema-imported', { statements: schema.length, sourcePins: await sourcePins() });

const attempts = 'experience_guest_image_result_copy_attempts';
const custodies = 'experience_guest_image_result_custodies';
const copies = 'experience_guest_image_result_copies';
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const digest = value => 'sha256:' + sha(typeof value === 'string' ? value : canonical(value));
const uuid = number => `${number.toString(16).padStart(8, '0')}-0000-7000-8000-${number.toString(16).padStart(12, '0')}`;
const iso = value => new Date(value).toISOString();
const normalize = value => value.replace(/\s+/gu, ' ').trim().replace(/;$/u, '');

// Only prerequisite table shapes needed by the inert constraints are reproduced.
// Their columns/FKs match R18's native DDL. The rows below are schema sentinels,
// not native claim evidence, a genuine complete lineage, or private-read authority.
// No runtime bootstrap, provider, MEDIA binding, policy installer or app fixture.
const prerequisites = [
  `CREATE TABLE experience_guest_policies(policy_id TEXT PRIMARY KEY NOT NULL,terms_digest TEXT NOT NULL,terms_json TEXT NOT NULL,review_digest TEXT NOT NULL,revoked_at_ms INTEGER)`,
  `CREATE TABLE experience_guest_sessions(session_id TEXT PRIMARY KEY NOT NULL,policy_id TEXT NOT NULL,terms_digest TEXT NOT NULL,
    guest_subject TEXT UNIQUE NOT NULL,project_id TEXT UNIQUE NOT NULL,document_id TEXT UNIQUE NOT NULL,session_hash TEXT UNIQUE NOT NULL,claim_hash TEXT UNIQUE NOT NULL,
    created_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER,
    FOREIGN KEY(policy_id) REFERENCES experience_guest_policies(policy_id))`,
  `CREATE TABLE experience_guest_claim_leases(session_id TEXT PRIMARY KEY NOT NULL,lease_id TEXT UNIQUE NOT NULL,destination_user_id TEXT NOT NULL,
    manifest_digest TEXT NOT NULL,request_id TEXT NOT NULL,request_ids_json TEXT NOT NULL CHECK(json_valid(request_ids_json) AND json_type(request_ids_json)='array' AND json_array_length(request_ids_json) BETWEEN 1 AND 100),acquisitions INTEGER NOT NULL CHECK(acquisitions BETWEEN 1 AND 100),
    created_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL,FOREIGN KEY(session_id) REFERENCES experience_guest_sessions(session_id))`,
  `CREATE TABLE experience_guest_context_adoptions(session_id TEXT PRIMARY KEY NOT NULL,destination_user_id TEXT NOT NULL,
    lease_id TEXT UNIQUE NOT NULL,request_id TEXT NOT NULL,manifest_digest TEXT NOT NULL,lineage_json TEXT NOT NULL,
    lineage_digest TEXT NOT NULL,created_at_ms INTEGER NOT NULL,FOREIGN KEY(session_id) REFERENCES experience_guest_sessions(session_id))`,
  `CREATE TABLE experience_guest_image_claims(session_id TEXT PRIMARY KEY NOT NULL,destination_user_id TEXT NOT NULL,lease_id TEXT UNIQUE NOT NULL,
    request_id TEXT NOT NULL,manifest_digest TEXT NOT NULL,context_lineage_digest TEXT NOT NULL,lineage_json TEXT NOT NULL,lineage_digest TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,FOREIGN KEY(session_id) REFERENCES experience_guest_context_adoptions(session_id))`,
  `CREATE TABLE experience_guest_image_stage_custodies(session_id TEXT PRIMARY KEY NOT NULL,destination_user_id TEXT NOT NULL,
    lease_id TEXT UNIQUE NOT NULL,request_id TEXT NOT NULL,manifest_digest TEXT NOT NULL,context_lineage_digest TEXT NOT NULL,
    save_lineage_digest TEXT NOT NULL,lineage_json TEXT NOT NULL,lineage_digest TEXT NOT NULL,created_at_ms INTEGER NOT NULL,
    FOREIGN KEY(session_id) REFERENCES experience_guest_image_claims(session_id))`,
  `CREATE TABLE private_content(content_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,redacted_at TEXT)`,
  `CREATE TABLE experience_guest_image_stage_copies(session_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('confirmation','quote','construction')),
    content_id TEXT UNIQUE NOT NULL,original_digest TEXT NOT NULL,byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=CASE WHEN role='construction' THEN 131072 ELSE 65536 END),
    created_at TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(session_id,role),FOREIGN KEY(session_id) REFERENCES experience_guest_image_stage_custodies(session_id),FOREIGN KEY(content_id) REFERENCES private_content(content_id))`,
  `CREATE TABLE events(event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX idx_events_stream_sequence ON events(stream_id,sequence)`,
  `CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT NOT NULL,created_at TEXT NOT NULL,redacted_at TEXT)`,
];

function ack(value, changes) {
  assert.equal(Object.hasOwn(value, 'success'), true); assert.equal(value.success, true);
  assert.equal(value.error, undefined); assert.ok(Array.isArray(value.results));
  assert.ok(value.meta && Object.hasOwn(value.meta, 'changes'));
  if (changes !== undefined) assert.equal(value.meta.changes, changes);
  return value;
}
function insertStatement(db, table, row, verb = 'INSERT') {
  const names = Object.keys(row);
  return db.prepare(`${verb} INTO ${table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).bind(...Object.values(row));
}
const insert = async (db, table, row, verb) => ack(await insertStatement(db, table, row, verb).run(), 1);
const row = async (db, id) => db.prepare(`SELECT * FROM ${attempts} WHERE attempt_id=?`).bind(id).first();
async function update(db, current, change, { version = current.row_version + 1, updated = current.updated_at_ms + 10 } = {}) {
  const next = { ...change, row_version: version, updated_at_ms: updated }, names = Object.keys(next);
  const receipt = await db.prepare(`UPDATE ${attempts} SET ${names.map(name => `${name}=?`).join(',')} WHERE attempt_id=? AND row_version=?`)
    .bind(...Object.values(next), current.attempt_id, current.row_version).run();
  ack(receipt, 1); return row(db, current.attempt_id);
}

// The native D1 binding is used only inside workerd. Miniflare's getD1Database
// would activate a separate Node worker-thread realm outside the host guard.
const d1Worker = `export default { async fetch(request, env) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/__schema-d1'
      || request.headers.get('x-schema-fixture-token') !== env.SCHEMA_FIXTURE_TOKEN)
    return new Response('Unknown local fixture request', { status: 404 });
  try {
    const text = await request.text();
    if (text.length > 2097152) throw new Error('Oversized local fixture command');
    const command = JSON.parse(text);
    if (!['run', 'all', 'first', 'batch'].includes(command.method) || !Array.isArray(command.statements)
        || command.statements.length < 1 || command.statements.length > 100
        || command.method !== 'batch' && command.statements.length !== 1)
      throw new Error('Invalid local fixture command');
    const statements = command.statements.map(item => {
      if (!item || typeof item.sql !== 'string' || !Array.isArray(item.args)) throw new Error('Invalid local fixture statement');
      const statement = env.ClaimContract.prepare(item.sql);
      return item.args.length ? statement.bind(...item.args) : statement;
    });
    const value = command.method === 'batch' ? await env.ClaimContract.batch(statements)
      : await statements[0][command.method]();
    return Response.json({ ok: true, value });
  } catch (error) {
    return Response.json({ ok: false, error: { name: error.name, message: error.message } }, { status: 409 });
  }
}};`;

// This facade serializes commands only. Values and errors come from the actual
// disposable D1 binding; no SQL, receipt, transaction or constraint is simulated.
function d1ViaDispatch(mf, token) {
  const statements = new WeakMap();
  async function invoke(method, items) {
    const response = await mf.dispatchFetch('http://127.0.0.1/__schema-d1', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-schema-fixture-token': token },
      body: JSON.stringify({ method, statements: items }),
    });
    const text = await response.text();
    assert.ok(text.length <= 2097152, 'bounded local D1 result');
    const result = JSON.parse(text);
    if (result.ok !== true) {
      assert.equal(response.status, 409);
      assert.equal(typeof result.error?.message, 'string');
      const error = new Error(result.error.message); error.name = result.error.name; throw error;
    }
    assert.equal(response.status, 200);
    return result.value;
  }
  function prepare(sql, args = []) {
    const item = { sql, args };
    const statement = Object.freeze({ bind: (...values) => prepare(sql, values),
      run: () => invoke('run', [item]), all: () => invoke('all', [item]), first: () => invoke('first', [item]) });
    statements.set(statement, item); return statement;
  }
  return Object.freeze({ prepare, batch: values => invoke('batch', values.map(value => {
    const item = statements.get(value); assert.ok(item, 'batch statement belongs to this fixture'); return item;
  })) });
}

const errorDetails = (error, depth = 0) => error && typeof error === 'object'
  ? { name: error.name, message: error.message, stack: error.stack,
      ...(error.cause !== undefined && depth < 2 ? { cause: errorDetails(error.cause, depth + 1) } : {}) }
  : { message: String(error) };
let guardedRuntime, installedHostGuard;
async function loadGuardedRuntime() {
  if (guardedRuntime) return guardedRuntime;
  process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
  const require = createRequire(import.meta.resolve('wrangler'));
  const guard = installHostNetworkGuard(require.resolve('miniflare')); installedHostGuard = guard;
  const selfchecks = await guard.verifyGuards();
  assert.equal(selfchecks.passed, true); assert.equal(selfchecks.expectedBlockedControls.length, 7);
  phase('host-guard-selfchecks', { selfchecks, snapshot: guard.snapshot() });
  guard.setPhase('miniflare-import');
  try {
    const runtime = require('miniflare');
    guardedRuntime = { ...runtime, guard, selfchecks }; return guardedRuntime;
  } catch (error) { phase('miniflare-import-failed', { error: errorDetails(error), hostNetwork: guard.snapshot() }); throw error; }
}

async function disposeBounded(mf) {
  let timer;
  try {
    await Promise.race([mf.dispose(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Miniflare disposal did not settle within 5000 ms; cleanup is incomplete.')), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

async function fixture(t) {
  const before = await sourcePins(); assert.deepEqual(before, initialPins);
  phase('case-source-before', { name: t.name, sourcePins: before });
  let mf, guard, setupError, outbound = 0, setupStage = 'load-runtime', statementIndex = null, installedStatements = 0;
  const allStatements = [...prerequisites, ...schema];
  t.after(async () => {
    let disposalError;
    try {
      if (mf) {
        guard.setPhase('disposal'); phase('dispose-start', { name: t.name });
        await disposeBounded(mf); phase('dispose-complete', { name: t.name });
      }
    } catch (error) {
      disposalError = error;
      phase('dispose-failed', { name: t.name, error: errorDetails(error), originalSetupError: setupError ? errorDetails(setupError) : null,
        hostNetwork: (guard ?? installedHostGuard)?.snapshot(), cleanupComplete: false });
    } finally {
      try {
        const hostNetwork = (guard ?? installedHostGuard)?.snapshot();
        phase('case-host-network', { name: t.name, hostNetwork, workerOutbound: outbound });
        const after = await sourcePins(); phase('case-source-after', { name: t.name, sourcePins: after });
        assert.deepEqual(after, before); assert.equal(outbound, 0);
        if (hostNetwork) {
          assert.equal(hostNetwork.denials.length, 7);
          assert.deepEqual(hostNetwork.denials.filter(event => event.phase !== 'guard-selfcheck'), []);
        }
      } finally {
        if (disposalError) {
          // This test runs in a dedicated terminating Node process. The outer
          // evidence runner owns process-group cleanup; this is not proof that
          // workerd exited. Preserve the first failure before ending this child.
          process.exitCode = 1;
          phase('child-exit-required', { name: t.name, exitCode: 1, delayMs: 1000, cleanupComplete: false });
          setTimeout(() => process.exit(1), 1000).unref();
        }
      }
    }
    if (disposalError && !setupError) throw disposalError;
  });
  try {
    phase('loading-miniflare', { name: t.name });
    const runtime = await loadGuardedRuntime();
    const { Miniflare, Log, LogLevel } = runtime; guard = runtime.guard; guard.setPhase('runtime');
    const token = randomUUID();
    setupStage = 'construct-miniflare';
    mf = new Miniflare({ modules: true, cf: false, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
      log: new Log(LogLevel.NONE), d1Databases: ['ClaimContract'],
      script: d1Worker, bindings: { SCHEMA_FIXTURE_TOKEN: token },
      outboundService() { outbound++; throw new Error('External workerd fetch forbidden.'); },
    });
    const db = d1ViaDispatch(mf, token);
    setupStage = 'install-schema';
    for (const [index, sql] of allStatements.entries()) {
      statementIndex = index; ack(await db.prepare(sql).run()); installedStatements++;
    }
    phase('dormant-schema-installed-locally', { name: t.name, prerequisiteStatements: prerequisites.length, familyStatements: schema.length });
    return db;
  } catch (error) {
    setupError = error;
    phase('fixture-setup-error', { name: t.name, error: errorDetails(error),
      setupStage, activeStatementIndex: statementIndex, installedStatements, totalStatements: allStatements.length,
      hostNetwork: (guard ?? installedHostGuard)?.snapshot(), workerOutbound: outbound });
    throw error;
  }
}

async function seed(db, n) {
  const base = 1_800_000_000_000 + n * 1_000_000, owner = `canonical-owner-${n}`;
  const session = uuid(n * 100 + 1), leaseId = uuid(n * 100 + 2), attemptId = uuid(n * 100 + 3), custodyId = uuid(n * 100 + 4);
  const generation = uuid(n * 100 + 5), eventId = uuid(n * 100 + 6), completion = uuid(n * 100 + 7), writerNonce = uuid(n * 100 + 8);
  const project = uuid(n * 100 + 9), document = uuid(n * 100 + 10), request = `claim-request-${n}`;
  const manifest = { sessionId: session, projectId: project, documentId: document, generationId: generation,
    nativeSnapshotDigest: digest(`snapshot-${n}`), expiresAt: iso(base + 60_000), object: { contentSha256: sha(`png-${n}`), mimeType: 'image/png', width: 2, height: 3 } };
  const manifestDigest = digest(manifest), output = `object-${generation.slice(-8)}`;
  const lease = { session_id: session, lease_id: leaseId, destination_user_id: owner, manifest_digest: manifestDigest,
    request_id: request, request_ids_json: canonical([request]), acquisitions: 1, created_at_ms: base, expires_at_ms: base + 60_000 };
  const destinationKey = `guest-image-result-media-v1/u-${Buffer.from(owner).toString('hex')}/${custodyId}/${output}.png`;
  const metadata = { version: '1', kind: 'guest-image-result-copy', attemptId, custodyId, ownerId: owner, generationId: generation,
    outputId: output, manifestDigest, nativeSnapshotDigest: manifest.nativeSnapshotDigest, sha256: manifest.object.contentSha256, mimeType: 'image/png', writerNonce };
  const descriptor = { version: 1, kind: 'guest-image-result-copy', attemptId, custodyId, requestId: request, destinationUserId: owner,
    manifestDigest, manifest, leaseSnapshot: lease, source: { byteLength: 73, producerMetadata: { model: 'gpt-image-1.5', provider: 'openai', adapter: 'openai-image-v5', providerRequestId: '' } },
    destinationKey, destinationMetadata: metadata, writerNonce };
  const original = { attempt_id: attemptId, custody_id: custodyId, session_id: session, destination_user_id: owner,
    lease_id: leaseId, lease_acquisition: 1, request_id: request, manifest_digest: manifestDigest,
    descriptor_json: canonical(descriptor), descriptor_digest: digest(descriptor), lease_snapshot_json: canonical(lease),
    source_expires_at_ms: base + 60_000, destination_key: destinationKey, writer_nonce: writerNonce,
    content_sha256: manifest.object.contentSha256, byte_length: 73, mime_type: 'image/png', width: 2, height: 3,
    destination_metadata_json: canonical(metadata), state: 'reserved', row_version: 0, put_outcome: 'pending', created_at_ms: base,
    updated_at_ms: base, put_started_at_ms: null, put_settled_at_ms: null, verified_at_ms: null, published_at_ms: null, published_claim_digest: null };
  await insert(db, 'experience_guest_policies', { policy_id: `policy-${n}`, terms_digest: digest(`terms-${n}`), terms_json: '{}', review_digest: digest(`review-${n}`), revoked_at_ms: null });
  await insert(db, 'experience_guest_sessions', { session_id: session, policy_id: `policy-${n}`, terms_digest: digest(`terms-${n}`), guest_subject: `guest:${session}`,
    project_id: project, document_id: document, session_hash: digest(`session-${n}`), claim_hash: digest(`claim-${n}`), created_at_ms: base, expires_at_ms: base + 60_000, revoked_at_ms: null });
  await insert(db, 'experience_guest_claim_leases', lease);
  const prior = { session_id: session, destination_user_id: owner, lease_id: leaseId, request_id: request, manifest_digest: manifestDigest,
    lineage_json: '{}', created_at_ms: base + 40 };
  const contextDigest = digest(`context-${n}`), saveDigest = digest(`save-${n}`), stageDigest = digest(`stage-${n}`);
  await insert(db, 'experience_guest_context_adoptions', { ...prior, lineage_digest: contextDigest });
  await insert(db, 'experience_guest_image_claims', { ...prior, context_lineage_digest: contextDigest, lineage_digest: saveDigest });
  await insert(db, 'experience_guest_image_stage_custodies', { ...prior, context_lineage_digest: contextDigest, save_lineage_digest: saveDigest, lineage_digest: stageDigest });
  for (const role of ['confirmation', 'quote', 'construction']) {
    const content = `stage-${role}-${n}`, contentId = `guest-image-stage-history-${sha(content)}`;
    await insert(db, 'private_content', { content_id: contentId, owner_id: owner, kind: 'guest-image-stage-history', content,
      created_at: iso(base + 40), expires_at: iso(base + 86_400_000), redacted_at: null });
    await insert(db, 'experience_guest_image_stage_copies', { session_id: session, role, content_id: contentId, original_digest: digest(content),
      byte_length: Buffer.byteLength(content), created_at: iso(base + 40), expires_at: iso(base + 86_400_000) });
  }
  const bodies = [];
  for (const [index, role] of ['planner', 'prompt'].entries()) {
    const content = `${role} body ${n}`, contentId = `guest-image-result-history-${sha(content)}`;
    const body = { custody_id: custodyId, role, content_id: contentId, original_content_id: uuid(n * 100 + 20 + index),
      original_kind: role === 'planner' ? 'provider-output' : 'prompt', original_digest: digest(content), byte_length: Buffer.byteLength(content),
      created_at: iso(base + 40), expires_at: iso(base + 86_400_000 + index * 1000) };
    bodies.push(body);
    await insert(db, 'private_content', { content_id: contentId, owner_id: owner, kind: 'guest-image-result-history', content,
      created_at: body.created_at, expires_at: body.expires_at, redacted_at: null });
  }
  const claimTime = base + 50, payload = { custody_id: custodyId, object_id: output, generation_id: generation, manifest_digest: manifestDigest,
    project_id: project, document_id: document };
  const lineage = { version: 1, kind: 'original-image-result-custody', copy: descriptor, resultCopies: bodies,
    canonical: { eventId, sequence: 7, streamId: `creative:${owner}`, occurredAt: iso(claimTime), recordedAt: iso(claimTime), privateDigest: digest(payload), expiresAt: bodies[0].expires_at } };
  const claim = { custody_id: custodyId, session_id: session, destination_user_id: owner, lease_id: leaseId, lease_acquisition: 1, request_id: request,
    manifest_digest: manifestDigest, native_snapshot_digest: manifest.nativeSnapshotDigest, context_lineage_digest: contextDigest,
    save_lineage_digest: saveDigest, stage_lineage_digest: stageDigest, claim_event_id: eventId, claim_event_sequence: 7,
    original_completion_event_id: completion, generation_id: generation, output_id: output, copy_attempt_id: attemptId,
    lineage_json: canonical(lineage), lineage_digest: digest(lineage), created_at_ms: claimTime, canonical_expires_at: bodies[0].expires_at };
  await insert(db, 'events', { event_id: eventId, stream_id: `creative:${owner}`, sequence: 7, occurred_at: iso(claimTime), recorded_at: iso(claimTime),
    actor: 'worker:guest-claim', client_id: 'guest-image-result-claim', correlation_id: session, causation_id: completion,
    compensates_event_id: null, schema_version: 1, type: 'GuestImageResultClaimed', payload: canonical({ _private_ref: eventId, ...payload }) });
  await insert(db, 'event_private_payloads', { private_event_id: eventId, owner_id: owner, project_id: project, document_id: document,
    private_json: canonical(payload), created_at: iso(claimTime), redacted_at: null });
  return { original, claim, bodies, lease, base, descriptor };
}

async function ready(db, fixture) {
  await insert(db, attempts, fixture.original);
  let current = await update(db, fixture.original, { state: 'writing', put_started_at_ms: fixture.base + 10 });
  current = await update(db, current, { put_outcome: 'success', put_settled_at_ms: fixture.base + 20 });
  current = await update(db, current, { state: 'ready', verified_at_ms: fixture.base + 30 });
  return current;
}
async function map(db, fixture, roles = fixture.bodies) {
  await insert(db, custodies, fixture.claim);
  for (const body of roles) await insert(db, copies, body);
}
async function revoke(db, fixture) {
  ack(await db.prepare('UPDATE experience_guest_sessions SET revoked_at_ms=? WHERE session_id=?')
    .bind(fixture.claim.created_at_ms, fixture.claim.session_id).run(), 1);
}
async function publish(db, current, fixture) {
  return update(db, current, { state: 'published', published_at_ms: fixture.claim.created_at_ms,
    published_claim_digest: fixture.claim.lineage_digest }, { updated: fixture.claim.created_at_ms });
}
const refused = operation => assert.rejects(operation, /(?:constraint|guest result|SQLITE_CONSTRAINT)/iu);

test('D1 positive: exact dormant schema and a complete valid journal publication association', { timeout: 60_000 }, async t => {
  const db = await fixture(t);
  const installed = (await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name LIKE 'experience_guest_image_result_%' ORDER BY name").all()).results;
  assert.deepEqual(installed.map(value => ({ type: value.type, name: value.name, table: value.tbl_name, sql: normalize(value.sql) })),
    [...family].sort((a, b) => a.name.localeCompare(b.name)).map(value => ({ ...value, sql: normalize(value.sql) })));
  const f = await seed(db, 1); phase('positive-prerequisites-ready');
  assert.equal('guest-image-result-history-'.length, 27);
  for (const body of f.bodies) { assert.equal(body.content_id.length, 91); assert.match(body.content_id.slice(27), /^[a-f0-9]{64}$/u); }
  const current = await ready(db, f); phase('positive-known-ack-ready');
  await map(db, f); await revoke(db, f);
  const published = await publish(db, current, f);
  assert.equal(published.state, 'published'); assert.equal(published.row_version, 4);
  assert.equal(published.put_outcome, 'success'); assert.equal(published.published_claim_digest, f.claim.lineage_digest);
  assert.deepEqual(await db.prepare(`SELECT * FROM ${custodies} WHERE custody_id=?`).bind(f.claim.custody_id).first(), f.claim);
  assert.deepEqual((await db.prepare(`SELECT * FROM ${copies} WHERE custody_id=? ORDER BY role`).bind(f.claim.custody_id).all()).results, f.bodies);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  phase('positive-complete', { interpretation: 'schema constraints and real D1 acknowledgements only; no native claim/R2 authority' });
});

test('D1 negative boundaries: immutable identity, finite receipts, publication and settled cleanup', { timeout: 120_000 }, async t => {
  const db = await fixture(t);
  let n = 10;
  await t.test('insert is reserved-only and duplicate OR REPLACE cannot erase history', async () => {
    const f = await seed(db, n++);
    await refused(() => insert(db, attempts, { ...f.original, state: 'writing' }));
    await insert(db, attempts, f.original);
    await refused(() => insert(db, attempts, f.original, 'INSERT OR REPLACE'));
    assert.deepEqual(await row(db, f.original.attempt_id), f.original);
  });
  await t.test('descriptor/body byte and namespace facts cannot diverge', async () => {
    const f = await seed(db, n++);
    for (const change of [{ byte_length: 24_000_001 }, { width: 8193 }, { content_sha256: 'g'.repeat(64) },
      { destination_key: `guest-image-result-media-v1/${f.original.custody_id}/bad.png` }, { destination_metadata_json: '{}' },
      { source_expires_at_ms: f.original.source_expires_at_ms + 1 }, { lease_acquisition: 2 }])
      await refused(() => insert(db, attempts, { ...f.original, ...change }));
    assert.equal(await row(db, f.original.attempt_id), null);
  });
  await t.test('immutable descriptors and stale row versions fail without mutation', async () => {
    const f = await seed(db, n++); await insert(db, attempts, f.original);
    await refused(() => update(db, f.original, { state: 'writing', put_started_at_ms: f.base + 10, descriptor_digest: digest('changed') }));
    await refused(() => update(db, f.original, { state: 'writing', put_started_at_ms: f.base + 10 }, { version: 0 }));
    assert.deepEqual(await row(db, f.original.attempt_id), f.original);
    const current = await update(db, f.original, { state: 'writing', put_started_at_ms: f.base + 10 });
    const stale = await db.prepare(`UPDATE ${attempts} SET state='cleanup_pending',row_version=row_version+1 WHERE attempt_id=? AND row_version=0`).bind(current.attempt_id).run();
    ack(stale, 0); assert.deepEqual(await row(db, current.attempt_id), current);
  });
  await t.test('a fabricated combined ACK/readback and meaningless same-state change refuse', async () => {
    const f = await seed(db, n++); await insert(db, attempts, f.original);
    const current = await update(db, f.original, { state: 'writing', put_started_at_ms: f.base + 10 });
    await refused(() => update(db, current, {}));
    await refused(() => update(db, current, { state: 'ready', put_outcome: 'success', put_settled_at_ms: f.base + 20, verified_at_ms: f.base + 20 }));
    assert.deepEqual(await row(db, current.attempt_id), current);
  });
  await t.test('unknown dispatched completion cannot be deleted, late known settlement cannot revive publication', async () => {
    const f = await seed(db, n++); await insert(db, attempts, f.original);
    let current = await update(db, f.original, { state: 'writing', put_started_at_ms: f.base + 10 });
    current = await update(db, current, { put_outcome: 'unknown' });
    current = await update(db, current, { state: 'cleanup_pending' });
    await refused(() => update(db, current, { state: 'deleted' }));
    await refused(() => update(db, current, { state: 'ready', put_outcome: 'success', put_settled_at_ms: f.base + 40, verified_at_ms: f.base + 40 }));
    current = await update(db, current, { put_outcome: 'success', put_settled_at_ms: f.base + 40 });
    current = await update(db, current, { state: 'deleted' });
    await refused(() => update(db, current, { state: 'reserved' }));
    assert.equal((await row(db, current.attempt_id)).state, 'deleted');
  });
  await t.test('conditional-null is settled nonpublication; never-dispatched cleanup remains distinguishable', async () => {
    const f = await seed(db, n++); await insert(db, attempts, f.original);
    let current = await update(db, f.original, { state: 'writing', put_started_at_ms: f.base + 10 });
    current = await update(db, current, { put_outcome: 'conditional-null', put_settled_at_ms: f.base + 20 });
    await refused(() => update(db, current, { state: 'ready', verified_at_ms: f.base + 30 }));
    current = await update(db, current, { state: 'cleanup_pending' });
    assert.equal((await update(db, current, { state: 'deleted' })).put_outcome, 'conditional-null');
    const g = await seed(db, n++); await insert(db, attempts, g.original);
    let untouched = await update(db, g.original, { state: 'cleanup_pending' });
    untouched = await update(db, untouched, { state: 'deleted' });
    assert.equal(untouched.put_started_at_ms, null); assert.equal(untouched.put_outcome, 'pending');
  });
  await t.test('lease replacement and elapsed source ceiling prevent readiness', async () => {
    const f = await seed(db, n++); await insert(db, attempts, f.original);
    let current = await update(db, f.original, { state: 'writing', put_started_at_ms: f.base + 10 });
    current = await update(db, current, { put_outcome: 'success', put_settled_at_ms: f.base + 20 });
    await refused(() => update(db, current, { state: 'ready', verified_at_ms: f.base + 60_000 }, { updated: f.base + 60_000 }));
    ack(await db.prepare('UPDATE experience_guest_claim_leases SET acquisitions=2 WHERE session_id=?').bind(f.lease.session_id).run(), 1);
    await refused(() => update(db, current, { state: 'ready', verified_at_ms: f.base + 30 }));
    assert.deepEqual(await row(db, current.attempt_id), current);
  });
  await t.test('reservation and initial dispatch obey the lease window; late settlement is knowledge only', async () => {
    const f = await seed(db, n++);
    await refused(() => insert(db, attempts, { ...f.original, created_at_ms: f.base - 1, updated_at_ms: f.base - 1 }));
    await insert(db, attempts, f.original);
    await refused(() => update(db, f.original, { state: 'writing', put_started_at_ms: f.base + 60_000 }, { updated: f.base + 60_000 }));
    let current = await update(db, f.original, { state: 'writing', put_started_at_ms: f.base + 10 });
    current = await update(db, current, { put_outcome: 'unknown' });
    ack(await db.prepare('UPDATE experience_guest_claim_leases SET acquisitions=2 WHERE session_id=?').bind(f.lease.session_id).run(), 1);
    current = await update(db, current, { put_outcome: 'success', put_settled_at_ms: f.base + 60_010 }, { updated: f.base + 60_010 });
    assert.equal(current.put_outcome, 'success');
    await refused(() => update(db, current, { state: 'ready', verified_at_ms: f.base + 60_020 }, { updated: f.base + 60_020 }));
  });
  await t.test('another lease acquisition cannot replace an unsettled same-session attempt', async () => {
    const f = await seed(db, n++); await insert(db, attempts, f.original);
    let current = await update(db, f.original, { state: 'writing', put_started_at_ms: f.base + 10 });
    current = await update(db, current, { put_outcome: 'unknown' });
    const request = f.lease.request_id + '-successor', changedLease = { ...f.lease, request_id: request,
      request_ids_json: canonical([f.lease.request_id, request]), acquisitions: 2 };
    ack(await db.prepare('UPDATE experience_guest_claim_leases SET request_id=?,request_ids_json=?,acquisitions=2 WHERE session_id=?')
      .bind(request, changedLease.request_ids_json, f.lease.session_id).run(), 1);
    const attemptId = uuid(n * 100 + 30), custodyId = uuid(n * 100 + 31), nonce = uuid(n * 100 + 32);
    const key = f.original.destination_key.replace(f.original.custody_id, custodyId);
    const metadata = { ...f.descriptor.destinationMetadata, attemptId, custodyId, writerNonce: nonce };
    const descriptor = { ...f.descriptor, attemptId, custodyId, requestId: request, leaseSnapshot: changedLease,
      destinationKey: key, destinationMetadata: metadata, writerNonce: nonce };
    const next = { ...f.original, attempt_id: attemptId, custody_id: custodyId, writer_nonce: nonce, request_id: request,
      lease_acquisition: 2, lease_snapshot_json: canonical(changedLease), destination_key: key,
      destination_metadata_json: canonical(metadata), descriptor_json: canonical(descriptor), descriptor_digest: digest(descriptor) };
    await refused(() => insert(db, attempts, next));
    assert.equal(await row(db, next.attempt_id), null);
    assert.deepEqual(await row(db, current.attempt_id), current);
  });
  await t.test('mapping before ready and publication without both exact copies or revocation refuse', async () => {
    const f = await seed(db, n++);
    await refused(() => insert(db, custodies, f.claim));
    const current = await ready(db, f);
    await map(db, f, [f.bodies[0]]);
    await revoke(db, f); await refused(() => publish(db, current, f));
    await insert(db, copies, f.bodies[1]);
    ack(await db.prepare('UPDATE experience_guest_sessions SET revoked_at_ms=NULL WHERE session_id=?').bind(f.lease.session_id).run(), 1);
    await refused(() => publish(db, current, f));
    await revoke(db, f); assert.equal((await publish(db, current, f)).state, 'published');
  });
  await t.test('wrong body owner/kind/role/retention fails; recorded retention cannot renew', async () => {
    const f = await seed(db, n++); await ready(db, f); await insert(db, custodies, f.claim);
    await refused(() => insert(db, copies, { ...f.bodies[0], original_kind: 'prompt' }));
    await refused(() => insert(db, copies, { ...f.bodies[0], byte_length: 65_537 }));
    await refused(() => insert(db, copies, { ...f.bodies[0], expires_at: iso(f.base + 2 * 86_400_000) }));
    ack(await db.prepare("UPDATE private_content SET owner_id='wrong-owner' WHERE content_id=?").bind(f.bodies[0].content_id).run(), 1);
    await refused(() => insert(db, copies, f.bodies[0]));
    ack(await db.prepare("UPDATE private_content SET owner_id=?,kind='provider-output' WHERE content_id=?").bind(f.claim.destination_user_id, f.bodies[0].content_id).run(), 1);
    await refused(() => insert(db, copies, f.bodies[0]));
    ack(await db.prepare("UPDATE private_content SET kind='guest-image-result-history' WHERE content_id=?").bind(f.bodies[0].content_id).run(), 1);
    await insert(db, copies, f.bodies[0]);
    await refused(() => db.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').bind(iso(f.base + 2 * 86_400_000), f.bodies[0].content_id).run());
    await refused(() => insert(db, copies, f.bodies[0], 'INSERT OR REPLACE'));
    const original = await db.prepare('SELECT * FROM private_content WHERE content_id=?').bind(f.bodies[0].content_id).first();
    await refused(() => insert(db, 'private_content', { ...original, owner_id: 'replacement-owner' }, 'INSERT OR REPLACE'));
    const unregistered = { ...original, content_id: `unregistered-${f.original.attempt_id}` };
    await insert(db, 'private_content', unregistered);
    await refused(() => db.prepare('UPDATE OR REPLACE private_content SET content_id=? WHERE content_id=?')
      .bind(original.content_id, unregistered.content_id).run());
    assert.deepEqual(await db.prepare('SELECT * FROM private_content WHERE content_id=?').bind(original.content_id).first(), original);
    assert.deepEqual(await db.prepare('SELECT * FROM private_content WHERE content_id=?').bind(unregistered.content_id).first(), unregistered);
  });
  await t.test('redacted envelope and incorrect minimum expiry cannot publish', async () => {
    const f = await seed(db, n++), current = await ready(db, f); await map(db, f); await revoke(db, f);
    ack(await db.prepare('UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?').bind(iso(f.base + 40), f.claim.claim_event_id).run(), 1);
    await refused(() => publish(db, current, f));
    const g = await seed(db, n++), next = await ready(db, g);
    const badLineage = JSON.parse(g.claim.lineage_json); badLineage.canonical.expiresAt = g.bodies[1].expires_at;
    await insert(db, custodies, { ...g.claim, canonical_expires_at: g.bodies[1].expires_at, lineage_json: canonical(badLineage), lineage_digest: digest(badLineage) });
    for (const body of g.bodies) await insert(db, copies, body);
    await revoke(db, g); await refused(() => publish(db, next, { ...g, claim: { ...g.claim, lineage_digest: digest(badLineage) } }));
  });
  await t.test('published history resists mutations and cleanup, while native body redaction remains possible', async () => {
    const f = await seed(db, n++), current = await ready(db, f); await map(db, f); await revoke(db, f);
    const published = await publish(db, current, f);
    await refused(() => update(db, published, { state: 'cleanup_pending', published_at_ms: null, published_claim_digest: null }));
    await refused(() => db.prepare(`DELETE FROM ${attempts} WHERE attempt_id=?`).bind(current.attempt_id).run());
    await refused(() => db.prepare(`DELETE FROM ${custodies} WHERE custody_id=?`).bind(f.claim.custody_id).run());
    await refused(() => db.prepare(`UPDATE ${copies} SET original_digest=? WHERE custody_id=?`).bind(digest('changed'), f.claim.custody_id).run());
    await refused(() => insert(db, custodies, f.claim, 'INSERT OR REPLACE'));
    ack(await db.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").bind(iso(f.base + 100), f.bodies[0].content_id).run(), 1);
    assert.equal((await row(db, current.attempt_id)).state, 'published', 'historical publication is not a fresh read capability');
  });
  await t.test('real D1 batch rolls back an earlier valid update when a later constraint fails', async () => {
    const f = await seed(db, n++); await insert(db, attempts, f.original);
    const first = db.prepare(`UPDATE ${attempts} SET state='writing',row_version=1,updated_at_ms=?,put_started_at_ms=? WHERE attempt_id=? AND row_version=0`)
      .bind(f.base + 10, f.base + 10, f.original.attempt_id);
    const second = db.prepare(`UPDATE ${attempts} SET state='ready',row_version=2,updated_at_ms=?,verified_at_ms=? WHERE attempt_id=? AND row_version=1`)
      .bind(f.base + 20, f.base + 20, f.original.attempt_id);
    await refused(() => db.batch([first, second]));
    assert.deepEqual(await row(db, f.original.attempt_id), f.original);
  });
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  phase('negative-boundaries-complete', { schemaOnly: true, outboundAndProviderCalls: 0 });
});
