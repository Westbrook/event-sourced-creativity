import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixture,rows,nativeEvents,outputDigest,snapshot,changes} from './helpers/guest-image-stage-fixture.mjs';
const [{prepareGuestImageConfirmation,confirmGuestImageRequirement},{preflightGuestImage,readGuestImagePreflight}]=await Promise.all([
  import('../worker/experience-guest-image-confirmation.ts'),import('../worker/experience-guest-image-preflight.ts')]);
const {preflightOutputImageSlidesTarget,outputNativeImageDisclosure}=await import('../worker/output-image-slides-preflight.ts');
// Independent expected bytes were captured once from the reviewed frozen native
// builder. Tests neither need its Git object nor regenerate from current code.
// Reference changes require separately reviewed native contract evidence.
const reference=JSON.parse(readFileSync(new URL('./fixtures/guest-image-native-disclosure-d848.json',import.meta.url),'utf8'));
assert.equal(reference.version,1);
assert.equal(reference.provenance.commit,'d84849b9d4609f5cfd92cd863d108768ef6456f6');
assert.equal(reference.provenance.path,'worker/output-image-slides-preflight.ts');
assert.equal(reference.provenance.sourceSha256,'1c54607a0ce12d4afecbc027828de95d60b4a6b802251a3968404a570d667e82');
assert.deepEqual(reference.cases.map(value=>value.name),['Image square','Image wide','Image portrait','Slides exact','Slides flexible','Fal Image']);
const expectedCases=new Map(reference.cases.map(value=>[value.name,value]));
assert.equal(expectedCases.size,6);

function pureInput(kind='image',ratio={width:1,height:1},flexible=false){
  const slides=kind==='slides';return {env:{OPENAI_API_KEY:'presence-only-not-a-credential',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'},
    target:{id:'disclosure-parity',selected:true,blocking_issues:[],media_kind:kind,source_scope:{kind:'document'},aspect_ratio:slides?null:ratio,
      instruction_text:slides?'5 slides':'Show a pear orchard',label:slides?'Slides':'Image',coverage:{kind:slides?'document_outline':'document_context'},
      count_policy:slides?flexible?{kind:'flexible',unit:'slide',min:5,max:15,aim:8}:{kind:'exact',unit:'slide',value:5}:null,suggested_count:flexible?8:null},
    context:{snapshot:{facts:[{block_id:'disclosure-source',type:'subject',active:true,intent:'include',properties:{text:'A pear orchard beside a stone wall.'}}],relationships:[]}}};
}


for(const [name,build,provider,route]of [
  ['Image square',()=>pureInput(),'openai','document-image-manual-v1'],
  ['Image wide',()=>pureInput('image',{width:16,height:9}),'openai','document-image-manual-v1'],
  ['Image portrait',()=>pureInput('image',{width:9,height:16}),'openai','document-image-manual-v1'],
  ['Slides exact',()=>pureInput('slides'),'openai','document-slides-manual-v1'],
  ['Slides flexible',()=>pureInput('slides',null,true),'openai','document-slides-manual-v1'],
  ['Fal Image',()=>{const input=pureInput();Object.assign(input.env,{FORMA_IMAGE_PROVIDER:'fal',FAL_KEY:'presence-only-not-a-credential'});return input;},'fal','document-image-fal-manual-v1'],
])test(`${name} serialized native offer preserves independent frozen expectations and property order`,async t=>{
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw Error('Pure disclosure parity attempted network');});
  const input=build(),captured=expectedCases.get(name);assert.deepEqual(input,captured.input);
  assert.equal(createHash('sha256').update(captured.expectedSerialized).digest('hex'),captured.expectedSha256);
  const before=JSON.parse(captured.expectedSerialized),after=await preflightOutputImageSlidesTarget(input);
  assert.equal(before.available,true);assert.equal(before.provider,provider);assert.equal(before.route,route);
  assert.equal(after.available,true,JSON.stringify(after));
  assert.deepEqual(after,before);assert.deepEqual(Object.keys(after),Object.keys(before));assert.equal(JSON.stringify(after),captured.expectedSerialized);
  assert.equal(fetch.mock.callCount(),0);
});

