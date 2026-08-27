import type { CreativeBlock, CreativeEvent, CreativeOutput } from "./events.ts";
import type { DocumentArtifact } from "./document-artifacts.ts";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactRevision, type DocumentArtifactKind } from "./document-artifacts.ts";
import { documentGenerationRevision, type DocumentJob } from "./document-jobs.ts";
import { unfinishedIntentTrajectories } from "./intent-trajectories.ts";
import { promptFactIsActive } from "./prompt-policy.ts";

export type CreativeMedium = "image" | DocumentArtifactKind;
export type CreativeActionScope = { projectId:string; documentId:string; canvasId:string|null; authorityKey:string };
export type CreativeNextTarget = CreativeActionScope & (
  | {kind:"context";sourceRevision:string}
  | {kind:"configure";medium:CreativeMedium|null;sourceRevision:string}
  | {kind:"output";outputId:string}
  | {kind:"artifact";artifactId:string;sequence:number;revision:number}
  | {kind:"job";jobId:string}
  | {kind:"compare";outputIds:readonly [string,string]}
);
export type CreativeNextActionId = "add-context" | "configure-output" | "open-output" | "read-draft" | "compare-images" | "check-job" | "inspect-job";
export type CreativeNextAction = { id:CreativeNextActionId; label:string; reason:string; title:string; priority:number; evidence:number; target:CreativeNextTarget };
export type CreativeWorkspaceFacts = {
  blocks:readonly CreativeBlock[]; outputs:readonly CreativeOutput[]; artifacts:readonly DocumentArtifact[];
  jobs?:readonly DocumentJob[]; events?:readonly CreativeEvent[]; documentId:string; projectId:string; canvasId?:string|null;
  authorityKey:string; canRead:boolean; canAuthor:boolean; canConfigure:boolean; requestedMedium?:CreativeMedium|null;
};
export type ProposedCreativeChange = { type: string; payload: Record<string, unknown> };

const readableLabel = (value: unknown) => String(value ?? "creative decision")
  .replace(/[_-]+/g, " ")
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .trim()
  .toLocaleLowerCase();

/** Explain an unaccepted mutation using authored meaning instead of event names or IDs. */
export function describeCreativeProposal(changes: readonly ProposedCreativeChange[]): string[] {
  return changes.map(({ type, payload }) => {
    const properties = payload.properties && typeof payload.properties === "object" && !Array.isArray(payload.properties)
      ? payload.properties as Record<string, unknown>
      : {};
    if (type === "BlockCreated") {
      const label = readableLabel(payload.type);
      const value = String(properties.text ?? properties.label ?? "").trim();
      return value ? `Add ${label}: “${value}”` : `Add a ${label}`;
    }
    if (type === "BlockPropertyEdited") {
      const property = readableLabel(payload.property_path);
      const before = String(payload.old_value ?? "").trim();
      const after = String(payload.new_value ?? "").trim();
      return before && after ? `Change ${property} from ${before} to ${after}` : after ? `Set ${property} to ${after}` : `Update ${property}`;
    }
    if (type === "BlockRemoved") return "Remove a creative decision";
    if (type === "BlockReordered") return "Reorder the creative decisions";
    return `Update ${readableLabel(type.replace(/(?:Created|Edited|Removed|Changed|Updated)$/, ""))}`;
  });
}

const medium=(value:unknown):CreativeMedium|null=>value==="image"||DOCUMENT_ARTIFACT_KINDS.includes(value as DocumentArtifactKind)?value as CreativeMedium:null;
const sourceBlocks=(facts:CreativeWorkspaceFacts)=>facts.blocks.filter((block)=>block.projectId===facts.projectId&&block.documentId===facts.documentId&&!block.removed);
const scopedOutputs=(facts:CreativeWorkspaceFacts)=>facts.outputs.filter((output)=>output.documentId===facts.documentId&&!output.discarded&&output.provider!=="simulation"&&Boolean(output.mediaUrl)&&(!facts.canvasId||!output.canvasId||output.canvasId===facts.canvasId));
const scopedArtifacts=(facts:CreativeWorkspaceFacts)=>facts.artifacts.filter((artifact)=>artifact.documentId===facts.documentId);
const scopedJobs=(facts:CreativeWorkspaceFacts)=>(facts.jobs??[]).filter((job)=>job.documentId===facts.documentId&&(!job.canvasId?job.sourceSurface!=="canvas":job.canvasId===(facts.canvasId??null)));
export const creativeActionSourceRevision=(facts:CreativeWorkspaceFacts)=>documentGenerationRevision({projectId:facts.projectId,documentId:facts.documentId,canvasId:facts.canvasId??null,blocks:sourceBlocks(facts)});

