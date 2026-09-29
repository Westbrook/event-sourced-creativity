import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssistantActions, assistantActionEvents, ASSISTANT_SUPPORTED_BLOCK_TYPES } from "../src/model/assistant-proposals.ts";
import { BLOCK_TYPES } from "../src/model/block-types.ts";

const context = {
  scope: { projectId: "project-a", documentId: "document-a" },
  decisionAtoms: [
    { id: "direction-a", type: "direction", text: "Current direction", locked: false, immutable: false },
    { id: "verified-source", type: "message", text: "Protected source", locked: false, immutable: true },
    { id: "locked-a", type: "brand", text: "Locked identity", locked: true, immutable: false },
  ],
  relationships: [],
};

test("decomposes user intent into the smallest separately approvable typed decisions", () => {
  const actions = normalizeAssistantActions("Add audience: urban gardeners; Add palette: forest green; Add audio: warm analog score; Never include fire", context);
  assert.deepEqual(actions.map((action) => action.blockType), ["audience", "palette", "audio", "exclusion"]);
  assert.equal(actions[3].intent, "prohibit");
  assert.deepEqual(ASSISTANT_SUPPORTED_BLOCK_TYPES, BLOCK_TYPES.filter((definition)=>definition.type!=="reference"&&definition.type!=="model3d").map((definition)=>definition.type));
});

test("natural conversational conjunctions and separate sentences produce independently approvable decisions", () => {
  const conversational = normalizeAssistantActions("Add an audience of urban gardeners and a forest-green palette and warm analog audio", context);
  assert.deepEqual(conversational.map((action) => action.blockType), ["audience", "palette", "audio"]);
  assert.equal(conversational.every((action) => !/gardeners.+palette|palette.+audio/iu.test(action.text)), true);
  const sentences = normalizeAssistantActions("Add palette forest green. Add audience urban gardeners. Add audio warm score.", context);
  assert.deepEqual(sentences.map((action) => action.blockType), ["palette", "audience", "audio"]);
});

test("explicit block labels take precedence over ambiguous descriptive words for every authorable kind", () => {
  for (const kind of ASSISTANT_SUPPORTED_BLOCK_TYPES.filter((item) => item !== "reference")) {
    const [action] = normalizeAssistantActions(`Add ${kind}: clear direction for a music campaign without clutter`, context);
    assert.equal(action?.blockType, kind, kind);
  }
  const collisions = [
    ["Add format: portrait", "format"],
    ["Add scale: intimate portrait", "scale"],
    ["Add composition: use negative space without clutter", "composition"],
    ["Add accessibility: captions without flashing", "accessibility"],
    ["Add brand: logo with audio signature", "brand"],
    ["Add direction: launch a music campaign", "direction"],
  ];
  for (const [message, expected] of collisions) assert.equal(normalizeAssistantActions(message, context)[0]?.blockType, expected, message);
});

test("French, Arabic, and Japanese requests classify meaningful non-Latin context decisions", () => {
  for (const [message, expected] of [
    ["أضف إضاءة ذهبية دافئة", "lighting"],
    ["أضف رسالة واضحة للعلامة", "message"],
    ["أضف كاميرا بزاوية واسعة", "camera"],
    ["照明を追加してください", "lighting"],
    ["メッセージを追加してください", "message"],
    ["カメラを追加してください", "camera"],
    ["Ajouter un éclairage chaleureux", "lighting"],
    ["Ajouter une émotion calme", "emotion"],
  ]) assert.equal(normalizeAssistantActions(message, context)[0]?.blockType, expected, message);
});

