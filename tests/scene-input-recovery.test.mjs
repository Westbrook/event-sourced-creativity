import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { documentGenerationInputInspection } from "../src/model/generation-inputs.ts";
import { storePrivateContent } from "../worker/pilot-policy.ts";

const noProviders=t=>t.mock.method(globalThis,"fetch",async()=>assert.fail("Scene receipt reads cannot contact a provider or an external host"));
const privateRead=(h,url)=>h.store.session.get()?.projectContext?url.endsWith("/private-receipt"):url.startsWith("/api/events?");
const options=(h,current=()=>true)=>({documentId:h.request.documentId,fresh:true,current});
const read=(h,selected=options(h))=>h.store.session.get()?.projectContext
  ?h.store.loadActorDocumentGenerationReceipt(h.request.requestId,selected)
  :h.store.loadDocumentJobDetail(h.request.requestId,selected);
async function admitted(t,shared=false){
  noProviders(t);const h=await createSceneStoreHost({shared});t.after(()=>h.close());
  const quoted=await h.quote();assert.equal(await h.approve(quoted.preview),true);
  const original=(await h.quote()).job;assert.equal(original.jobId,h.request.requestId);
  h.store.documentJobs.set([original]);
  return{h,original};
}
function baseline(h){return{feed:h.store.documentJobs.get(),content:h.store.content.get(),head:h.store.head.get(),events:h.store.events.get(),requests:h.requests.length,writes:h.worker.controls.writes.length,counts:h.worker.counts()};}
function assertReadOnly(h,before,label="fresh receipt"){
  assert.equal(h.store.documentJobs.get(),before.feed,label+" never writes or inserts a feed row");
  assert.equal(h.store.content.get(),before.content,label+" never hydrates or replaces shared/private caches");
  assert.equal(h.store.head.get(),before.head,label+" never advances event state");
  assert.equal(h.store.events.get(),before.events,label+" never merges unrelated event content");
  assert.equal(h.worker.controls.writes.length,before.writes,label+" uses read-only server routes");
  assert.deepEqual(h.worker.counts(),before.counts,label+" never creates jobs or budget holds");
  assert.ok(h.requests.slice(before.requests).every(request=>!request.init.method||request.init.method==="GET"),label+" never dispatches, retries, cancels or purchases");
}
const states=["queued","running","committing","completed","partial","failed","canceled"];
for(const shared of [false,true])for(const omitted of [false,true]){
  test("Scene exact input recovery "+(shared?"shared":"personal")+" "+(omitted?"omitted":"listed")+" preserves all seven actual job states",async t=>{
    const {h,original}=await admitted(t,shared);
    if(shared)await h.store.loadActorDocumentGenerationReceipt(original.jobId);
    else await h.store.loadDocumentJobDetail(original.jobId);
    const cached=h.store.content.get();
    for(const [index,status]of states.entries()){
      const updatedAt=new Date(Date.now()+index+1).toISOString(),completedAt=["completed","partial","failed","canceled"].includes(status)?updatedAt:null;
      h.worker.sqlite.prepare("UPDATE document_jobs SET status=?,updated_at=?,completed_at=? WHERE job_id=?").run(status,updatedAt,completedAt,original.jobId);
      const exact=(await h.quote()).job;assert.equal(exact.status,status);assert.equal(exact.jobId,original.jobId);
      h.store.documentJobs.set(omitted?[]:[original]);
      const before=baseline(h),inspected=await read(h),reference=inspected.job.result.generationReceipt.input_ref;
      assert.equal(inspected.job.status,status,"fresh status is never the old cached queued status");
      assert.equal(inspected.job.updatedAt,exact.updatedAt);assert.equal(inspected.job.jobId,original.jobId);assert.equal(inspected.job.documentId,original.documentId);
      assert.equal(JSON.parse(inspected.content[reference]).job_id,original.jobId);
      assert.deepEqual(Object.keys(inspected.content),[reference],"only exact receipt content crosses the handoff");
      assert.equal(h.store.content.get(),cached);assertReadOnly(h,before,status);
      assert.deepEqual(h.requests.slice(before.requests).map(request=>request.url),[
        "/api/document-jobs/"+original.jobId+"?inspection=1",
        shared?"/api/document-jobs/"+original.jobId+"/private-receipt":"/api/events?after="+before.head+"&limit=1&content=1",
      ]);
    }
  });
}

