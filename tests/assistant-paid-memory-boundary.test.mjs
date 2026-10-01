import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

globalThis.fetch=async()=>{throw new Error("external_fetch_forbidden");};
const root=new URL("../",import.meta.url).href;
const resolution=registerHooks({resolve(specifier,context,nextResolve){
  const local=typeof context.parentURL==="string"&&context.parentURL.startsWith(root)&&!context.parentURL.includes("/node_modules/");
  return nextResolve(local&&specifier.startsWith(".")&&!/\.[a-z0-9]+$/iu.test(specifier)?`${specifier}.ts`:specifier,context);
}});
const [{paidMemoryProof,storedPaidMemoryExclusion},{legacyChatMemoryProof},{respondToCreativeChat}]=await Promise.all([
  import("../worker/assistant-specialist-consent.ts"),import("../worker/events-api.ts"),import("../worker/openai-adapter.ts"),
]).finally(()=>resolution.deregister());

// Native exclusion SELECT fixture only. The main application suite owns the
// authenticated specialist/provider flow; this does not substitute authority.
function fixture(t,origins=true){
  const db=new DatabaseSync(":memory:");t.after(()=>db.close());
  db.exec("CREATE TABLE assistant_turns(actor_user_id TEXT,scope_key TEXT,turn_id TEXT,project_id TEXT,document_id TEXT,user_content_ref TEXT,assistant_content_ref TEXT,organization_id TEXT,project_access_id TEXT)");
  db.exec("CREATE TABLE private_content(content_id TEXT,kind TEXT)");
  db.exec("CREATE TABLE events(event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT,type TEXT,actor TEXT,payload TEXT)");
  if(origins)db.exec("CREATE TABLE memory_native_answer_origins(origin_id TEXT,actor_user_id TEXT,scope_key TEXT,turn_id TEXT,answer_content_id TEXT)");
  db.prepare("INSERT INTO assistant_turns VALUES(?,?,?,?,?,?,?,?,?)").run("alice","scope","turn","project","document","user","answer",null,null);
  db.exec("INSERT INTO private_content VALUES('user','chat-user'),('answer','chat-assistant'),('replacement','chat-assistant')");
  const event=(id,contentRef,marker,actor="alice",turnId="turn",scope={})=>db.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(id,"creative:"+(scope.ownerUserId??actor),"AssistantReasoned","user:"+actor,JSON.stringify({turn_id:turnId,project_id:"project",document_id:"document",content_ref:contentRef,organization_id:scope.organizationId??null,project_access_id:scope.projectAccessId??null,owner_user_id:scope.ownerUserId??actor,...(marker===undefined?{}:{memory_origin_version:marker})}));
  event("event","answer");
  const env={DB:{prepare(sql){return{first(){return Promise.resolve(db.prepare(sql).get()??null);}};}}};
  const evaluate=proof=>Boolean(db.prepare("SELECT 1 WHERE "+proof.sql).get(...proof.bindings));
  const proof=()=>paidMemoryProof(env,"alice","scope",[{turnId:"turn",userRef:"user",answerRef:"answer"}]);
  const staticAllowed=(scope=null)=>Boolean(db.prepare("SELECT 1 FROM (SELECT ? AS content) approved,(SELECT 'alice' AS actor_user_id,'scope' AS scope_key,'turn' AS turn_id) signed WHERE "+storedPaidMemoryExclusion()).get(JSON.stringify({binding:{scope,request:{conversation:[],turn:{user_content_ref:"user",assistant_content_ref:"answer"}}}})));
  return{db,env,event,evaluate,proof,staticAllowed};
}

for(const origins of [false,true])test("paid memory exclusion: ordinary original references remain eligible "+(origins?"with":"without")+" origin schema",async t=>{
  const f=fixture(t,origins);assert.equal(f.evaluate(await f.proof()),true);
  f.db.exec("DELETE FROM private_content WHERE content_id='answer'");
  assert.equal(f.evaluate(await f.proof()),true,"missing ordinary body remains a separate custody failure, not fabricated memory ancestry");
});

for(const marker of [1,2,null,"1",true])test("paid memory exclusion: retained proof rejects public marker "+JSON.stringify(marker)+" after capture",async t=>{
  const f=fixture(t),proof=await f.proof();assert.equal(f.evaluate(proof),true);assert.equal(f.staticAllowed(),true);
  f.event("late-marker","answer",marker);assert.equal(f.evaluate(proof),false);assert.equal(f.staticAllowed(),false);
});

