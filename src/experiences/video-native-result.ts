import {canonicalJson,freeze} from "./compiler.ts";
import {snapshotExperienceEvidence as snapshot} from "./evidence-snapshot.ts";
import {parseVideoOutputContract,type VideoOutputContract} from "../model/output-video-contract.ts";
import {ownerMediaNamespace} from "../model/media-ownership.ts";
import type {NativeRetainedOutputDto} from "../model/native-retained-output.ts";
const row=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
const id=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(v);
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/u.test(v);
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const own=(v:unknown,k:string)=>{if(!row(v))return undefined;const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,"value")?d.value:undefined;};
const sha=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),n=>n.toString(16).padStart(2,"0")).join("");
type Media=Readonly<{artifactId:string;mediaUrl:string;mediaType:"video/mp4";sha256:string;byteLength:number;clientRequestId:string;providerRequestId:string;model:"bytedance/seedance-2.0/reference-to-video";requestDigest:string;width:number;height:number;durationSeconds:number;audioTracks:0;codec:"avc1";rotationDegrees:0}>;
type Receipt=Readonly<{version:"output-video-completion-v1";contract:VideoOutputContract;jobId:string;slotId:string;artifactId:string;actorUserId:string;documentId:string;streamId:string;correlationId:string;attempt:number;grantId:string;targetId:string;planRevisionId:string;targetContractDigest:string;sourceDigest:string;plannerRequestDigest:string;plannerResponseId:string;planSha256:string;providerCallCount:2;media:Media;visualReview:"required"}>;
export type ExperienceVideoEvidence=Readonly<{receipt:Receipt;contentSha256:string;inputSha256:string}>;
const receiptKeys=["version","contract","jobId","slotId","artifactId","actorUserId","documentId","streamId","correlationId","attempt","grantId","targetId","planRevisionId","targetContractDigest","sourceDigest","plannerRequestDigest","plannerResponseId","planSha256","providerCallCount","media","visualReview"];
const mediaKeys=["artifactId","mediaUrl","mediaType","sha256","byteLength","clientRequestId","providerRequestId","model","requestDigest","width","height","durationSeconds","audioTracks","codec","rotationDegrees"];
/** A display witness only. The server revalidates private original bytes. */
export function captureExperienceVideoEvidence(value:unknown):ExperienceVideoEvidence|null{
 try{
  const receipt=snapshot(own(value,"output_video")),contentSha256=own(value,"video_content_sha256"),inputSha256=own(value,"video_input_sha256");
  if(!row(receipt)||!exact(receipt,receiptKeys)||!hash(contentSha256)||!hash(inputSha256))return null;
  const contract=parseVideoOutputContract(receipt.contract),m=receipt.media;
  if(!contract||receipt.version!=="output-video-completion-v1"||receipt.providerCallCount!==2||receipt.visualReview!=="required"
   ||!["jobId","slotId","artifactId","actorUserId","documentId","streamId","correlationId","grantId","targetId","planRevisionId","plannerResponseId"].every(k=>id(receipt[k]))
   ||!["plannerRequestDigest","planSha256"].every(k=>hash(receipt[k]))||receipt.planSha256!==contentSha256
   ||!["targetContractDigest","sourceDigest"].every(k=>typeof receipt[k]==="string"&&receipt[k].length>0&&receipt[k].length<=256)
   ||receipt.streamId!==`creative:${receipt.actorUserId}`||!Number.isSafeInteger(receipt.attempt)||Number(receipt.attempt)<1
   ||!row(m)||!exact(m,mediaKeys)||m.artifactId!==receipt.artifactId||m.mediaUrl!=="/api/media/"+encodeURIComponent(`${ownerMediaNamespace(String(receipt.actorUserId))}/generated/${receipt.artifactId}.mp4`)
   ||m.mediaType!=="video/mp4"||m.model!=="bytedance/seedance-2.0/reference-to-video"||!hash(m.sha256)||!hash(m.requestDigest)||!id(m.clientRequestId)||!id(m.providerRequestId)
   ||!Number.isSafeInteger(m.byteLength)||Number(m.byteLength)<1||Number(m.byteLength)>24*1024*1024||m.audioTracks!==0||m.codec!=="avc1"||m.rotationDegrees!==0
   ||!Number.isFinite(m.durationSeconds)||Math.abs(Number(m.durationSeconds)-4)>1/24+.001
   ||![m.width,m.height].every(n=>Number.isSafeInteger(n)&&Number(n)>0)||Math.min(Number(m.width),Number(m.height))!==480
   ||Math.abs(Number(m.width)/Number(m.height)-(contract.frameSize==="1280x720"?16/9:9/16))>.03)return null;
  return freeze({receipt:receipt as unknown as Receipt,contentSha256,inputSha256});
 }catch{return null;}
}
export function captureExperienceVideoTarget(value:unknown,expected:VideoOutputContract|null):VideoOutputContract|null{
 try{const t=snapshot(value),contract=parseVideoOutputContract(expected);
  if(!row(t)||!contract||!same(t.video_contract,contract)||t.media_kind!=="video"||["narrative_contract","scene_contract","audio_contract","storyboard_contract"].some(k=>Object.hasOwn(t,k))
   ||!same(t.content_quantity,{kind:"exact",unit:"second",value:4})||!same(t.count_policy,{kind:"exact",unit:"second",value:4})
   ||["aspect_ratio","variant_id","member_id","suggested_count"].some(k=>t[k]!==null)
   ||!same(t.quantity,{kind:"exact",unit:"video",value:1})||!same(t.source_scope,{kind:"document"})||!same(t.coverage,{kind:"document_context"}))return null;
  return contract;
 }catch{return null;}
}
export async function verifyExperienceVideoRead(evidence:ExperienceVideoEvidence,raw:unknown,rawInput:unknown,dto:NativeRetainedOutputDto,
 expected:{contract:VideoOutputContract;documentId:string;projectId:string;artifactId:string;ownerId:string;jobId:string;slotId:string;grantId:string;targetId:string;planRevisionId:string;targetContractDigest:string;sourceDigest:string;correlationId:string},now=Date.now()){
 try{
  if(typeof raw!=="string"||typeof rawInput!=="string"||new TextEncoder().encode(raw).length>1048576||new TextEncoder().encode(rawInput).length>1048576)return false;
  const e=snapshot(evidence) as ExperienceVideoEvidence,x=snapshot(expected) as typeof expected,r=snapshot(dto) as NativeRetainedOutputDto;
  const receipt=captureExperienceVideoEvidence({output_video:e.receipt,video_content_sha256:e.contentSha256,video_input_sha256:e.inputSha256})?.receipt;
  if(!receipt||!same(receipt.contract,x.contract)||r.output!=="video"||r.kind!=="native-retained-output"||r.schemaVersion!==1||r.selection.revision!==0
   ||r.selection.documentId!==x.documentId||r.selection.artifactId!==x.artifactId||r.selection.contentSha256!==e.contentSha256||!Number.isFinite(now)||!Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)<=now
   ||receipt.actorUserId!==x.ownerId||["documentId","artifactId","jobId","slotId","grantId","targetId","planRevisionId","targetContractDigest","sourceDigest","correlationId"].some(k=>receipt[k as keyof Receipt]!==x[k as keyof typeof x]))return false;
  const content=JSON.parse(raw),input=JSON.parse(rawInput);
  if(!row(content)||!Array.isArray(content.items)||content.items.length!==1||content.presentation!==null||content.title!==r.title||r.content.clips.length!==1||r.content.primaryMedia?.url!==receipt.media.mediaUrl||r.content.primaryMedia.mediaType!=="video/mp4"
   ||!row(input)||input.schema_version!==1||input.artifact_kind!=="video"||input.document_id!==x.documentId||input.project_id!==x.projectId||input.artifact_id!==x.artifactId||!same(input.output_video,receipt)
   ||!row(input.request)||input.request.source_surface!=="outputs"||input.request.production_mode!=="manual"||input.request.item_count!==1||!row(input.planner)||input.planner.provider!=="openai"||input.planner.response_id!==receipt.plannerResponseId)return false;
  const item=content.items[0],clip=r.content.clips[0];if(!row(item)||!clip||clip.title!==item.title||clip.body!==item.body||clip.notes!==item.notes||clip.id!==`${x.artifactId}-item-1`||clip.media?.url!==receipt.media.mediaUrl||clip.media.mediaType!=="video/mp4"||r.content.content_markdown!==content.content_markdown)return false;
  const hashes=await Promise.all([sha(raw),sha(rawInput)]);return hashes[0]===e.contentSha256&&hashes[1]===e.inputSha256;
 }catch{return false;}
}
