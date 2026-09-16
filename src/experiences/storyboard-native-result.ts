import { snapshotExperienceEvidence as snapshot } from "./evidence-snapshot.ts";
import { canonicalJson, freeze } from "./compiler.ts";
import { createStoryboardOutputContract, parseStoryboardOutputContract, type StoryboardOutputContract } from "../model/output-storyboard-contract.ts";
import { ownerMediaNamespace } from "../model/media-ownership.ts";
import type { NativeRetainedOutputDto } from "../model/native-retained-output.ts";

const row=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
const id=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(v);
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/u.test(v);
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const sha=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,"0")).join("");
const own=(value:unknown,key:string)=>{if(!row(value))return undefined;const d=Object.getOwnPropertyDescriptor(value,key);return d?.enumerable&&Object.hasOwn(d,"value")?d.value:undefined;};
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
type Frame=Readonly<{frameIndex:number;id:string;mediaUrl:string;sha256:string;byteLength:number;width:1536;height:1024;mimeType:"image/png";provider:"fal";model:"ideogram/v4";clientRequestId:string;providerRequestId:string;storyboardBindingSha256:string}>;
type Receipt=Readonly<{version:"output-storyboard-completion-v1";contract:StoryboardOutputContract;jobId:string;slotId:string;artifactId:string;
 actorUserId:string;documentId:string;streamId:string;correlationId:string;attempt:number;grantId:string;targetId:string;planRevisionId:string;
 targetContractDigest:string;sourceDigest:string;plannerRequestDigest:string;plannerResponseId:string;planSha256:string;storyboardBindingSha256:string;
 frameCount:4;frames:readonly Frame[];providerCallCount:5;visualReview:"required"}>;
export type ExperienceStoryboardEvidence=Readonly<{receipt:Receipt;contentSha256:string;inputSha256:string}>;
const receiptKeys=["version","contract","jobId","slotId","artifactId","actorUserId","documentId","streamId","correlationId","attempt","grantId","targetId","planRevisionId","targetContractDigest","sourceDigest","plannerRequestDigest","plannerResponseId","planSha256","storyboardBindingSha256","frameCount","frames","providerCallCount","visualReview"];
const frameKeys=["frameIndex","id","mediaUrl","sha256","byteLength","width","height","mimeType","provider","model","clientRequestId","providerRequestId","storyboardBindingSha256"];

/** Closed original completion evidence only; this is neither authorization nor
 * a declaration that the images satisfy the author's creative intent. */
export function captureExperienceStoryboardEvidence(value:unknown):ExperienceStoryboardEvidence|null{
 try{
  const receipt=snapshot(own(value,"output_storyboard")),contentSha256=own(value,"storyboard_content_sha256"),inputSha256=own(value,"storyboard_input_sha256");
  if(!row(receipt)||!exact(receipt,receiptKeys)||!hash(contentSha256)||!hash(inputSha256)||!parseStoryboardOutputContract(receipt.contract)
   ||receipt.version!=="output-storyboard-completion-v1"||receipt.frameCount!==4||receipt.providerCallCount!==5||receipt.visualReview!=="required"
   ||!["jobId","slotId","artifactId","actorUserId","documentId","streamId","correlationId","grantId","targetId","planRevisionId","plannerResponseId"].every(k=>id(receipt[k]))
   ||!["plannerRequestDigest","planSha256","storyboardBindingSha256"].every(k=>hash(receipt[k]))
   ||!["targetContractDigest","sourceDigest"].every(k=>typeof receipt[k]==="string"&&receipt[k].length>0&&receipt[k].length<=256)
   ||receipt.streamId!==`creative:${receipt.actorUserId}`||!Number.isSafeInteger(receipt.attempt)||Number(receipt.attempt)<1
   ||!Array.isArray(receipt.frames)||receipt.frames.length!==4)return null;
  for(let index=0;index<4;index++){
   const frame=receipt.frames[index];
   if(!row(frame)||!exact(frame,frameKeys)||frame.frameIndex!==index||frame.id!==`${receipt.artifactId}-frame-${index+1}`
    ||frame.mediaUrl!=="/api/media/"+encodeURIComponent(`${ownerMediaNamespace(String(receipt.actorUserId))}/generated/${frame.id}.png`)
    ||!hash(frame.sha256)||!Number.isSafeInteger(frame.byteLength)||Number(frame.byteLength)<=0||Number(frame.byteLength)>24*1024*1024
    ||frame.width!==1536||frame.height!==1024||frame.mimeType!=="image/png"||frame.provider!=="fal"||frame.model!=="ideogram/v4"
    ||!id(frame.clientRequestId)||!id(frame.providerRequestId)||frame.storyboardBindingSha256!==receipt.storyboardBindingSha256)return null;
  }
  if(new Set(receipt.frames.map(f=>f.clientRequestId)).size!==4||new Set([receipt.plannerResponseId,...receipt.frames.map(f=>f.providerRequestId)]).size!==5)return null;
  return freeze({receipt:receipt as unknown as Receipt,contentSha256,inputSha256});
 }catch{return null;}
}

/** Compare the original retained intake, both private strings and the canonical
 * server DTO. Caller retains the current source/job/read lease around awaits. */
