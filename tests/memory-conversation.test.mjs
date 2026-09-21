import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryConversationSegment, memoryConversationCoverage } from "../src/model/memory-conversation.ts";
import { memoryKey, memorySourceRef } from "../src/model/scoped-memory.ts";
import { hashMemoryText, memoryFixture, sourceMap } from "./helpers/scoped-memory.mjs";

function conversation(count = 8) {
  const f = memoryFixture({ targetScopeId: "document" });
  const rows = Array.from({ length: count }, (_, index) => {
    const role = index % 2 ? "assistant" : "user";
    const text = role === "user" ? `User requirement ${index}: keep the chart precise.` : `Possible approach ${index}: add a chart.`;
    const source = f.source({ id: `chat-${index}`, scopeId: "document", streamId: "private-conversation:alice", sequence: index * 3 + 2,
      contentHash: hashMemoryText(text), origin: role, speaker: role, independentEvidence: role === "user" });
    return { source, turn: { turnId: `turn-${Math.floor(index / 2)}`, conversationId: "conversation-1", role, status: "final", text, source: memorySourceRef(source) } };
  });
  const sources = sourceMap(rows.map((row) => row.source));
  const inventory = { conversationId: "conversation-1", scopeId: "document", completeFromStart: true, turns: rows.map((row) => row.turn) };
  const segment = (start, end, overrides = {}) => createMemoryConversationSegment({ id: `segment-${start}-${end}`, version: 1,
    inventory: { ...inventory, turns: inventory.turns.slice(start, end) }, ...overrides }, sources, f.access, f.graph);
  const coverage = (segments, overrides = {}) => memoryConversationCoverage({ inventory, segments, recentLimit: 2, ...overrides }, sources, f.access, f.graph);
  return { ...f, rows, sources, inventory, segment, coverage };
}

test("rolling context is an exact summarized prefix plus uncovered recent turns, despite unrelated-event sequence gaps", async () => {
  const f = conversation();
  const segments = [await f.segment(0, 4), await f.segment(4, 6)];
  const result = await f.coverage(segments);
  assert.equal(result.status, "ready");
  assert.equal(result.continuous, true);
  assert.equal(result.summarizedTurnIds.length, 6);
  assert.equal(result.recentTurnIds.length, 2);
  assert.deepEqual(result.omittedTurnIds, []);
  assert.equal(new Set([...result.summarizedTurnIds, ...result.recentTurnIds]).size, 8);
  assert.match(segments[0].record.body, /Assistant proposed \(not an accepted decision\)/u);
  assert.equal(segments[0].record.authority, "historical");
});

test("overlapping and duplicate segments never double-count source turns", async () => {
  const f = conversation(6);
  const first = await f.segment(0, 2), overlap = await f.segment(1, 4), next = await f.segment(2, 4);
  const result = await f.coverage([next, first, first, overlap]);
  assert.equal(result.continuous, true);
  assert.equal(result.segments.length, 2);
  assert.equal(result.summarizedTurnIds.length, 4);
});

test("lagging, gapped and partial inventories disclose missing coverage", async () => {
  const f = conversation(8);
  const first = await f.segment(0, 2), gap = await f.segment(4, 6);
  const result = await f.coverage([first, gap]);
  assert.equal(result.continuous, false);
  assert.equal(result.omittedTurnIds.length, 4);
  const partial = await f.coverage([], { inventory: { ...f.inventory, completeFromStart: false }, recentLimit: 8 });
  assert.equal(partial.completeFromStart, false);
  assert.equal(partial.continuous, false);
  assert.deepEqual(partial.omittedTurnIds, []);
});

test("pending/superseded answers are excluded; duplicate final messages are rejected", async () => {
  const f = conversation(4);
  f.inventory.turns[1].status = "pending";
  f.inventory.turns[2].status = "superseded";
  const result = await f.coverage([], { recentLimit: 8 });
  assert.equal(result.recentTurns.length, 2);
  assert.equal(result.recentTurns.some((turn) => turn.status !== "final"), false);
  const duplicate = structuredClone(f.inventory.turns[3]);
  f.inventory.turns.push(duplicate);
  assert.equal((await f.coverage([])).status, "blocked");
});

test("current content fingerprints invalidate summaries even when content IDs have not changed", async () => {
  const f = conversation(4);
  const segment = await f.segment(0, 2);
  const original = f.rows[0].source;
  const revised = { ...original, contentHash: hashMemoryText("Corrected same-reference content") };
  f.sources.set(memoryKey(original.custodianId, original.id), revised);
  assert.equal((await f.coverage([segment])).status, "blocked");
  f.inventory.turns[0] = { ...f.inventory.turns[0], text: "Corrected same-reference content", source: memorySourceRef(revised) };
  const current = await f.coverage([segment]);
  assert.equal(current.status, "ready");
  assert.equal(current.segments.length, 0);
  assert.equal(current.continuous, false);
});

