import type {MemoryImageReceiptLifetime} from './memory-image-execution-lifetime.ts';
import { memoryFieldTextHash } from '../src/model/memory-field-request.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { derivationExact,derivationInteger,derivationHash,derivationId } from './memory-derivation-policy.ts';
import { memoryCanonical } from './memory-sql.ts';
import { memoryDerivationJsonUniqueKeys,parseMemoryDerivationResult,snapshotMemoryDerivationInput,type MemoryDerivationParseContext,type MemoryDerivationCandidate,type ParsedMemoryDerivation } from './memory-derivation-result.ts';
import type { NativeMemoryFieldTarget } from './memory-field-targets.ts';
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const MEMORY_FIELD_RECIPE='memory-field-suggestions-v1' as const;
export type MemoryFieldCandidate=MemoryDerivationCandidate&{fieldTarget:Omit<NativeMemoryFieldTarget,'text'|'eventIds'>;replacement:string;locale:'en'|'fr'|'ar'|'ja'};
export type ParsedMemoryFieldDerivation=Omit<ParsedMemoryDerivation,'version'|'items'>&{version:typeof MEMORY_FIELD_RECIPE;items:readonly MemoryFieldCandidate[]};
/** An exact saved-field proposal, not a write, authoring capability or new human
 * preference. Original human intent and unchanged native field identity are
 * both required. No model-supplied project/block IDs are accepted. */
export async function parseMemoryFieldResult(rawJson:string,input:MemoryDerivationParseContext,fieldInput:readonly NativeMemoryFieldTarget[],processing?:MemoryImageReceiptLifetime):Promise<ParsedMemoryFieldDerivation|null>{
 try{
  if(typeof rawJson!=='string'||new TextEncoder().encode(rawJson).byteLength>65536||!memoryDerivationJsonUniqueKeys(rawJson))return null;
  const fields=snapshotMemoryDerivationInput(fieldInput) as NativeMemoryFieldTarget[];
  if(!Array.isArray(fields)||fields.length>8||fields.some(field=>!derivationExact(field,['blockId','field','revision','sequence','textHash','text','eventIds'])
   ||!derivationId(field.blockId)||field.field!=='text'||!derivationInteger(field.revision,1)||!derivationInteger(field.sequence,1)||!derivationHash(field.textHash)
   ||typeof field.text!=='string'||!field.text.isWellFormed()||Array.from(field.text).length>1200||!Array.isArray(field.eventIds)||!field.eventIds.length||field.eventIds.length>256||!field.eventIds.every(derivationId))
   ||new Set(fields.map(field=>field.blockId)).size!==fields.length)return null;
  for(const field of fields)if(await memoryFieldTextHash(field.text)!==field.textHash)return null;
  const raw=snapshotMemoryDerivationInput(JSON.parse(rawJson)),context=snapshotMemoryDerivationInput(input) as MemoryDerivationParseContext;
  if(!derivationExact(raw,['version','items'])||raw.version!==MEMORY_FIELD_RECIPE||!Array.isArray(raw.items)||raw.items.length>8||context.purpose!=='suggestion'||fields.length>8)return null;
  const empty=await parseMemoryDerivationResult(JSON.stringify({version:'memory-derivation-candidates-v1',items:[]}),context,processing);if(!empty)return null;
  const items:MemoryFieldCandidate[]=[],seen=new Set<number>();
  for(const item of raw.items){
   if(!derivationExact(item,['operation','target','category','text','supports','counterevidence','fieldIndex','replacement','locale'])
    ||item.operation!=='assert'||item.target!==null||item.category!=='proposal'||!derivationInteger(item.fieldIndex,0,fields.length-1)||seen.has(item.fieldIndex)
    ||typeof item.replacement!=='string'||!item.replacement.isWellFormed()||!item.replacement.trim()||Array.from(item.replacement).length>600
    ||!['en','fr','ar','ja'].includes(String(item.locale)))return null;
   const field=fields[item.fieldIndex]!;if(item.replacement===field.text)return null;seen.add(item.fieldIndex);
   const {fieldIndex:_index,replacement,locale,...value}=item;
   const parsed=await parseMemoryDerivationResult(JSON.stringify({version:'memory-derivation-candidates-v1',items:[value]}),context,processing),base=parsed?.items[0];
   if(!base||!base.supports.some(quote=>context.sources[quote.sourceIndex]?.authorship==='original-human'&&context.sources[quote.sourceIndex]?.role==='user'))return null;
   const {text:_text,eventIds:_events,...fieldTarget}=field;
   items.push({...base,claimKey:'derived:'+await memoryDigest(memoryCanonical([MEMORY_FIELD_RECIPE,base.claimKey,fieldTarget])),fieldTarget:structuredClone(fieldTarget),replacement,locale:locale as MemoryFieldCandidate['locale']});
  }
  if(Date.now()>=Date.parse(empty.validUntil))return null;
  return freeze({...empty,version:MEMORY_FIELD_RECIPE,items});
 }catch{return null;}
}