export async function verifyExperienceStoryboardRead(evidence:ExperienceStoryboardEvidence,raw:unknown,rawInput:unknown,dto:NativeRetainedOutputDto,
 expected:{source:unknown;documentId:string;projectId:string;artifactId:string;ownerId:string;jobId:string;slotId:string;grantId:string;
  targetId:string;planRevisionId:string;targetContractDigest:string;sourceDigest:string;correlationId:string},now=Date.now()){
 try{
  if(typeof raw!=="string"||typeof rawInput!=="string"||new TextEncoder().encode(raw).length>1_048_576||new TextEncoder().encode(rawInput).length>1_048_576||!Number.isFinite(now))return false;
  const e=snapshot(evidence) as ExperienceStoryboardEvidence,x=snapshot(expected) as typeof expected,result=snapshot(dto) as NativeRetainedOutputDto;
  const checked=captureExperienceStoryboardEvidence({output_storyboard:e.receipt,storyboard_content_sha256:e.contentSha256,storyboard_input_sha256:e.inputSha256});
  const contract=createStoryboardOutputContract(x.source),receipt=checked?.receipt;
  if(!contract||!receipt||!same(receipt.contract,contract)||result.kind!=="native-retained-output"||result.schemaVersion!==1||result.output!=="storyboard"||result.selection.revision!==0
   ||result.selection.documentId!==x.documentId||result.selection.artifactId!==x.artifactId||result.selection.contentSha256!==e.contentSha256
   ||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=now||result.content.frames.length!==4
   ||receipt.actorUserId!==x.ownerId||["documentId","artifactId","jobId","slotId","grantId","targetId","planRevisionId","targetContractDigest","sourceDigest","correlationId"].some(k=>receipt[k as keyof Receipt]!==x[k as keyof typeof x]))return false;
  const content=JSON.parse(raw),input=JSON.parse(rawInput);
  if(!row(content)||!Array.isArray(content.items)||content.items.length!==4||content.presentation!==null||content.title!==result.title
   ||!row(input)||input.schema_version!==1||input.artifact_kind!=="storyboard"||input.document_id!==x.documentId
   ||input.project_id!==x.projectId||input.artifact_id!==x.artifactId||!same(input.output_storyboard,receipt)
   ||!row(input.request)||input.request.source_surface!=="outputs"||input.request.production_mode!=="manual"||input.request.item_count!==4
   ||!row(input.planner)||input.planner.provider!=="openai"||input.planner.response_id!==receipt.plannerResponseId)return false;
  // Request-local aliases bind the exact planner request; empty/omitted aliases
  // retain the original hash, matching the server's canonical plan capture.
  const hasGroups=content.items.some(item=>row(item)&&Array.isArray(item.context_group_ids)&&item.context_group_ids.length>0);
  const [contentHash,inputHash,bindingHash]=await Promise.all([sha(raw),sha(rawInput),sha(JSON.stringify({contract,plannerResponseId:receipt.plannerResponseId,planSha256:receipt.planSha256,...(hasGroups?{plannerRequestDigest:receipt.plannerRequestDigest}:{})}))]);
  if(contentHash!==e.contentSha256||contentHash!==receipt.planSha256||inputHash!==e.inputSha256||bindingHash!==receipt.storyboardBindingSha256)return false;
  return content.items.every((item,index)=>{
   const frame=result.content.frames[index],saved=receipt.frames[index];
   return row(item)&&frame&&saved&&frame.id===saved.id&&frame.title===item.title&&frame.body===item.body&&frame.notes===item.notes
    &&frame.imagePrompt===item.image_prompt&&frame.image?.url===saved.mediaUrl&&frame.image.mediaType===saved.mimeType
    &&frame.image.width===saved.width&&frame.image.height===saved.height;
  });
 }catch{return false;}
}

export function experienceStoryboardItemsMatch(value:unknown,evidence:ExperienceStoryboardEvidence):boolean{
 try{
  const items=snapshot(value);
  return Array.isArray(items)&&items.length===4&&items.every((item,index)=>{
   const frame=evidence.receipt.frames[index];
   return row(item)&&frame&&item.id===frame.id&&item.media_url===frame.mediaUrl&&item.media_type===frame.mimeType
    &&item.width===frame.width&&item.height===frame.height;
  });
 }catch{return false;}
}

/** Exact original single-document target; no mixed/foreign output contract. */
export function captureExperienceStoryboardTarget(value:unknown,source:unknown):StoryboardOutputContract|null{
 try{
  const target=snapshot(value),expected=createStoryboardOutputContract(snapshot(source));
  if(!row(target)||!expected||!same(target.storyboard_contract,expected)||target.media_kind!=="document"
   ||["narrative_contract","scene_contract","audio_contract","video_contract"].some(k=>Object.hasOwn(target,k))
   ||!same(target.quantity,{kind:"exact",unit:"document",value:1})||!same(target.source_scope,{kind:"document"})||!same(target.coverage,{kind:"document_context"})
   ||["aspect_ratio","content_quantity","count_policy","variant_id","member_id","suggested_count"].some(k=>target[k]!==null))return null;
  return expected;
 }catch{return null;}
}