/** Only an explicit structured medium or an unsubmitted declared intent selects a format.
 * Ambiguous prose and lists of sibling formats open a choice, never an image-first purchase. */
export function requestedCreativeMedium(facts:CreativeWorkspaceFacts):CreativeMedium|null{
  if(facts.requestedMedium!==undefined)return medium(facts.requestedMedium);
  const declared=new Set(sourceBlocks(facts).filter(promptFactIsActive).filter((block)=>!["exclusion","boundary","constraint","audience"].includes(block.type)&&!["avoid","prohibit","exclude"].includes(String(block.properties.intent??""))).flatMap((block)=>[block.properties.output_kind,block.properties.artifact_kind,block.properties.requested_medium].map(medium).filter((value):value is CreativeMedium=>Boolean(value))));
  if(!declared.size&&!facts.canvasId&&facts.events)for(const intent of unfinishedIntentTrajectories(facts.events,{projectId:facts.projectId,documentId:facts.documentId})){
    if(intent.authority==="explicit"&&intent.status==="initiated"&&!intent.generationIds.length&&!intent.artifactIds.length){const value=medium(intent.expectedOutputKind);if(value)declared.add(value);}
  }
  return declared.size===1?[...declared][0]!:null;
}

/** A recommendation is a scoped navigation/configuration capability, never permission to execute. */
export function creativeNextActions(facts:CreativeWorkspaceFacts):CreativeNextAction[]{
  if(!facts.canRead||!facts.authorityKey||!facts.projectId||!facts.documentId)return[];
  const scope:CreativeActionScope={projectId:facts.projectId,documentId:facts.documentId,canvasId:facts.canvasId??null,authorityKey:facts.authorityKey};
  const active=sourceBlocks(facts).filter(promptFactIsActive),outputs=scopedOutputs(facts),artifacts=scopedArtifacts(facts),jobs=scopedJobs(facts).filter((job)=>!job.dismissedAt);
  const actions:CreativeNextAction[]=[],requested=requestedCreativeMedium(facts),sourceRevision=creativeActionSourceRevision(facts);
  const existing=[...outputs.map((output)=>({sequence:output.sequence,title:output.title??"Image",draft:output.quality==="low"||output.purpose==="ideate",format:"image" as CreativeMedium,target:{...scope,kind:"output" as const,outputId:output.id}})),...artifacts.map((artifact)=>({sequence:artifact.sequence,title:artifact.title,draft:false,format:artifact.kind,target:{...scope,kind:"artifact" as const,artifactId:artifact.id,sequence:artifact.sequence,revision:documentArtifactRevision(facts.events??[],artifact.id)}}))].sort((a,b)=>Number(b.format===requested)-Number(a.format===requested)||b.sequence-a.sequence);
  const result=existing[0];
  if(result)actions.push({id:result.draft?"read-draft":"open-output",label:result.draft?"Review this image draft":"Open saved result",reason:"Inspect this exact saved output without starting another generation.",title:result.title,priority:90,evidence:1,target:result.target});
  const running=jobs.filter((job)=>["queued","running","committing"].includes(job.status)).sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt))[0];
  if(running)actions.push({id:"check-job",label:"Check this work in progress",reason:"Open the existing request. A new request is not needed to check progress.",title:running.jobId,priority:85,evidence:1,target:{...scope,kind:"job",jobId:running.jobId}});
  if(!active.length&&facts.canAuthor)actions.push({id:"add-context",label:"Describe the direction",reason:"Add a deliberate creative decision to this document.",title:"",priority:80,evidence:0,target:{...scope,kind:"context",sourceRevision}});
  const comparable=outputs.filter((output)=>!output.promptFanId||output.standalone).sort((a,b)=>b.sequence-a.sequence);
  if(comparable.length>=2)actions.push({id:"compare-images",label:"Compare these images",reason:"Inspect these two saved alternatives side by side.",title:"",priority:75,evidence:2,target:{...scope,kind:"compare",outputIds:[comparable[0]!.id,comparable[1]!.id]}});
  const failed=jobs.filter((job)=>["failed","partial"].includes(job.status)).sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt))[0];
  if(failed)actions.push({id:"inspect-job",label:"Inspect the previous attempt",reason:"Review retained evidence and partial work. Independent outputs can continue.",title:failed.jobId,priority:result||running?40:70,evidence:1,target:{...scope,kind:"job",jobId:failed.jobId}});
  if(active.length&&facts.canConfigure)actions.push({id:"configure-output",label:"Prepare an output",reason:"Choose and review this document’s output settings. Nothing is generated yet.",title:requested??"",priority:60,evidence:active.length,target:{...scope,kind:"configure",medium:requested,sourceRevision}});
  return actions.sort((a,b)=>b.priority-a.priority).slice(0,3);
}

