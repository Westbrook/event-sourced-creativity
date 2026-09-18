import { canonicalJson } from "../experiences/compiler.ts";
import { parseStoryboardOutputContract } from "./output-storyboard-contract.ts";
import { readOutputFalImageContract } from "./output-fal-image-contract.ts";
import { documentRenderTokenReservation } from "./generation-budget.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "./output-execution-policy.ts";
export const STORYBOARD_READY_REASON = "Exactly 4 frames from the authored story and visual direction. Review the resulting images; completion does not guarantee creative acceptance.";
export const STORYBOARD_TRANSFER = "This check sends nothing. After authorization and Create, Forma sends the current Document context to OpenAI once to plan exactly four frames, then each planned frame direction to fal.ai / Ideogram 4 for one PNG. Before each of the four images, the exact final text prompt also goes to OpenAI (omni-moderation-latest) for its existing safety check. Those up to four safety checks are separate from the five paid generation stages; no reference pixels, repair request or automatic retry is authorized. This is a published-rate allowance, not a provider invoice.";
const row=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const id=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(v);
const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
function capture(value:unknown):unknown{
 let nodes=0,chars=0;const ancestors=new Set<object>();
 const visit=(v:unknown,depth:number):unknown=>{
  if(++nodes>4096||depth>16)throw Error("storyboard_offer_limit");
  if(v===null||typeof v==="boolean"||typeof v==="number"&&Number.isFinite(v))return v;
  if(typeof v==="string"&&(chars+=v.length)<=131072)return v;
  if(!v||typeof v!=="object"||ancestors.has(v))throw Error("storyboard_offer_invalid");
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
  if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw Error("storyboard_offer_invalid");
  const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);ancestors.add(v);
  if(keys.some(k=>typeof k!=="string")||keys.length>256)throw Error("storyboard_offer_limit");
  if(array){
   if(keys.length!==v.length+1)throw Error("storyboard_offer_invalid");
   const result:unknown[]=[];
   for(let i=0;i<v.length;i++){const d=ds[String(i)];if(!d?.enumerable||!Object.hasOwn(d,"value"))throw Error("storyboard_offer_invalid");result.push(visit(d.value,depth+1));}
   ancestors.delete(v);return Object.freeze(result);
  }
  const result:Record<string,unknown>=Object.create(null);
  for(const [key,d]of Object.entries(ds)){if(!d.enumerable||!Object.hasOwn(d,"value")||["__proto__","prototype","constructor"].includes(key))throw Error("storyboard_offer_invalid");result[key]=visit(d.value,depth+1);}
  ancestors.delete(v);return Object.freeze(result);
 };return visit(value,0);
}
/** One closed quoted route. This parser proves neither source custody nor an
 * approval; the native preflight's private proof and original command own those. */
export function readStoryboardExecutionOffer(value:unknown){
 try{
  const offer=capture(value);if(!row(offer)||!exact(offer,["targetId","available","reasonCode","reason","transferCode","transferDescription","provider","model","route","maximumMicrousd","maximumCalls","maximumTokens","settings"])
   ||!id(offer.targetId)||offer.available!==true||offer.reasonCode!=="output_storyboard_ready"||offer.reason!==STORYBOARD_READY_REASON
   ||offer.transferCode!=="output_transfer_storyboard_after_authorization"||offer.transferDescription!==STORYBOARD_TRANSFER
   ||offer.provider!=="fal"||offer.model!=="ideogram/v4"||offer.route!=="document-storyboard-four-frames-manual-v1"
   ||offer.maximumCalls!==5||offer.maximumTokens!==documentRenderTokenReservation("storyboard",4,1)||!positive(offer.maximumMicrousd))return null;
  const settings=offer.settings;if(!row(settings)||!exact(settings,["kind","payload","calls","executionPolicy","preparationOnly","executionAvailable","explicitCostAndTransferApprovalRequired","original"])
   ||settings.kind!=="render_document"||settings.preparationOnly!==false||settings.executionAvailable!==true||settings.explicitCostAndTransferApprovalRequired!==true
   ||!same(settings.executionPolicy,OUTPUT_NATIVE_EXECUTION_POLICY))return null;
  const payload=settings.payload,original=settings.original;
  if(!row(payload)||!exact(payload,["artifactKind","productionMode","itemCount","outputStoryboard","outputStoryboardPlanner","outputFalImage","outputTargetInstructions","paidMediaConfirmed","budgetAcknowledged","preflightAcknowledged"])
   ||payload.artifactKind!=="storyboard"||payload.productionMode!=="manual"||payload.itemCount!==4||payload.paidMediaConfirmed!==true||payload.budgetAcknowledged!==true||payload.preflightAcknowledged!==true
   ||typeof payload.outputTargetInstructions!=="string"||!payload.outputTargetInstructions.trim()||payload.outputTargetInstructions.length>16384)return null;
  const contract=parseStoryboardOutputContract(payload.outputStoryboard),fal=readOutputFalImageContract(payload.outputFalImage),planner=payload.outputStoryboardPlanner;
  if(!contract||!fal||fal.width!==1536||fal.height!==1024||!row(planner)||!exact(planner,["contract","requestDigest","maximumInputTokens"])
   ||!same(planner.contract,contract)||typeof planner.requestDigest!=="string"||!/^[a-f0-9]{64}$/u.test(planner.requestDigest)
   ||!positive(planner.maximumInputTokens)||planner.maximumInputTokens<4096||planner.maximumInputTokens>124000)return null;
  if(!row(original)||!exact(original,["requestId","expiresAt","draftId","actorUserId","projectId","documentId","sourceDigest","requirementsDigest"])
   ||typeof original.requestId!=="string"||!/^storyboard-[a-f0-9]{64}$/u.test(original.requestId)||original.draftId!==contract.source.draftId
   ||!["actorUserId","projectId","documentId","sourceDigest","requirementsDigest"].every(k=>id(original[k]))
   ||typeof original.expiresAt!=="string"||!Number.isFinite(Date.parse(original.expiresAt))||new Date(Date.parse(original.expiresAt)).toISOString()!==original.expiresAt)return null;
  const calls=settings.calls;if(!Array.isArray(calls)||calls.length!==5)return null;let total=0;
  for(let index=0;index<5;index++){
   const call=calls[index];if(!row(call)||!exact(call,["stage","provider","model","maximumMicrousd","maximumInputTokens","maximumOutputTokens"])
    ||call.stage!==(index===0?"planning:0:initial":`image:frame:${index}`)||call.provider!==(index===0?"openai":"fal")
    ||call.model!==(index===0?fal.plannerModel:fal.model)||!positive(call.maximumMicrousd)
    ||call.maximumInputTokens!==(index===0?planner.maximumInputTokens:0)||call.maximumOutputTokens!==(index===0?4000:0)
    ||index>0&&call.maximumMicrousd!==fal.maximumMicrousd)return null;total+=call.maximumMicrousd;
  }
  if(!Number.isSafeInteger(total)||total!==offer.maximumMicrousd)return null;
  return Object.freeze({offer,settings,payload,contract,fal,planner,original,calls,maximumMicrousd:total});
 }catch{return null;}
}