for(const shared of [false,true]){
  test("Scene fresh "+(shared?"shared":"personal")+" rejects wrong metadata and wrong receipt identities without cached fallback",async t=>{
    const {h,original}=await admitted(t,shared);h.store.documentJobs.set([]);
    const variants=[
      ["metadata job",false,body=>{body.job.jobId="wrong-original";}],
      ["metadata document",false,body=>{body.job.documentId="wrong-document";}],
      ["metadata kind",false,body=>{body.job.kind="structure_adaptive";}],
      ["metadata format",false,body=>{body.job.result.artifactKind="slides";}],
      ["metadata status",false,body=>{body.job.status="approved";}],
      ["private wrong job",true,body=>{const ref=Object.keys(body.content).find(key=>{try{return JSON.parse(body.content[key]).job_id===original.jobId;}catch{return false;}});const value=JSON.parse(body.content[ref]);value.job_id="another-job";body.content[ref]=JSON.stringify(value);}],
      ["private wrong document",true,body=>{const ref=Object.keys(body.content).find(key=>{try{return JSON.parse(body.content[key]).job_id===original.jobId;}catch{return false;}});const value=JSON.parse(body.content[ref]);value.document_id="another-document";body.content[ref]=JSON.stringify(value);}],
      ["private malformed",true,body=>{for(const key of Object.keys(body.content))body.content[key]="not-json";}],
      ["private omitted",true,body=>{body.content={};}],
      ["private malformed container",true,body=>{body.content=[];}],
      ...(shared?[
        ["second job",true,body=>{body.job.jobId="another-job";}],
        ["second request key",true,body=>{body.job.requestKey="another-immutable-request";}],
        ["second source revision",true,body=>{body.job.documentRevision="another-original-source";}],
        ["second Canvas",true,body=>{body.job.canvasId="another-canvas";}],
        ["second surface",true,body=>{body.job.sourceSurface="canvas";}],
        ["second request time",true,body=>{body.job.requestedAt="2000-01-01T00:00:00.000Z";}],
        ["extra shared private text",true,body=>{body.content.unrelated="Unrelated actor-private content";}],
      ]:[]),
    ];
    for(const [label,second,mutate]of variants){
      h.intercept=async request=>{
        if(privateRead(h,request.url)!==second)return undefined;
        const response=await h.worker.request(request.url,request.init),body=await response.json();assert.equal(response.status,200,label);
        mutate(body);return Response.json(body);
      };
      const before=baseline(h);await assert.rejects(read(h),/generation inputs/u,label);assertReadOnly(h,before,label);
      assert.equal(h.requests.length-before.requests,second?2:1,label+" stops at the exact failed boundary");
    }
  });

  test("Scene fresh "+(shared?"shared":"personal")+" denies each header before a pending or malformed body",async t=>{
    const {h,original}=await admitted(t,shared);
    if(!shared)await h.store.loadDocumentJobDetail(original.jobId);
    h.store.documentJobs.set([]);
    for(const second of [false,true])for(const status of [401,403,404,410]){
      let bodyReads=0;
      h.intercept=async request=>privateRead(h,request.url)===second?{ok:false,status,json(){bodyReads++;return new Promise(()=>{});}}:undefined;
      const before=baseline(h);
      await assert.rejects(read(h),/generation inputs/u,"headers "+status+" step "+(second?2:1));
      assert.equal(bodyReads,0,"denial never waits for private error bodies");assertReadOnly(h,before);
    }
  });

  test("Scene fresh "+(shared?"shared":"personal")+" requires current authority and caller ownership before every read boundary",async t=>{
    const {h}=await admitted(t,shared);h.store.documentJobs.set([]);
    const savedSession=h.store.session.get(),savedRoute=h.store.route.get();
    const mutations=[
      ["closed",()=>false],
      ["route",()=>{h.store.route.set("/library");return true;}],
      ["actor",()=>{h.setSession({user:{...savedSession.user,userId:"another-actor"}});return true;}],
      ["permission epoch",()=>{h.setSession({permissionEpoch:"withdrawn-epoch"});return true;}],
      ["raw permissions",()=>{h.setSession(shared?{projectContext:{...savedSession.projectContext,permissions:[]}}:{capabilities:[]});return true;}],
      ["custody posture",()=>{h.setSession(shared?{projectContext:undefined}:{projectContext:{organizationId:"org",projectAccessId:"access",projectId:"project",ownerUserId:"owner",permissions:["project.read"],role:"editor",expiresAt:new Date(Date.now()+60_000).toISOString()}});return true;}],
      ...(shared?[
        ["project identity",()=>{h.setSession({projectContext:{...savedSession.projectContext,projectId:"another-project"}});return true;}],
        ["context expiry",()=>{h.setSession({projectContext:{...savedSession.projectContext,expiresAt:"2000-01-01T00:00:00.000Z"}});return true;}],
      ]:[]),
    ];
    for(const second of [false,true])for(const phase of ["headers","body"])for(const [label,mutate]of mutations){
      h.store.session.set(savedSession);h.store.route.set(savedRoute);let current=true,bodyReads=0;
      const gate=sceneDeferred(),entered=sceneDeferred();
      h.intercept=async request=>{
        if(privateRead(h,request.url)!==second)return undefined;
        const response=await h.worker.request(request.url,request.init),body=await response.json();assert.equal(response.status,200,label);
        if(phase==="headers"){entered.resolve(body);await gate.promise;return{ok:true,status:200,json:async()=>{bodyReads++;return body;}};}
        return{ok:true,status:200,json(){bodyReads++;entered.resolve(body);return gate.promise;}};
      };
      const before=baseline(h),pending=read(h,options(h,()=>current)).then(value=>({value}),error=>({error}));
      const body=await entered.promise;current=mutate();gate.resolve(body);
      const result=await pending;assert.ok(result.error,label+" "+phase+" step "+(second?2:1));assert.equal(result.value,undefined);
      assert.equal(bodyReads,phase==="headers"?0:1);assertReadOnly(h,before,label);
      assert.equal(h.requests.length-before.requests,second?2:1,label+" does not advance to an unowned request");
    }
    h.store.session.set(savedSession);h.store.route.set(savedRoute);h.intercept=null;
    const before=baseline(h);assert.ok((await read(h)).job);assertReadOnly(h,before,"healthy recovery after canceled reads");
  });

  test("Scene fresh "+(shared?"shared":"personal")+" handles late A success and rejection without corrupting B",async t=>{
    const {h}=await admitted(t,shared);h.store.documentJobs.set([]);
    for(const reject of [false,true]){
      const gate=sceneDeferred(),entered=sceneDeferred();let first=true,presentation="A";
      h.intercept=async request=>{
        if(!privateRead(h,request.url)||!first)return undefined;first=false;
        const response=await h.worker.request(request.url,request.init),body=await response.json();
        return{ok:true,status:200,json(){entered.resolve(body);return gate.promise;}};
      };
      const before=baseline(h),a=read(h,options(h,()=>presentation==="A")).then(value=>({value}),error=>({error}));
      const body=await entered.promise;presentation="B";
      const b=await read(h,options(h,()=>presentation==="B"));assert.equal(b.job.jobId,h.request.requestId);const exact=JSON.stringify(b);
      if(reject)gate.reject(new Error("A's lost response"));else gate.resolve(body);
      const old=await a;assert.ok(old.error);assert.equal(old.value,undefined);assert.equal(JSON.stringify(b),exact);
      assertReadOnly(h,before,"B remains response-owned");
    }
  });

  test("Scene fresh "+(shared?"shared":"personal")+" current false, wrong explicit document and raw permission withdrawal cannot start private reads",async t=>{
    const {h}=await admitted(t,shared),before=baseline(h),saved=h.store.session.get();
    await assert.rejects(read(h,options(h,()=>false)),/generation inputs/u);
    await assert.rejects(read(h,{...options(h),documentId:"another-document"}),/generation inputs/u);
    h.setSession(shared?{projectContext:{...saved.projectContext,permissions:[]}}:{capabilities:[]});
    await assert.rejects(read(h),/generation inputs/u);assert.equal(h.requests.length,before.requests);assertReadOnly(h,before);
  });

  test("Scene fresh "+(shared?"shared":"personal")+" rejects actual retained input erasure with preexisting cache bytes",async t=>{
    const {h,original}=await admitted(t,shared),first=await read(h),reference=first.job.result.generationReceipt.input_ref;
    h.store.content.set({...h.store.content.get(),[reference]:first.content[reference]});h.store.documentJobs.set([]);
    h.worker.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(),reference);
    const before=baseline(h);await assert.rejects(read(h),/generation inputs/u);
    assertReadOnly(h,before);assert.equal(h.store.content.get()[reference],first.content[reference],"global cache is not treated as authority for the isolated Scene view");
    assert.equal((await h.quote()).job.jobId,original.jobId,"erased inputs never allocate a replacement original");
  });
}

