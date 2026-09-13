import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
const {fileURLToPath}=await import('node:url');
const C=process.env.FORMA_SOURCE_ROOT??fileURLToPath(new URL('../',import.meta.url));
const {registerOutputSourceImports}=await import(C+'/tests/output-execution-test-helpers.mjs');registerOutputSourceImports();
registerHooks({resolve(specifier,context,next){
 if(!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.includes(':'))return next(specifier,{...context,parentURL:new URL('file://'+C+'/worker/openai-adapter.ts').href});
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const normal=new URL(/\.[a-z0-9]+$/iu.test(specifier)?specifier:specifier+'.ts',context.parentURL);if(!existsSync(normal)&&normal.pathname.includes('/src/experiences/'))return next(new URL('file://'+C+'/src/experiences/'+normal.pathname.split('/src/experiences/')[1]).href,context);}
 return next(specifier,context);
}});
const {readFileSync}=await import("node:fs");
const {stripTypeScriptTypes}=await import("node:module");
const {readVideoReferencePlan}=await import("../src/experiences/video-reference-plan.ts");
const {canonicalJson,digest,freeze}=await import("../src/experiences/compiler.ts");
const {buildExperiencePlan,registeredExperience,validateIntakeRequest,experienceResourceId,receiptPrefix}=await import("../src/experiences/intake.ts");
const {experienceSourceMatches}=await import("../src/experiences/host-source.ts");
const {createVideoOutputContract,parseVideoOutputContract}=await import("../src/model/output-video-contract.ts");
const {confirmOutputRequirementInterpretation}=await import("../src/model/output-requirements.ts");
const {compileOutputPlan}=await import("../src/model/output-plan.ts");
const {experienceOutputBinding}=await import("../worker/experience-output-binding.ts");
const {createExperienceOutputRecipe,matchExperienceOutputRecipeTarget}=await import("../worker/experience-output-recipe.ts");
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=originalFetch;});
const source = path => { const local=new URL("../"+path,import.meta.url);return readFileSync(existsSync(local)?local:C+"/"+path,"utf8"); };
function extracted(path, names, deps) {
  // Execute complete actual module logic, replacing import bindings only. Heavy
  // Worker readers receive finite ports; real pure compiler/profile helpers run.
  const body = source(path).replace(/^import[\s\S]*?;\n/gmu, "").replace(/^export /gmu, "");
  const js = stripTypeScriptTypes(body);
  return new Function(...Object.keys(deps), js + "\nreturn {" + names.join(",") + "};")(...Object.values(deps));
}
class OutputConflictError extends Error { constructor(code, status = 409) { super(code); this.code = code; this.status = status; } }
const creator = "video-owned-test";
const release = await registeredExperience("video");
const referenceSelection = { version: 1, sourceProjectId: "original-project", sourceDocumentId: "original-document",
  sourceBlockId: "original-block", referenceId: "original-reference", sha256: "f".repeat(64), permissionAttestation: "i-own-or-have-permission" };
const referencePlan = { version: 1, selection: referenceSelection, sourceDigest: "e".repeat(64), properties: {
  label: "Owned still", reference_id: referenceSelection.referenceId, source_content_hash: referenceSelection.sha256,
  media_url: "/api/media/u-766964656f2d6f776e65642d74657374/still.png", media_type: "image/png", rights_class: "owned", pixel_reference_mode: "inspiration", weight: 1,
} };
const request = { experienceId: "video", intentId: "00000000-0000-4000-8000-000000000020", releaseHash: release.releaseHash,
  values: { motion: { value: "A slow pan. 水\nKeep the subject still.", provenance: "authored" }, frame: { value: "portrait", provenance: "authored" } }, reference: referenceSelection };
const plan = await buildExperiencePlan(creator, request, release, referencePlan);
const binding = await experienceOutputBinding(plan);
const contract = createVideoOutputContract({ source: {draftId: binding.draftId, draftHash: binding.draftHash, releaseHash: binding.releaseHash,
  requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash}, reference: referenceSelection, frameSize: "720x1280" });
const requirementId = await experienceResourceId(plan.draftId, "native-output-requirement");
const deliverableId = await experienceResourceId(plan.draftId, "native-output-deliverable");
const recipe = createExperienceOutputRecipe({ output: "video", requirementId, deliverableId, contract });
const sourceDigest = "a".repeat(64), requirementsDigest = "b".repeat(64);
const compiled = compileOutputPlan([confirmOutputRequirementInterpretation(recipe.spec)],
  { document_id: plan.documentId, source_revision: sourceDigest, requirement_revision: requirementsDigest });
