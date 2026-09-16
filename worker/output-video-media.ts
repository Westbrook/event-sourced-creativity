import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";
import { parseVideoOutputContract } from "../src/model/output-video-contract.ts";
import { OUTPUT_VIDEO_TRANSPORT } from "./output-video-execution.ts";
import type { WorkerEnv } from "./runtime.ts";
export type OutputVideoMediaResult = { artifactId: string; mediaUrl: string; mediaType: string; sha256: string; byteLength: number; clientRequestId: string; providerRequestId: string; model: string; requestDigest: string };
function fail(reason="unavailable"): never { throw new Error("output_video_media_"+reason); }
/** Seedance's nominal 480p grid is 864x496 (landscape) / 496x864
 * (portrait), not a literal 480px short edge. Keep standard 480px originals
 * readable, but never widen the aspect tolerance for arbitrary dimensions.
 * Provider table: https://fal.ai/models/bytedance/seedance-2.0/text-to-video
 * Verified 2026-09-16. Frame size in the contract selects orientation. */
export function outputVideoFrameDiagnostic(width:number,height:number,frameSize:"1280x720"|"720x1280") {
 const landscape=frameSize==="1280x720";
 if(width===(landscape?864:496)&&height===(landscape?496:864))return null;
 if(Math.min(width,height)!==480)return "dimensions";
 return Math.abs(width/height-(landscape?16/9:9/16))>.03?"aspect_ratio":null;
}
/** Bounded original private-object readback. Container/sample facts are not
 * decoded playback, visual quality or human acceptance. */
export async function readOutputVideoMedia(env: WorkerEnv, ownerId: string, contractValue: unknown, value: OutputVideoMediaResult, lifetime: { signal?: AbortSignal; deadlineMs: number }) {
 const contract=parseVideoOutputContract(contractValue),key=`${ownerMediaNamespace(ownerId)}/generated/${value.artifactId}.mp4`;
 if(!contract||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value.artifactId)||value.mediaUrl!=="/api/media/"+encodeURIComponent(key)
  ||value.mediaType!=="video/mp4"||value.model!==OUTPUT_VIDEO_TRANSPORT.model||![value.sha256,value.requestDigest].every(hash=>/^[a-f0-9]{64}$/u.test(hash))
  ||!Number.isSafeInteger(value.byteLength)||value.byteLength<1||value.byteLength>MAX_OUTPUT_ASSET_BYTES||!value.clientRequestId||!value.providerRequestId)fail("identity");
 const deadline=Math.min(lifetime.deadlineMs,Date.now()+OUTPUT_VIDEO_TRANSPORT.requestTimeoutMs),controller=new AbortController();
 const abort=()=>controller.abort(lifetime.signal?.reason??Error("output_video_media_interrupted"));
 if(lifetime.signal?.aborted)abort();else lifetime.signal?.addEventListener("abort",abort,{once:true});
 const current=()=>{if(controller.signal.aborted||!Number.isFinite(deadline)||Date.now()>=deadline)fail("lifetime");};
 const timer=setTimeout(abort,Math.max(0,deadline-Date.now()));let stopped!:()=>void;
 const interruption=new Promise<never>((_,reject)=>{stopped=()=>reject(Error("output_video_media_interrupted"));controller.signal.addEventListener("abort",stopped,{once:true});});
 const bounded=async<T>(work:Promise<T>)=>{current();const result=await Promise.race([work,interruption]);current();return result;};
 let finished=false,complete=false,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const dispose=(body:ReadableStream)=>{try{void body.cancel().catch(()=>{});}catch{/* Nonblocking cancellation. */}};
 try{
  current();
  const object=await bounded(env.MEDIA.get(key).then(object=>{if(finished&&object)dispose(object.body);return object;}));
  const metadata=object?.customMetadata;
  if(!object||!metadata||object.size!==value.byteLength||metadata.ownerId!==ownerId||metadata.artifactId!==value.artifactId||metadata.source!=="provider-generated-media"
   ||metadata.artifactRole!=="document-video"||metadata.provider!=="fal"||metadata.model!==value.model||metadata.providerJobId!==value.providerRequestId
   ||metadata.providerRequestId!==value.providerRequestId||metadata.providerSubmissionId!==value.clientRequestId||metadata.outputVideoRequestDigest!==value.requestDigest
   ||metadata.sha256!==value.sha256||metadata.mimeType!=="video/mp4"){if(object)dispose(object.body);fail("object_metadata");}
  const headers=new Headers();object.writeHttpMetadata(headers);if(headers.get("content-type")!=="video/mp4"){dispose(object.body);fail("content_type");}
  reader=object.body.getReader();const chunks:Uint8Array[]=[];let length=0;
  for(let reads=0;reads<OUTPUT_VIDEO_TRANSPORT.maximumChunks;reads++){
   const next=await bounded(reader.read());if(next.done){complete=true;break;}
   if(!(next.value instanceof Uint8Array)||!next.value.byteLength||length+next.value.byteLength>value.byteLength)fail("stream_chunk");
   chunks.push(next.value.slice());length+=next.value.byteLength;
  }
  if(!complete||length!==value.byteLength)fail("stream_length");
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const inspection=await bounded(inspectOutputAsset(bytes,value.artifactId+".mp4")),facts=inspection.facts;
  const width=Number(facts.width),height=Number(facts.height);
  if(inspection.status!=="inspected"||inspection.kind!=="video"||inspection.mimeType!=="video/mp4"||inspection.extension!=="mp4")fail("inspection");
  if(inspection.sha256!==value.sha256)fail("digest");
  if(facts.durationBasis!=="mp4-track-timeline")fail("duration_basis");
  if(!Number.isFinite(facts.durationSeconds)||Math.abs(Number(facts.durationSeconds)-4)>1/24+.001)fail("duration");
  if(facts.codec!=="avc1")fail("codec");
  if(facts.audioCodec!==undefined)fail("audio_present");
  if(facts.rotationDegrees!==0)fail("rotation");
  const frameFailure=outputVideoFrameDiagnostic(width,height,contract.frameSize);if(frameFailure)fail(frameFailure);
  current();return{bytes,inspection,media:Object.freeze({...value,width,height,durationSeconds:facts.durationSeconds!,audioTracks:0,codec:"avc1",rotationDegrees:0})};
 }finally{finished=true;clearTimeout(timer);lifetime.signal?.removeEventListener("abort",abort);controller.signal.removeEventListener("abort",stopped);controller.abort();
  if(reader){if(!complete){try{void reader.cancel().catch(()=>{});}catch{/* Already closed. */}}try{reader.releaseLock();}catch{/* Pending rejection remains observed. */}}
 }
}