test("mixed stream order, foreign actor, shared visibility and missing sources fail closed", async () => {
  for (const change of ["stream", "actor", "visibility", "missing", "expired"]) {
    const f = conversation(2), source = f.rows[0].source;
    const changed = { ...source, ...(change === "stream" ? { streamId: "another-ledger" } : change === "actor" ? { actorUserId: "bob" }
      : change === "visibility" ? { visibility: "shared" } : change === "expired" ? { expiresAt: f.access.now } : {}) };
    if (change === "missing") f.sources.delete(memoryKey(source.custodianId, source.id));
    else f.sources.set(memoryKey(source.custodianId, source.id), changed);
    f.inventory.turns[0].source = memorySourceRef(changed);
    assert.equal((await f.coverage([])).status, "blocked", change);
  }
});

test("extractive body and conversation claim tampering never acquire source coverage", async () => {
  const f = conversation(4), segment = await f.segment(0, 2);
  for (const patch of [{ body: "An invented accepted decision" }, { claimKey: "another-conversation" }]) {
    const result = await f.coverage([{ ...segment, record: { ...segment.record, ...patch } }]);
    assert.equal(result.segments.length, 0);
    assert.equal(result.continuous, false);
  }
});

test("conversation role is bound to authenticated speaker, not mutable turn labels or content origin", async () => {
  const f = conversation(2);
  f.inventory.turns = [{ ...f.inventory.turns[1], role: "user" }];
  assert.equal(await f.segment(0, 1), null);
  assert.equal((await f.coverage([])).status, "blocked");
  const assisted = conversation(1), original = assisted.rows[0].source;
  const source = { ...original, origin: "assistant", independentEvidence: false, speaker: "user" };
  assisted.sources.set(memoryKey(source.custodianId, source.id), source);
  assisted.inventory.turns[0].source = memorySourceRef(source);
  const segment = await assisted.segment(0, 1);
  assert.match(segment.record.body, /^User stated:/u);
  assert.equal(segment.record.lastIndependentEvidenceAt, null);
});

test("turn mutation during asynchronous hashing cannot misattribute new content to an old hash", async () => {
  const f = conversation(2), original = f.inventory.turns[0].text;
  const pending = f.segment(0, 2);
  f.inventory.turns[0].text = "INJECTED DURING HASHING";
  f.inventory.turns[0].status = "pending";
  const result = await pending;
  assert.match(result.record.body, new RegExp(original.replaceAll(".", "\\.")));
  assert.equal(result.record.body.includes("INJECTED"), false);
});

test("source revocation while a summary hashes aborts construction", async () => {
  const f = conversation(2);
  const pending = f.segment(0, 2);
  const original = f.rows[0].source;
  f.sources.set(memoryKey(original.custodianId, original.id), { ...original, state: "revoked" });
  assert.equal(await pending, null);
});

test("summary-byte budgets disclose gaps instead of dropping or rewriting recent context", async () => {
  const f = conversation(8), segment = await f.segment(0, 6);
  const before = structuredClone(f.inventory);
  const result = await f.coverage([segment], { summaryByteLimit: 0 });
  assert.equal(result.segments.length, 0);
  assert.equal(result.omittedTurnIds.length, 6);
  assert.equal(result.recentTurns.length, 2);
  assert.deepEqual(f.inventory, before);
});

test("source-ref property order does not change exact coverage", async () => {
  const f = conversation(4), segment = await f.segment(0, 2);
  segment.covered[0].source = Object.fromEntries(Object.entries(segment.covered[0].source).reverse());
  assert.equal((await f.coverage([segment])).continuous, true);
});

