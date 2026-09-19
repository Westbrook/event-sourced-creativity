import { memoryDigest } from '../src/model/scoped-memory.ts';
import { memoryCanonical } from './memory-sql.ts';
import { derivationExact, derivationHash, derivationId, derivationInteger, derivationTime } from './memory-derivation-policy.ts';
import { memoryDerivationJsonUniqueKeys, parseMemoryDerivationResult, snapshotMemoryDerivationInput,
  type MemoryDerivationParseContext, type MemoryDerivationCandidate, type ParsedMemoryDerivation } from './memory-derivation-result.ts';

export const MEMORY_BEHAVIORAL_RESULT_VERSION='memory-derivation-candidates-v2' as const;
export const MEMORY_BEHAVIORAL_ACTIONS=['encounter','inspect','compare','edit','commit','reuse','remove','restore','critique','request','accept','reject','defer'] as const;
/** Typed native evidence, not authored words, independent use, attention or
 * semantic truth. Only the native capture may supply these to a provider. */
export type MemoryBehavioralSource={sourceId:string;revision:number;contentHash:string;lineageId:string;scopeKey:string;
  resourceKey:string;eventType:string;action:typeof MEMORY_BEHAVIORAL_ACTIONS[number];recordedAt:string;expiresAt:string;independentEvidence:false};
export type MemoryBehavioralContext=MemoryDerivationParseContext&{observations:readonly MemoryBehavioralSource[]};
export type MemoryBehavioralCitation={observationIndex:number;action:MemoryBehavioralSource['action'];recordedAt:string;role:'support'|'counterevidence'};
export type MemoryBehavioralCandidate=MemoryDerivationCandidate&{observationSupports:readonly number[];observationCounterevidence:readonly number[];
  observationCitations:readonly MemoryBehavioralCitation[]};
export type ParsedMemoryBehavioralDerivation=Omit<ParsedMemoryDerivation,'version'|'items'>&{
  version:typeof MEMORY_BEHAVIORAL_RESULT_VERSION;items:readonly MemoryBehavioralCandidate[]};
const sourceKeys=['sourceId','revision','contentHash','lineageId','scopeKey','resourceKey','eventType','action','recordedAt','expiresAt','independentEvidence'];
const scope=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=8192&&value.isWellFormed();
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export async function behavioralSourceHash(source:Omit<MemoryBehavioralSource,'contentHash'>){return memoryDigest(memoryCanonical(source));}

/** V2 is explicit. V1 continues to require genuine original quotations. This
 * parser issues data only, never spending, publication or source authority.
 * Native controls, complete dependencies and fresh scope proof remain required.
 * Observations cannot establish a decision or an authored preference. */
