import { memoryReviewTargetMatches,type MemoryEditReviewTarget } from './memory-edit-review.ts';

export type ProfileSynthesisProposal={text:string;category:'preference-hypothesis'|'workflow-hypothesis';references:string[]};
export type ProfileSynthesisSource={alias:string;ownerId:string;projectId:string;documentId:string;zoom:string;weight:number;
 category:ProfileSynthesisProposal['category'];text:string;originalIds:string[];quotes:string[]};
export type MemoryProfileSynthesis=MemoryEditReviewTarget&{version:'memory-profile-synthesis-v1';mode:'review-only';independentEvidence:false;
 items:Array<{text:string;category:ProfileSynthesisProposal['category'];zoom:string;weight:number;originalCount:number;
  sources:Array<{projectId:string;documentId:string;interpretation:string;quotes:string[]}>}>};
const scopes=['document','project','project-tree','organization','partition'];
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>record(v)&&Reflect.ownKeys(v).length===keys.length
 &&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');});
const text=(v:unknown,max:number)=>typeof v==='string'&&v.isWellFormed()&&v.trim().length>0&&Array.from(v).length<=max;
const category=(v:unknown)=>v==='preference-hypothesis'||v==='workflow-hypothesis';
const array=(v:unknown,min:number,max:number):v is unknown[]=>Array.isArray(v)&&v.length>=min&&v.length<=max
 &&Reflect.ownKeys(v).length===v.length+1&&Array.from({length:v.length},(_,i)=>Object.getOwnPropertyDescriptor(v,String(i))).every(d=>d&&Object.hasOwn(d,'value'));

export function parseProfileSynthesisProposals(value:unknown):ProfileSynthesisProposal[]|null{
 try{
  if(!array(value,0,4))return null;
  const seen=new Set<string>();
  for(const item of value){
   if(!exact(item,['text','category','references'])||!text(item.text,600)||!category(item.category)||!array(item.references,2,8)
    ||item.references.some(v=>typeof v!=='string'||!/^profile_[1-9][0-9]?$/u.test(v))||new Set(item.references).size!==item.references.length)return null;
   const key=JSON.stringify([item.category,[...item.references].sort()]);if(seen.has(key))return null;seen.add(key);
  }
  return structuredClone(value) as ProfileSynthesisProposal[];
 }catch{return null;}
}

/** Native caller supplies currently authorized original-backed sources. This
 * does not mint access or publish policy. A model selects aliases, never counts
 * evidence, chooses a broader scope, assigns confidence or rewrites originals. */
export function buildMemoryProfileSynthesis(proposals:unknown,sources:readonly ProfileSynthesisSource[],target:MemoryEditReviewTarget):MemoryProfileSynthesis|null{
 const parsed=parseProfileSynthesisProposals(proposals);if(!parsed||!parsed.length||sources.length>24)return null;
 const aliases=new Map(sources.map(s=>[s.alias,s]));if(aliases.size!==sources.length)return null;
 const items:MemoryProfileSynthesis['items']=[];
 for(const proposal of parsed){
  const selected=proposal.references.map(alias=>aliases.get(alias));if(selected.some(s=>!s||s.category!==proposal.category))return null;
  const rows=selected as ProfileSynthesisSource[],documents=new Set(rows.map(s=>JSON.stringify([s.ownerId,s.projectId,s.documentId])));
  if(documents.size<2)return null;
  const origins=new Map<string,string>();
  for(const source of rows){
   if(!scopes.includes(source.zoom)||!Number.isFinite(source.weight)||source.weight<=0||source.weight>1||!source.originalIds.length)return null;
   const document=JSON.stringify([source.ownerId,source.projectId,source.documentId]);
   for(const id of source.originalIds){const key=JSON.stringify([source.ownerId,id]),prior=origins.get(key);if(prior&&prior!==document)return null;origins.set(key,document);}
  }
  if(origins.size<3)return null;
  const widest=rows.reduce((a,b)=>a.weight<=b.weight?a:b);
  items.push({text:proposal.text,category:proposal.category,zoom:widest.zoom,weight:widest.weight,originalCount:origins.size,
   sources:rows.map(s=>({projectId:s.projectId,documentId:s.documentId,interpretation:s.text,quotes:[...s.quotes]}))});
 }
 return parseMemoryProfileSynthesis({version:'memory-profile-synthesis-v1',...target,mode:'review-only',independentEvidence:false,items},target);
}

/** Presentation-only ingress validation. The server remains responsible for
 * all source custody, consent, inverse retirement and native source proofs. */
export function parseMemoryProfileSynthesis(value:unknown,target:MemoryEditReviewTarget):MemoryProfileSynthesis|null{
 try{
  if(!exact(value,['version','executionId','turnId','projectId','documentId','sourceHash','locale','mode','independentEvidence','items'])
   ||value.version!=='memory-profile-synthesis-v1'||value.mode!=='review-only'||value.independentEvidence!==false
   ||!memoryReviewTargetMatches(value,target)||!array(value.items,1,4))return null;
  for(const item of value.items){
   if(!exact(item,['text','category','zoom','weight','originalCount','sources'])||!text(item.text,600)||!category(item.category)
    ||!scopes.includes(String(item.zoom))||typeof item.weight!=='number'||!Number.isFinite(item.weight)||item.weight<=0||item.weight>1
    ||!Number.isSafeInteger(item.originalCount)||Number(item.originalCount)<3||Number(item.originalCount)>1024||!array(item.sources,2,8))return null;
   for(const source of item.sources)if(!exact(source,['projectId','documentId','interpretation','quotes'])||!text(source.projectId,240)
    ||!text(source.documentId,240)||!text(source.interpretation,1800)||!array(source.quotes,1,8)||source.quotes.some(q=>!text(q,512)))return null;
  }
  return structuredClone(value) as MemoryProfileSynthesis;
 }catch{return null;}
}
