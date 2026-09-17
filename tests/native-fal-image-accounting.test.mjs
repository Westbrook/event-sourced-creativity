import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {png} from './output-asset-fixtures.mjs';

registerOutputSourceImports();
const {generateCreativeImage}=await import('../worker/image-adapter.ts');
const {createOutputFalImageContract}=await import('../worker/output-fal-image-contract.ts');

// Adapter ABI coverage: real image wrapper, native request capture, moderation,
// Fal queue/result parsing and PNG inspection; all transport is synthetic.
// These callbacks do not stand in for funded admission, D1 settlement, a live
// provider journey, a persisted moderation receipt, or a provider invoice.
const clientId='native-image-original-client',providerId='native-image-original-provider';
const endpoint='https://queue.fal.run/ideogram/v4';
const resultUrl=`${endpoint}/requests/${providerId}`;
const mediaUrl='https://cdn.fal.media/native-image-original.png';
const contract=createOutputFalImageContract('ideogram/v4','1024x1024');
const imageBytes=png({width:1024,height:1024});
const nativeCost=134858;
const complete=state=>state.receipts.filter(receipt=>receipt.status==='completed');

async function runNativeImage(config={}){
  const state={trace:[],receipts:[],receiptAttempts:[],requests:[],captured:null,attempt:null,result:null,error:null};
  let authority=true;
  const metadata={request_id:providerId,model:'ideogram/v4',images:[{url:mediaUrl,content_type:'image/png',width:1024,height:1024}]};
  config.changeMetadata?.(metadata);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const address=String(url),method=init.method??'GET';
    const request={url:address,method,redirect:init.redirect,body:init.body,completed:structuredClone(complete(state))};
    state.requests.push(request);
    state.trace.push(`fetch:${method}:${address}`);
    if(address==='https://api.openai.com/v1/moderations'&&method==='POST')return Response.json({id:'synthetic-moderation',model:'omni-moderation-latest',results:[{flagged:false,categories:{},category_scores:{}}]});
    if(address===endpoint&&method==='POST')return Response.json({request_id:providerId,status:config.statusMismatch?'IN_QUEUE':'COMPLETED',response_url:resultUrl});
    if(address===`${resultUrl}/status?logs=1`&&method==='GET')return Response.json({request_id:config.statusMismatch?'foreign-provider-request':providerId,status:'COMPLETED'});
    if(address===resultUrl&&method==='GET'){
      assert.equal(authority,true,'The original creative authority must still permit result acquisition');
      if(config.resultRedirect)return new Response(null,{status:302,headers:{location:'https://untrusted.invalid/result'}});
      return Response.json(metadata);
    }
    if(address===mediaUrl&&method==='GET'){
      if(config.mediaFailure)return new Response('synthetic media failure',{status:503});
      return new Response(config.invalidPng?new TextEncoder().encode('not a PNG'):imageBytes,{headers:{'content-type':'image/png'}});
    }
    throw new Error(`Unexpected synthetic transport request: ${method} ${address}`);
  };
  try{
    state.result=await generateCreativeImage(
      {OPENAI_API_KEY:'synthetic-not-a-credential',FAL_KEY:'synthetic-not-a-credential',FORMA_IMAGE_PROVIDER:'fal-ideogram',FAL_IMAGE_MODEL:'ideogram/v4'},
      'synthetic-actor',{facts:[]},{title:'A geometric blue square'},
      {quality:'high',size:'1024x1024',outputFormat:'png',references:[],outputFalImage:contract,providerClientRequestId:clientId,
        onBeforeProviderAttempt:async attempt=>{state.trace.push('claim');state.attempt=attempt;},
        onOutputFalRequest:async captured=>{state.trace.push('checkpoint');state.captured=captured;},
        onBeforeProviderDispatch:id=>{assert.equal(id,clientId);state.trace.push('dispatch');},
        onBeforeSourceTransmission:async()=>{state.trace.push('authority');if(!authority)throw new Error('synthetic-authority-withdrawn');},
        onProviderSubmission:async receipt=>{
          state.receiptAttempts.push(structuredClone(receipt));
          if(receipt.status==='completed'&&config.observerFailure)throw new Error('synthetic-money-observer-failure');
          state.receipts.push(structuredClone(receipt));state.trace.push(`receipt:${receipt.status}`);
        },
        onStage:async stage=>{
          state.trace.push(`stage:${stage}`);
          if(stage==='provider-queued'&&config.withdrawBeforeResult)authority=false;
          if(stage==='provider-download'&&config.progressFailure)throw new Error('synthetic-private-progress-failure');
        },
      });
  }catch(error){state.error=error;}finally{globalThis.fetch=originalFetch;}
  return state;
}