test('native Image disclosure helper returns fresh exact values and cannot be poisoned by another caller',()=>{
  const original=JSON.parse(expectedCases.get('Image square').expectedSerialized),first=outputNativeImageDisclosure(),second=outputNativeImageDisclosure();
  const expected={reasonValues:original.reasonValues,reason:original.reason,transferDescription:original.transferDescription};
  assert.deepEqual(Object.keys(first),['reasonValues','reason','transferDescription']);
  assert.deepEqual(first,expected);assert.deepEqual(second,expected);
  assert.notEqual(first,second);assert.notEqual(first.reasonValues,second.reasonValues);first.reasonValues.maximumExecutionSeconds=0;first.reason='changed';first.transferDescription='changed';
  assert.deepEqual(outputNativeImageDisclosure(),expected);assert.deepEqual(second,expected);assert.equal(second.reasonValues.maximumExecutionSeconds,240);
});

async function quotedFixture(t){
  const f=await fixture(t),review=await prepareGuestImageConfirmation(f.request,f.env,f.input);
  await confirmGuestImageRequirement(f.request,f.env,{...f.input,reviewedRequirementDigest:review.reviewedRequirementDigest,explicitRequirementsConfirmation:true});
  const original=await preflightGuestImage(f.request,f.env,f.input),event=nativeEvents(f).find(row=>row.type==='OutputPlanPreflighted');
  return {f,original,event};
}
async function replaceDisclosure(f,event,mutate){
  const payload=structuredClone(event.payload);mutate(payload.preflight.targets[0]);
  const {termsDigest:ignored,...withoutDigest}=payload.preflight;void ignored;payload.preflight.termsDigest=await outputDigest(withoutDigest);
  f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(payload),event.eventId);
  f.sqlite.prepare('UPDATE output_preflights SET terms_digest=? WHERE preflight_id=?').run(payload.preflight.termsDigest,payload.preflight.id);
}

test('a coherently rehashed malformed native transfer disclosure is not accepted as the original quote',async t=>{
  const {f,original,event}=await quotedFixture(t);await replaceDisclosure(f,event,offered=>{offered.transferDescription={};});
  const before=snapshot(f),count=changes(f);
  const outcome=await readGuestImagePreflight(f.request,f.env,f.input).then(value=>({accepted:true,sameEvent:value.eventId===original.eventId,
    transferDescription:value.preflight.targets[0].transferDescription}),error=>({error:String(error)}));
  t.diagnostic(JSON.stringify({outcome,resources:rows(f,'experience_sponsor_resource_receipts').length,preflights:rows(f,'output_preflights').length}));
  assert.ok(outcome.error,'native disclosure fields must match their actual shared pure contract');
  await assert.rejects(preflightGuestImage(f.request,f.env,f.input));assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);
});

for(const [name,mutate]of [
  ['null transfer description',offered=>{offered.transferDescription=null;}],['missing transfer description',offered=>{delete offered.transferDescription;}],
  ['altered transfer description',offered=>{offered.transferDescription='No source will be transferred.';}],
  ['object reason',offered=>{offered.reason={};}],['null reason',offered=>{offered.reason=null;}],['missing reason',offered=>{delete offered.reason;}],
  ['altered reason',offered=>{offered.reason='Unlimited image requests';}],
  ['null reason values',offered=>{offered.reasonValues=null;}],['array reason values',offered=>{offered.reasonValues=[];}],
  ['missing reason values',offered=>{delete offered.reasonValues;}],['missing execution window',offered=>{offered.reasonValues={};}],
  ['string execution window',offered=>{offered.reasonValues={maximumExecutionSeconds:'240'};}],
  ['altered execution window',offered=>{offered.reasonValues={maximumExecutionSeconds:241};}],
  ['extra reason field',offered=>{offered.reasonValues={maximumExecutionSeconds:240,unlimited:true};}],
])test(`coherently rehashed ${name} is refused without renewal, refund or disclosure`,async t=>{
  const {f,event}=await quotedFixture(t);await replaceDisclosure(f,event,mutate);const before=snapshot(f),count=changes(f);
  await assert.rejects(readGuestImagePreflight(f.request,f.env,f.input));await assert.rejects(preflightGuestImage(f.request,f.env,f.input));
  assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,3);assert.equal(rows(f,'output_preflights').length,1);
});