test("questions never mutate and references cannot be fabricated from a text prompt", () => {
  assert.deepEqual(normalizeAssistantActions("What is the current direction?", context), []);
  assert.deepEqual(normalizeAssistantActions("Add reference: uploaded source image", context), []);
  assert.deepEqual(normalizeAssistantActions("Add model3d: a ceramic vase", context), []);
  for (const blockType of ["reference", "model3d"]) {
    assert.deepEqual(assistantActionEvents({ kind: "context.create", blockType, text: "A ceramic vase", intent: "include" }, context,
      { blockId: "unverified-source", relationId: "relation", turnId: "turn" }), []);
  }
  assert.deepEqual(normalizeAssistantActions("Add a warm color", { ...context, scope: { projectId: "project-a", documentId: null } }), []);
});

test("verified sources and locked decisions cannot be edited or removed", () => {
  assert.deepEqual(normalizeAssistantActions("Change message verified-source", context), []);
  assert.deepEqual(normalizeAssistantActions("Remove brand locked-a", context), []);
  assert.deepEqual(assistantActionEvents({ kind: "context.edit", targetBlockId: "verified-source", text: "forged" }, context, { blockId: "new", relationId: "relation", turnId: "turn" }), []);
  assert.deepEqual(assistantActionEvents({ kind: "context.remove", targetBlockId: "locked-a" }, context, { blockId: "new", relationId: "relation", turnId: "turn" }), []);
});

test("approved audio creation never enables listening, output inclusion, or provider transfer", () => {
  const [action] = normalizeAssistantActions("Add audio: warm analog soundtrack", context);
  const [event] = assistantActionEvents(action, context, { blockId: "audio-created", relationId: "relation", turnId: "turn-a" });
  assert.equal(event.type, "BlockCreated");
  assert.equal(event.payload.type, "audio");
  assert.equal(event.payload.properties.inform_generation, false);
  assert.equal(event.payload.properties.include_in_output, false);
  assert.equal(event.payload.properties.allow_provider_audio_transfer, false);
});

test("an assistant cannot invert an exclusion into an inclusion",()=>{
  const identifiers={blockId:"protected",relationId:"relation",turnId:"turn"};
  assert.deepEqual(assistantActionEvents({kind:"context.create",blockType:"exclusion",text:"Never disclose customer information",intent:"include"},context,identifiers),[]);
  for(const intent of ["avoid","prohibit"]){
    const [accepted]=assistantActionEvents({kind:"context.create",blockType:"exclusion",text:"Never disclose customer information",intent},context,identifiers);
    assert.equal(accepted.payload.properties.intent,intent);
  }
});

test("unlocked exact wording and prohibitions remain read-only to assistant proposals and forged actions",()=>{
  const guarded={...context,decisionAtoms:[
    {id:"exact-message",type:"message",text:"Revenue  growth\nwithout alteration",locked:false,immutable:false,protected:true},
    {id:"hard-boundary",type:"exclusion",text:"Never disclose contractual pricing",locked:false,immutable:false,protected:true,intent:"prohibit"},
  ]};
  const identifiers={blockId:"new",relationId:"relation",turnId:"turn"};
  assert.deepEqual(normalizeAssistantActions("Change the message to a weaker promise",guarded),[]);
  assert.deepEqual(normalizeAssistantActions("Remove exclusion",guarded),[]);
  assert.deepEqual(assistantActionEvents({kind:"context.edit",targetBlockId:"exact-message",text:"Compromised wording"},guarded,identifiers),[]);
  assert.deepEqual(assistantActionEvents({kind:"context.remove",targetBlockId:"hard-boundary"},guarded,identifiers),[]);
  assert.deepEqual(assistantActionEvents({kind:"context.relation.add",fromBlockId:"exact-message",toBlockId:"hard-boundary",relationKind:"context_contains"},guarded,identifiers),[]);
});