// Model candidates have a distinct unverified contract; exact quotes are not
// permission to write user declarations or evidence that the model is correct.
const {parseMemoryDerivationResult,MEMORY_DERIVATION_RESULT_VERSION}=await import('../worker/memory-derivation-result.ts');
function derivationFixture(purpose='rolling-summary'){
  const now=Date.now(),until=new Date(now+30000).toISOString(),scopeKey='native-document:actor:project:document';
  const sources=[{sourceId:'user-source',lineageId:'human-lineage',scopeKey,text:'Keep 🪴 green. Do not add red.',expiresAt:until,role:'user',kind:'message',authorship:'original-human'},
    {sourceId:'assistant-source',lineageId:'assistant-lineage',scopeKey,text:'Consider red as an alternative.',expiresAt:until,role:'assistant',kind:'message',authorship:'original-assistant'}];
  for(const source of sources){source.revision=1;source.contentHash=hashMemoryText(source.text);}
  const context={purpose,scopeKey,manifestId:'native-manifest',manifestRevision:3,checkedAt:new Date(now).toISOString(),validUntil:until,sources,priorItems:[],suppressedLineages:[]};
  const quote=(sourceIndex=0,start=0,end=13)=>({sourceIndex,start,end,text:Array.from(sources[sourceIndex].text).slice(start,end).join('')});
  const item={operation:'assert',target:null,category:purpose==='profile'?'preference-hypothesis':purpose==='suggestion'?'proposal':'decision',text:'Keep the palette green.',supports:[quote()],counterevidence:[]};
  const body={version:MEMORY_DERIVATION_RESULT_VERSION,items:[item]};
  return {context,item,body,quote,parse:()=>parseMemoryDerivationResult(JSON.stringify(body),context)};
}
for(const purpose of ['rolling-summary','profile','suggestion'])test('model candidate '+purpose+' remains quoted, bounded and semantically unverified',async()=>{
  const f=derivationFixture(purpose),result=await f.parse();assert.ok(result);assert.equal(result.semanticAuthority,'model-derived-unverified');
  assert.equal(result.semanticCompleteness,false);assert.equal(result.independentEvidence,false);assert.equal(result.validUntil,f.context.validUntil);
  assert.equal(result.items[0].citationStatus,'support-cited');assert.deepEqual(result.items[0].lineageIds,['human-lineage']);
  assert.equal(result.items[0].supports[0].text,'Keep 🪴 green.');assert.ok(Object.isFrozen(result.items[0].supports[0]));
  f.item.text='An entirely unrelated invented inference.';
  const attributed=await f.parse();assert.ok(attributed);assert.equal(attributed.semanticAuthority,'model-derived-unverified','Exact attribution cannot verify entailment');
  assert.equal(attributed.items[0].claimKey,result.items[0].claimKey,'Paraphrasing cannot create a new support lineage');
});
for(const fault of ['duplicate-key','escaped-duplicate-key','trailing','oversize','unknown-field','unpaired-surrogate','deep'])test('model candidate rejects '+fault,async()=>{
  const f=derivationFixture();let raw=JSON.stringify(f.body);
  if(fault==='duplicate-key')raw=raw.replace('"items":','"items":[],"items":');
  if(fault==='escaped-duplicate-key')raw=raw.replace('"items":','"it\\u0065ms":[],"items":');
  if(fault==='trailing')raw+='{}';
  if(fault==='oversize')raw=' '.repeat(65537)+raw;
  if(fault==='unknown-field')raw=JSON.stringify({...f.body,confidence:1});
  if(fault==='unpaired-surrogate'){f.item.text='\ud800';raw=JSON.stringify(f.body);}
  if(fault==='deep')raw=JSON.stringify({version:MEMORY_DERIVATION_RESULT_VERSION,items:[[[[[[[[[[[[[[]]]]]]]]]]]]]]});
  assert.equal(await parseMemoryDerivationResult(raw,f.context),null);
});
for(const fault of ['wrong-index','utf16-offset','changed-negation','duplicate-quote','same-counterquote','assistant-decision','derived-support','unknown-support','observation-intent','stale-source','cross-scope','expired-lease','future-clock','long-lease'])test('model candidate rejects unsupported citation '+fault,async()=>{
  const f=derivationFixture();
  if(fault==='wrong-index')f.item.supports[0].sourceIndex=1;
  if(fault==='utf16-offset')f.item.supports[0].end++;
  if(fault==='changed-negation')f.item.supports[0].text='Do add red.';
  if(fault==='duplicate-quote')f.item.supports.push({...f.item.supports[0]});
  if(fault==='same-counterquote')f.item.counterevidence.push({...f.item.supports[0]});
  if(fault==='assistant-decision')f.item.supports=[f.quote(1,0,8)];
  if(fault==='derived-support')f.context.sources[0].authorship='derived';
  if(fault==='unknown-support')f.context.sources[0].authorship='unknown';
  if(fault==='observation-intent')f.context.sources[0].kind='observation';
  if(fault==='stale-source')f.context.sources[0].expiresAt=f.context.checkedAt;
  if(fault==='cross-scope')f.context.sources[0].scopeKey='another-document';
  if(fault==='expired-lease')f.context.validUntil=f.context.checkedAt;
  if(fault==='future-clock')f.context.checkedAt=new Date(Date.now()+10000).toISOString();
  if(fault==='long-lease')f.context.validUntil=new Date(Date.now()+120000).toISOString();
  assert.equal(await f.parse(),null);
});
test('model profile cannot relabel an assistant suggestion as human preference; countercontext remains explicitly conflicting',async()=>{
  const f=derivationFixture('profile');f.item.supports=[f.quote(1,0,8)];assert.equal(await f.parse(),null);
  f.item.supports=[f.quote()];f.item.counterevidence=[f.quote(1,0,8)];const result=await f.parse();assert.ok(result);
  assert.equal(result.items[0].citationStatus,'conflicting-citations');assert.deepEqual(result.items[0].lineageIds,['assistant-lineage','human-lineage']);
});
for(const fault of ['stale-target','protected-target','unknown-target','cross-purpose','missing-old-lineage','repeated-target','suppressed-support','suppressed-counter','sparse-sources','accessor','custom-prototype'])test('model candidate cannot bypass native context constraints '+fault,async()=>{
  const f=derivationFixture(),prior={itemId:'prior',revision:2,purpose:f.context.purpose,scopeKey:f.context.scopeKey,lineageIds:['human-lineage','assistant-lineage'],sourceBindings:f.context.sources.map(({sourceId,revision,contentHash})=>({sourceId,revision,contentHash})),validUntil:f.context.validUntil,userProtected:false};
  f.context.priorItems=[prior];f.item.operation='correct';f.item.target={itemId:'prior',revision:2};
  if(fault==='stale-target')f.item.target.revision=1;
  if(fault==='protected-target')prior.userProtected=true;
  if(fault==='unknown-target')f.item.target.itemId='fabricated';
  if(fault==='cross-purpose')prior.purpose='profile';
  if(fault==='missing-old-lineage')prior.lineageIds.push('missing-original');
  if(fault==='repeated-target')f.body.items.push(structuredClone(f.item));
  if(fault==='suppressed-support')f.context.suppressedLineages=['human-lineage'];
  if(fault==='suppressed-counter')f.context.suppressedLineages=['assistant-lineage'];
  if(fault==='sparse-sources')delete f.context.sources[1];
  if(fault==='accessor')Object.defineProperty(f.context,'scopeKey',{enumerable:true,get(){return assert.fail('Do not execute an accessor');}});
  if(fault==='custom-prototype')Object.setPrototypeOf(f.context.sources[0],{toJSON(){assert.fail('Do not invoke custom serialization');}});
  assert.equal(await f.parse(),null);
});
test('model correction carries every old original dependency and omission is not withdrawal',async()=>{
  const f=derivationFixture(),prior={itemId:'prior',revision:2,purpose:f.context.purpose,scopeKey:f.context.scopeKey,lineageIds:['human-lineage','assistant-lineage'],sourceBindings:f.context.sources.map(({sourceId,revision,contentHash})=>({sourceId,revision,contentHash})),validUntil:f.context.validUntil,userProtected:false};
  f.context.priorItems=[prior];f.item.operation='correct';f.item.target={itemId:'prior',revision:2};
  const result=await f.parse();assert.ok(result);assert.equal(result.items[0].claimKey,'prior');
  assert.deepEqual(result.items[0].lineageIds,['assistant-lineage','human-lineage']);assert.equal(result.items[0].validUntil,prior.validUntil);
  assert.deepEqual(result.items[0].sourceBindings,[...prior.sourceBindings].sort((a,b)=>a.sourceId.localeCompare(b.sourceId)));
  f.body.items=[];const empty=await f.parse();assert.ok(empty);assert.deepEqual(empty.items,[]);assert.equal(f.context.priorItems.length,1);
});