/** Missing, changed, or unauthorized exact targets fail closed. Never replace them with the first available object. */
export function creativeActionScopeAvailable(target:CreativeActionScope,facts:CreativeWorkspaceFacts):boolean{
  return facts.canRead&&Boolean(target.authorityKey)&&target.authorityKey===facts.authorityKey&&target.projectId===facts.projectId&&target.documentId===facts.documentId&&target.canvasId===(facts.canvasId??null);
}
export function creativeNextTargetAvailable(target:CreativeNextTarget,facts:CreativeWorkspaceFacts):boolean{
  if(!creativeActionScopeAvailable(target,facts))return false;
  if(target.kind==="context")return facts.canAuthor&&target.sourceRevision===creativeActionSourceRevision(facts);
  if(target.kind==="configure")return facts.canConfigure&&target.sourceRevision===creativeActionSourceRevision(facts);
  if(target.kind==="output")return scopedOutputs(facts).some((output)=>output.id===target.outputId);
  if(target.kind==="artifact")return scopedArtifacts(facts).some((artifact)=>artifact.id===target.artifactId&&artifact.sequence===target.sequence&&documentArtifactRevision(facts.events??[],artifact.id)===target.revision);
  if(target.kind==="job")return scopedJobs(facts).some((job)=>job.jobId===target.jobId);
  return new Set(target.outputIds).size===2&&target.outputIds.every((id)=>scopedOutputs(facts).some((output)=>output.id===id&&(!output.promptFanId||output.standalone)));
}

export type CreativeNextPorts={ [Kind in CreativeNextTarget["kind"]]:(target:Extract<CreativeNextTarget,{kind:Kind}>)=>unknown|Promise<unknown> };
export function creativePreparationChoice(target:Extract<CreativeNextTarget,{kind:"configure"}>|null,medium:CreativeMedium,facts:CreativeWorkspaceFacts):Extract<CreativeNextTarget,{kind:"configure"}>|null{
  return target&&creativeNextTargetAvailable(target,facts)?{...target,medium}:null;
}
export type CreativePreparationStage="opening"|"editing";
export type CreativePreparationGuard=(()=>boolean)&{beginEditing:()=>boolean};
export function creativePreparationTargetAvailable(target:Extract<CreativeNextTarget,{kind:"configure"}>,facts:CreativeWorkspaceFacts,stage:CreativePreparationStage="opening"):boolean{
  return stage==="opening"?creativeNextTargetAvailable(target,facts):creativeActionScopeAvailable(target,facts)&&facts.canConfigure;
}
/** Keep opening exact, then allow settings edits within the same authorized document.
 * This session is not paid consent; execution must quote and validate current inputs. */
export function retainCreativePreparation(current:()=>CreativeWorkspaceFacts,required:(stage:CreativePreparationStage)=>boolean=()=>true):CreativePreparationGuard{
  const facts=current(),target:Extract<CreativeNextTarget,{kind:"configure"}>={kind:"configure",projectId:facts.projectId,documentId:facts.documentId,canvasId:facts.canvasId??null,authorityKey:facts.authorityKey,sourceRevision:creativeActionSourceRevision(facts),medium:null};
  let stage:CreativePreparationStage="opening";
  const guard=()=>required(stage)&&creativePreparationTargetAvailable(target,current(),stage);
  return Object.assign(guard,{beginEditing:()=>{if(!guard())return false;stage="editing";return true;}});
}
export async function followCreativeNextTarget(target:CreativeNextTarget,current:()=>CreativeWorkspaceFacts,ports:CreativeNextPorts):Promise<boolean>{
  if(!creativeNextTargetAvailable(target,current()))return false;
  switch(target.kind){
    case"context":return await ports.context(target)!==false;
    case"configure":return await ports.configure(target)!==false;
    case"output":return await ports.output(target)!==false;
    case"artifact":return await ports.artifact(target)!==false;
    case"job":return await ports.job(target)!==false;
    case"compare":return await ports.compare(target)!==false;
  }
}
