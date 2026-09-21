import { memoryDerivationProfileContextSchemaProfile as profileContexts } from './memory-derivation-profile-context-schema.ts';
import { memoryDerivationAssetSchemaProfile as assets } from './memory-derivation-asset-schema.ts';
import { memoryDerivationConsumerParentSchemaProfile as parents,memoryDerivationConsumerParentConsumerDigest } from './memory-derivation-consumer-parent-schema.ts';
import { memoryDerivationConsumerSourceSchemaProfile as sources } from './memory-derivation-consumer-source-schema.ts';
import { memoryDerivationConsumerSchemaProfile as profile } from './memory-derivation-consumer-schema.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { memoryCanonical } from './memory-sql.ts';
const family="name LIKE '%memory_derivation_profile_context%' OR instr(lower(COALESCE(sql,'')),'memory_derivation_profile_contexts')>0 OR name LIKE '%memory_derivation_asset%' OR instr(lower(COALESCE(sql,'')),'memory_derivation_asset_edges')>0 OR name LIKE '%memory_derivation_consumer%' OR instr(lower(COALESCE(sql,'')),'memory_derivation_consumers')>0 OR instr(lower(COALESCE(sql,'')),'memory_derivation_consumer_contents')>0";
export const semanticConsumerSchemaSnapshot=`(SELECT json_group_array(json_object('name',name,'sql',sql,'table',tbl_name,'type',type)) FROM (SELECT name,sql,tbl_name,type FROM sqlite_schema WHERE ${family} ORDER BY name,type))`;
export async function qualifySemanticConsumerBoundary(encoded:unknown){
 if(typeof encoded!=='string')throw Error('memory_boundary_schema_unavailable');
 const rows=JSON.parse(encoded) as {name:string;sql:string|null;table:string;type:string}[];
 if(!Array.isArray(rows)||rows.length>profile.count+profile.automaticIndexes.length+sources.count+sources.automaticIndexes.length+parents.count+parents.automaticIndexes.length+assets.count+assets.automaticIndexes.length+profileContexts.count+profileContexts.automaticIndexes.length)throw Error('memory_boundary_schema_unavailable');
 const explicit=rows.filter(r=>r.sql!==null),names:readonly string[]=[...profile.names,...sources.names,...parents.names,...assets.names,...profileContexts.names],automatic:readonly string[]=[...profile.automaticIndexes,...sources.automaticIndexes,...parents.automaticIndexes,...assets.automaticIndexes,...profileContexts.automaticIndexes];
 if(rows.some(r=>Object.keys(r).sort().join(',')!=='name,sql,table,type'||(r.sql===null?!automatic.includes(r.name):!names.includes(r.name))))throw Error('memory_boundary_schema_unavailable');
 for(const part of [profile,sources,parents,assets,profileContexts]){
  const selected=explicit.filter(r=>(part.names as readonly string[]).includes(r.name));
  if((part===profile&&rows.length>0||selected.length>0)&&(selected.length!==part.count||'sha256:'+await memoryDigest(memoryCanonical(selected.map(r=>({...r,sql:r.sql!.trim().replace(/;$/u,'').replace(/\bIF\s+NOT\s+EXISTS\s+/giu,'')}))))!==(part===profile&&explicit.some(r=>(parents.names as readonly string[]).includes(r.name))?memoryDerivationConsumerParentConsumerDigest:part.digest)))throw Error('memory_boundary_schema_unavailable');
 }
 const assetsPresent=explicit.some(r=>(assets.names as readonly string[]).includes(r.name));
 if((assetsPresent||explicit.some(r=>(profileContexts.names as readonly string[]).includes(r.name)))&&![sources,parents].every(p=>explicit.some(r=>(p.names as readonly string[]).includes(r.name))))throw Error('memory_boundary_schema_unavailable');
 return {present:rows.length>0,assetsPresent,guard:{sql:semanticConsumerSchemaSnapshot+'=?',bindings:[encoded]}};
}