for(const omit of [false,true]){
  test("personal Scene fresh "+(omit?"missing":"current")+" response cannot adopt a late older global hydration",async t=>{
    const {h,original}=await admitted(t),first=await read(h),reference=first.job.result.generationReceipt.input_ref;
    const old=JSON.stringify({...JSON.parse(first.content[reference]),stale_private_marker:"OLDER GLOBAL INPUT MUST NOT ENTER SCENE"});
    h.store.content.set({...h.store.content.get(),[reference]:old});
    const gate=sceneDeferred(),entered=sceneDeferred();let hydration=0;
    h.intercept=async request=>{
      if(!request.url.startsWith("/api/events?"))return undefined;hydration++;
      if(hydration===1)return{ok:true,status:200,json(){entered.resolve();return gate.promise;}};
      if(omit){gate.resolve({content:{[reference]:old}});return Response.json({content:{}});}
      return undefined;
    };
    const legacy=h.store.ensurePrivateContent(reference,{force:true});await entered.promise;
    const before=baseline(h);
    if(omit)await assert.rejects(read(h),/generation inputs/u);
    else{
      const exact=await read(h);gate.resolve({content:{[reference]:old}});await legacy;
      assert.equal(h.store.content.get()[reference],old,"actual older general hydration did arrive");
      assert.equal(exact.content[reference],first.content[reference]);
      assert.doesNotMatch(JSON.stringify(exact),/OLDER GLOBAL INPUT/u);
      const inspection=documentGenerationInputInspection(exact.job,h.store.events.get(),exact.content);
      assert.doesNotMatch(JSON.stringify(inspection),/OLDER GLOBAL INPUT/u);
    }
    await legacy;assert.equal(h.store.content.get()[reference],old);
    assert.equal(h.store.documentJobs.get(),before.feed);assert.equal(h.worker.controls.writes.length,before.writes);
    assert.equal(h.worker.counts().document_jobs,1);assert.equal(h.request.requestId,original.jobId);
  });
}