test("relationships use exact editable endpoints and remove only an existing server-owned edge", () => {
  const editable = { ...context, decisionAtoms: [...context.decisionAtoms, { id: "palette-a", type: "palette", text: "Ocean cobalt", locked: false, immutable: false }] };
  const [added] = normalizeAssistantActions("Connect direction-a to palette-a", editable);
  assert.equal(added.kind, "context.relation.add");
  const [addition] = assistantActionEvents(added, editable, { blockId: "new", relationId: "server-edge", turnId: "turn" });
  assert.equal(addition.payload.relation_id, "server-edge");
  const connected = { ...editable, relationships: [{ id: "existing-edge", from: "direction-a", to: "palette-a", kind: "context_contains" }] };
  const [removed] = normalizeAssistantActions("Disconnect direction-a from palette-a", connected);
  const [removal] = assistantActionEvents(removed, connected, { blockId: "new", relationId: "fabricated-edge", turnId: "turn" });
  assert.equal(removal.payload.relation_id, "existing-edge");
  assert.deepEqual(normalizeAssistantActions("Connect direction-a to locked-a", editable), []);
});

test("relationship proposals reject unsupported edge kinds and cycles in the known context graph", () => {
  const graph = {
    ...context,
    decisionAtoms: [
      { id: "a", type: "direction", text: "First decision", locked: false, immutable: false },
      { id: "b", type: "palette", text: "Second decision", locked: false, immutable: false },
      { id: "c", type: "emotion", text: "Third decision", locked: false, immutable: false },
    ],
    relationships: [{ id: "ab", from: "a", to: "b", kind: "context_contains" }, { id: "bc", from: "b", to: "c", kind: "context_contains" }],
  };
  assert.deepEqual(assistantActionEvents({ kind: "context.relation.add", fromBlockId: "c", toBlockId: "a", relationKind: "context_contains" }, graph,
    { blockId: "block", relationId: "ca", turnId: "turn" }), []);
  assert.deepEqual(assistantActionEvents({ kind: "context.relation.add", fromBlockId: "a", toBlockId: "c", relationKind: "invented_unrestricted_edge" }, graph,
    { blockId: "block", relationId: "ac", turnId: "turn" }), []);
});

// Same action model, separate read-only Memory consumer: no authored event.
const {memoryAssistantEditReview}=await import('../worker/memory-assistant-edits.ts');
const {parseMemoryEditReview}=await import('../src/model/memory-edit-review.ts');
const memoryEditTarget={executionId:'execution-a',turnId:'turn-a',projectId:'project-a',documentId:'document-a',sourceHash:'a'.repeat(64),locale:'en'};
const memoryEditContext={...context,decisionAtoms:[{...context.decisionAtoms[0],version:4,intent:'include',providerEligible:true,providerVisibility:'editable'}]};
const memoryEditResult={actions:[{kind:'context.edit',target_block_id:'direction-a',text:'Suggested <script>literal</script> 🌱'}]};
test('Memory edit review binds a historical field excerpt and never creates an action capability',()=>{
 const review=memoryAssistantEditReview(memoryEditResult,memoryEditContext,memoryEditTarget);
 assert.deepEqual(review,{version:'memory-edit-review-v1',...memoryEditTarget,mode:'review-only',independentEvidence:false,
  edits:[{blockId:'direction-a',field:'text',revision:4,beforeExcerpt:'Current direction',suggestedText:memoryEditResult.actions[0].text}]});
 assert.deepEqual(parseMemoryEditReview(review,memoryEditTarget),review);
 const copy=parseMemoryEditReview(review,memoryEditTarget);copy.edits[0].suggestedText='changed';assert.notEqual(review.edits[0].suggestedText,'changed');
});
for(const fault of ['locked','immutable','protected','ineligible','restricted','prohibit','reference','revision','duplicate-target','duplicate-action','no-op','other-scope'])test('Memory edit review rejects '+fault,()=>{
 const c=structuredClone(memoryEditContext),r=structuredClone(memoryEditResult),block=c.decisionAtoms[0];
 if(['locked','immutable','protected'].includes(fault))block[fault]=true;
 if(fault==='ineligible')block.providerEligible=false;
 if(fault==='restricted')block.providerVisibility='restricted';
 if(fault==='prohibit')block.intent='prohibit';
 if(fault==='reference')block.type='reference';
 if(fault==='revision')block.version=0;
 if(fault==='duplicate-target')c.decisionAtoms.push({...block});
 if(fault==='duplicate-action')r.actions.push({...r.actions[0],text:'Conflicting suggestion'});
 if(fault==='no-op')r.actions[0].text=block.text;
 if(fault==='other-scope')c.scope={...c.scope,documentId:'other'};
 assert.equal(memoryAssistantEditReview(r,c,memoryEditTarget),null);
});
for(const fault of ['documentId','projectId','sourceHash','locale','executionId','turnId','field','mode','independence','extra','duplicate','oversized','accessor','array-accessor','hidden'])test('Memory edit review decoder denies '+fault,()=>{
 const r=memoryAssistantEditReview(memoryEditResult,memoryEditContext,memoryEditTarget);
 if(Object.hasOwn(memoryEditTarget,fault))r[fault]='other';
 if(fault==='field')r.edits[0].field='rights';
 if(fault==='mode')r.mode='apply';
 if(fault==='independence')r.independentEvidence=true;
 if(fault==='extra')r.action='accept';
 if(fault==='duplicate')r.edits.push({...r.edits[0]});
 if(fault==='oversized')r.edits[0].suggestedText='x'.repeat(601);
 if(fault==='accessor')Object.defineProperty(r,'locale',{enumerable:true,get(){return assert.fail('getter must not execute');}});
 if(fault==='array-accessor')Object.defineProperty(r.edits,'0',{enumerable:true,get(){return assert.fail('getter must not execute');}});
 if(fault==='hidden')Object.defineProperty(r,'execute',{value:true});
 assert.equal(parseMemoryEditReview(r,memoryEditTarget),null);
});

