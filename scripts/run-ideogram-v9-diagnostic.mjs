import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IMAGE_ADAPTER_EVALUATION_CORPUS } from "../evals/image-adapters/canvas-image-corpus-v5.ts";
import { buildCreativeImagePrompt } from "../worker/openai-adapter.ts";
import { FAL_IDEOGRAM_ADAPTER_ID, FAL_IDEOGRAM_ADAPTER_VERSION, generateFalCreativeImage } from "../worker/fal-image-adapter.ts";

const PAID_APPROVAL="I explicitly approve this three-request Ideogram v9 diagnostic";
const args=new Map(process.argv.slice(2).map((part)=>{const [key,...rest]=part.split("=");return[key,rest.join("=")||"true"];}));
if(FAL_IDEOGRAM_ADAPTER_VERSION!=="v9")throw new Error("ideogram_v9_diagnostic_retired: the retained v9 run is complete; do not relabel a newer adapter as v9");
if(args.get("--approve-paid-diagnostic")!==PAID_APPROVAL)throw new Error(`paid_diagnostic_approval_required: pass --approve-paid-diagnostic=${JSON.stringify(PAID_APPROVAL)} only after the active user approves this exact three-request run`);

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
async function loadEnv(){const values={...process.env};const file=await readFile(path.join(root,".env.local"),"utf8").catch(()=>"");for(const raw of file.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith("#"))continue;const index=line.indexOf("=");if(index<1)continue;const key=line.slice(0,index).trim();let value=line.slice(index+1).trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);if(!String(values[key]??"").trim())values[key]=value;}return values;}
const env=await loadEnv();if(!env.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY is not configured for the required safety preflight");if(!env.FAL_KEY)throw new Error("FAL_KEY is not configured for the Ideogram diagnostic");
const workerEnv={OPENAI_API_KEY:env.OPENAI_API_KEY,OPENAI_PROJECT:env.OPENAI_PROJECT,FAL_KEY:env.FAL_KEY,FAL_IMAGE_MODEL:env.FAL_IMAGE_MODEL??"ideogram/v4",FAL_IMAGE_PREVIEW_MODEL:env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast",FAL_IMAGE_EDIT_MODEL:env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image"};
const item=IMAGE_ADAPTER_EVALUATION_CORPUS.find((candidate)=>candidate.id==="v5-01-observatory-composition");if(!item)throw new Error("diagnostic_context_missing");
const canonicalPrompt=buildCreativeImagePrompt(item.snapshot,item.direction,[],item.options.promptTechnique,{size:"1024x1024",quality:"high",partialImages:0});
const variants=[
  {id:"native-caption-none",promptMode:"native_caption",expansionModel:"None"},
  {id:"expanded-plain-medium",promptMode:"expanded_plain",expansionModel:"Medium"},
  {id:"expanded-plain-large",promptMode:"expanded_plain",expansionModel:"Large"},
];
const runId=new Date().toISOString().replaceAll(/[:.]/g,"-");const outputRoot=path.join(root,"outputs","image-adapter-diagnostic","ideogram-v9-observatory",runId);await mkdir(outputRoot,{recursive:true});
const hash=(value)=>createHash("sha256").update(value).digest("hex");const ext=(mime)=>mime==="image/png"?"png":"jpg";const results=[];
for(const variant of variants){
  process.stdout.write(`DIAGNOSTIC ${variant.id} starting\n`);const stages=[];
  try{
    const result=await generateFalCreativeImage(workerEnv,"image-adapter-diagnostic",item.snapshot,item.direction,{quality:"high",size:"1024x1024",outputFormat:"jpeg",promptTechnique:item.options.promptTechnique,preparedPrompt:canonicalPrompt,ideogramPromptMode:variant.promptMode,ideogramExpansionModel:variant.expansionModel,onStage:(stage,message)=>{stages.push({at:new Date().toISOString(),stage,message});process.stdout.write(`PROGRESS ${variant.id} ${stage} ${message}\n`);}});
    const imageFile=`${variant.id}.${ext(result.mimeType)}`;await writeFile(path.join(outputRoot,imageFile),result.bytes);results.push({id:variant.id,status:"completed",providerRequestId:result.providerRequestId,imageFile,model:result.model,promptMode:result.promptMode,promptAdapterVersion:result.promptAdapterVersion,expansionModel:result.expansionModel,renderingSpeed:result.renderingSpeed,canonicalPrompt:result.canonicalPrompt,canonicalPromptHash:hash(result.canonicalPrompt),providerPrompt:result.prompt,providerPromptHash:hash(result.prompt),revisedPrompt:result.revisedPrompt,latencyMs:result.latencyMs,width:result.width,height:result.height,mimeType:result.mimeType,costMicrousd:result.costBreakdown.totalMicrousd,safetyCoverage:result.safetyCoverage,stages});
  }catch(error){results.push({id:variant.id,status:"failed",name:error?.name??"Error",message:String(error?.message??error),detail:error?.detail??null,providerPrompt:error?.prompt??null,stages});}
  await writeFile(path.join(outputRoot,"report.json"),JSON.stringify({schemaVersion:1,runId,adapter:`${FAL_IDEOGRAM_ADAPTER_ID}@${FAL_IDEOGRAM_ADAPTER_VERSION}`,caseId:item.id,canonicalPromptHash:hash(canonicalPrompt),requestCount:variants.length,completed:results.filter((result)=>result.status==="completed").length,failed:results.filter((result)=>result.status==="failed").length,results},null,2));
}
const report={schemaVersion:1,runId,adapter:`${FAL_IDEOGRAM_ADAPTER_ID}@${FAL_IDEOGRAM_ADAPTER_VERSION}`,caseId:item.id,canonicalPromptHash:hash(canonicalPrompt),requestCount:variants.length,completed:results.filter((result)=>result.status==="completed").length,failed:results.filter((result)=>result.status==="failed").length,totalRecordedCostMicrousd:results.reduce((sum,result)=>sum+Number(result.costMicrousd??0),0),results};await writeFile(path.join(outputRoot,"report.json"),JSON.stringify(report,null,2));process.stdout.write(`REPORT ${JSON.stringify({outputRoot:path.relative(root,outputRoot),completed:report.completed,failed:report.failed,totalRecordedCostMicrousd:report.totalRecordedCostMicrousd})}\n`);