test('model candidates distinguish evidence spans but cannot reassert an existing protected claim',async()=>{
  const f=derivationFixture(),first=(await f.parse()).items[0];
  f.body.items.push({...structuredClone(f.item),text:'Do not add red.',supports:[f.quote(0,14,29)]});
  const distinct=await f.parse();assert.ok(distinct);assert.notEqual(distinct.items[0].claimKey,distinct.items[1].claimKey);
  f.body.items.pop();f.context.priorItems=[{itemId:first.claimKey,revision:1,purpose:f.context.purpose,scopeKey:f.context.scopeKey,
    lineageIds:first.lineageIds,sourceBindings:first.sourceBindings,validUntil:first.validUntil,userProtected:true}];
  assert.equal(await f.parse(),null,'An assert is not a bypass for an exact protected claim');
  f.item.supports=[f.quote(0,14,29)];f.context.suppressedLineages=['human-lineage'];
  assert.equal(await f.parse(),null,'A new evidence span cannot bypass lineage suppression');
});
for(const fault of ['different-original','changed-body','changed-revision','wrong-hash'])test('model correction retains exact original binding: '+fault,async()=>{
  const f=derivationFixture(),first=(await f.parse()).items[0];
  f.context.priorItems=[{itemId:first.claimKey,revision:1,purpose:f.context.purpose,scopeKey:f.context.scopeKey,
    lineageIds:first.lineageIds,sourceBindings:first.sourceBindings,validUntil:first.validUntil,userProtected:false}];
  f.item.operation='correct';f.item.target={itemId:first.claimKey,revision:1};
  if(fault==='different-original')f.context.sources[0].sourceId='same-lineage-other-original';
  if(fault==='changed-body'){f.context.sources[0].text+=' Different meaning.';f.context.sources[0].contentHash=hashMemoryText(f.context.sources[0].text);}
  if(fault==='changed-revision')f.context.sources[0].revision++;
  if(fault==='wrong-hash')f.context.sources[0].contentHash='f'.repeat(64);
  assert.equal(await f.parse(),null);
});
test('model parser accepts bounded compound native keys and rejects blank human support',async()=>{
  const f=derivationFixture(),{nativeMemoryDocumentIdentity}=await import('../worker/memory-native-scope.ts');
  const identity=nativeMemoryDocumentIdentity({actor_user_id:'a'.repeat(240),owner_user_id:'a'.repeat(240),organization_id:null,
    project_access_id:null,project_id:'p'.repeat(240),document_id:'d'.repeat(240)});
  assert.ok(identity.documentKey.length>240);f.context.scopeKey=identity.documentKey;
  for(const source of f.context.sources)source.scopeKey=identity.documentKey;
  assert.ok(await f.parse());f.item.supports=[f.quote(0,4,5)];assert.equal(await f.parse(),null);
});

