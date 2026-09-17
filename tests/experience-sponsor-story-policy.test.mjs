import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';
const imports=registerOutputSourceImports();
const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');let egress=0;
globalThis.fetch=()=>{egress++;throw Error('No network in story policy contract qualification');};
after(()=>{Object.defineProperty(globalThis,'fetch',fetchDescriptor);imports.deregister();assert.equal(egress,0);});
const [{readSponsorPolicy,compileSponsorEnvelope,DEFAULT_SPONSOR_POLICY},
  {compileSponsorApprovalProposal,sponsorApprovalAssertion,sponsorIssuedAuthorityAssertion},
  {canonicalJson,digest},{registeredExperience},{SHORT_STORY_NARRATIVE_CONTRACT},{OUTPUT_NATIVE_EXECUTION_POLICY},
  {OPENAI_TEXT_PRICING_VERSION,estimateOpenAITextCallMaximumMicrousd},{preflightOutputNarrativeTarget}]=await Promise.all([
  import('../worker/experience-sponsor-policy.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../src/experiences/compiler.ts'),import('../src/experiences/intake.ts'),import('../src/model/output-narrative-contract.ts'),
  import('../src/model/output-execution-policy.ts'),import('../worker/openai-text-cost.ts'),import('../worker/output-narrative-preflight.ts'),
]);

// Pure contracts from a real native preflight with synthetic text. No database,
// campaign approval, financial reservation, provider or storage is invoked.
const h=digit=>`sha256:${digit.repeat(64)}`,now=1_000_000;
const release=await registeredExperience('short-story');assert.ok(release);
const offered=await preflightOutputNarrativeTarget({env:{OPENAI_API_KEY:'synthetic-no-egress'},context:{snapshot:{facts:[{type:'subject',properties:{text:'Mira returns a lost clock.'}}]}},
  target:{id:'story-target',selected:true,blocking_issues:[],media_kind:'document',quantity:{kind:'exact',unit:'document',value:1},source_scope:{kind:'document'},coverage:{kind:'document_context'},narrative_contract:SHORT_STORY_NARRATIVE_CONTRACT,instruction_text:'One complete fictional story'}});
assert.equal(offered.available,true);
const recipe={appId:'short-story',recipeVersion:`short-story@${release.definition.revision}`,releaseDigest:release.releaseHash,outputKind:'short_story',provider:offered.provider,model:offered.model,
  routeDigest:await digest(offered),settingsDigest:await digest(offered.settings),outputCount:1,durationMs:0,width:0,height:0,calls:{parsing:0,planning:1,render:0,repair:0},maximumTokens:offered.maximumTokens,maximumMicrousd:offered.maximumMicrousd};