const {memoryAssistantCreationReview}=await import('../worker/memory-assistant-edits.ts');
const {parseMemoryCreationReview,memoryCreationApprovalHash}=await import('../src/model/memory-creation-review.ts');
const memoryCreationResult={actions:[{kind:'context.create',block_type:'direction',target_block_id:null,from_block_id:null,to_block_id:null,relation_kind:'',intent:'include',text:'A quiet moonlit garden <script>literal</script>'}]};
test('Memory creation preview preserves exact private text and separately hashes explicit authorship',async()=>{
 const review=memoryAssistantCreationReview(memoryCreationResult,memoryEditContext,memoryEditTarget);
 assert.equal(review.creations[0].text,memoryCreationResult.actions[0].text);
 assert.deepEqual(parseMemoryCreationReview(review,memoryEditTarget),review);
 const copy=parseMemoryCreationReview(review,memoryEditTarget);copy.creations[0].text='Other';
 assert.notEqual(await memoryCreationApprovalHash(review,'create-0'),await memoryCreationApprovalHash(copy,'create-0'));
 assert.equal(await memoryCreationApprovalHash(review,'create-1'),null);
 assert.equal(memoryAssistantCreationReview(memoryCreationResult,memoryEditContext,memoryEditTarget,'direction-a'),null);
 for(const block_type of ['reference','model3d','audio','brand','exclusion','accessibility'])assert.equal(memoryAssistantCreationReview({actions:[{...memoryCreationResult.actions[0],block_type}]},memoryEditContext,memoryEditTarget),null);
});
for(const fault of ['documentId','locale','sourceHash','executionId','extra','independence','duplicate','oversized','sparse','getter','array-getter','media','target','intent','malformed-unicode'])test('Memory creation preview rejects '+fault,()=>{
 const r=memoryAssistantCreationReview(memoryCreationResult,memoryEditContext,memoryEditTarget);
 if(Object.hasOwn(memoryEditTarget,fault))r[fault]='other';
 if(fault==='extra')r.generate=true;
 if(fault==='independence')r.independentEvidence=true;
 if(fault==='duplicate')r.creations.push({...r.creations[0]});
 if(fault==='oversized')r.creations[0].text='x'.repeat(601);
 if(fault==='sparse')r.creations.length=2;
 if(fault==='getter')Object.defineProperty(r.creations[0],'text',{enumerable:true,get(){return assert.fail('must not read getters');}});
 if(fault==='array-getter')Object.defineProperty(r.creations,'0',{enumerable:true,get(){return assert.fail('must not read getters');}});
 if(fault==='media')r.creations[0].blockType='reference';
 if(fault==='target')r.creations[0].blockId='injected';
 if(fault==='intent')r.creations[0].intent='prohibit';
 if(fault==='malformed-unicode')r.creations[0].text=String.fromCharCode(0xd800);
 assert.equal(parseMemoryCreationReview(r,memoryEditTarget),null);
});

