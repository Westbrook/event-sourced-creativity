import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCreativeVideo } from "../worker/openai-adapter.ts";

const args=new Map(process.argv.slice(2).map((part)=>{const [key,...rest]=part.split("=");return[key,rest.join("=")||"true"];}));
const providerModel=String(args.get("--provider-model")??"bytedance/seedance-2.0/reference-to-video");
if(providerModel!=="bytedance/seedance-2.5/reference-to-video"&&providerModel!=="bytedance/seedance-2.0/reference-to-video")throw new Error("provider_model_invalid: this control only supports the adopted Seedance 2.0 and retained Seedance 2.5 adapters");
const PAID_APPROVAL=`I approve one 4-second 480p Seedance ${providerModel.includes("seedance-2.0")?"2.0":"2.5"} reference control`;
if(args.get("--approve-paid-control")!==PAID_APPROVAL)throw new Error(`paid_control_approval_required: pass --approve-paid-control=${JSON.stringify(PAID_APPROVAL)} only after the active user approves this exact one-request run`);

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const imagePath=path.resolve(String(args.get("--image")??""));
if(!imagePath||imagePath===root)throw new Error("reference_image_required: pass --image=/absolute/path/to/image.png");
const promptProfile=String(args.get("--prompt-profile")??"standard");
if(promptProfile!=="standard"&&promptProfile!=="positive-only")throw new Error("prompt_profile_invalid: expected standard or positive-only");

async function loadEnv(){
  const values={...process.env};
  const file=await readFile(path.join(root,".env.local"),"utf8").catch(()=>"");
  for(const raw of file.split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith("#"))continue;
    const index=line.indexOf("=");if(index<1)continue;
    const key=line.slice(0,index).trim();let value=line.slice(index+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    if(!String(values[key]??"").trim())values[key]=value;
  }
  return values;
}

const env=await loadEnv();
if(!env.FAL_KEY)throw new Error("FAL_KEY is not configured");
const bytes=new Uint8Array(await readFile(imagePath));
const sha256=createHash("sha256").update(bytes).digest("hex");
const runId=new Date().toISOString().replaceAll(/[:.]/g,"-");
const outputRoot=path.join(root,"outputs","video-reference-diagnostic","seedance-face-control",runId);
await mkdir(outputRoot,{recursive:true});

const report={
  schemaVersion:1,
  runId,
  purpose:promptProfile==="positive-only"?"Determine whether concise positive-only reference language avoids the late Seedance likeness-policy rejection.":"Determine whether Seedance acceptance follows freshly uploaded image pixels or original Fal asset lineage.",
  authorization:{requestCount:1,durationSeconds:4,resolution:"480p",maximumCostUsd:providerModel.includes("seedance-2.0")?0.54:0.882},
  input:{fileName:path.basename(imagePath),mimeType:"image/png",byteLength:bytes.length,sha256,promptProfile,providerModel},
  status:"running",
  stages:[],
};
const save=()=>writeFile(path.join(outputRoot,"report.json"),JSON.stringify(report,null,2));
await save();

try{
  const result=await generateCreativeVideo(
    {FAL_KEY:env.FAL_KEY,FORMA_VIDEO_PROVIDER:"fal",FAL_REFERENCE_VIDEO_MODEL:providerModel},
    promptProfile==="positive-only"?"Create a restrained four-second editorial motion study. The adult fashion model in @Image1 makes one small natural turn toward warm side light while the camera performs a slow, stable push in. Preserve the clothing, abstract painted environment, composition, and color design. Silent.":"Create a restrained four-second editorial motion study. The fictional adult fashion model in @Image1 makes one small natural turn toward the light while the camera performs a slow, stable push in. Preserve the original clothing, abstract painted environment, mature adult appearance, composition, and color design. Do not identify or imitate a real person. No dialogue and no audio.",
    {
      seconds:4,
      size:"1280x720",
      resolution:"480p",
      generateAudio:false,
      endUserId:"seedance-reference-control",
      referencePromptProfile:promptProfile,
      providerModel,
      references:[{
        bytes,
        mimeType:"image/png",
        blockId:"diagnostic-face1",
        referenceId:"diagnostic-face1",
        label:promptProfile==="positive-only"?"Adult editorial fashion reference":"User-provided fictional adult fashion reference",
        mode:"preserve_subject",
        sequence:null,
        shotDirection:promptProfile==="positive-only"?"The adult model makes one small natural turn toward warm side light.":"The fictional adult model makes one small natural turn toward the light.",
        cameraDirection:"Slow, stable push in.",
        framePrompt:"Preserve the clothing, abstract painted environment, composition, and color design.",
        sourceArtifactId:null,
        sourceArtifactItemId:null,
        sourceArtifactKind:null,
        storyboardTitle:"",
        provider:null,
        providerModel:null,
        providerRequestId:null,
        providerMediaUrl:null,
      }],
      onStage:(stage,message)=>{report.stages.push({at:new Date().toISOString(),stage,message});process.stdout.write(`PROGRESS ${stage} ${message}\n`);return save();},
      onPrepared:(receipt)=>{report.prepared=receipt;return save();},
      onReceipt:(receipt)=>{report.providerReceipt=receipt;return save();},
    },
  );
  const videoFile="result.mp4";
  await writeFile(path.join(outputRoot,videoFile),result.bytes);
  Object.assign(report,{status:"completed",videoFile,result:{providerJobId:result.providerJobId,provider:result.provider,model:result.model,mimeType:result.mimeType,seconds:result.seconds,size:result.size,latencyMs:result.latencyMs,costMicrousd:result.costMicrousd,submittedPrompt:result.submittedPrompt,providerParameters:result.providerParameters,referenceInputs:result.referenceInputs,usedReferencePixels:result.usedReferencePixels}});
}catch(error){
  Object.assign(report,{status:"failed",failure:{name:error?.name??"Error",message:String(error?.message??error),detail:error?.detail??null,preparedPrompt:error?.preparedPrompt??null}});
}
await save();
process.stdout.write(`REPORT ${JSON.stringify({outputRoot:path.relative(root,outputRoot),status:report.status,providerJobId:report.providerReceipt?.providerJobId??null,failureCode:report.failure?.detail?.code??null})}\n`);
