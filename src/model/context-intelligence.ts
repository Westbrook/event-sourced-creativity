import { blockTypeDefinition, isBlockKind, suggestedSubtype, type BlockKind } from "./block-types.ts";
import { ACTION_REFERENCE_ROLES, type ActionReferenceRole } from "./combined-context.ts";
import type { CreativeBlock, CreativeBlockRelation } from "./events.ts";

export type DecompositionParticipant = { handle:string; role:ActionReferenceRole };
export type DecompositionProposal = {
  id:string;
  type:BlockKind;
  subtype:string;
  label:string;
  text:string;
  sourceExcerpt:string;
  participants:DecompositionParticipant[];
  addendum:boolean;
};

export type DecompositionPlan = {
  sourceBlockId:string;
  sourceText:string;
  proposals:DecompositionProposal[];
  addenda:DecompositionProposal[];
};

export type ContextResearchArea = "inferred"|"related"|"learned";
export type ContextResearchSuggestion = {
  id:string;
  area:ContextResearchArea;
  blockId:string|null;
  type:BlockKind;
  subtype:string;
  label:string;
  text:string;
  reason:string;
  scope:"document"|"project"|"web";
  distance:number;
  sourceUrl:string|null;
  imageUrl:string|null;
  license:string|null;
  attribution:string|null;
};

export type ContextResearchReport = {
  blockId:string;
  inferred:ContextResearchSuggestion[];
  related:ContextResearchSuggestion[];
  learned:ContextResearchSuggestion[];
  searchedWeb:boolean;
  query:string;
};

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const words=(value:string)=>value.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)??[];
const connectiveWords=new Set(["a","an","the","and","or","of","in","on","at","to","by","for","from","with","between","among","is","are","was","were","be","being","has","have","having","his","her","its","their","who","that","which"]);
const semanticConnectiveWords=new Set(["in","on","at","to","by","for","from","with","among","his","her","its","their"]);
const stem=(value:string)=>{const normalized=value.replace(/[’‘ʼ]/gu,"'");return normalized.length>4&&normalized.endsWith("s")?normalized.slice(0,-1):normalized;};
const negationWords=new Set(["not","no","never","without","neither","nor","cannot","can't","don't","doesn't","isn't","aren't","wasn't","weren't","won't","avoid","exclude","excluding","prohibit","prohibited","forbid","forbidden","ne","pas","jamais","sans","aucun","aucune","interdit","interdire","éviter","évitez","exclure","لا","ليس","ليست","بدون","دون","ممنوع","تجنب"].map(stem));
const normalize=(value:string)=>value.normalize("NFKC").trim().replace(/\s+/gu," ");
const groundedHandle=(handle:string,sourceWords:Set<string>)=>handle.split("/").every((segment,index)=>index===0&&isBlockKind(segment)||words(segment).every((word)=>connectiveWords.has(word)||sourceWords.has(stem(word))));

/** A proposal is valid only when every creative claim already occurs in its exact source. */
export function decompositionIsGrounded(source:string,text:string,sourceExcerpt:string){
  const original=normalize(source).toLocaleLowerCase(),excerpt=normalize(sourceExcerpt).toLocaleLowerCase();
  if(!original||!excerpt||!original.includes(excerpt))return false;
  const excerptWords=words(excerpt).map(stem),allowed=new Set(excerptWords);
  const sourceWords=new Set(words(original).map(stem));
  const mentions=[...text.matchAll(/@([\p{L}\p{N}_/-]+)/gu)].map((match)=>match[1]!);
  if(mentions.some((mention)=>!groundedHandle(mention,sourceWords)))return false;
  const prose=normalize(text).replace(/@[\p{L}\p{N}_/-]+/gu,""),proseWords=words(prose).map(stem);
  if(!prose||proseWords.some((word)=>!connectiveWords.has(word)&&!allowed.has(word)))return false;
  if(proseWords.some((word)=>(word==="and"||word==="or")&&!sourceWords.has(word)))return false;
  if(proseWords.some((word)=>semanticConnectiveWords.has(word)&&!excerptWords.includes(word)))return false;
  if(excerptWords.some((word)=>negationWords.has(word)&&!proseWords.includes(word)))return false;
  let index=0,matched=false;
  for(const word of proseWords){
    if(connectiveWords.has(word))continue;
    while(index<excerptWords.length&&excerptWords[index]!==word){if(matched&&!connectiveWords.has(excerptWords[index]!))return false;index+=1;}
    if(index===excerptWords.length)return false;
    index+=1;matched=true;
  }
  return true;
}

export function normalizeDecompositionProposals(source:string,candidates:unknown,addendum=false):DecompositionProposal[]{
  if(!Array.isArray(candidates))return[];
  const seen=new Set<string>();
  return candidates.flatMap((candidate,index)=>{
    const item=record(candidate),type=String(item.type??"");
    const text=normalize(String(item.text??item.instruction??"")),sourceExcerpt=normalize(String(item.source_excerpt??item.sourceExcerpt??""));
    if(!isBlockKind(type)||type==="reference"||!decompositionIsGrounded(source,text,sourceExcerpt))return[];
    const key=`${type}\u0000${text.toLocaleLowerCase()}`;if(seen.has(key))return[];seen.add(key);
    const proposedSubtype=normalize(String(item.subtype??""));
    const subtype=blockTypeDefinition(type)?.subtypes.includes(proposedSubtype)?proposedSubtype:suggestedSubtype(type);
    const proposedLabel=normalize(String(item.label??text));
    const label=decompositionIsGrounded(source,proposedLabel,sourceExcerpt)?proposedLabel:text;
    const participants=Array.isArray(item.participants)?item.participants.flatMap((value)=>{
      const participant=record(value),role=String(participant.role??"") as ActionReferenceRole,handle=normalize(String(participant.handle??"")).replace(/^@+/u,"");
      const sourceWords=new Set(words(source).map(stem));
      const grounded=groundedHandle(handle,sourceWords);
      return handle&&grounded&&ACTION_REFERENCE_ROLES.includes(role)?[{handle,role}]:[];
    }):[];
    const mentions=[...text.matchAll(/@([\p{L}\p{N}_/-]+)/gu)].map((match)=>(match[1]!.split("/").at(-1)??"").toLocaleLowerCase());
    if(type==="action"&&mentions.some((mention)=>!participants.some((participant)=>(participant.handle.split("/").at(-1)??"").toLocaleLowerCase()===mention)))return[];
    return[{id:normalize(String(item.id??`proposal-${index+1}`)),type,subtype,label,text,sourceExcerpt,participants,addendum}];
  }).slice(0,12);
}