test("personal Scene exact moderation reference is response-only and excludes unrelated content",async t=>{
  const {h,original}=await admitted(t);
  const prompt=await storePrivateContent(h.worker.env,h.worker.owner,"moderation-prompt","Exact private Scene moderation prompt");
  const unrelated=await storePrivateContent(h.worker.env,h.worker.owner,"moderation-prompt","UNRELATED MODERATION SECRET");
  const saved=JSON.parse(h.worker.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(original.jobId).result_json);
  h.worker.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify({...saved,moderationPromptRef:prompt.contentId}),original.jobId);
  h.store.documentJobs.set([]);const before=baseline(h),inspected=await read(h),reference=inspected.job.result.generationReceipt.input_ref;
  assert.deepEqual(Object.keys(inspected.content).sort(),[reference,prompt.contentId].sort());
  assert.equal(inspected.content[prompt.contentId],"Exact private Scene moderation prompt");
  assert.equal(inspected.content[unrelated.contentId],undefined);assertReadOnly(h,before);
});

test("fresh personal receipt captures the immutable document and caller function before an awaited read",async t=>{
  const {h}=await admitted(t),selected=options(h),entered=sceneDeferred(),gate=sceneDeferred();
  let current=true;selected.current=()=>current;h.store.documentJobs.set([]);
  h.intercept=async request=>{
    if(!request.url.endsWith("?inspection=1"))return undefined;
    const response=await h.worker.request(request.url,request.init),body=await response.json();
    return{ok:true,status:200,json(){entered.resolve(body);return gate.promise;}};
  };
  const pending=read(h,selected).then(value=>({value}),error=>({error})),body=await entered.promise;
  selected.documentId="another-document";selected.current=()=>true;current=false;gate.resolve(body);
  const result=await pending;assert.ok(result.error);assert.equal(result.value,undefined);
  assert.equal(h.requests.at(-1).url,"/api/document-jobs/"+h.request.requestId+"?inspection=1");
});