const receipt = { status: "complete", generation: "unavailable", projectId: plan.projectId, documentId: plan.documentId,
  draftId: plan.draftId, draftHash: plan.draftHash,
  appended: plan.events.map((event, i) => ({ eventId: "intake-event-" + i, sequence: i + 1, type: event.type, payload: structuredClone(event.payload) })) };
const originalEvents = receipt.appended.map(event => ({ ...event, streamId: plan.streamId, actor: "user" }));
const authoredBlocks = receipt.appended.filter(event => event.type === "BlockCreated").map(event => ({
  id: event.payload.block_id, projectId: plan.projectId, documentId: plan.documentId, scope: "document", canvasId: "",
  removed: false, locked: false, type: event.payload.type, handle: event.payload.handle, position: event.payload.position,
  properties: event.payload.properties, sourceEvents: [event.eventId],
}));
const outputBlock = { id: requirementId, type: "output", scope: "document", canvasId: "", projectId: plan.projectId,
  documentId: plan.documentId, removed: false, locked: false, handle: "video-output", position: "z",
  properties: { output_spec: recipe.spec }, sourceEvents: ["managed-output"] };
const outputEvent = { sequence: 100, eventId: "managed-output", actor: "user:" + creator, streamId: plan.streamId, clientId: "server:output-requirements", type: "BlockCreated",
  payload: { block_id: requirementId, type: "output", scope: "document", project_id: plan.projectId, document_id: plan.documentId,
    handle: outputBlock.handle, position: outputBlock.position, properties: outputBlock.properties } };

