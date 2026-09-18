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
  if(fault==='accessor')Object.defineProperty(f.context,'scopeKey',{enumerable:true,get(){assert.fail('Do not execute an accessor');}});
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