function assertOneOriginalPurchase(state){
  assert.equal(state.requests.filter(request=>request.url===endpoint&&request.method==='POST').length,1);
  assert.equal(state.requests.filter(request=>request.url==='https://api.openai.com/v1/moderations').length,1,
    'The separate synthetic moderation transfer is not a paid image claim');
  assert.equal(state.attempt.clientRequestId,clientId);
  assert.equal(state.attempt.model,'ideogram/v4');
  assert.equal(state.attempt.logicalCallKey,'image:initial');
  assert.equal(state.attempt.maximumInputTokens,0);
  assert.equal(state.attempt.maximumOutputTokens,0);
  assert.equal(Object.isFrozen(state.attempt),true);
  assert.equal(Object.isFrozen(state.captured),true);
  const submitted=state.requests.find(request=>request.url===endpoint&&request.method==='POST');
  assert.equal(submitted.body,state.captured.body,'The actual captured native request is the exact submitted body');
  assert.equal(createHash('sha256').update(JSON.stringify({contract,body:submitted.body})).digest('hex'),state.attempt.requestDigest);
  assert.deepEqual(JSON.parse(submitted.body).image_size,{width:1024,height:1024});
  assert.deepEqual(state.captured.contract,contract);
  assert.equal(contract.estimatedMicrousd,nativeCost);
  assert.equal(contract.maximumMicrousd,900000);
  const ordered=['claim','checkpoint','receipt:pending','dispatch',`fetch:POST:${endpoint}`].map(value=>state.trace.indexOf(value));
  assert.ok(ordered.every((value,index)=>value>=0&&(index===0||value>ordered[index-1])));
  for(const receipt of state.receipts){
    assert.equal(receipt.clientRequestId,clientId);assert.equal(receipt.provider,'fal');
    assert.equal(receipt.operation,'image');assert.equal(receipt.model,'ideogram/v4');
    if(receipt.status!=='pending')assert.equal(receipt.providerRequestId,providerId);
  }
  assert.equal(state.receipts.some(receipt=>receipt.status==='rejected'),false,'No later failure reverses an accepted image purchase');
}

function assertCompletedOnce(state){
  assertOneOriginalPurchase(state);
  assert.equal(complete(state).length,1,'The real wrapper must not duplicate the adapter completion observation');
  assert.deepEqual(complete(state)[0],{clientRequestId:clientId,provider:'fal',operation:'image',model:'ideogram/v4',providerRequestId:providerId,status:'completed',costMicrousd:nativeCost,inputTokens:0,outputTokens:0,totalTokens:0});
}

test('native Fal records the original square image cost before private progress and media, once through the real wrapper',async()=>{
  const state=await runNativeImage();
  assert.equal(state.error,null);
  assertCompletedOnce(state);
  const media=state.requests.find(request=>request.url===mediaUrl);
  assert.deepEqual(media.completed,complete(state));
  assert.equal(media.redirect,'manual');
  const resultRead=state.trace.indexOf(`fetch:GET:${resultUrl}`);
  assert.equal(state.trace[resultRead-1],'authority','A live permission check precedes the result GET');
  assert.equal(state.requests.find(request=>request.url===resultUrl).redirect,'manual');
  assert.ok(resultRead<state.trace.indexOf('receipt:completed'));
  assert.ok(state.trace.indexOf('receipt:completed')<state.trace.indexOf('stage:provider-download'));
  assert.equal(state.result.providerSubmissionId,clientId);
  assert.equal(state.result.providerRequestId,providerId);
  assert.equal(state.result.costBreakdown.totalMicrousd,nativeCost);
  assert.equal(state.result.pricingVersion,contract.pricingVersion);
  assert.equal(state.result.costPrecision,'provider-pixel-rate-estimate');
  assert.equal(state.result.width,1024);assert.equal(state.result.height,1024);
  assert.deepEqual(state.result.bytes,imageBytes);
});