function fixture() {
  const reads = [], selects = [], principal = { userId: creator, streamId: plan.streamId, access: { capabilities: ["project.author"] }, consent: true };
  const input = { request: new Request("https://forma.test"), principal,
    env: { FORMA_IMAGE_PROVIDER: "fal", OPENAI_API_KEY: "synthetic-configured-no-network", FAL_KEY: "synthetic-configured-no-network", DB: {
      prepare(sql) { assert.match(sql, /^SELECT 1 AS current WHERE /u); selects.push(sql);
        return { bind(...values) { selects.push(values); return { async first() { return input.current ? { current: 1 } : null; } }; } }; },
    } }, current: true,
    scope: { kind: "personal", actorUserId: creator, ownerUserId: creator, projectId: plan.projectId, documentId: plan.documentId,
      organizationId: null, projectAccessId: null, contextId: null },
    sourceDigest, requirementsDigest, ownerHead: 42, sourceAssertions: [{ sql: "source_head_current = ?", bindings: [42] }],
    sourceEvents: structuredClone([...originalEvents, outputEvent]),
    confirmedPlan: { revisionId: "confirmed-original", confirmedAt: new Date(Date.now() - 1000).toISOString(),
      plan: structuredClone(compiled), sourceDigest, requirementsDigest },
    target: structuredClone(compiled.targets[0]),
    context: { snapshot: { document: { title: plan.title }, facts: authoredBlocks.map(block => ({
      block_id: block.id, type: block.type, active: true, properties: block.properties,
    })) }, projection: { documentId: plan.documentId, documentTitle: plan.title, projectId: plan.projectId,
      documents: [{ id: plan.documentId, projectId: plan.projectId, title: plan.title, removed: false }],
      libraryBlocks: structuredClone([...authoredBlocks, outputBlock]), libraryBlockRelations: [] } },
  };
  const ports = {
    readExperienceDraft: async (_env, auth, draftId) => { reads.push("draft"); assert.equal(auth.principal, principal); assert.equal(draftId, plan.draftId);
      return input.missing ? null : { plan: input.retainedPlan ?? plan, content: { exact: "retained-source" }, expiresAt: new Date(Date.now() + 86400000).toISOString() }; },
    experienceDraftGuard: (_auth, actual) => { assert.equal(actual.draftId, plan.draftId); return { sql: "private_draft_current = ?", bindings: [plan.draftHash] }; },
    projectIntakeAuthority: (_env, auth) => { assert.equal(auth.principal, principal); return { sql: "actor_current = ?", bindings: [creator] }; },
    join: (...guards) => ({ sql: guards.map(g => "(" + g.sql + ")").join(" AND "), bindings: guards.flatMap(g => g.bindings) }),
    requireConsent: actor => { assert.equal(actor, principal); return actor.consent ? null : new Response(null, { status: 403 }); },
    commitAtomicIntake: async (_env, auth, actual, mode, options) => {
      reads.push("check"); assert.equal(auth.principal, principal); assert.equal(mode, "check");
      assert.deepEqual(actual.events, plan.events); assert.equal(options.receiptPrefix, receiptPrefix(plan.draftId));
      return Response.json(input.badReceipt ? { ...receipt, status: "unavailable" } : receipt);
    },
  };
  const fresh = extracted("worker/experience-video-output-source.ts", ["prepareExperienceVideoOutputSource"], {
    canonicalJson, buildExperiencePlan, validateIntakeRequest, readVideoReferencePlan, createVideoOutputContract, experienceOutputBinding, OutputConflictError,
    prepareExperienceVideoReference: async (request, env, auth, selection) => {
      reads.push("original-image"); assert.equal(request, input.request); assert.equal(env,input.env); assert.equal(auth.principal,principal); assert.deepEqual(selection, referenceSelection);
      if(input.imageUnavailable)throw new OutputConflictError("video_reference_source_unavailable");
      return { reference: input.freshReference ?? referencePlan, head:input.originalHead ?? 42, guard:{sql:"original_image_current = ?",bindings:[referenceSelection.sha256]} };
    },
  });
  const resolver = extracted("worker/output-video-source.ts", ["resolveOutputVideoSource", "outputVideoPreparationIdentity"], {
    canonicalJson, digest, freeze, buildExperiencePlan, experienceResourceId, receiptPrefix, validateIntakeRequest, experienceSourceMatches,
    createVideoOutputContract, parseVideoOutputContract, prepareExperienceVideoOutputSource: fresh.prepareExperienceVideoOutputSource, createExperienceOutputRecipe, matchExperienceOutputRecipeTarget, OutputConflictError, ...ports,
  });
  return { input, reads, selects, principal, ports, ...fresh, ...resolver };
}
test("actual resolver reuses original private intake check, exact current source and immutable operation expiry", async () => {
  const f = fixture(), resolved = await f.resolveOutputVideoSource(f.input);
  assert.deepEqual(f.reads, ["draft", "original-image", "check"]); assert.deepEqual(resolved.plan, plan);
  assert.match(resolved.requestId, /^video-[a-f0-9]{64}$/u);
  assert.equal(resolved.expiresAt, new Date(Date.parse(f.input.confirmedPlan.confirmedAt) + 900000).toISOString());
  const repeated = await f.outputVideoPreparationIdentity(contract, f.input.confirmedPlan, f.input.target.id);
  assert.equal(repeated.requestId, resolved.requestId); assert.equal(repeated.expiresAt, resolved.expiresAt);
  assert.ok(resolved.sourceAssertions.some(g => g.sql.includes("event_private_payloads") && g.sql.includes("redacted_at IS NULL")));
  assert.ok(resolved.sourceAssertions.some(g => g.sql.includes("private_draft_current")));
});

test("actual resolver refuses foreign/consent/source/target/receipt changes rather than adopting nearby Video", async () => {
  const changes = [
    f => { f.input.scope.ownerUserId = "foreign"; }, f => { f.input.scope.contextId = "context"; },
    f => { f.input.principal.consent = false; }, f => { f.input.principal.projectExecution = {}; },
    f => { f.input.principal.access.capabilities = []; }, f => { f.input.missing = true; },
    f => { f.input.context.projection.libraryBlocks[0].properties = { text: "edited" }; },
    f => { f.input.context.projection.libraryBlocks.at(-1).sourceEvents = ["other-output"]; },
    f => { f.input.target.video_contract.source.requestHash = "sha256:" + "f".repeat(64); },
    f => { f.input.imageUnavailable = true; },
    f => { f.input.originalHead = 43; }, f => { delete f.input.ownerHead; },
    f => { f.input.freshReference = {...referencePlan, sourceDigest:"d".repeat(64)}; },
    f => { f.input.freshReference = {...referencePlan, properties:{...referencePlan.properties,label:"Changed"}}; },
    f => { f.input.retainedPlan = {...plan,request:{...request,reference:{...referenceSelection,referenceId:"nearby"}}}; },
    f => { f.input.confirmedPlan.confirmedAt = new Date(Date.now()+10000).toISOString(); },
    f => { f.input.confirmedPlan.confirmedAt = new Date(Date.now()-1000000).toISOString(); },
    f => { f.input.badReceipt = true; }, f => { f.input.sourceAssertions = []; },
    f => { f.input.sourceEvents.at(-1).actor = "user:foreign"; },
  ];
  for (const change of changes) { const f = fixture(); change(f); await assert.rejects(f.resolveOutputVideoSource(f.input)); }
});

