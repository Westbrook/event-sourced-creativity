import { createHash } from 'node:crypto';
import { memoryDerivationJsonUniqueKeys } from '../../../worker/memory-derivation-result.ts';
import { validModerationResults } from '../../../worker/moderation-response-validation.ts';
import { inspectOutputAsset } from '../../../src/model/output-asset-inspection.ts';

export const HOST_LIMITS=Object.freeze({promptBytes:32000,responseBytes:23*1024*1024,artifactBytes:16*1024*1024,evidenceBytes:2*1024*1024,privateWrites:16,deadlineMs:120000});
export const digest=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value)).digest('hex');
const deny=code=>{throw Error(code);};
export function validateWire(request,stage,user){
  if(!request||request.provider!=='openai'||request.endpoint!==(stage==='moderation'?'/v1/moderations':'/v1/images/generations')||typeof request.body!=='string'||!memoryDerivationJsonUniqueKeys(request.body))deny('study_request_identity');
  const b=JSON.parse(request.body),keys=Object.keys(b).sort().join(',');
  if(stage==='moderation'){
    if(keys!=='input,model'||b.model!=='omni-moderation-latest'||(!Array.isArray(b.input)||b.input.length!==1||b.input[0]?.type!=='text'||typeof b.input[0].text!=='string'||Object.keys(b.input[0]).sort().join(',')!=='text,type'))deny('study_moderation_contract');
  }else if(keys!=='model,n,output_format,prompt,quality,size,user'||b.model!=='gpt-image-2.5-sunburst'||b.n!==1||b.quality!=='high'||b.size!=='1536x1024'||b.output_format!=='png'||b.user!==user)deny('study_image_contract');
  const prompt=stage==='moderation'?b.input[0].text:b.prompt;
  if(typeof prompt!=='string'||!prompt.isWellFormed()||!prompt.length||prompt!==prompt.trim()||Buffer.byteLength(prompt)>HOST_LIMITS.promptBytes)deny('study_prompt_invalid');
  return b;
}
/** Separate v2 advisory contract; v1 exact-prompt validation is unchanged. */
export function validateAdvisoryWire(request){
 if(!request||request.provider!=='openai'||request.method!=='POST'||request.endpoint!=='/v1/moderations'||typeof request.body!=='string'||!memoryDerivationJsonUniqueKeys(request.body))deny('study_advisory_contract');
 const b=JSON.parse(request.body);
 if(Object.keys(b).sort().join(',')!=='input,model'||b.model!=='omni-moderation-latest'||!Array.isArray(b.input)||b.input.length!==2||b.input.some(v=>typeof v!=='string'||!v.length||!v.isWellFormed()||Buffer.byteLength(v)>HOST_LIMITS.promptBytes))deny('study_advisory_contract');
 return b;
}
/** Exact wire body, one fetch, no SDK retry and no status/result fallback. Called only after durable intent. */
export async function submitStudyStage(env,request,stage,{signal,checkpoint}){
  const response=await fetch('https://api.openai.com'+request.endpoint,{method:'POST',redirect:'error',signal,headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`,'content-type':'application/json',...(env.OPENAI_PROJECT?{'OpenAI-Project':env.OPENAI_PROJECT}:{})},body:request.body});
  const headerId=response.headers.get('x-request-id');
  const requestId=typeof headerId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(headerId)?headerId:null;
  // Request identity survives a lost/oversized/malformed body before private custody.
  await checkpoint({phase:'headers',requestId,httpStatus:response.status});
  const raw=await readStudyBody(response,signal,stage==='advisory'?65536:stage==='moderation'?HOST_LIMITS.evidenceBytes:HOST_LIMITS.responseBytes);
  if(!memoryDerivationJsonUniqueKeys(raw))deny('study_response_duplicate_or_invalid_json');
  const body=JSON.parse(raw);
  const receiptHash=digest(raw),usage=body.usage??null;
  await checkpoint({phase:'receipt',requestId,httpStatus:response.status,receiptHash,usage});
  if(!response.ok)return {outcome:'unknown',requestId,receiptHash,raw,usage};
  if(stage==='moderation'||stage==='advisory'){
    if(!validModerationResults(body,stage==='advisory'?2:1))deny('study_moderation_invalid');
    return {outcome:body.results.some(r=>r.flagged)?'refused':'usable',requestId,receiptHash,raw,usage:null};
  }
  if(!Array.isArray(body.data)||body.data.length!==1||typeof body.data[0]?.b64_json!=='string')deny('study_image_missing');
  const encoded=body.data[0].b64_json;
  if(encoded.length>Math.ceil(HOST_LIMITS.artifactBytes/3)*4||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))deny('study_image_base64');
  const bytes=Buffer.from(encoded,'base64');
  if(!bytes.length||bytes.length>HOST_LIMITS.artifactBytes||bytes.toString('base64')!==encoded)deny('study_image_base64');
  const inspected=await inspectOutputAsset(bytes,'study.png');
  if(inspected.status!=='inspected'||inspected.mimeType!=='image/png'||inspected.facts.width!==1536||inspected.facts.height!==1024)deny('study_image_invalid');
  const decodedSha256=await decodedPngDigest(bytes);
  // Keep the exact raw hash; private evidence excludes pixels, which occupy one separately bounded artifact slot.
  const evidence={...body,data:body.data.map(({b64_json,...v})=>({...v,pixelSha256:digest(bytes),decodedSha256,encodedBytes:b64_json.length}))};
  const evidenceRaw=JSON.stringify(evidence);
  if(Buffer.byteLength(evidenceRaw)>HOST_LIMITS.evidenceBytes)deny('study_evidence_oversize');
  const integer=n=>Number.isSafeInteger(n)&&n>=0;
  const completeUsage=usage&&[usage.input_tokens,usage.output_tokens,usage.total_tokens,usage.input_tokens_details?.text_tokens,usage.input_tokens_details?.image_tokens].every(integer)
    &&usage.input_tokens+usage.output_tokens===usage.total_tokens&&usage.input_tokens_details.text_tokens===usage.input_tokens&&usage.input_tokens_details.image_tokens===0;
  return {outcome:'usable',requestId,receiptHash,raw:evidenceRaw,usage,completeUsage:Boolean(completeUsage),bytes,artifactHash:digest(bytes),mimeType:'image/png',width:1536,height:1024,
    // Public uncached arithmetic is an estimate, never measured/invoiced settlement.
    uncachedEstimateMicrousd:completeUsage?5*usage.input_tokens+30*usage.output_tokens:null,measuredMicrousd:null};
}

/** The shared private-Memory reader has a 1MiB ceiling; this separately versioned no-reference PNG lane is bounded to 23MiB. */
export async function readStudyBody(response,signal,maximumBytes){
  const body=response.body,length=response.headers.get('content-length');
  if(!body||signal.aborted||length!==null&&(!/^\d+$/.test(length)||Number(length)>maximumBytes)){await body?.cancel();deny('study_response_bound');}
  const reader=body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let count=0,text='';
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{for(;;){const next=await reader.read();if(signal.aborted)deny('study_response_aborted');if(next.done)break;count+=next.value.byteLength;if(count>maximumBytes)deny('study_response_bound');text+=decoder.decode(next.value,{stream:true});}return text+decoder.decode();}
  finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Decode the bounded PNG scanlines into samples as well as validating its container. Narrow supported study output: 8-bit RGB/RGBA, no interlace. */
export async function decodedPngDigest(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20),depth=bytes[24],color=bytes[25];
  if(depth!==8||![2,6].includes(color)||bytes[28]!==0||width!==1536||height!==1024)deny('study_png_decode_unsupported');
  const channels=color===2?3:4,stride=width*channels,parts=[];
  for(let offset=8;offset+12<=bytes.length;){const length=view.getUint32(offset),type=Buffer.from(bytes.subarray(offset+4,offset+8)).toString('ascii');if(type==='IDAT')parts.push(bytes.subarray(offset+8,offset+8+length));offset+=length+12;}
  const reader=new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>(stride+1)*height)deny('study_png_decode_bound');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(size!==(stride+1)*height)deny('study_png_decode_size');
  const raw=Buffer.concat(chunks),samples=Buffer.alloc(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];if(filter>4)deny('study_png_decode_filter');
    for(let x=0;x<stride;x++){const i=y*stride+x,left=x>=channels?samples[i-channels]:0,up=y?samples[i-stride]:0,corner=y&&x>=channels?samples[i-stride-channels]:0;
      const prediction=[0,left,up,Math.floor((left+up)/2),paeth(left,up,corner)][filter];samples[i]=(raw[y*(stride+1)+1+x]+prediction)&255;}
  }
  return digest(samples);
}
