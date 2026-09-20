import { memoryDerivationConsumerSchemaProfile as profile } from './memory-derivation-consumer-schema.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { memoryCanonical } from './memory-sql.ts';
const family="name LIKE '%memory_derivation_consumer%' OR instr(lower(COALESCE(sql,'')),'memory_derivation_consumers')>0 OR instr(lower(COALESCE(sql,'')),'memory_derivation_consumer_contents')>0";
export const semanticConsumerSchemaSnapshot=`(SELECT json_group_array(json_object('name',name,'sql',sql,'table',tbl_name,'type',type)) FROM (SELECT name,sql,tbl_name,type FROM sqlite_schema WHERE ${family} ORDER BY name,type))`;
export async function qualifySemanticConsumerBoundary(encoded:unknown){
 if(typeof encoded!=='string')throw Error('memory_boundary_schema_unavailable');
 const rows=JSON.parse(encoded) as {name:string;sql:string|null;table:string;type:string}[];
 if(!Array.isArray(rows)||rows.length>profile.count+profile.automaticIndexes.length)throw Error('memory_boundary_schema_unavailable');
 const explicit=rows.filter(r=>r.sql!==null),names:readonly string[]=profile.names,automatic:readonly string[]=profile.automaticIndexes;
 if(rows.some(r=>Object.keys(r).sort().join(',')!=='name,sql,table,type'||(r.sql===null?!automatic.includes(r.name):!names.includes(r.name))))throw Error('memory_boundary_schema_unavailable');
 if(rows.length&&(explicit.length!==profile.count||'sha256:'+await memoryDigest(memoryCanonical(explicit.map(r=>({...r,sql:r.sql!.trim().replace(/;$/u,'').replace(/\bIF\s+NOT\s+EXISTS\s+/giu,'')}))))!==profile.digest))throw Error('memory_boundary_schema_unavailable');
 return {present:rows.length>0,guard:{sql:semanticConsumerSchemaSnapshot+'=?',bindings:[encoded]}};
}