function oneFunction(path, start, end, deps) {
  const text=source(path), from=text.indexOf(start), to=text.indexOf(end,from+start.length);
  assert(from>=0&&to>from);return new Function(...Object.keys(deps),stripTypeScriptTypes(text.slice(from,to).replace(/^export /u,''))+'\nreturn '+start.match(/function (\w+)/u)[1]+';')(...Object.values(deps));
}

test('native load maps the retained Video plan and carries original-image guard to final disclosure',async()=>{
 const f=fixture(),trusted={...f.input,projection:f.input.context.projection,events:f.input.sourceEvents,sourceProblems:[]};
 const auth={user:f.principal,principal:f.principal,impersonation:null};
 const saved={receipt:{payload:outputEvent.payload,eventId:outputEvent.eventId},sequence:outputEvent.sequence};
 const error=(code,status=409)=>{throw new OutputConflictError(code,status);},record=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
 const validateManagedRequirement=oneFunction('worker/experience-output-api.ts','function validateManagedRequirement','\nasync function load',{record,canonicalJson,error});
 const load=oneFunction('worker/experience-output-api.ts','async function load','\nasync function confirmed',{
  authorizeExperienceIntake:async()=>auth,readExperienceDraft:f.ports.readExperienceDraft,experienceOutputBinding,experienceResourceId,
  prepareExperienceVideoOutputSource:f.prepareExperienceVideoOutputSource,createExperienceOutputRecipe,commitAtomicIntake:f.ports.commitAtomicIntake,
  receiptPrefix,experienceDraftGuard:f.ports.experienceDraftGuard,loadOutputTrustedContext:async()=>{ if(f.input.mutateAtDestinationRead)trusted.ownerHead++; return trusted; },
  readExperienceOutputOriginals:async()=>({save:saved}),outputCommandReceiptAssertion:()=>({sql:'managed_current = ?',bindings:[1]}),
  validateManagedRequirement,experienceSourceMatches,canonicalJson,record,error,
 });
 const loaded=await load(f.input.request,f.input.env,plan.draftId,'read');
 assert.equal(loaded.binding.output,'video');assert.deepEqual(loaded.recipe.spec,recipe.spec);assert.deepEqual(f.reads,['draft','original-image','check']);
 assert(trusted.sourceAssertions.some(g=>g.sql==='original_image_current = ?'));
 assert.equal(loaded.recipe.nativeReadiness,'unavailable');
 f.input.originalHead=41;await assert.rejects(load(f.input.request,f.input.env,plan.draftId,'read'),/output_video_source_changed/);f.input.originalHead=42;
 f.input.mutateAtDestinationRead=true;await assert.rejects(load(f.input.request,f.input.env,plan.draftId,'read'),/output_video_source_changed/);f.input.mutateAtDestinationRead=false;trusted.ownerHead=42;
 f.input.imageUnavailable=true;await assert.rejects(load(f.input.request,f.input.env,plan.draftId,'read'),/video_reference_source_unavailable/);
});

test('Video source preparation cannot offer authorization or accept a forged retained grant',async()=>{
 const f=fixture(),preflight={planRevisionId:f.input.confirmedPlan.revisionId,sourceDigest,requirementsDigest,
  expiresAt:new Date(Date.now()+60000).toISOString(),targets:[{targetId:recipe.targetId,available:true}]};
 const loaded={binding,recipe,trusted:{scope:f.input.scope,sourceDigest,requirementsDigest,env:{DB:{prepare(){return{bind(){return{first:async()=>null};}};}}}},
  originals:{preflight:{receipt:{payload:{preflight}},envelope:{planRevisionId:preflight.planRevisionId}}}};
 const state=oneFunction('worker/experience-output-api.ts','async function state','\nasync function execute',{
  confirmed:async()=>({...f.input.confirmedPlan,targetContractDigests:{[recipe.targetId]:'synthetic-target'}}),
  record:v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)),canonicalJson,phases:['save','confirm','preflight','authorize','run'],
  error:code=>{throw new Error(code);},
 });
 const value=await state(loaded);assert.equal(value.status,'unavailable');assert.equal(value.permitted.authorize,false);assert.equal(value.permitted.run,false);
 loaded.originals.authorize={};await assert.rejects(state(loaded),/experience_video_execution_unavailable/);
});