export async function parseMemoryBehavioralResult(rawJson:string,input:MemoryBehavioralContext):Promise<ParsedMemoryBehavioralDerivation|null>{
  try{
    if(typeof rawJson!=='string'||new TextEncoder().encode(rawJson).byteLength>65536||!memoryDerivationJsonUniqueKeys(rawJson))return null;
    const raw=snapshotMemoryDerivationInput(JSON.parse(rawJson)),context=snapshotMemoryDerivationInput(input);
    if(!derivationExact(raw,['version','items'])||raw.version!==MEMORY_BEHAVIORAL_RESULT_VERSION||!Array.isArray(raw.items)||raw.items.length>16
      ||!derivationExact(context,['purpose','scopeKey','manifestId','manifestRevision','checkedAt','validUntil','sources','priorItems','suppressedLineages','observations'])
      ||!['rolling-summary','profile','suggestion'].includes(String(context.purpose))||!scope(context.scopeKey)||!derivationId(context.manifestId)
      ||!derivationInteger(context.manifestRevision,1)||!derivationTime(context.checkedAt)||!derivationTime(context.validUntil)
      ||!Array.isArray(context.sources)||context.sources.length>128||!Array.isArray(context.priorItems)||context.priorItems.length!==0
      ||!Array.isArray(context.suppressedLineages)||context.suppressedLineages.length>128||context.suppressedLineages.some(id=>!derivationHash(id))
      ||new Set(context.suppressedLineages).size!==context.suppressedLineages.length
      ||!Array.isArray(context.observations)||context.observations.length>128||context.sources.length+context.observations.length===0)return null;
    const at=Date.parse(context.checkedAt),until=Date.parse(context.validUntil);
    if(at>Date.now()||until<=Date.now()||until<=at||until-at>60000)return null;
    const observations=context.observations as MemoryBehavioralSource[],base={...context} as Record<string,unknown>;delete base.observations;
    if(context.sources.length&&!await parseMemoryDerivationResult(JSON.stringify({version:'memory-derivation-candidates-v1',items:[]}),base as unknown as MemoryDerivationParseContext))return null;
    const ids=new Set(context.sources.map(source=>(source as {sourceId:string}).sourceId));
    for(const source of observations){
      if(!derivationExact(source,sourceKeys)||!derivationId(source.sourceId)||ids.has(source.sourceId)||!derivationInteger(source.revision,1)
        ||!derivationHash(source.contentHash)||!derivationHash(source.lineageId)||source.scopeKey!==context.scopeKey||!scope(source.resourceKey)
        ||!derivationId(source.eventType)||!MEMORY_BEHAVIORAL_ACTIONS.includes(source.action)||source.independentEvidence!==false
        ||!derivationTime(source.recordedAt)||!derivationTime(source.expiresAt)||Date.parse(source.recordedAt)>at||Date.parse(source.expiresAt)<until
        ||Date.parse(source.expiresAt)<=Date.parse(source.recordedAt))return null;
      const {contentHash,...descriptor}=source;if(await behavioralSourceHash(descriptor)!==contentHash||Date.now()>=until)return null;ids.add(source.sourceId);
    }
    const items:MemoryBehavioralCandidate[]=[],claims=new Set<string>();
    for(const value of raw.items){
      if(!derivationExact(value,['operation','target','category','text','supports','counterevidence','observationSupports','observationCounterevidence'])
        ||value.operation!=='assert'||value.target!==null||typeof value.text!=='string'||!value.text.trim()||!value.text.isWellFormed()||Array.from(value.text).length>1000
        ||!Array.isArray(value.supports)||value.supports.length>8||!Array.isArray(value.counterevidence)||value.counterevidence.length>8
        ||!Array.isArray(value.observationSupports)||value.observationSupports.length>8||!Array.isArray(value.observationCounterevidence)||value.observationCounterevidence.length>8
        ||value.supports.length+value.observationSupports.length===0)return null;
      const categories=context.purpose==='profile'?['preference-hypothesis','workflow-hypothesis']:context.purpose==='suggestion'?['proposal','next-step']:['goal','decision','proposal','rejected-alternative','question','blocker','next-step'];
      if(!categories.includes(String(value.category)))return null;
      const indexSet=new Set<number>(),cited:MemoryBehavioralSource[]=[],citations:MemoryBehavioralCitation[]=[];
      for(const [indexes,role] of [[value.observationSupports,'support'],[value.observationCounterevidence,'counterevidence']] as const){
        for(const index of indexes){
          if(!derivationInteger(index,0,observations.length-1)||indexSet.has(index))return null;indexSet.add(index);
          const source=observations[index]!;if(context.suppressedLineages.includes(source.lineageId))return null;
          cited.push(source);citations.push({observationIndex:index,action:source.action,recordedAt:source.recordedAt,role});
        }
      }
      let original:MemoryDerivationCandidate|undefined;
      if(value.supports.length){
        const quoted={operation:value.operation,target:value.target,category:value.category,text:value.text,supports:value.supports,counterevidence:value.counterevidence};
        original=(await parseMemoryDerivationResult(JSON.stringify({version:'memory-derivation-candidates-v1',items:[quoted]}),base as unknown as MemoryDerivationParseContext))?.items[0];if(!original)return null;
      }else{
        // Observation-only hypotheses never claim original intent, decisions or
        // personal preferences. Mixed quotation counterevidence requires an
        // original-supported item until its independent contract is qualified.
        if(value.counterevidence.length||!['workflow-hypothesis','proposal','next-step'].includes(String(value.category)))return null;
      }
      const bindings=new Map((original?.sourceBindings??[]).map(source=>[source.sourceId,source]));
      for(const source of cited)bindings.set(source.sourceId,{sourceId:source.sourceId,revision:source.revision,contentHash:source.contentHash});
      const lineageIds=[...new Set([...(original?.lineageIds??[]),...cited.map(source=>source.lineageId)])].sort();
      const claimKey='derived:'+await memoryDigest(memoryCanonical(['native-behavioral-claim-v2',context.scopeKey,context.purpose,value.category,original?.claimKey??null,
        value.observationSupports.map(index=>{const source=observations[Number(index)]!;return [source.sourceId,source.revision,source.contentHash];}).sort((a,b)=>memoryCanonical(a).localeCompare(memoryCanonical(b)))]));
      if(claims.has(claimKey)||Date.now()>=until)return null;claims.add(claimKey);
      items.push({...value as unknown as MemoryBehavioralCandidate,claimKey,lineageIds,sourceBindings:[...bindings.values()].sort((a,b)=>a.sourceId.localeCompare(b.sourceId)),
        validUntil:context.validUntil,citationStatus:value.counterevidence.length||value.observationCounterevidence.length?'conflicting-citations':'support-cited',observationCitations:citations});
    }
    if(Date.now()>=until)return null;
    return freeze({version:MEMORY_BEHAVIORAL_RESULT_VERSION,purpose:context.purpose as MemoryBehavioralContext['purpose'],scopeKey:context.scopeKey,
      manifestId:context.manifestId,manifestRevision:context.manifestRevision,validUntil:context.validUntil,
      semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,items});
  }catch{return null;}
}
