import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";
import type { WorkerEnv } from "./runtime.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";

export type StoryboardFrameMedia = Readonly<{id:string;media_url:string;media_type:string;width:number;height:number;provider:string;
 provider_request_id:string;provider_submission_id:string;provider_model:string;source_content_hash:string}>;
const fail=():never=>{throw new Error("output_storyboard_private_frame_unavailable");};
/** Physical readback of the original private object, not a URL-only association.
 * This certifies container bytes/identity only; visual quality and meaning still
 * require the native result review, and no returned value authorizes spending. */
export async function readOutputStoryboardFrameMedia(env:WorkerEnv,ownerId:string,artifactId:string,index:number,frame:StoryboardFrameMedia,planBinding:string,lifetime:{signal?:AbortSignal;deadlineMs?:number}={}){
 if(!Number.isSafeInteger(index)||index<0||index>=4||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(artifactId)
  ||!/^[a-f0-9]{64}$/u.test(planBinding)||!frame||frame.id!==`${artifactId}-frame-${index+1}`||frame.provider!=="fal"
  ||frame.provider_model!=="ideogram/v4"||frame.media_type!=="image/png"||frame.width!==1536||frame.height!==1024
  ||!frame.provider_request_id||!frame.provider_submission_id||!/^[a-f0-9]{64}$/u.test(frame.source_content_hash))return fail();
 const key=`${ownerMediaNamespace(ownerId)}/generated/${frame.id}.png`;
 if(frame.media_url!=="/api/media/"+encodeURIComponent(key))return fail();
 const stopped=Symbol("storyboard-media-stopped");let stop!:()=>void;
 const interruption=new Promise<typeof stopped>(resolve=>{stop=()=>resolve(stopped);});
 const deadline=Math.min(lifetime.deadlineMs??Infinity,Date.now()+OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds);
 const current=()=>{if(!Number.isFinite(deadline)||Date.now()>=deadline||lifetime.signal?.aborted)return fail();};
 current();const timer=setTimeout(stop,Math.max(0,deadline-Date.now()));lifetime.signal?.addEventListener("abort",stop,{once:true});
 const bounded=async<T>(promise:Promise<T>):Promise<T>=>{const value=await Promise.race([promise,interruption]);if(value===stopped)return fail();current();return value;};
 let finished=false,complete=false,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let acquired:Awaited<ReturnType<WorkerEnv["MEDIA"]["get"]>>=null;
 const dispose=(body:ReadableStream)=>{try{void body.cancel().catch(()=>{});}catch{/* Cancellation is not provider/usage evidence. */}};
 try{
 const pending=env.MEDIA.get(key).then(value=>{acquired=value;if(finished&&value)dispose(value.body);return value;});
 const object=await bounded(pending),metadata=object?.customMetadata;
 if(!object||!metadata||typeof object.size!=="number"||object.size<=0||object.size>MAX_OUTPUT_ASSET_BYTES||metadata.ownerId!==ownerId||metadata.artifactId!==artifactId
  ||metadata.generationId!==frame.id||metadata.artifactRole!=="storyboard-frame"||metadata.source!=="provider-image-api"
  ||metadata.provider!=="fal"||metadata.model!==frame.provider_model||metadata.providerRequestId!==frame.provider_request_id
  ||metadata.providerSubmissionId!==frame.provider_submission_id||metadata.storyboardFrameIndex!==String(index)
  ||metadata.storyboardBindingSha256!==planBinding||metadata.sha256!==frame.source_content_hash||metadata.mimeType!=="image/png")return fail();
 const headers=new Headers();object.writeHttpMetadata(headers);if(headers.get("content-type")!=="image/png")return fail();
 reader=object.body.getReader();const chunks:Uint8Array[]=[];let length=0,emptyReads=0;
 for(let reads=0;reads<8192;reads++){
  const next=await bounded(reader.read());if(next.done){complete=true;break;}
  if(!(next.value instanceof Uint8Array)||next.value.byteLength>object.size-length||next.value.byteLength>MAX_OUTPUT_ASSET_BYTES-length)return fail();
  if(!next.value.byteLength){if(++emptyReads>=32)return fail();continue;}emptyReads=0;chunks.push(next.value.slice());length+=next.value.byteLength;
 }
 if(!complete||length!==object.size)return fail();
 const bytes=new Uint8Array(length);let cursor=0;for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.byteLength;}
 const inspection=await bounded(inspectOutputAsset(bytes,frame.id+".png"));
 if(inspection.status!=="inspected"||inspection.kind!=="image"||inspection.mimeType!=="image/png"||inspection.extension!=="png"
  ||inspection.facts.width!==1536||inspection.facts.height!==1024||inspection.sha256!==frame.source_content_hash)return fail();
 current();return Object.freeze({frameIndex:index,id:frame.id,mediaUrl:frame.media_url,sha256:inspection.sha256,byteLength:bytes.byteLength,
  width:1536,height:1024,mimeType:"image/png",provider:"fal",model:frame.provider_model,clientRequestId:frame.provider_submission_id,
  providerRequestId:frame.provider_request_id,storyboardBindingSha256:planBinding});
 }finally{
  finished=true;clearTimeout(timer);lifetime.signal?.removeEventListener("abort",stop);
  if(reader){if(!complete){try{void reader.cancel().catch(()=>{});}catch{/* Never wait for cancellation. */}}try{reader.releaseLock();}catch{/* Late read rejection is observed by Promise.race. */}}
  else if(acquired)dispose(acquired.body);
 }
}