test('Memory Output creation uses a versioned explicit unconfirmed-requirement approval',async()=>{
 const action={...memoryCreationResult.actions[0],block_type:'output',text:'Output images: one image.'};
 const review=memoryAssistantCreationReview({actions:[action]},memoryEditContext,memoryEditTarget);
 assert.equal(review.version,'memory-creation-review-v2');assert.equal(review.creations[0].blockType,'output');
 assert.deepEqual(parseMemoryCreationReview(review,memoryEditTarget),review);assert.match(await memoryCreationApprovalHash(review,'create-0'),/^[a-f0-9]{64}$/);
 assert.equal(parseMemoryCreationReview({...review,version:'memory-creation-review-v1'},memoryEditTarget),null);
 assert.equal(memoryAssistantCreationReview({actions:[{...action,intent:'avoid'}]},memoryEditContext,memoryEditTarget),null);
 assert.equal(memoryAssistantCreationReview({actions:[{...action,intent:'prohibit'}]},memoryEditContext,memoryEditTarget),null);
 const changed=structuredClone(review);changed.creations[0].text+=' Another image.';assert.notEqual(await memoryCreationApprovalHash(review,'create-0'),await memoryCreationApprovalHash(changed,'create-0'));
 const regular=memoryAssistantCreationReview(memoryCreationResult,memoryEditContext,memoryEditTarget);
 assert.notEqual(await memoryCreationApprovalHash(regular,'create-0'),await memoryCreationApprovalHash({...regular,version:'memory-creation-review-v2'},'create-0'));
 assert.equal(memoryAssistantCreationReview({actions:[action]},memoryEditContext,memoryEditTarget,'direction-a'),null);
});

const {memoryOutputCreation}=await import('../src/model/memory-creation-review.ts');
const {normalizeOutputRequirementCreation}=await import('../src/model/output-requirement-creation.ts');
const {blockTypeDefinition}=await import('../src/model/block-types.ts');
function nativeMemoryOutputPayload(){return normalizeOutputRequirementCreation({block_id:'memory-output-a',type:'output',source_chat_turn_id:'turn-a',properties:{text:'Output images: one image.',subtype:blockTypeDefinition('output').subtypes[0],authority:'authored',created_from:'assistant',source_chat_turn_id:'turn-a',intent:'include',weight:.7}});}
test('Memory Output native operation accepts only the exact unconfirmed prose interpretation',()=>{assert.equal(memoryOutputCreation(nativeMemoryOutputPayload()),true);});
for(const fault of ['type','weight','intent','status','spec','source','identity','text','settings','getter'])test('Memory Output native operation refuses '+fault,()=>{
 const value=nativeMemoryOutputPayload();
 if(fault==='type')value.type='direction';if(fault==='weight')value.properties.weight=1;if(fault==='intent')value.properties.intent='include';
 if(fault==='status')value.properties.output_confirmed=true;if(fault==='spec')value.properties.output_spec.deliverables[0].quantity.value=99;
 if(fault==='source')value.source_chat_turn_id='different';if(fault==='identity')value.properties.output_spec.id='different';if(fault==='text')value.properties.text='Different exact wording';
 if(fault==='settings')value.properties.provider='openai';if(fault==='getter')Object.defineProperty(value.properties,'text',{get(){throw Error('not data');},enumerable:true});
 assert.equal(memoryOutputCreation(value),false);
});