const {parseMemoryDerivationQualification,derivationCanonical,memoryDerivationMaximumMicroUsd,DERIVATION_EVIDENCE}=await import('../worker/memory-derivation-policy.ts');
function derivationQualificationFixture(){
  const binding={sourceSha256:'a'.repeat(64),origin:'https://qualification.fixture.invalid',deploymentId:'isolated-local-qualification'};
  const terms={version:'memory-derivation-terms-v1',purpose:'rolling-summary',recipeVersion:'memory-derivation-candidates-v1',provider:'openai',model:'isolated-test-model',
    pricing:{inputMicroUsdPerMillion:1000000,cachedInputMicroUsdPerMillion:250000,outputMicroUsdPerMillion:2000000},maximumInputTokens:1000,maximumOutputTokens:100,
    monthlyCapMicroUsd:100000,payer:'self-ai-allowance',providerStore:false,providerRetentionDisclosure:'Isolated synthetic qualification only; no real provider retention claim.',retentionPolicyId:'isolated-test-retention',evidence:Object.fromEntries(DERIVATION_EVIDENCE.map(key=>[key,hashMemoryText('synthetic-only:'+key)]))};
  const row={qualification_id:'isolated-local-receipt',source_sha256:binding.sourceSha256,origin:binding.origin,deployment_id:binding.deploymentId,
    terms_json:derivationCanonical(terms),terms_sha256:'',status:'qualified',qualified_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString()};
  const resign=()=>{row.terms_json=derivationCanonical(terms);row.terms_sha256=hashMemoryText(row.terms_json);};resign();
  return {binding,terms,row,resign,parse:()=>parseMemoryDerivationQualification(row,binding)};
}
test('purpose qualification is exact, deployment-bound and has no default price or monthly cap',async()=>{
  const f=derivationQualificationFixture(),accepted=await f.parse();assert.ok(accepted);
  assert.equal(memoryDerivationMaximumMicroUsd(accepted.terms),1200);assert.ok(Object.isFrozen(accepted.terms.evidence));
  assert.equal(await parseMemoryDerivationQualification(null,f.binding),null);
  f.terms.pricing.inputMicroUsdPerMillion=999999;f.resign();assert.equal(memoryDerivationMaximumMicroUsd((await f.parse()).terms),1200,'Ceil the total charge; never use cached pricing for a maximum');
});
for(const fault of ['missing-evidence','missing-cap','changed-hash','duplicate-key','extra-field','different-source','different-origin','different-deployment','http-origin','withdrawn','expired','future-qualified','fractional-price','negative-cache-price','cache-premium','call-over-cap','provider-store','another-payer'])
test('purpose qualification rejects '+fault,async()=>{
  const f=derivationQualificationFixture();
  if(fault==='missing-evidence')delete f.terms.evidence.capApproval;
  if(fault==='missing-cap')delete f.terms.monthlyCapMicroUsd;
  if(fault==='extra-field')f.terms.allowedToSpend=true;
  if(fault==='fractional-price')f.terms.pricing.inputMicroUsdPerMillion=1.5;
  if(fault==='negative-cache-price')f.terms.pricing.cachedInputMicroUsdPerMillion=-1;
  if(fault==='cache-premium')f.terms.pricing.cachedInputMicroUsdPerMillion=1000001;
  if(fault==='call-over-cap')f.terms.monthlyCapMicroUsd=1;
  if(fault==='provider-store')f.terms.providerStore=true;
  if(fault==='another-payer')f.terms.payer='organization';
  f.resign();
  if(fault==='changed-hash')f.row.terms_sha256='0'.repeat(64);
  if(fault==='duplicate-key'){f.row.terms_json=f.row.terms_json.replace('"monthlyCapMicroUsd":','"monthlyCapMicroUsd":1,"monthlyCapMicroUsd":');f.row.terms_sha256=hashMemoryText(f.row.terms_json);}
  if(fault==='different-source')f.binding.sourceSha256='b'.repeat(64);
  if(fault==='different-origin')f.binding.origin='https://other.fixture.invalid';
  if(fault==='different-deployment')f.binding.deploymentId='other-deployment';
  if(fault==='http-origin')f.binding.origin=f.row.origin='http://qualification.fixture.invalid';
  if(fault==='withdrawn')f.row.status='withdrawn';
  if(fault==='expired')f.row.expires_at=new Date(Date.now()-1).toISOString();
  if(fault==='future-qualified')f.row.qualified_at=new Date(Date.now()+10000).toISOString();
  assert.equal(await f.parse(),null);
  if(fault==='future-qualified')assert.equal(await parseMemoryDerivationQualification(f.row,f.binding,new Date(Date.now()+20000).toISOString()),null);
});