for(const role of ["user","answer"])test("paid memory exclusion: either original half stays excluded after pointer replacement ("+role+")",async t=>{
  const f=fixture(t),proof=await f.proof();
  f.db.prepare("UPDATE private_content SET kind='chat-assistant-memory' WHERE content_id=?").run(role);
  f.db.exec("UPDATE assistant_turns SET "+(role==="user"?"user_content_ref":"assistant_content_ref")+"='replacement'");
  assert.equal(f.evaluate(proof),false);assert.equal(f.staticAllowed(),false);
});

for(const role of ["user_content_ref","assistant_content_ref"])test("paid memory exclusion: current "+role+" cannot adopt a retyped memory answer",async t=>{
  const f=fixture(t),proof=await f.proof();f.event("memory","replacement",1,"alice","other-turn");
  f.db.exec("UPDATE assistant_turns SET "+role+"='replacement'");assert.equal(f.evaluate(proof),false);
});

test("paid memory exclusion: original origin row survives missing body and same-turn pointer retyping",async t=>{
  const f=fixture(t),proof=await f.proof();
  f.db.exec("INSERT INTO memory_native_answer_origins VALUES('origin','alice','scope','turn','answer')");
  f.db.exec("DELETE FROM private_content WHERE content_id='answer'; UPDATE assistant_turns SET assistant_content_ref='replacement'");
  assert.equal(f.evaluate(proof),false);
});

test("paid memory exclusion: foreign origin tuple and unselected history do not block an ordinary selected turn",async t=>{
  const f=fixture(t);
  f.db.exec("INSERT INTO memory_native_answer_origins VALUES('foreign','bob','scope','turn','foreign-content')");
  f.event("other-turn-memory","foreign-content",1,"alice","other-turn");
  assert.equal(f.evaluate(await f.proof()),true);
});

test("paid memory exclusion: over-limit saved windows fail before DB access",async()=>{
  await assert.rejects(paidMemoryProof({DB:{prepare(){throw new Error("unexpected DB");}}},"alice","scope",Array.from({length:100},()=>({turnId:"turn"}))),/assistant_memory_paid_ancestry_unsupported/u);
});

test("paid memory exclusion: legacy selected reference proof denies original and newly repointed private identity",async t=>{
  const f=fixture(t),proof=await legacyChatMemoryProof(f.env,"creative:alice",[{eventId:"event",contentRef:"answer"}]);
  assert.equal(f.evaluate(proof),true);
  f.db.exec("UPDATE events SET payload=json_set(payload,'$.content_ref','replacement') WHERE event_id='event'");
  f.db.exec("INSERT INTO memory_native_answer_origins VALUES('origin','alice','scope','other-turn','replacement')");
  assert.equal(f.evaluate(proof),false);
});

test("paid memory exclusion: legacy marker is rejected even if its body and manifest are absent",async t=>{
  const f=fixture(t,false);f.db.exec("DELETE FROM private_content WHERE content_id='answer'; UPDATE events SET payload=json_set(payload,'$.memory_origin_version',1)");
  assert.equal(f.evaluate(await legacyChatMemoryProof(f.env,"creative:alice",[{eventId:"event",contentRef:"answer"}])),false);
});

test("paid memory exclusion: creative provider callback stops dispatch after request construction",async()=>{
  let checked=0;
  await assert.rejects(respondToCreativeChat({OPENAI_API_KEY:"mock-not-a-credential"},"alice",{
    documentTitle:"Document",blocks:[],history:[],message:"Question",beforeDispatch:async()=>{checked++;throw new Error("assistant_memory_paid_ancestry_unsupported");},
  }),/assistant_memory_paid_ancestry_unsupported/u);
  assert.equal(checked,1);
});

for(const shared of [false,true])test("paid memory exclusion: static and native marker tuples isolate duplicate turn IDs across "+(shared?"shared":"personal")+" scopes",async t=>{
  const f=fixture(t,false),scope=shared?{organizationId:"org",projectAccessId:"access",ownerUserId:"owner"}:null;
  if(shared)f.db.exec("UPDATE assistant_turns SET organization_id='org',project_access_id='access'");
  f.event("foreign-marker","unrelated-private",1,"alice","turn",{organizationId:"other-org",projectAccessId:"other-access",ownerUserId:"other-owner"});
  assert.equal(f.staticAllowed(scope),true);assert.equal(f.evaluate(await f.proof()),true);
  f.event("exact-marker","former-private",1,"alice","turn",scope??{});
  assert.equal(f.staticAllowed(scope),false);assert.equal(f.evaluate(await f.proof()),false);
});