const template={version:1,family:'canonical-short-story@1',appId:'short-story',recipeVersion:recipe.recipeVersion,releaseDigest:recipe.releaseDigest,outputKind:'short_story',inputMode:'authorized-document-text',
  outputCount:1,durationMs:0,width:0,height:0,route:'document-short-story-manual-v1',maximumCalls:1,maximumTokens:128000,maximumInputTokens:122000,maximumOutputTokens:6000,
  maximumMicrousd:Math.max(1_000_000,estimateOpenAITextCallMaximumMicrousd('gpt-5.6-terra',122000,6000)),call:{stage:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra'},
  narrativeContract:SHORT_STORY_NARRATIVE_CONTRACT,pricingVersion:OPENAI_TEXT_PRICING_VERSION,cachePolicy:'disabled-explicit',reasoningEffort:'low',executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY};
const allowance={maximumOperations:20,maximumTextBytes:100_000,maximumOperationsPerWindow:10,maximumTextBytesPerWindow:50_000,maximumPendingGrants:2,maximumInflightJobs:1};
const policy={version:4,family:'canonical-short-story@1',mode:'candidate',campaignId:'story-campaign',policyVersion:'story-policy@1',payerUserId:'payer',audience:'canonical-principal',approvalReceiptDigest:h('4'),
  startsAtMs:now-1000,expiresAtMs:now+100_000,maximumGrantLifetimeMs:60_000,maximumAdmissions:10,maximumMicrousd:template.maximumMicrousd*10,maximumAdmissionsPerActor:5,
  windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[template],resources:{version:1,startsAtMs:now-500,expiresAtMs:now+80_000,windowMs:60_000,maximumOperationTextBytes:10_000,campaign:allowance,actor:allowance}};
const envelope={version:4,family:'canonical-short-story@1',campaignId:policy.campaignId,policyVersion:policy.policyVersion,consumptionId:'story-consumption',intentKey:'story-intent',actorKind:'canonical-principal',
  actorUserId:'actor',sessionDigest:h('5'),payerUserId:'payer',ownerUserId:'actor',projectId:'project',documentId:'document',sourceRevision:7,sourceDigest:h('6'),orderedAssetDigests:[],rightsDigest:h('7'),
  compiledInputDigest:h('8'),transferEnvelopeDigest:h('9'),recipe,issuedAtMs:now,expiresAtMs:now+30_000,templateDigest:await digest(template)};
const proposal=()=>{const {approvalReceiptDigest:ignored,...terms}=structuredClone(policy);void ignored;return{policy:terms,eligibleActorUserIds:['actor'],issuerUserIds:['actor']};};

test('V4 preserves exact native one-planning-call actuals under its independently bounded template',async()=>{
  const compiled=await compileSponsorEnvelope(policy,envelope);
  assert.equal(compiled.policy.version,4);assert.equal(compiled.policy.resources.version,1);
  assert.deepEqual(compiled.envelope.recipe.calls,{parsing:0,planning:1,render:0,repair:0});
  assert.equal(Object.values(compiled.envelope.recipe.calls).reduce((a,b)=>a+b,0),1);
  assert.equal(compiled.envelope.recipe.maximumMicrousd,offered.maximumMicrousd);
  assert.equal(compiled.envelope.recipe.routeDigest,await digest(offered));
  assert.equal(compiled.envelope.recipe.settingsDigest,await digest(offered.settings));
  assert.ok(compiled.envelope.recipe.maximumMicrousd<=compiled.policy.templates[0].maximumMicrousd);
  assert.equal(compiled.policyJson,canonicalJson(policy));assert.equal(compiled.envelopeJson,canonicalJson(envelope));
  assert.equal(compiled.policyDigest,await digest(policy));assert.equal(compiled.envelopeDigest,await digest(envelope));
  assert.ok(Object.isFrozen(compiled.policy.resources.actor));assert.ok(Object.isFrozen(compiled.envelope.recipe.calls));
  assert.strictEqual(readSponsorPolicy(),DEFAULT_SPONSOR_POLICY);
});

const policyChanges={
  'guest policy version':p=>p.version=3,
  'wrong family':p=>p.family='guest-short-story@1',
  'missing family':p=>delete p.family,
  'guest audience':p=>p.audience='guest',
  'Image template':p=>p.templates[0].appId='image',
  'another template':p=>p.templates.push(structuredClone(p.templates[0])),
  'no template':p=>p.templates=[],
  'additional root key':p=>p.allowAnyOutput=true,
  'missing approval':p=>delete p.approvalReceiptDigest,
  'invalid payer':p=>p.payerUserId='',
  'zero admissions':p=>p.maximumAdmissions=0,
  'fractional admissions':p=>p.maximumAdmissions=1.5,
  'excess admissions':p=>p.maximumAdmissions=100_001,
  'actor exceeds campaign':p=>p.maximumAdmissionsPerActor=11,
  'window exceeds campaign':p=>p.maximumAdmissionsPerWindow=11,
  'actor window exceeds actor':p=>p.maximumAdmissionsPerActorWindow=6,
  'negative time':p=>p.startsAtMs=-1,
  'zero lifetime':p=>p.expiresAtMs=p.startsAtMs,
  'oversized grant lifetime':p=>p.maximumGrantLifetimeMs=900_001,
  'zero window':p=>p.windowMs=0,
  'oversized window':p=>p.windowMs=86_400_001,
  'zero campaign money':p=>p.maximumMicrousd=0,
  'unsafe campaign money':p=>p.maximumMicrousd=Number.MAX_SAFE_INTEGER,
  'template exceeds campaign money':p=>p.maximumMicrousd=template.maximumMicrousd-1,
  'resources start before campaign':p=>p.resources.startsAtMs=p.startsAtMs-1,
  'resources expire after campaign':p=>p.resources.expiresAtMs=p.expiresAtMs+1,
  'Image draft resource permission':p=>{p.resources.version=2;p.resources.allowedOperations=['text-intake','preflight','issuance','image-text-draft-storage'];},
};
for(const [name,change] of Object.entries(policyChanges))test(`V4 policy refuses ${name}`,()=>{const changed=structuredClone(policy);change(changed);assert.throws(()=>readSponsorPolicy(changed));});

const envelopeChanges={
  'guest version':e=>e.version=3,
  'wrong family':e=>e.family='canonical-image@1',
  'guest actor':e=>e.actorKind='guest',
  'missing template digest':e=>delete e.templateDigest,
  'wrong template digest':e=>e.templateDigest=h('a'),
  'wrong campaign':e=>e.campaignId='another-campaign',
  'wrong policy revision':e=>e.policyVersion='another-policy',
  'wrong payer':e=>e.payerUserId='another-payer',
  'actor is payer':e=>{e.actorUserId='payer';e.ownerUserId='payer';},
  'foreign custody':e=>e.ownerUserId='another-owner',
  'reference asset expansion':e=>e.orderedAssetDigests=[h('b')],
  'negative revision':e=>e.sourceRevision=-1,
  'unhashed source':e=>e.sourceDigest='source',
  'render fiction':e=>e.recipe.calls.render=1,
  'repair expansion':e=>e.recipe.calls.repair=1,
  'second planning call':e=>e.recipe.calls.planning=2,
  'Image recipe':e=>e.recipe.outputKind='image',
  'changed model':e=>e.recipe.model='gpt-5.6-sol',
  'changed release':e=>e.recipe.releaseDigest=h('c'),
  'cost above reviewed cap':e=>e.recipe.maximumMicrousd=template.maximumMicrousd+1,
  'token expansion':e=>e.recipe.maximumTokens=128001,
  'issued before resources':e=>e.issuedAtMs=policy.resources.startsAtMs-1,
  'zero grant lifetime':e=>e.expiresAtMs=e.issuedAtMs,
  'grant exceeds lifetime':e=>e.expiresAtMs=e.issuedAtMs+policy.maximumGrantLifetimeMs+1,
  'grant exceeds resources':e=>{e.issuedAtMs=now+50_000;e.expiresAtMs=policy.resources.expiresAtMs+1;},
  'additional permission':e=>e.allowRepair=true,
};
for(const [name,change] of Object.entries(envelopeChanges))test(`V4 envelope refuses ${name}`,async()=>{const changed=structuredClone(envelope);change(changed);await assert.rejects(compileSponsorEnvelope(policy,changed));});

test('V4 approval and issuance assertions bind the exact reviewed terms and resource digest',async()=>{
  const input=proposal(),compiled=await compileSponsorApprovalProposal(input);
  assert.equal(compiled.policy.version,4);assert.equal(compiled.policy.approvalReceiptDigest,compiled.termsDigest);
  assert.equal(compiled.termsJson,canonicalJson(input));assert.equal(compiled.termsDigest,await digest(input));
  const assertion=sponsorApprovalAssertion(compiled.policy,'actor',true);
  assert.deepEqual(assertion.bindings.slice(0,6),[policy.campaignId,'payer',compiled.termsDigest,compiled.policyJson,'actor','actor']);
  const issuance=await sponsorIssuedAuthorityAssertion({policy:compiled.policy,policyDigest:compiled.policyDigest,grantId:'issued-story',actorUserId:'actor',sessionDigest:envelope.sessionDigest,intentKey:envelope.intentKey,envelopeDigest:await digest(envelope)});
  assert.equal(issuance.bindings.at(-1),await digest(compiled.policy.resources));
});

test('approval rejects raw approval digests, guest versions and ineligible payer or issuer lists',async()=>{
  for(const mutate of [p=>p.policy.version=3,p=>p.policy.approvalReceiptDigest=h('a'),p=>p.eligibleActorUserIds.push('payer'),p=>p.issuerUserIds=['other'],p=>p.eligibleActorUserIds.push('actor'),p=>p.issuerUserIds=[]]){
    const input=proposal();mutate(input);await assert.rejects(compileSponsorApprovalProposal(input));
  }
});

test('caller mutation during hashing and accessor properties cannot alter approved captured contracts',async()=>{
  const p=structuredClone(policy),e=structuredClone(envelope),pending=compileSponsorEnvelope(p,e);
  p.family='guest';p.resources.maximumOperationTextBytes=1;e.recipe.calls.render=1;e.ownerUserId='other';
  const compiled=await pending;assert.equal(compiled.policyJson,canonicalJson(policy));assert.equal(compiled.envelopeJson,canonicalJson(envelope));
  const input=proposal(),before=structuredClone(input),approval=compileSponsorApprovalProposal(input);
  input.policy.payerUserId='other';input.eligibleActorUserIds.push('other');
  assert.equal((await approval).termsJson,canonicalJson(before));
  let accessed=0;const getter={...policy};Object.defineProperty(getter,'family',{enumerable:true,get(){accessed++;return policy.family;}});
  assert.throws(()=>readSponsorPolicy(getter));assert.equal(accessed,0);
});

// Fixed outputs generated in a separate process from the original policy and
// approval modules at 9fb1f8b. These expected bytes/digests never call new APIs.
const imageBaseline = {
  "sourceCommit": "9fb1f8bc2921c17ac0cab76977d7351b394f6ae3",
  "compiled": [
    {
      "policyJson": "{\"approvalReceiptDigest\":\"sha256:4444444444444444444444444444444444444444444444444444444444444444\",\"audience\":\"canonical-principal\",\"campaignId\":\"image-campaign\",\"expiresAtMs\":1100000,\"maximumAdmissions\":10,\"maximumAdmissionsPerActor\":5,\"maximumAdmissionsPerActorWindow\":5,\"maximumAdmissionsPerWindow\":10,\"maximumGrantLifetimeMs\":60000,\"maximumMicrousd\":1000,\"mode\":\"candidate\",\"payerUserId\":\"payer\",\"policyVersion\":\"image-policy@1\",\"recipes\":[{\"appId\":\"image\",\"calls\":{\"parsing\":0,\"planning\":1,\"render\":1,\"repair\":0},\"durationMs\":0,\"height\":1024,\"maximumMicrousd\":100,\"maximumTokens\":1000,\"model\":\"fixture-model\",\"outputCount\":1,\"outputKind\":\"image\",\"provider\":\"fixture-provider\",\"recipeVersion\":\"recipe@1\",\"releaseDigest\":\"sha256:1111111111111111111111111111111111111111111111111111111111111111\",\"routeDigest\":\"sha256:2222222222222222222222222222222222222222222222222222222222222222\",\"settingsDigest\":\"sha256:3333333333333333333333333333333333333333333333333333333333333333\",\"width\":1024}],\"startsAtMs\":999000,\"version\":1,\"windowMs\":60000}",
      "envelopeJson": "{\"actorKind\":\"canonical-principal\",\"actorUserId\":\"actor\",\"campaignId\":\"image-campaign\",\"compiledInputDigest\":\"sha256:9999999999999999999999999999999999999999999999999999999999999999\",\"consumptionId\":\"image-consumption\",\"documentId\":\"document\",\"expiresAtMs\":1030000,\"intentKey\":\"image-intent\",\"issuedAtMs\":1000000,\"orderedAssetDigests\":[\"sha256:7777777777777777777777777777777777777777777777777777777777777777\"],\"ownerUserId\":\"actor\",\"payerUserId\":\"payer\",\"policyVersion\":\"image-policy@1\",\"projectId\":\"project\",\"recipe\":{\"appId\":\"image\",\"calls\":{\"parsing\":0,\"planning\":1,\"render\":1,\"repair\":0},\"durationMs\":0,\"height\":1024,\"maximumMicrousd\":100,\"maximumTokens\":1000,\"model\":\"fixture-model\",\"outputCount\":1,\"outputKind\":\"image\",\"provider\":\"fixture-provider\",\"recipeVersion\":\"recipe@1\",\"releaseDigest\":\"sha256:1111111111111111111111111111111111111111111111111111111111111111\",\"routeDigest\":\"sha256:2222222222222222222222222222222222222222222222222222222222222222\",\"settingsDigest\":\"sha256:3333333333333333333333333333333333333333333333333333333333333333\",\"width\":1024},\"rightsDigest\":\"sha256:8888888888888888888888888888888888888888888888888888888888888888\",\"sessionDigest\":\"sha256:5555555555555555555555555555555555555555555555555555555555555555\",\"sourceDigest\":\"sha256:6666666666666666666666666666666666666666666666666666666666666666\",\"sourceRevision\":7,\"transferEnvelopeDigest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"version\":1}",
      "policyDigest": "sha256:b4e58b89f621cc5c626b27be370b8c4fd024805c14d22c3662e7074d3343fc89",
      "envelopeDigest": "sha256:7e60ec8ba615ba73ccfc329d3fc419df3fa27c2905296a7ea65ff2de70482a75"
    },
    {
      "policyJson": "{\"approvalReceiptDigest\":\"sha256:4444444444444444444444444444444444444444444444444444444444444444\",\"audience\":\"canonical-principal\",\"campaignId\":\"image-campaign\",\"expiresAtMs\":1100000,\"maximumAdmissions\":10,\"maximumAdmissionsPerActor\":5,\"maximumAdmissionsPerActorWindow\":5,\"maximumAdmissionsPerWindow\":10,\"maximumGrantLifetimeMs\":60000,\"maximumMicrousd\":10000000,\"mode\":\"candidate\",\"payerUserId\":\"payer\",\"policyVersion\":\"image-policy@1\",\"resources\":{\"actor\":{\"maximumInflightJobs\":1,\"maximumOperations\":20,\"maximumOperationsPerWindow\":10,\"maximumPendingGrants\":2,\"maximumTextBytes\":100000,\"maximumTextBytesPerWindow\":50000},\"campaign\":{\"maximumInflightJobs\":1,\"maximumOperations\":20,\"maximumOperationsPerWindow\":10,\"maximumPendingGrants\":2,\"maximumTextBytes\":100000,\"maximumTextBytesPerWindow\":50000},\"expiresAtMs\":1080000,\"maximumOperationTextBytes\":10000,\"startsAtMs\":999500,\"version\":1,\"windowMs\":60000},\"startsAtMs\":999000,\"templates\":[{\"appId\":\"image\",\"calls\":[{\"maximumMicrousd\":100000,\"model\":\"gpt-5.6-terra\",\"provider\":\"openai\",\"stage\":\"planning:initial\"},{\"maximumMicrousd\":900000,\"model\":\"gpt-image-2\",\"provider\":\"openai\",\"stage\":\"image:initial\"}],\"durationMs\":0,\"height\":1024,\"inputMode\":\"text-only\",\"maximumCalls\":2,\"maximumMicrousd\":1000000,\"maximumTokens\":128000,\"outputCount\":1,\"outputKind\":\"image\",\"recipeVersion\":\"image@2\",\"releaseDigest\":\"sha256:72c2627350f6928135d3f0dcb0d1d118bb391a8820b943364103eb485607d16f\",\"route\":\"document-image-manual-v1\",\"settings\":{\"budgetAcknowledged\":true,\"executionPolicy\":{\"heartbeatMilliseconds\":60000,\"maximumMilliseconds\":240000,\"maximumRenewals\":3},\"imageBudget\":{\"allowanceCode\":\"output_native_image_allowance_verified\",\"allowanceDescription\":\"UTF-8 prompt bytes plus protocol headroom, and twice the documented output-token estimate for this exact high-quality frame. Provider receipts determine actual charges; no additional request is allowed after an overrun or uncertain response.\",\"estimatedOutputTokens\":7024,\"maximumInputTokens\":36096,\"maximumMicrousd\":601920,\"maximumOutputTokens\":14048,\"maximumPromptBytes\":32000,\"maximumReferenceImages\":0,\"quality\":\"high\",\"version\":\"gpt-image-2-doc-calculator-2026-08-27\"},\"imageRender\":{\"format\":{\"aspect_ratio\":{\"height\":1,\"width\":1},\"dimensions\":{\"height\":1024,\"unit\":\"px\",\"width\":1024},\"schema_version\":1},\"size\":\"1024x1024\"},\"kind\":\"generate\",\"preflightAcknowledged\":true,\"productionMode\":\"manual\"},\"transport\":{\"image\":{\"adapterId\":\"openai-image\",\"adapterVersion\":\"v5\",\"api\":\"https://api.openai.com/v1/images/generations\",\"outputCount\":1,\"outputFormat\":\"png\",\"partialImages\":0,\"quality\":\"high\"},\"planning\":{\"api\":\"https://api.openai.com/v1/responses\",\"format\":{\"name\":\"forma_creative_direction\",\"schemaDigest\":\"sha256:d847c85755559fbe899d448a88e3a18067564990c7f2228b62f32c96bd00805d\",\"strict\":true,\"type\":\"json_schema\"},\"maximumOutputTokens\":1200,\"reasoningEffort\":\"low\",\"store\":false,\"verbosity\":\"low\"},\"safety\":{\"api\":\"https://api.openai.com/v1/moderations\",\"input\":\"text\",\"maximumCalls\":1,\"model\":\"omni-moderation-latest\",\"provider\":\"openai\"}},\"version\":2,\"width\":1024}],\"version\":2,\"windowMs\":60000}",
      "envelopeJson": "{\"actorKind\":\"canonical-principal\",\"actorUserId\":\"actor\",\"campaignId\":\"image-campaign\",\"compiledInputDigest\":\"sha256:9999999999999999999999999999999999999999999999999999999999999999\",\"consumptionId\":\"image-consumption\",\"documentId\":\"document\",\"expiresAtMs\":1030000,\"intentKey\":\"image-intent\",\"issuedAtMs\":1000000,\"orderedAssetDigests\":[],\"ownerUserId\":\"actor\",\"payerUserId\":\"payer\",\"policyVersion\":\"image-policy@1\",\"projectId\":\"project\",\"recipe\":{\"appId\":\"image\",\"calls\":{\"parsing\":0,\"planning\":1,\"render\":1,\"repair\":0},\"durationMs\":0,\"height\":1024,\"maximumMicrousd\":1000000,\"maximumTokens\":128000,\"model\":\"gpt-image-2\",\"outputCount\":1,\"outputKind\":\"image\",\"provider\":\"openai\",\"recipeVersion\":\"image@2\",\"releaseDigest\":\"sha256:72c2627350f6928135d3f0dcb0d1d118bb391a8820b943364103eb485607d16f\",\"routeDigest\":\"sha256:2f9fc10bf14df6d9f459296d07c7d8579f34c4b188879fcfe36d64799a54ec36\",\"settingsDigest\":\"sha256:6cef89b8a487194bae90eaea60f25846b6a9afe6d54dd9ba654821431ea8cf91\",\"width\":1024},\"rightsDigest\":\"sha256:8888888888888888888888888888888888888888888888888888888888888888\",\"sessionDigest\":\"sha256:5555555555555555555555555555555555555555555555555555555555555555\",\"sourceDigest\":\"sha256:6666666666666666666666666666666666666666666666666666666666666666\",\"sourceRevision\":7,\"templateDigest\":\"sha256:0a36d1537d3a808bf9121a054a419ad9e8ab31df985c7daefe27fae8837af404\",\"transferEnvelopeDigest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"version\":2}",
      "policyDigest": "sha256:0424c394d07dae6d4e9e449ca0740b61b01b60af938045d84ea871ec2483dd88",
      "envelopeDigest": "sha256:5e27fe47b1a0a3d3989c123a8c4bf550d761adc46c74d0e5296b02a836569b8e"
    }
  ],
  "approval": {
    "termsJson": "{\"eligibleActorUserIds\":[\"actor\"],\"issuerUserIds\":[\"actor\"],\"policy\":{\"audience\":\"canonical-principal\",\"campaignId\":\"image-campaign\",\"expiresAtMs\":1100000,\"maximumAdmissions\":10,\"maximumAdmissionsPerActor\":5,\"maximumAdmissionsPerActorWindow\":5,\"maximumAdmissionsPerWindow\":10,\"maximumGrantLifetimeMs\":60000,\"maximumMicrousd\":10000000,\"mode\":\"candidate\",\"payerUserId\":\"payer\",\"policyVersion\":\"image-policy@1\",\"resources\":{\"actor\":{\"maximumInflightJobs\":1,\"maximumOperations\":20,\"maximumOperationsPerWindow\":10,\"maximumPendingGrants\":2,\"maximumTextBytes\":100000,\"maximumTextBytesPerWindow\":50000},\"campaign\":{\"maximumInflightJobs\":1,\"maximumOperations\":20,\"maximumOperationsPerWindow\":10,\"maximumPendingGrants\":2,\"maximumTextBytes\":100000,\"maximumTextBytesPerWindow\":50000},\"expiresAtMs\":1080000,\"maximumOperationTextBytes\":10000,\"startsAtMs\":999500,\"version\":1,\"windowMs\":60000},\"startsAtMs\":999000,\"templates\":[{\"appId\":\"image\",\"calls\":[{\"maximumMicrousd\":100000,\"model\":\"gpt-5.6-terra\",\"provider\":\"openai\",\"stage\":\"planning:initial\"},{\"maximumMicrousd\":900000,\"model\":\"gpt-image-2\",\"provider\":\"openai\",\"stage\":\"image:initial\"}],\"durationMs\":0,\"height\":1024,\"inputMode\":\"text-only\",\"maximumCalls\":2,\"maximumMicrousd\":1000000,\"maximumTokens\":128000,\"outputCount\":1,\"outputKind\":\"image\",\"recipeVersion\":\"image@2\",\"releaseDigest\":\"sha256:72c2627350f6928135d3f0dcb0d1d118bb391a8820b943364103eb485607d16f\",\"route\":\"document-image-manual-v1\",\"settings\":{\"budgetAcknowledged\":true,\"executionPolicy\":{\"heartbeatMilliseconds\":60000,\"maximumMilliseconds\":240000,\"maximumRenewals\":3},\"imageBudget\":{\"allowanceCode\":\"output_native_image_allowance_verified\",\"allowanceDescription\":\"UTF-8 prompt bytes plus protocol headroom, and twice the documented output-token estimate for this exact high-quality frame. Provider receipts determine actual charges; no additional request is allowed after an overrun or uncertain response.\",\"estimatedOutputTokens\":7024,\"maximumInputTokens\":36096,\"maximumMicrousd\":601920,\"maximumOutputTokens\":14048,\"maximumPromptBytes\":32000,\"maximumReferenceImages\":0,\"quality\":\"high\",\"version\":\"gpt-image-2-doc-calculator-2026-08-27\"},\"imageRender\":{\"format\":{\"aspect_ratio\":{\"height\":1,\"width\":1},\"dimensions\":{\"height\":1024,\"unit\":\"px\",\"width\":1024},\"schema_version\":1},\"size\":\"1024x1024\"},\"kind\":\"generate\",\"preflightAcknowledged\":true,\"productionMode\":\"manual\"},\"transport\":{\"image\":{\"adapterId\":\"openai-image\",\"adapterVersion\":\"v5\",\"api\":\"https://api.openai.com/v1/images/generations\",\"outputCount\":1,\"outputFormat\":\"png\",\"partialImages\":0,\"quality\":\"high\"},\"planning\":{\"api\":\"https://api.openai.com/v1/responses\",\"format\":{\"name\":\"forma_creative_direction\",\"schemaDigest\":\"sha256:d847c85755559fbe899d448a88e3a18067564990c7f2228b62f32c96bd00805d\",\"strict\":true,\"type\":\"json_schema\"},\"maximumOutputTokens\":1200,\"reasoningEffort\":\"low\",\"store\":false,\"verbosity\":\"low\"},\"safety\":{\"api\":\"https://api.openai.com/v1/moderations\",\"input\":\"text\",\"maximumCalls\":1,\"model\":\"omni-moderation-latest\",\"provider\":\"openai\"}},\"version\":2,\"width\":1024}],\"version\":2,\"windowMs\":60000}}",
    "termsDigest": "sha256:26a05847ddd2a0ebe9b6b1e3da98af2bae76da639f5fa0a42bfc55d34e8fe63f",
    "policyJson": "{\"approvalReceiptDigest\":\"sha256:26a05847ddd2a0ebe9b6b1e3da98af2bae76da639f5fa0a42bfc55d34e8fe63f\",\"audience\":\"canonical-principal\",\"campaignId\":\"image-campaign\",\"expiresAtMs\":1100000,\"maximumAdmissions\":10,\"maximumAdmissionsPerActor\":5,\"maximumAdmissionsPerActorWindow\":5,\"maximumAdmissionsPerWindow\":10,\"maximumGrantLifetimeMs\":60000,\"maximumMicrousd\":10000000,\"mode\":\"candidate\",\"payerUserId\":\"payer\",\"policyVersion\":\"image-policy@1\",\"resources\":{\"actor\":{\"maximumInflightJobs\":1,\"maximumOperations\":20,\"maximumOperationsPerWindow\":10,\"maximumPendingGrants\":2,\"maximumTextBytes\":100000,\"maximumTextBytesPerWindow\":50000},\"campaign\":{\"maximumInflightJobs\":1,\"maximumOperations\":20,\"maximumOperationsPerWindow\":10,\"maximumPendingGrants\":2,\"maximumTextBytes\":100000,\"maximumTextBytesPerWindow\":50000},\"expiresAtMs\":1080000,\"maximumOperationTextBytes\":10000,\"startsAtMs\":999500,\"version\":1,\"windowMs\":60000},\"startsAtMs\":999000,\"templates\":[{\"appId\":\"image\",\"calls\":[{\"maximumMicrousd\":100000,\"model\":\"gpt-5.6-terra\",\"provider\":\"openai\",\"stage\":\"planning:initial\"},{\"maximumMicrousd\":900000,\"model\":\"gpt-image-2\",\"provider\":\"openai\",\"stage\":\"image:initial\"}],\"durationMs\":0,\"height\":1024,\"inputMode\":\"text-only\",\"maximumCalls\":2,\"maximumMicrousd\":1000000,\"maximumTokens\":128000,\"outputCount\":1,\"outputKind\":\"image\",\"recipeVersion\":\"image@2\",\"releaseDigest\":\"sha256:72c2627350f6928135d3f0dcb0d1d118bb391a8820b943364103eb485607d16f\",\"route\":\"document-image-manual-v1\",\"settings\":{\"budgetAcknowledged\":true,\"executionPolicy\":{\"heartbeatMilliseconds\":60000,\"maximumMilliseconds\":240000,\"maximumRenewals\":3},\"imageBudget\":{\"allowanceCode\":\"output_native_image_allowance_verified\",\"allowanceDescription\":\"UTF-8 prompt bytes plus protocol headroom, and twice the documented output-token estimate for this exact high-quality frame. Provider receipts determine actual charges; no additional request is allowed after an overrun or uncertain response.\",\"estimatedOutputTokens\":7024,\"maximumInputTokens\":36096,\"maximumMicrousd\":601920,\"maximumOutputTokens\":14048,\"maximumPromptBytes\":32000,\"maximumReferenceImages\":0,\"quality\":\"high\",\"version\":\"gpt-image-2-doc-calculator-2026-08-27\"},\"imageRender\":{\"format\":{\"aspect_ratio\":{\"height\":1,\"width\":1},\"dimensions\":{\"height\":1024,\"unit\":\"px\",\"width\":1024},\"schema_version\":1},\"size\":\"1024x1024\"},\"kind\":\"generate\",\"preflightAcknowledged\":true,\"productionMode\":\"manual\"},\"transport\":{\"image\":{\"adapterId\":\"openai-image\",\"adapterVersion\":\"v5\",\"api\":\"https://api.openai.com/v1/images/generations\",\"outputCount\":1,\"outputFormat\":\"png\",\"partialImages\":0,\"quality\":\"high\"},\"planning\":{\"api\":\"https://api.openai.com/v1/responses\",\"format\":{\"name\":\"forma_creative_direction\",\"schemaDigest\":\"sha256:d847c85755559fbe899d448a88e3a18067564990c7f2228b62f32c96bd00805d\",\"strict\":true,\"type\":\"json_schema\"},\"maximumOutputTokens\":1200,\"reasoningEffort\":\"low\",\"store\":false,\"verbosity\":\"low\"},\"safety\":{\"api\":\"https://api.openai.com/v1/moderations\",\"input\":\"text\",\"maximumCalls\":1,\"model\":\"omni-moderation-latest\",\"provider\":\"openai\"}},\"version\":2,\"width\":1024}],\"version\":2,\"windowMs\":60000}",
    "policyDigest": "sha256:addd1a32b5367e554acd9e3892f3588d0d71321c4a9486161b73ecd12ded1ceb"
  },
  "egress": 0
};
for(const [index,expected] of imageBaseline.compiled.entries())test(`Image V${index+1} canonical policy/envelope bytes and digests match original source golden`,async()=>{
  const actual=await compileSponsorEnvelope(JSON.parse(expected.policyJson),JSON.parse(expected.envelopeJson));
  for(const key of ['policyJson','envelopeJson','policyDigest','envelopeDigest'])assert.equal(actual[key],expected[key],key);
});
test('Image V2 approval canonical terms and policy digests match original source golden',async()=>{
  const expected=imageBaseline.approval,actual=await compileSponsorApprovalProposal(JSON.parse(expected.termsJson));
  for(const key of ['termsJson','termsDigest','policyJson','policyDigest'])assert.equal(actual[key],expected[key],key);
});
test('a V4 approval has distinct reviewed terms and cannot inherit the old Image approval digest',async()=>{
  const current=await compileSponsorApprovalProposal(proposal());
  assert.notEqual(current.termsDigest,imageBaseline.approval.termsDigest);
  assert.notEqual(current.policyDigest,imageBaseline.approval.policyDigest);
  assert.notEqual(current.policy.approvalReceiptDigest,imageBaseline.approval.termsDigest);
});