const {buildMemoryProfileSynthesis,parseMemoryProfileSynthesis,parseProfileSynthesisProposals}=await import('../src/model/memory-profile-synthesis.ts');
const synthesisSources=()=>[{alias:'profile_1',ownerId:'actor',projectId:'p',documentId:'a',zoom:'document',weight:1,category:'preference-hypothesis',text:'Quiet scenes',originalIds:['original-a','original-b'],quotes:['I prefer quiet scenes.']},{alias:'profile_2',ownerId:'actor',projectId:'p',documentId:'b',zoom:'project',weight:.7,category:'preference-hypothesis',text:'Low-key scenes',originalIds:['original-c'],quotes:['Keep this scene low-key.']}];
const synthesisProposal=()=>[{category:'preference-hypothesis',text:'A tentative preference for restrained scenes.',references:['profile_1','profile_2']}];
test('cross-scope profile synthesis uses distinct originals and least-local relevance, not model counts',()=>{
 const sources=synthesisSources(),view=buildMemoryProfileSynthesis(synthesisProposal(),sources,memoryEditTarget);
 assert.equal(view.items[0].originalCount,3);assert.equal(view.items[0].weight,.7);assert.equal(view.items[0].zoom,'project');assert.equal(view.independentEvidence,false);
 assert.equal(view.items[0].sources[0].quotes[0],sources[0].quotes[0]);sources[0].quotes[0]='changed';assert.notEqual(view.items[0].sources[0].quotes[0],'changed');
 const copy=parseMemoryProfileSynthesis(view,memoryEditTarget);copy.items[0].text='changed';assert.notEqual(view.items[0].text,'changed');
 for(const [zoom,weight]of [['project-tree',.25],['organization',.0125],['partition',.01]]){const broad=synthesisSources();broad[1].zoom=zoom;broad[1].weight=weight;broad[1].projectId='other-project';assert.equal(buildMemoryProfileSynthesis(synthesisProposal(),broad,memoryEditTarget).items[0].weight,weight);}
});
for(const fault of ['unknown','duplicate','repeated-group','same-document','copied-original','insufficient','category','weight','extra','getter','sparse','target','authority'])test('cross-scope profile synthesis rejects '+fault,()=>{
 const sources=synthesisSources(),proposal=synthesisProposal();
 if(fault==='unknown')proposal[0].references[1]='profile_99';if(fault==='duplicate')proposal[0].references[1]='profile_1';if(fault==='repeated-group')proposal.push({...proposal[0]});
 if(fault==='same-document')sources[1].documentId='a';if(fault==='copied-original')sources[1].originalIds=['original-a'];if(fault==='insufficient')sources[0].originalIds=['original-a'];
 if(fault==='category')sources[1].category='workflow-hypothesis';if(fault==='weight')sources[1].weight=NaN;if(fault==='extra')proposal[0].confidence=1;
 if(fault==='getter')Object.defineProperty(proposal[0],'text',{enumerable:true,get(){return assert.fail('never invoke an accessor');}});if(fault==='sparse')delete proposal[0].references[0];
 if(fault==='target'||fault==='authority'){const view=buildMemoryProfileSynthesis(proposal,sources,memoryEditTarget);if(fault==='target')view.documentId='other';else view.independentEvidence=true;assert.equal(parseMemoryProfileSynthesis(view,memoryEditTarget),null);return;}
 assert.equal(buildMemoryProfileSynthesis(proposal,sources,memoryEditTarget),null);
});
test('cross-scope profile synthesis empty proposals do not manufacture a preference',()=>{assert.deepEqual(parseProfileSynthesisProposals([]),[]);assert.equal(buildMemoryProfileSynthesis([],synthesisSources(),memoryEditTarget),null);});
