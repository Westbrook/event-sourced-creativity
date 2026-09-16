import { parseStoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
import { OUTPUT_FAL_PLANNING_MODEL } from "./output-fal-image-contract.ts";
import { captureOutputStoryboardPlan } from "./output-storyboard-plan.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";

export type StoryboardPlannerExecution = Readonly<{ contract: NonNullable<ReturnType<typeof parseStoryboardOutputContract>>; requestDigest: string; maximumInputTokens: number }>;
const fail = (): never => { throw new Error("output_storyboard_planner_request_invalid"); };
const digest = async (raw: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))),n=>n.toString(16).padStart(2,"0")).join("");
function object(value: unknown): Record<string,unknown> {
 if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).some(key=>typeof key!=="string"||!descriptors[key].enumerable||!("value" in descriptors[key])))return fail();
 return value as Record<string,unknown>;
}
export function readStoryboardPlannerExecution(value: unknown): StoryboardPlannerExecution | null {
 try {
  const row=object(value),contract=parseStoryboardOutputContract(row.contract);
  if(Object.keys(row).length!==3||!contract||typeof row.requestDigest!=="string"||!/^([a-f0-9]{64})$/u.test(row.requestDigest)
   ||!Number.isSafeInteger(row.maximumInputTokens)||Number(row.maximumInputTokens)<4096||Number(row.maximumInputTokens)>1_000_000)return null;
  return Object.freeze({contract,requestDigest:row.requestDigest,maximumInputTokens:Number(row.maximumInputTokens)});
 }catch{return null;}
}

/** Exact request from the existing document adapter. Offline preparation and
 * runtime share these bytes; this record contains no grant, claim or dispatch. */
export async function captureStoryboardPlannerRequest(sourceContract: unknown, requestBody: string, clientRequestId: string) {
 const contract=parseStoryboardOutputContract(sourceContract);
 if(!contract||typeof requestBody!=="string"||new TextEncoder().encode(requestBody).byteLength>262144
  ||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(clientRequestId))return fail();
 const row=object(JSON.parse(requestBody)),format=object(object(row.text).format),schema=object(format.schema);
 const items=object(object(schema.properties).items),reasoning=object(row.reasoning),cache=object(row.prompt_cache_options);
 if(row.model!==OUTPUT_FAL_PLANNING_MODEL||row.store!==false||row.max_output_tokens!==4000||row.service_tier!=="default"||cache.mode!=="explicit"
  ||reasoning.effort!=="low"||format.type!=="json_schema"||format.strict!==true||format.name!=="document_storyboard"
  ||items.minItems!==4||items.maxItems!==4||typeof row.instructions!=="string"||!row.instructions.trim()||typeof row.input!=="string"||!row.input.trim())return fail();
 const input=object(JSON.parse(row.input));
 if(JSON.stringify(parseStoryboardOutputContract(input.storyboard_contract))!==JSON.stringify(contract))return fail();
 const requestDigest=await digest(requestBody),maximumInputTokens=new TextEncoder().encode(requestBody).byteLength+4096;
 return Object.freeze({requestBody,requestDigest,maximumInputTokens,maximumOutputTokens:4000,contract,
  attempt:Object.freeze({model:OUTPUT_FAL_PLANNING_MODEL,maximumInputTokens,maximumOutputTokens:4000,clientRequestId,
   logicalCallKey:"planning:0:initial",requestDigest,storyboardPlanning:Object.freeze({contract,requestBody})})});
}

export async function readStoryboardPlannerAttempt(attempt: ProviderAttemptPreflight, expected: unknown) {
 const execution=readStoryboardPlannerExecution(expected),row=object(attempt.storyboardPlanning);
 if(!execution||Object.keys(row).length!==2||typeof row.requestBody!=="string")return fail();
 const captured=await captureStoryboardPlannerRequest(row.contract,row.requestBody,attempt.clientRequestId);
 if(JSON.stringify(captured.contract)!==JSON.stringify(execution.contract)||captured.requestDigest!==execution.requestDigest
  ||captured.maximumInputTokens!==execution.maximumInputTokens||attempt.logicalCallKey!==captured.attempt.logicalCallKey
  ||attempt.model!==captured.attempt.model||attempt.maximumInputTokens!==captured.maximumInputTokens||attempt.maximumOutputTokens!==4000
  ||attempt.requestDigest!==captured.requestDigest)return fail();
 return captured;
}

/** Validate the first original provider envelope before any legacy artifact
 * normalization or repair. Four malformed frames are a failure, never a reason
 * to make an unplanned second planner call. Cost/receipt proof remains separate. */
export async function captureStoryboardPlannerResponse(envelope: unknown, raw: string, contract: unknown, plannerRequestBody?:string) {
 const row=object(envelope),usage=object(row.usage);
 if(row.model!==OUTPUT_FAL_PLANNING_MODEL||row.status!=="completed"||typeof row.id!=="string"||row.incomplete_details
  ||!["input_tokens","output_tokens","total_tokens"].every(key=>Number.isSafeInteger(usage[key])&&Number(usage[key])>=0)
  ||Number(usage.total_tokens)!==Number(usage.input_tokens)+Number(usage.output_tokens))return fail();
 if(Array.isArray(row.output)&&row.output.some(value=>{const item=object(value);return item.type==="refusal"||Array.isArray(item.content)&&item.content.some(value=>{const part=object(value);return part.type==="refusal"||Boolean(part.refusal);});}))return fail();
 const texts=Array.isArray(row.output)?row.output.flatMap(value=>{const item=object(value);return Array.isArray(item.content)?item.content.map(object).filter(part=>part.type==="output_text").map(part=>part.text):[];}):[];
 if(texts.length>1||texts.some(text=>typeof text!=="string")||typeof row.output_text==="string"&&texts.length===1&&row.output_text!==texts[0]
  ||(row.output_text||texts[0]||"")!==raw)return fail();
 if(typeof raw!=="string"||new TextEncoder().encode(raw).byteLength>262144)return fail();
 return captureOutputStoryboardPlan(JSON.parse(raw),contract,row.id,plannerRequestBody);
}