for(const purpose of ['rolling-summary','profile','suggestion'])test('native derivation request windows bound escaped Unicode and whole-pair framing '+purpose,async()=>{
  const request=await import('../worker/memory-derivation-request.ts'),terms={...derivationQualificationFixture().terms,purpose,maximumInputTokens:131072};
  const bytes=value=>new TextEncoder().encode(value).byteLength;
  const samples=['ordinary words','\u0000\u0001\n\t\r\b\f\\"','日本語 العربية 😀','x'.repeat(16384)];
  const empty=bytes(request.nativeDerivationRequestBody(terms,[],[]));
  for(const text of samples){
    const originals=Array.from({length:128},(_,i)=>({role:i%2?'assistant':'user',authorship:i%2?'original-assistant':'original-human',text}));
    const observed=Array.from({length:64},()=>({action:'request-changes',recordedAt:'2026-09-18T23:59:59.999Z'}));
    for(const [items,observations]of [[originals,[]],[[],observed],[originals,observed]]){
      const bound=empty+items.length/2*request.NATIVE_DERIVATION_PAIR_FRAMING+items.reduce((n,item)=>n+bytes(item.text)*request.NATIVE_DERIVATION_JSON_EXPANSION,0)+observations.length*request.NATIVE_DERIVATION_OBSERVATION_FRAMING;
      assert.ok(bytes(request.nativeDerivationRequestBody(terms,items,observations))<=bound);
    }
  }
  assert.equal(request.nativeDerivationWindowBudget({...terms,maximumInputTokens:1}),0);
  const body=request.nativeDerivationRequestBody(terms,[],[]);
  assert.equal(request.nativeDerivationRequestFits({...terms,maximumInputTokens:bytes(body)+4096},body),true);
  assert.equal(request.nativeDerivationRequestFits({...terms,maximumInputTokens:bytes(body)+4095},body),false);
});

test('native artifact identities separate actor partitions, custody and exact document containment',async()=>{
  const {nativeMemoryArtifactIdentity}=await import('../worker/memory-native-scope.ts');
  const e={actor_user_id:'reader-a',owner_user_id:'owner',organization_id:'org',project_access_id:'access',project_id:'project',document_id:'document'};
  const first=nativeMemoryArtifactIdentity(e,'artifact'),second=nativeMemoryArtifactIdentity({...e,actor_user_id:'reader-b'},'artifact');
  assert.ok(Object.isFrozen(first));assert.equal(first.artifactKey,second.artifactKey);assert.notEqual(first.partitionKey,second.partitionKey);
  for(const key of ['owner_user_id','organization_id','project_access_id','project_id','document_id'])assert.notEqual(first.artifactKey,nativeMemoryArtifactIdentity({...e,[key]:'different'},'artifact').artifactKey);
  assert.notEqual(first.artifactKey,nativeMemoryArtifactIdentity(e,'artifact-next').artifactKey);
  assert.equal(nativeMemoryArtifactIdentity(e,' invalid '),null);assert.equal(nativeMemoryArtifactIdentity({...e,organization_id:null},'artifact'),null);
  assert.equal(first.projectAncestry,'unresolved','artifact identity cannot fabricate nested-project authority');
});