test('original receipt SQL rejects missing, redirected, redacted and altered private evidence',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE event_client_receipts(stream_id TEXT,client_event_id TEXT,event_id TEXT,sequence INTEGER); CREATE TABLE events(event_id TEXT,stream_id TEXT,sequence INTEGER,actor TEXT,type TEXT,compensates_event_id TEXT); CREATE TABLE event_private_payloads(private_event_id TEXT,owner_id TEXT,redacted_at TEXT,private_json TEXT);');
  for(const e of receipt.appended){
   db.prepare('INSERT INTO event_client_receipts VALUES(?,?,?,?)').run(plan.streamId,e.payload.client_event_id,e.eventId,e.sequence);
   db.prepare('INSERT INTO events VALUES(?,?,?,?,?,NULL)').run(e.eventId,plan.streamId,e.sequence,'user',e.type);
   db.prepare('INSERT INTO event_private_payloads VALUES(?,?,NULL,?)').run(e.eventId,creator,JSON.stringify(e.payload));
  }
  const f=fixture(),resolved=await f.resolveOutputVideoSource(f.input),guard=resolved.sourceAssertions.find(g=>g.sql.includes('event_private_payloads'));
  const current=()=>Boolean(db.prepare('SELECT 1 AS current WHERE '+guard.sql).get(...guard.bindings));assert.equal(current(),true);
  for(const sql of ["DELETE FROM event_client_receipts WHERE sequence=1","UPDATE event_client_receipts SET event_id='other' WHERE sequence=1","UPDATE events SET actor='foreign' WHERE sequence=1","UPDATE events SET compensates_event_id='other' WHERE sequence=1","UPDATE event_private_payloads SET redacted_at='now' WHERE private_event_id='intake-event-0'","UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id='intake-event-0'","UPDATE event_private_payloads SET owner_id='foreign' WHERE private_event_id='intake-event-0'","INSERT INTO event_client_receipts SELECT stream_id,client_event_id,event_id,sequence FROM event_client_receipts LIMIT 1"]){
   db.exec('SAVEPOINT mutation');db.exec(sql);assert.equal(current(),false,sql);db.exec('ROLLBACK TO mutation; RELEASE mutation');assert.equal(current(),true);
  }
 }finally{db.close();}
});

test('saved default Landscape remains exact 480p intent without silently asserting authored framing',async()=>{
 const f=fixture(),defaultRequest={...request,values:{...request.values,frame:{value:'landscape',provenance:'default'}}};
 const defaultPlan=await buildExperiencePlan(creator,defaultRequest,release,referencePlan);
 const result=await f.prepareExperienceVideoOutputSource(f.input.request,f.input.env,{user:f.principal,principal:f.principal,impersonation:null},{plan:defaultPlan,content:JSON.stringify(defaultPlan),expiresAt:new Date(Date.now()+86400000).toISOString()});
 assert.equal(result.contract.frameSize,'1280x720');assert.equal(result.contract.resolution,'480p');
 assert.equal(defaultPlan.request.values.frame.provenance,'default');
});

test('original-image edit after resolution invalidates the final stream-head SQL without changing earlier private rows',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE events(stream_id TEXT,sequence INTEGER,payload TEXT);');
  db.prepare('INSERT INTO events VALUES(?,?,?)').run(plan.streamId,42,'original-image');
  const f=fixture(),resolved=await f.resolveOutputVideoSource(f.input),head=resolved.sourceAssertions.find(g=>g.sql.includes('MAX(sequence)'));
  assert(head);assert.deepEqual(head.bindings,[plan.streamId,42]);
  const current=()=>Boolean(db.prepare('SELECT 1 AS current WHERE '+head.sql).get(...head.bindings));
  assert.equal(current(),true);db.prepare('INSERT INTO events VALUES(?,?,?)').run(plan.streamId,43,'original-image-edited');
  assert.equal(db.prepare('SELECT payload FROM events WHERE sequence=42').get().payload,'original-image');assert.equal(current(),false);
 }finally{db.close();}
});

test('native bridge forwards captured owner head without manufacturing an epoch from filtered source events',()=>{
 const bridge=oneFunction('worker/output-requirements-api.ts','function bridgeTarget','\nasync function preflightPlan',{requireCurrentSource:trusted=>trusted.context});
 const f=fixture(),trusted={...f.input,events:f.input.sourceEvents,ownerHead:77};const value=bridge(trusted,f.input.confirmedPlan,f.input.target);
 assert.equal(value.ownerHead,77);assert.equal(value.sourceEvents,trusted.events);
});
