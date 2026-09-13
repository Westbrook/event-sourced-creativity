import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
export const MAX_STORYBOARD_ENVELOPE_BYTES=524288;
export const MAX_STORYBOARD_ENVELOPE_READS=4096;
export const MAX_STORYBOARD_ENVELOPE_EMPTY_READS=32;
export type StoryboardRawEnvelope=Readonly<{version:"output-storyboard-raw-envelope-v1";clientRequestId:string;requestDigest:string;provider:"openai";model:string;httpStatus:number;bodyBase64:string;retainedBytes:number;complete:boolean;readFailed:boolean;receivedAt:string}>;
/** Bounded byte capture only. No JSON, response shape, usage or output access.
 * A partial prefix is explicitly incomplete and cannot become a candidate. */
export async function captureStoryboardRawEnvelope(response:Response,identity:{clientRequestId:string;requestDigest:string;model:string},signal?:AbortSignal):Promise<StoryboardRawEnvelope>{
 const chunks:Uint8Array[]=[];let length=0,complete=false,readFailed=false;
 const reader=response.body?.getReader();
 if(reader){
  const stopped=Symbol("storyboard-envelope-stopped");let stop!:()=>void;
  const interruption=new Promise<typeof stopped>(resolve=>{stop=()=>resolve(stopped);});
  const deadline=Date.now()+OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds;
  const timer=setTimeout(stop,OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds);
  signal?.addEventListener("abort",stop,{once:true});
  let emptyReads=0;
  try{for(let reads=0;reads<MAX_STORYBOARD_ENVELOPE_READS;reads++){
   if(signal?.aborted||Date.now()>=deadline){readFailed=true;break;}
   // Promise.race observes a late read rejection even after interruption wins.
   const next=await Promise.race([reader.read(),interruption]);
   if(next===stopped){readFailed=true;break;}
   if(next.done){complete=true;break;}
  if(!(next.value instanceof Uint8Array)){readFailed=true;break;}
  if(next.value.byteLength===0){if(++emptyReads>=MAX_STORYBOARD_ENVELOPE_EMPTY_READS){readFailed=true;break;}continue;}
  emptyReads=0;
  const room=MAX_STORYBOARD_ENVELOPE_BYTES-length;
  if(next.value.byteLength>room){if(room){chunks.push(next.value.slice(0,room));length+=room;}break;}
  chunks.push(next.value.slice());length+=next.value.byteLength;
  }
  if(!complete&&length<MAX_STORYBOARD_ENVELOPE_BYTES)readFailed=true;
 }catch{readFailed=true;}finally{
  clearTimeout(timer);signal?.removeEventListener("abort",stop);
  // Cancellation is best-effort: provider cancellation/zero usage is NOT proven.
  // Neither an unresolved cancel nor its rejection may block prefix custody.
  if(!complete){try{void reader.cancel().catch(()=>{});}catch{/* Retain the prefix. */}}
  try{reader.releaseLock();}catch{/* Pending reads already have rejection observers. */}
 }}
 else complete=true;
 const bytes=new Uint8Array(length);let cursor=0;for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.byteLength;}
 let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return Object.freeze({version:"output-storyboard-raw-envelope-v1",...identity,provider:"openai",httpStatus:response.status,bodyBase64:btoa(binary),retainedBytes:length,complete,readFailed,receivedAt:new Date().toISOString()});
}
export function storyboardEnvelopeText(envelope:StoryboardRawEnvelope){
 if(!envelope.complete||envelope.readFailed||envelope.retainedBytes>MAX_STORYBOARD_ENVELOPE_BYTES)throw new Error("output_storyboard_envelope_incomplete");
 const bytes=Uint8Array.from(atob(envelope.bodyBase64),c=>c.charCodeAt(0));
 if(bytes.byteLength!==envelope.retainedBytes)throw new Error("output_storyboard_envelope_invalid");
 return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