const {parseMemoryBehavioralResult,behavioralSourceHash,MEMORY_BEHAVIORAL_RESULT_VERSION}=await import('../worker/memory-behavioral-result.ts');
async function behavioralFixture(purpose='profile'){
  const f=derivationFixture(purpose),context={...f.context,sources:[],observations:[]},descriptor={sourceId:'native-inspection',revision:7,lineageId:'b'.repeat(64),scopeKey:context.scopeKey,
    resourceKey:'native-block:document:block',eventType:'BlockInspected',action:'inspect',recordedAt:context.checkedAt,expiresAt:context.validUntil,independentEvidence:false};
  context.observations.push({...descriptor,contentHash:await behavioralSourceHash(descriptor)});
  const item={operation:'assert',target:null,category:purpose==='profile'?'workflow-hypothesis':'proposal',text:'You may want to revisit the block you inspected.',supports:[],counterevidence:[],observationSupports:[0],observationCounterevidence:[]};
  const body={version:MEMORY_BEHAVIORAL_RESULT_VERSION,items:[item]};return {context,item,body,original:f,parse:()=>parseMemoryBehavioralResult(JSON.stringify(body),context)};
}
for(const purpose of ['profile','suggestion','rolling-summary'])test('behavioral v2: native action citations stay separate from human quotations '+purpose,async()=>{
  const f=await behavioralFixture(purpose),result=await f.parse();assert.ok(result);assert.equal(result.version,MEMORY_BEHAVIORAL_RESULT_VERSION);assert.equal(result.semanticAuthority,'model-derived-unverified');assert.equal(result.independentEvidence,false);assert.equal(result.semanticCompleteness,false);
  const item=result.items[0];assert.deepEqual(item.supports,[]);assert.deepEqual(item.observationCitations,[{observationIndex:0,action:'inspect',recordedAt:f.context.checkedAt,role:'support'}]);assert.deepEqual(item.lineageIds,['b'.repeat(64)]);assert.equal(item.sourceBindings[0].sourceId,'native-inspection');assert.ok(Object.isFrozen(item.observationCitations[0]));
  f.item.text='A different unverified workflow interpretation.';assert.equal((await f.parse()).items[0].claimKey,item.claimKey);assert.equal(await parseMemoryDerivationResult(JSON.stringify(f.body),f.context),null);
});
test('behavioral v2: genuine human preference quotes and typed counterevidence remain distinct',async()=>{
  const f=await behavioralFixture();f.context.sources=f.original.context.sources;f.item.category='preference-hypothesis';f.item.supports=[f.original.quote()];f.item.observationSupports=[];f.item.observationCounterevidence=[0];
  const result=await f.parse();assert.ok(result);assert.equal(result.items[0].citationStatus,'conflicting-citations');assert.deepEqual(result.items[0].lineageIds,['b'.repeat(64),'human-lineage']);assert.equal(result.items[0].observationCitations[0].role,'counterevidence');
  f.context.sources[0].authorship='derived';assert.equal(await f.parse(),null);
});
for(const fault of ['wrong-version','source-hash','source-scope','source-expired','source-future','duplicate-source','unsupported-action','independent-use','wrong-index','duplicate-index','same-counter','no-support','invented-preference','invented-decision','suppressed','original-quote-substitute','unknown-key','target','operation','duplicate-claim','future-clock','expired-clock','accessor','snapshot-race'])test('behavioral v2 rejects '+fault,async()=>{
  const f=await behavioralFixture(fault==='invented-decision'?'rolling-summary':'profile'),source=f.context.observations[0];let invoked=0;
  if(fault==='wrong-version')f.body.version=MEMORY_DERIVATION_RESULT_VERSION;if(fault==='source-hash')source.contentHash='0'.repeat(64);if(fault==='source-scope')source.scopeKey='foreign';if(fault==='source-expired')source.expiresAt=f.context.checkedAt;if(fault==='source-future')source.recordedAt=new Date(Date.now()+60000).toISOString();
  if(fault==='duplicate-source')f.context.observations.push({...source});if(fault==='unsupported-action')source.action='attention';if(fault==='independent-use')source.independentEvidence=true;if(fault==='wrong-index')f.item.observationSupports=[1];if(fault==='duplicate-index')f.item.observationSupports=[0,0];if(fault==='same-counter')f.item.observationCounterevidence=[0];if(fault==='no-support')f.item.observationSupports=[];
  if(fault==='invented-preference')f.item.category='preference-hypothesis';if(fault==='invented-decision')f.item.category='decision';if(fault==='suppressed')f.context.suppressedLineages=[source.lineageId];if(fault==='original-quote-substitute')f.item.supports=[{sourceIndex:0,start:0,end:7,text:'inspect'}];if(fault==='unknown-key')f.item.attention=true;if(fault==='target')f.item.target={itemId:'claim',revision:1};if(fault==='operation')f.item.operation='correct';if(fault==='duplicate-claim')f.body.items.push({...f.item,text:'Paraphrased duplicate'});
  if(fault==='future-clock')f.context.checkedAt=new Date(Date.now()+1000).toISOString();if(fault==='expired-clock')f.context.validUntil=f.context.checkedAt;if(fault==='accessor')Object.defineProperty(source,'action',{enumerable:true,get(){invoked++;return 'inspect';}});
  if(fault==='snapshot-race'){const pending=f.parse();f.context.observations[0].action='edit';assert.ok(await pending,'Input mutation after parsing starts cannot alter the copied evidence');return;}
  assert.equal(await f.parse(),null);assert.equal(invoked,0);
});
test('behavioral v2 rejects duplicate JSON keys without reading a later replacement',async()=>{
  const f=await behavioralFixture(),raw=JSON.stringify(f.body).replace('"observationSupports":','"observationSupports":[],"observationSupports":');assert.equal(await parseMemoryBehavioralResult(raw,f.context),null);
});

