import type {MemoryImageReceiptLifetime} from './memory-image-execution-lifetime.ts';
import { derivationExact } from './memory-derivation-policy.ts';
import { memoryDerivationJsonUniqueKeys,parseMemoryDerivationResult,snapshotMemoryDerivationInput,
 type MemoryDerivationParseContext,type MemoryDerivationCandidate,type MemoryDerivationQuote,type ParsedMemoryDerivation } from './memory-derivation-result.ts';

export const MEMORY_PROFILE_RESULT_VERSION='memory-profile-consolidation-v1' as const;
export type MemoryProfileRelation={relationship:'revises'|'contradicts';claimKey:string;category:'preference-hypothesis'|'workflow-hypothesis';supports:readonly MemoryDerivationQuote[]};
export type MemoryProfileCandidate=MemoryDerivationCandidate&{reconciles:readonly MemoryProfileRelation[]};
export type ParsedMemoryProfileDerivation=Omit<ParsedMemoryDerivation,'version'|'items'>&{version:typeof MEMORY_PROFILE_RESULT_VERSION;items:readonly MemoryProfileCandidate[]};
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

/** Semantic relationships are unverified proposals grounded in ORIGINAL human
 * quotations, not a summary of prior generated summaries. The original citation
 * identity reconstructs the earlier claim key without loading its private text.
 * Every relationship's source bindings and lineages join the new item's inverse
 * dependencies. A user correction/suppression cannot be lifted by this recipe.
 * No relationship silently deletes, promotes or overwrites an earlier claim. */
export async function parseMemoryProfileResult(rawJson:string,input:MemoryDerivationParseContext,processing?:MemoryImageReceiptLifetime):Promise<ParsedMemoryProfileDerivation|null>{
 try{
  if(typeof rawJson!=='string'||new TextEncoder().encode(rawJson).byteLength>65536||!memoryDerivationJsonUniqueKeys(rawJson))return null;
  const raw=snapshotMemoryDerivationInput(JSON.parse(rawJson)),context=snapshotMemoryDerivationInput(input) as MemoryDerivationParseContext;
  if(!derivationExact(raw,['version','items'])||raw.version!==MEMORY_PROFILE_RESULT_VERSION||!Array.isArray(raw.items)||raw.items.length>16
   ||context.purpose!=='profile'||!Array.isArray(context.priorItems)||context.priorItems.length)return null;
  let total=0;const originals=[];
  for(const value of raw.items){
   if(!derivationExact(value,['operation','target','category','text','supports','counterevidence','reconciles'])||value.operation!=='assert'||value.target!==null
    ||!Array.isArray(value.reconciles)||value.reconciles.length>4||(total+=value.reconciles.length)>16)return null;
   const {reconciles:_relations,...original}=value;originals.push(original);
  }
  const base=await parseMemoryDerivationResult(JSON.stringify({version:'memory-derivation-candidates-v1',items:originals}),context,processing);
  if(!base)return null;
  const items:MemoryProfileCandidate[]=[];
  for(const [index,item]of base.items.entries()){
   const reconciles:MemoryProfileRelation[]=[],seen=new Set<string>(),lineages=new Set(item.lineageIds),bindings=new Map(item.sourceBindings.map(row=>[row.sourceId,row]));
   for(const relation of (raw.items[index] as {reconciles:unknown[]}).reconciles){
    if(!derivationExact(relation,['relationship','category','supports'])||!['revises','contradicts'].includes(String(relation.relationship)))return null;
    const prior=await parseMemoryDerivationResult(JSON.stringify({version:'memory-derivation-candidates-v1',items:[{
     operation:'assert',target:null,category:relation.category,text:'Original evidence anchor',supports:relation.supports,counterevidence:[],
    }]}),context,processing),anchor=prior?.items[0];
    if(!anchor||anchor.claimKey===item.claimKey||seen.has(anchor.claimKey))return null;seen.add(anchor.claimKey);
    for(const lineage of anchor.lineageIds)lineages.add(lineage);for(const binding of anchor.sourceBindings)bindings.set(binding.sourceId,binding);
    reconciles.push({relationship:relation.relationship as MemoryProfileRelation['relationship'],claimKey:anchor.claimKey,
     category:anchor.category as MemoryProfileRelation['category'],supports:anchor.supports});
   }
   items.push({...item,lineageIds:[...lineages].sort(),sourceBindings:[...bindings.values()].sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0),reconciles});
  }
  // Same-result loops are not useful historical reconciliation and must not
  // fabricate a mutually reinforcing chain from one provider response.
  const keys=new Set(items.map(item=>item.claimKey));if(items.some(item=>item.reconciles.some(link=>keys.has(link.claimKey))))return null;
  if(Date.now()>=Date.parse(base.validUntil))return null;
  return freeze({...base,version:MEMORY_PROFILE_RESULT_VERSION,items});
 }catch{return null;}
}
