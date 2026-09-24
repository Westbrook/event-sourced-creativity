import {reserveCreationQualificationAttempt} from './creation-qualification-budget.ts';
import type { WorkerEnv } from './runtime.ts';
import { creationHTTP, CreationProviderError } from './creation-provider-http.ts';
/** Changing any field creates a new model space; old generations cannot be scanned with it. */
export const CREATION_REPRESENTATION=Object.freeze({id:'openai-small-512-l2-source-v1-utf8passage2048-overlap256-f32le-v1',model:'text-embedding-3-small',dimensions:512,normalization:'l2',template:1,chunker:'utf8-boundary-v1',targetEstimatedTokens:512,overlapEstimatedTokens:64,maxPassageBytes:2048,overlapBytes:256,codec:'f32le-v1'});
export const CREATION_VECTOR_PREFIX='__still_creation_index/';
export const isCreationIndexKey=(key:string)=>key.startsWith(CREATION_VECTOR_PREFIX);
export const MAX_SHARD_BYTES=1_048_576;
export type GroundedPassage={ordinal:number;start:number;end:number;text:string};
/** Byte-bounded estimate of 512 tokens (2048 UTF-8 bytes), 64-token overlap (256 bytes).
 * Provider admission reserves UTF-8 bytes as the conservative token upper bound. Never split a surrogate
 * pair. Prefer paragraph/sentence ends in the last quarter; every source code unit is covered.
 * Target is an estimate, not a claim of exact tokenizer counts. Offsets remain UTF-16 source offsets. */
export function sourcePassages(text:string,after=0,limit=32):{passages:GroundedPassage[];next:number;complete:boolean}{
  const passages:GroundedPassage[]=[];let start=after;
  while(start<text.length&&passages.length<limit){let end=start,bytes=0;while(end<text.length){const point=String.fromCodePoint(text.codePointAt(end)!);const n=new TextEncoder().encode(point).length;if(bytes+n>2048)break;bytes+=n;end+=point.length;}
    if(end<text.length){const tail=text.slice(start,end);const boundaries=[...tail.matchAll(/\n\s*\n|[.!?。！？](?:\s|$)/gu)];const last=boundaries.at(-1);if(last&&last.index!>tail.length*.75)end=start+last.index!+last[0].length;}
    passages.push({ordinal:passages.length,start,end,text:text.slice(start,end)});
    if(end===text.length){start=end;break;}let overlap=end,n=0;while(overlap>start){const prev=overlap>=2&&/[\uDC00-\uDFFF]/.test(text[overlap-1])?overlap-2:overlap-1;const size=new TextEncoder().encode(text.slice(prev,overlap)).length;if(n+size>256)break;n+=size;overlap=prev;}start=Math.max(start+1,overlap);
  }
  return {passages,next:start,complete:start===text.length};
}
export function normalizeVector(value:unknown):Float32Array{
  if(!Array.isArray(value)||value.length!==512||value.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new CreationProviderError('embedding_shape',0,true);
  const norm=Math.hypot(...value);if(!Number.isFinite(norm)||norm===0)throw new CreationProviderError('embedding_norm',0,true);
  return Float32Array.from(value,v=>v/norm);
}
export async function embedCreationTexts(env:WorkerEnv,texts:string[],signal:AbortSignal):Promise<{vectors:Float32Array[];tokens:number}>{
  if(!env.OPENAI_API_KEY)throw new CreationProviderError('embedding_credentials_missing',0,true);
  if(!texts.length||texts.length>32||texts.some(t=>!t.trim()||new TextEncoder().encode(t).length>8191)||texts.reduce((n,t)=>n+new TextEncoder().encode(t).length,0)>24000)throw new CreationProviderError('embedding_input_budget',0,true);
  const body={model:CREATION_REPRESENTATION.model,dimensions:512,encoding_format:'float',input:texts};
  await reserveCreationQualificationAttempt(env,'openai:embeddings',CREATION_REPRESENTATION.model,JSON.stringify(body));
  signal.throwIfAborted();
  const value=await creationHTTP(env.OPENAI_API_KEY,env.OPENAI_PROJECT,'embeddings',body,signal,700_000) as {model?:string;data?:Array<{index:number;embedding:unknown}>;usage?:{total_tokens?:number}};
  if(value.model!==CREATION_REPRESENTATION.model||!Array.isArray(value.data)||value.data.length!==texts.length||value.data.some((d,i)=>d.index!==i))throw new CreationProviderError('embedding_envelope',0,true);
  return {vectors:value.data.map(d=>normalizeVector(d.embedding)),tokens:Number(value.usage?.total_tokens??0)};
}
export function encodeVectors(vectors:Float32Array[]):Uint8Array{
  if(!vectors.length||vectors.length*2048>MAX_SHARD_BYTES)throw new Error('shard_capacity');const bytes=new Uint8Array(vectors.length*2048),view=new DataView(bytes.buffer);
  vectors.forEach((v,i)=>{if(v.length!==512)throw new Error('shard_dimensions');v.forEach((n,j)=>{if(!Number.isFinite(n))throw new Error('shard_nonfinite');view.setFloat32((i*512+j)*4,n,true);});});return bytes;
}
export const vectorChecksum=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),n=>n.toString(16).padStart(2,'0')).join('');
export function cosineAt(bytes:Uint8Array,offset:number,query:Float32Array){if(bytes.length%2048||offset<0||(offset+1)*2048>bytes.length||query.length!==512)throw new Error('shard_length');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let score=0,norm=0;for(let i=0;i<512;i++){const v=view.getFloat32((offset*512+i)*4,true);if(!Number.isFinite(v))throw new Error('shard_nonfinite');score+=v*query[i];norm+=v*v;}if(Math.abs(norm-1)>.001)throw new Error('shard_norm');return score;}