const {parseMemoryProfileResult}=await import('../worker/memory-profile-result.ts');
function profileConsolidationFixture(){
 const f=derivationFixture('profile');f.body.version='memory-profile-consolidation-v1';f.item.supports=[f.quote(0,14,28)];
 f.item.reconciles=[{relationship:'contradicts',category:'preference-hypothesis',supports:[f.quote()]}];
 return {...f,parse:()=>parseMemoryProfileResult(JSON.stringify(f.body),f.context)};
}
test('profile consolidation derives a tentative historical anchor from original quotes, not older model prose',async()=>{
 const f=profileConsolidationFixture(),result=await f.parse(),prior=await derivationFixture('profile').parse();assert.ok(result);
 const item=result.items[0];assert.equal(item.reconciles[0].claimKey,prior.items[0].claimKey);assert.notEqual(item.claimKey,prior.items[0].claimKey);
 assert.equal(item.reconciles[0].supports[0].text,'Keep 🪴 green.');assert.equal(result.independentEvidence,false);assert.ok(Object.isFrozen(item.reconciles[0]));
 assert.equal(item.operation,'assert');assert.equal(item.target,null);assert.equal(result.semanticCompleteness,false);
});
for(const fault of ['purpose','invented-quote','assistant-support','protected-source','self-link','unknown-key','duplicate-link','too-many','same-response-chain','prior-model-input'])test('profile consolidation rejects '+fault,async()=>{
 const f=profileConsolidationFixture();
 if(fault==='purpose')f.context.purpose='rolling-summary';
 if(fault==='invented-quote')f.item.reconciles[0].supports[0].text='Invented old preference';
 if(fault==='assistant-support')f.item.reconciles[0].supports=[f.quote(1,0,8)];
 if(fault==='protected-source')f.context.suppressedLineages=['human-lineage'];
 if(fault==='self-link')f.item.reconciles[0].supports=structuredClone(f.item.supports);
 if(fault==='unknown-key')f.item.reconciles[0].approved=true;
 if(fault==='duplicate-link')f.item.reconciles.push(structuredClone(f.item.reconciles[0]));
 if(fault==='too-many')f.item.reconciles=Array.from({length:5},()=>structuredClone(f.item.reconciles[0]));
 if(fault==='same-response-chain')f.body.items.push({...structuredClone(derivationFixture('profile').item),reconciles:[]});
 if(fault==='prior-model-input')f.context.priorItems=[{text:'An old model summary is not an original'}];
 assert.equal(await f.parse(),null);
});
test('profile recipe qualification is explicit and restricted to profile without changing v1/v2 terms',async()=>{
 const {parseMemoryDerivationTerms}=await import('../src/model/memory-derivation-policy.ts'),f=derivationQualificationFixture();
 f.terms.recipeVersion='memory-profile-consolidation-v1';assert.equal(parseMemoryDerivationTerms(f.terms),null);f.terms.purpose='profile';assert.ok(parseMemoryDerivationTerms(f.terms));
 const {nativeDerivationRequestBody}=await import('../worker/memory-derivation-request.ts'),request=JSON.parse(nativeDerivationRequestBody(f.terms,[],[]));
 assert.deepEqual(request.text.format.schema.properties.version.enum,['memory-profile-consolidation-v1']);assert.ok(request.text.format.schema.properties.items.items.required.includes('reconciles'));
 assert.match(request.instructions,/ORIGINAL HUMAN/);assert.equal(request.store,false);
});

const {parseMemoryFieldResult}=await import('../worker/memory-field-result.ts');
function fieldCandidateFixture(){
 const f=derivationFixture('suggestion');f.body.version='memory-field-suggestions-v1';Object.assign(f.item,{fieldIndex:0,replacement:'A green direction.',locale:'en'});
 const fields=[{blockId:'block',field:'text',revision:2,sequence:17,textHash:hashMemoryText('Original'),text:'Original',eventIds:['creation','edit']}];
 return {...f,fields,parse:()=>parseMemoryFieldResult(JSON.stringify(f.body),f.context,fields)};
}
test('background field candidate binds only a native field index, original human support and immutable target',async()=>{
 const f=fieldCandidateFixture(),result=await f.parse();assert.ok(result);assert.equal(result.items[0].fieldTarget.blockId,'block');assert.equal(result.items[0].replacement,'A green direction.');
 assert.equal(result.independentEvidence,false);assert.ok(Object.isFrozen(result.items[0].fieldTarget));assert.match(result.items[0].claimKey,/^derived:[a-f0-9]{64}$/u);
 const key=result.items[0].claimKey;f.fields[0].sequence++;assert.notEqual((await f.parse()).items[0].claimKey,key);
});
for(const fault of ['unobserved-index','duplicate-field','unchanged','oversize','invalid-unicode','unknown-locale','wrong-purpose','assistant-only','extra-authority','duplicate-json','empty-fields','bad-native-hash','native-accessor','duplicate-target'])test('background field parser rejects '+fault,async()=>{
 const f=fieldCandidateFixture();
 if(fault==='unobserved-index')f.item.fieldIndex=1;
 if(fault==='duplicate-field')f.body.items.push(structuredClone(f.item));
 if(fault==='unchanged')f.item.replacement=f.fields[0].text;
 if(fault==='oversize')f.item.replacement='🪴'.repeat(601);
 if(fault==='invalid-unicode')f.item.replacement='\ud800';
 if(fault==='unknown-locale')f.item.locale='unknown';
 if(fault==='wrong-purpose')f.context.purpose='profile';
 if(fault==='assistant-only')f.item.supports=[f.quote(1,0,12)];
 if(fault==='extra-authority')f.item.blockId='model-invented-id';
 if(fault==='empty-fields')f.fields.length=0;
 if(fault==='bad-native-hash')f.fields[0].textHash='bad';
 if(fault==='native-accessor')Object.defineProperty(f.fields[0],'text',{enumerable:true,get(){return assert.fail('Never execute input accessors');}});
 if(fault==='duplicate-target')f.fields.push(structuredClone(f.fields[0]));
 const raw=fault==='duplicate-json'?JSON.stringify(f.body).replace('"fieldIndex":0','"fieldIndex":1,"fieldIndex":0'):JSON.stringify(f.body);
 assert.equal(await parseMemoryFieldResult(raw,f.context,f.fields),null);
});