for(const absent of ['width','height','content_type'])test(`native Fal missing explicit ${absent} retains after-byte completion without inventing metadata`,async()=>{
  const state=await runNativeImage({changeMetadata:metadata=>{delete metadata.images[0][absent];}});
  assert.equal(state.error,null);
  assertCompletedOnce(state);
  assert.deepEqual(state.requests.find(request=>request.url===mediaUrl).completed,[]);
  assert.ok(state.trace.indexOf(`fetch:GET:${mediaUrl}`)<state.trace.indexOf('receipt:completed'));
  assert.deepEqual(state.result.bytes,imageBytes);
});

for(const [label,config] of [
  ['result error envelope',{changeMetadata:metadata=>{metadata.error='synthetic provider failure';}}],
  ['foreign result request ID',{changeMetadata:metadata=>{metadata.request_id='foreign-provider-request';}}],
  ['foreign result model',{changeMetadata:metadata=>{metadata.model='foreign/model';}}],
  ['mismatched explicit dimensions',{changeMetadata:metadata=>{metadata.images[0].width=2048;}}],
  ['mismatched explicit format',{changeMetadata:metadata=>{metadata.images[0].content_type='image/jpeg';}}],
  ['non-array image envelope',{changeMetadata:metadata=>{metadata.images={0:metadata.images[0],length:1};}}],
  ['result redirect',{resultRedirect:true}],
  ['foreign completed queue request ID',{statusMismatch:true}],
])test(`native Fal ${label} cannot produce early known money or read media`,async()=>{
  const state=await runNativeImage(config);
  assert.ok(state.error);
  assertOneOriginalPurchase(state);
  assert.deepEqual(complete(state),[]);
  assert.equal(state.requests.some(request=>request.url===mediaUrl),false);
  if(config.resultRedirect)assert.equal(state.requests.find(request=>request.url===resultUrl).redirect,'manual');
  if(config.statusMismatch)assert.equal(state.requests.some(request=>request.url===resultUrl),false);
});

test('native Fal refuses a new creative result GET after the original authority is withdrawn',async()=>{
  const state=await runNativeImage({withdrawBeforeResult:true});
  assert.match(state.error?.message??'',/synthetic-authority-withdrawn/u);
  assertOneOriginalPurchase(state);
  assert.deepEqual(complete(state),[]);
  assert.equal(state.requests.some(request=>request.url===resultUrl||request.url===mediaUrl),false);
});

test('native Fal awaits its monetary observer and stops before private progress or media when that observer fails',async()=>{
  const state=await runNativeImage({observerFailure:true});
  assert.match(state.error?.message??'',/synthetic-money-observer-failure/u);
  assertOneOriginalPurchase(state);
  assert.equal(state.receiptAttempts.filter(receipt=>receipt.status==='completed').length,1);
  assert.deepEqual(complete(state),[],'A failed callback is not claimed as a persisted observation');
  assert.equal(state.trace.includes('stage:provider-download'),false);
  assert.equal(state.requests.some(request=>request.url===mediaUrl),false);
});

for(const [label,config] of [
  ['private progress failure',{progressFailure:true}],
  ['media HTTP failure',{mediaFailure:true}],
  ['invalid downloaded PNG',{invalidPng:true}],
])test(`native Fal retains one original known cost while ${label} still fails the artifact`,async()=>{
  const state=await runNativeImage(config);
  assert.ok(state.error);
  assert.equal(state.result,null);
  assertCompletedOnce(state);
  if(config.progressFailure)assert.equal(state.requests.some(request=>request.url===mediaUrl),false);
  else assert.deepEqual(state.requests.find(request=>request.url===mediaUrl).completed,complete(state));
});