test("default one-argument detail and actor-only receipt behavior remains unchanged",async t=>{
  const {h,original}=await admitted(t);
  const detail=await h.store.loadDocumentJobDetail(original.jobId);assert.equal(detail.jobId,original.jobId);assert.equal(detail.job,undefined);
  const count=h.requests.length;assert.equal((await h.store.loadDocumentJobDetail(original.jobId)).jobId,original.jobId);
  assert.equal(h.requests.length,count,"the existing non-Scene/default cache contract remains intact");
  await assert.rejects(h.store.loadActorDocumentGenerationReceipt(original.jobId),/active project context/u);
});


test("shared fresh receipt rejects actual selected-context revocation between exact metadata and private content",async t=>{
  const {h,original}=await admitted(t,true),prior=await read(h),reference=prior.job.result.generationReceipt.input_ref;
  h.store.content.set({...h.store.content.get(),[reference]:prior.content[reference]});h.store.documentJobs.set([]);
  let revoked=false;
  h.intercept=async request=>{
    if(!request.url.endsWith("?inspection=1"))return undefined;
    const response=await h.worker.request(request.url,request.init),body=await response.json();assert.equal(response.status,200);
    h.worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),h.worker.sharing.contextId);revoked=true;
    return Response.json(body);
  };
  const before=baseline(h);await assert.rejects(read(h),/generation inputs/u);assert.equal(revoked,true);assertReadOnly(h,before);
  assert.deepEqual(h.requests.slice(before.requests).map(request=>request.url),[
    "/api/document-jobs/"+original.jobId+"?inspection=1","/api/document-jobs/"+original.jobId+"/private-receipt",
  ]);
});

test("personal fresh Scene inspection rejects an actually expired terminal original without using the retained global cache",async t=>{
  const {h,original}=await admitted(t),prior=await h.store.loadDocumentJobDetail(original.jobId);
  const reference=prior.result.generationReceipt.input_ref;assert.equal(typeof h.store.content.get()[reference],"string");
  h.store.documentJobs.set([]);
  h.worker.sqlite.prepare("UPDATE document_jobs SET status='failed',expires_at=?,completed_at=? WHERE job_id=?").run("2000-01-01T00:00:00.000Z","2000-01-01T00:00:00.000Z",original.jobId);
  const before=baseline(h);await assert.rejects(read(h),/generation inputs/u);assertReadOnly(h,before);
  assert.equal(h.requests.length-before.requests,1,"no broader content hydration follows denied exact metadata");
});

test("cookie-free tenant original keeps existing exact-cost lookup but cannot invent selected-context input permissions",async t=>{
  const {h,original}=await admitted(t,true);
  h.worker.setScopedHeaders({});const response=await h.worker.request("/api/session");assert.equal(response.status,200);
  h.store.session.set(await response.json());h.store.documentJobs.set([]);
  assert.equal(h.store.session.get().projectContext,undefined);
  assert.equal((await h.quote()).job.jobId,original.jobId,"existing read-only Scene recovery still retains original identity");
  const before=baseline(h);await assert.rejects(read(h),/generation inputs/u);assertReadOnly(h,before);
  assert.equal(h.requests.length-before.requests,1,"a denied personal detail cannot fall through to project-private routes");
  assert.equal(h.requests.at(-1).url,"/api/document-jobs/"+original.jobId+"?inspection=1");
  h.worker.setScopedHeaders(h.worker.sharing.headers);h.store.session.set(await(await h.worker.request("/api/session")).json());
  assert.equal((await read(h)).job.jobId,original.jobId,"the existing selected project context supplies its real authorized route");
});


test("Scene fresh response does not seed the legacy job-detail cache",async t=>{
  const {h}=await admitted(t);h.store.documentJobs.set([]);
  const fresh=await read(h);h.store.documentJobs.set([fresh.job]);
  const count=h.requests.length;assert.equal((await h.store.loadDocumentJobDetail(fresh.job.jobId)).jobId,fresh.job.jobId);
  assert.deepEqual(h.requests.slice(count).map(request=>request.url),[
    "/api/document-jobs/"+fresh.job.jobId+"?inspection=1",
    "/api/events?after="+h.store.head.get()+"&limit=1&content=1",
  ],"default helper still must obtain its own detail and hydration; fresh handoff cached neither");
});