export function createDecompositionPlan(sourceBlockId:string,sourceText:string,candidates:unknown):DecompositionPlan{
  return{sourceBlockId,sourceText,proposals:normalizeDecompositionProposals(sourceText,candidates),addenda:[]};
}

export function appendDecompositionAddendum(plan:DecompositionPlan,sourceText:string,candidates:unknown):DecompositionPlan{
  const base=plan.addenda.length;
  const additions=normalizeDecompositionProposals(sourceText,candidates,true).map((proposal,index)=>({...proposal,id:`addendum-${base+index+1}`}));
  return{...plan,addenda:[...plan.addenda,...additions]};
}

export function researchBlockText(block:Pick<CreativeBlock,"handle"|"properties">){
  return normalize(String(block.properties.text??block.properties.source_excerpt??block.properties.description??block.properties.label??block.handle));
}

/** Existing decisions remain authoritative: the model can select a block, never rewrite it. */
export function existingResearchSuggestion(input:{area:"inferred"|"related";block:CreativeBlock;reason:string;documentId:string;distance?:number}):ContextResearchSuggestion|null{
  if(!isBlockKind(input.block.type)||input.block.removed||input.block.properties.organization_context_package_binding_id)return null;
  const text=researchBlockText(input.block);if(!text)return null;
  const inDocument=input.block.scope!=="library"&&input.block.documentId===input.documentId;
  if(input.area==="inferred"&&!inDocument)return null;
  return{id:`${input.area}-${input.block.id}`,area:input.area,blockId:input.block.id,type:input.block.type,subtype:String(input.block.properties.subtype??suggestedSubtype(input.block.type)),label:String(input.block.properties.label??input.block.handle),text,reason:normalize(input.reason).slice(0,320),scope:inDocument?"document":"project",distance:inDocument?0:Math.max(1,input.distance??1),sourceUrl:null,imageUrl:null,license:null,attribution:null};
}

export function contextResearchCandidates(target:CreativeBlock,blocks:readonly CreativeBlock[],relations:readonly CreativeBlockRelation[],documentId:string){
  const targetWords=new Set(words(researchBlockText(target)).filter((word)=>word.length>2).map(stem));
  const connected=new Set(relations.filter((relation)=>!relation.removed&&(relation.fromBlockId===target.id||relation.toBlockId===target.id)).flatMap((relation)=>[relation.fromBlockId,relation.toBlockId]));
  return blocks.filter((block)=>block.id!==target.id&&!block.removed&&block.projectId===target.projectId&&!block.properties.organization_context_package_binding_id)
    .map((block)=>{
      const shared=words(researchBlockText(block)).filter((word)=>targetWords.has(stem(word))).length;
      const distance=block.scope!=="library"&&block.documentId===documentId?0:1;
      const score=(distance===0?100:35)+(connected.has(block.id)?25:0)+shared*8+(block.type===target.type?4:0);
      return{block,distance,score,connected:connected.has(block.id)};
    }).sort((left,right)=>left.distance-right.distance||right.score-left.score||left.block.position.localeCompare(right.block.position));
}

export function newLearnedSuggestion(input:{id:string;type:unknown;subtype?:unknown;text:unknown;reason?:unknown;sourceUrl?:unknown;imageUrl?:unknown;license?:unknown;attribution?:unknown},existing:readonly CreativeBlock[]):ContextResearchSuggestion|null{
  const type=String(input.type??"");if(!isBlockKind(type))return null;
  const text=normalize(String(input.text??""));if(!text||existing.some((block)=>researchBlockText(block).toLocaleLowerCase()===text.toLocaleLowerCase()))return null;
  const safeUrl=(value:unknown,host?:string)=>{try{const url=new URL(String(value??""));const local=url.hostname==="localhost"||url.hostname.endsWith(".localhost")||url.hostname==="[::1]"||/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(url.hostname);return url.protocol==="https:"&&!url.username&&!url.password&&!local&&(!host||url.hostname===host)?url.toString():null;}catch{return null;}};
  const imageUrl=safeUrl(input.imageUrl,"upload.wikimedia.org"),sourceUrl=safeUrl(input.sourceUrl);
  const candidateSubtype=normalize(String(input.subtype??"")),subtype=blockTypeDefinition(type)?.subtypes.includes(candidateSubtype)?candidateSubtype:suggestedSubtype(type);
  return{id:input.id,area:"learned",blockId:null,type,subtype,label:blockTypeDefinition(type)?.label??type,text,reason:normalize(String(input.reason??"")).slice(0,320),scope:"web",distance:2,sourceUrl,imageUrl,license:input.license?normalize(String(input.license)):null,attribution:input.attribution?normalize(String(input.attribution)):null};
}