test("paid memory exclusion: static personal tuple requires explicit nullable scope fields",async t=>{
  const f=fixture(t,false);f.event("marker","former-private",1);
  f.db.exec("UPDATE events SET payload=json_remove(payload,'$.organization_id','$.project_access_id') WHERE event_id='marker'");
  assert.equal(f.staticAllowed(),true);
  f.db.exec("UPDATE events SET payload=json_set(payload,'$.organization_id',NULL,'$.project_access_id',NULL) WHERE event_id='marker'");
  assert.equal(f.staticAllowed(),false);
});

test("paid memory exclusion: static tuple requires the approved owner and matching canonical owner stream",async t=>{
  const f=fixture(t,false);f.db.exec("UPDATE assistant_turns SET organization_id='org',project_access_id='access'");
  const scope={organizationId:"org",projectAccessId:"access",ownerUserId:"owner"};
  f.event("marker","former-private",1,"alice","turn",{...scope,ownerUserId:"different-owner"});
  assert.equal(f.staticAllowed(scope),true);
  f.db.exec("UPDATE events SET payload=json_set(payload,'$.owner_user_id','owner') WHERE event_id='marker'");
  assert.equal(f.staticAllowed(scope),true);
  f.db.exec("UPDATE events SET stream_id='creative:owner' WHERE event_id='marker'");
  assert.equal(f.staticAllowed(scope),false);
});

test("paid memory exclusion: direct private-reference marker match remains global despite foreign scope",async t=>{
  const f=fixture(t,false);f.event("foreign-marker","answer",1,"bob","foreign-turn",{organizationId:"other-org",projectAccessId:"other-access",ownerUserId:"other-owner"});
  assert.equal(f.staticAllowed(),false);assert.equal(f.evaluate(await f.proof()),false);
});

test("paid memory exclusion: static original references survive absent turn and content without fabricating NULL marker ancestry",async t=>{
  const f=fixture(t,false);
  f.db.exec("DELETE FROM assistant_turns; DELETE FROM private_content");assert.equal(f.staticAllowed(),true);
  f.event("unmatched-null",null,1,"bob","foreign-turn");assert.equal(f.staticAllowed(),true);
  f.event("direct-ref","answer",null,"bob","foreign-turn");assert.equal(f.staticAllowed(),false);
  f.db.exec("DELETE FROM events WHERE event_id='direct-ref'");assert.equal(f.staticAllowed(),true);
});

test("paid memory exclusion: static tuple marker survives NULL or missing content reference only while its exact turn remains",async t=>{
  const f=fixture(t,false);
  f.db.exec("DELETE FROM private_content");
  f.event("tuple-marker",null,1);assert.equal(f.staticAllowed(),false);
  f.db.exec("UPDATE events SET payload=json_remove(payload,'$.content_ref') WHERE event_id='tuple-marker'");assert.equal(f.staticAllowed(),false);
  f.db.exec("DELETE FROM assistant_turns");assert.equal(f.staticAllowed(),true);
});

test("paid memory exclusion: static matching and nonmatching event duplicates preserve the exclusion boolean",async t=>{
  const f=fixture(t,false);
  f.event("unmatched-a","foreign-ref",1,"bob","foreign-turn");f.event("unmatched-b","foreign-ref",1,"bob","foreign-turn");assert.equal(f.staticAllowed(),true);
  f.event("matched-a","answer",1,"bob","foreign-turn");assert.equal(f.staticAllowed(),false);
  f.event("matched-b","answer",1,"bob","foreign-turn");assert.equal(f.staticAllowed(),false);
  f.db.exec("DELETE FROM events WHERE event_id='matched-a'");assert.equal(f.staticAllowed(),false);
  f.db.exec("DELETE FROM events WHERE event_id='matched-b'");assert.equal(f.staticAllowed(),true);
});

test("paid memory exclusion: static positive memory kind skips malformed events without suppressing ordinary errors",async t=>{
  const f=fixture(t,false);
  // Keep valid non-null turn refs; only the selected memory-kind body remains.
  f.db.exec("DELETE FROM private_content WHERE content_id!='answer'; UPDATE private_content SET kind='chat-assistant-memory' WHERE content_id='answer'");
  assert.equal(f.staticAllowed(),false);
  f.db.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run("malformed","creative:alice","AssistantReasoned","user:alice","{");
  assert.equal(f.staticAllowed(),false,"The original positive-kind result remains a clean denial, not a malformed-JSON exception");
  f.db.exec("UPDATE private_content SET kind='chat-assistant' WHERE content_id='answer'");
  assert.throws(()=>f.staticAllowed(),/malformed JSON/u);
  f.db.exec("UPDATE events SET payload='{}' WHERE event_id='malformed'");
  assert.equal(f.staticAllowed(),true,"Repairing only the malformed event restores the ordinary exclusion result");
});
