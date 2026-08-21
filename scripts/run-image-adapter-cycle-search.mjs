import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IDEOGRAM_CANDIDATE_CAMPAIGNS } from "../worker/ideogram-adapter-cycles.ts";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const args=new Map(process.argv.slice(2).map((part)=>{const [key,...rest]=part.split("=");return[key,rest.join("=")||"true"];}));
const campaign=Number(args.get("--campaign")??5);if(![1,2,3,4,5].includes(campaign))throw new Error(`unknown_candidate_campaign:${campaign}`);const availableProfiles=IDEOGRAM_CANDIDATE_CAMPAIGNS[campaign];
const PAID_APPROVAL=campaign===1?"I explicitly approve up to ten paid image-adapter candidate cycles":`I explicitly approve up to ten paid image-adapter candidate cycles for campaign ${campaign}`;
if(args.get("--approve-paid-eval")!==PAID_APPROVAL)throw new Error(`paid_cycle_search_approval_required: pass --approve-paid-eval=${JSON.stringify(PAID_APPROVAL)} only after the active user approves this bounded search`);
const maxCycles=Math.max(1,Math.min(10,Number(args.get("--max-cycles")??10)));const concurrency=Math.max(1,Math.min(3,Number(args.get("--concurrency")??2)));const startVersion=String(args.get("--start-version")??availableProfiles[0].version);const startIndex=availableProfiles.findIndex((profile)=>profile.version===startVersion);if(startIndex<0)throw new Error(`unknown_bounded_candidate_for_campaign_${campaign}:${startVersion}`);
const profiles=availableProfiles.slice(startIndex,startIndex+maxCycles);if(!profiles.length)throw new Error("no_candidate_cycles_selected");
const searchId=new Date().toISOString().replaceAll(/[:.]/g,"-");const searchRoot=path.join(root,"outputs","image-adapter-cycles");await mkdir(searchRoot,{recursive:true});const searchPath=path.join(searchRoot,`search-${searchId}.json`);const search={schemaVersion:2,searchId,campaign,startedAt:new Date().toISOString(),maxCycles,profiles:profiles.map((item)=>item.version),status:"running",cycles:[]};
const save=()=>writeFile(searchPath,JSON.stringify(search,null,2));await save();

function runStage(version,stage,preflight=false,retryFailed=false){return new Promise((resolve,reject)=>{
  const childArgs=["--experimental-strip-types","scripts/run-image-adapter-eval.mjs",`--candidate-version=${version}`,`--stage=${stage}`,`--concurrency=${concurrency}`,...(retryFailed?["--retry-failed=true"]:[]),...(preflight?["--preflight-only=true"]:[`--approve-paid-eval=${PAID_APPROVAL}`])];
  const child=spawn(process.execPath,childArgs,{cwd:root,stdio:"inherit"});child.on("error",reject);child.on("exit",(code)=>code===0?resolve():reject(new Error(`candidate_stage_failed:${version}:${stage}:exit_${code}`)));
});}

async function reportFor(version,stage){return JSON.parse(await readFile(path.join(searchRoot,version,stage,"report.json"),"utf8"));}
async function runPaidStage(version,stage){await runStage(version,stage);let report=await reportFor(version,stage);if(report.failures?.some((failure)=>failure.provider==="fal"&&failure.category==="safety")){await runStage(version,stage,false,true);report=await reportFor(version,stage);}return report;}
for(const [offset,profile] of profiles.entries()){
  const cycle={cycle:offset+1,version:profile.version,hypothesis:profile.hypothesis,startedAt:new Date().toISOString(),stages:[],status:"running"};search.cycles.push(cycle);await save();
  try{
    await runStage(profile.version,"full",true);cycle.stages.push({stage:"preflight",passed:true,caseCount:50});await save();
    const micro=await runPaidStage(profile.version,"micro");cycle.stages.push({stage:"micro",screeningPassed:micro.screeningPassed,report:path.relative(root,path.join(searchRoot,profile.version,"micro","report.json")),metrics:{evaluatedPairs:micro.evaluatedPairs,usable:micro.providers.candidate.usable,referenceUsable:Object.values(micro.referenceModes).reduce((sum,item)=>sum+item.candidate.usable,0),meanInstruction:micro.providers.candidate.meanInstruction,newSuccessfulImageProviderCostMicrousd:micro.newSuccessfulImageProviderCostMicrousd}});await save();if(!micro.screeningPassed){cycle.status="rejected_micro";cycle.completedAt=new Date().toISOString();await save();continue;}
    const sentinel=await runPaidStage(profile.version,"sentinel");cycle.stages.push({stage:"sentinel",screeningPassed:sentinel.screeningPassed,report:path.relative(root,path.join(searchRoot,profile.version,"sentinel","report.json")),metrics:{evaluatedPairs:sentinel.evaluatedPairs,usable:sentinel.providers.candidate.usable,referenceUsable:Object.values(sentinel.referenceModes).reduce((sum,item)=>sum+item.candidate.usable,0),meanInstruction:sentinel.providers.candidate.meanInstruction,newSuccessfulImageProviderCostMicrousd:sentinel.newSuccessfulImageProviderCostMicrousd}});await save();if(!sentinel.screeningPassed){cycle.status="rejected_sentinel";cycle.completedAt=new Date().toISOString();await save();continue;}
    const full=await runPaidStage(profile.version,"full");cycle.stages.push({stage:"full",passed:full.passed,report:path.relative(root,path.join(searchRoot,profile.version,"full","report.json")),metrics:{evaluatedPairs:full.evaluatedPairs,usable:full.providers.candidate.usable,referenceUsable:Object.values(full.referenceModes).reduce((sum,item)=>sum+item.candidate.usable,0),meanInstruction:full.providers.candidate.meanInstruction,newSuccessfulImageProviderCostMicrousd:full.newSuccessfulImageProviderCostMicrousd}});cycle.status=full.passed?"passed":"rejected_full";cycle.completedAt=new Date().toISOString();await save();if(full.passed){search.status="passed";search.winner=profile.version;break;}
  }catch(error){cycle.status="errored";cycle.error=String(error?.message??error);cycle.completedAt=new Date().toISOString();await save();}
}
if(search.status!=="passed")search.status="exhausted_nonpassing";search.completedAt=new Date().toISOString();await save();process.stdout.write(`SEARCH ${JSON.stringify({status:search.status,winner:search.winner??null,cycles:search.cycles.length,report:path.relative(root,searchPath)})}\n`);if(search.status!=="passed")process.exitCode=2;
