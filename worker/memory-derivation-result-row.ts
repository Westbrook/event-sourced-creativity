import { DERIVATION_RESULT_TABLE_COLUMNS } from './memory-derivation-results-schema.ts';
import { derivationExact } from './memory-derivation-policy.ts';
import { derivationResults } from './memory-derivation-store.ts';

export type NativeDerivationStoredRow=Record<string,string|number|null>;
const columns=DERIVATION_RESULT_TABLE_COLUMNS.memory_derivation_results;
// Match the producer/parser and original manifest admission ceilings. Enforce
// these in SQLite before any retained body is hydrated into the Worker.
export const NATIVE_DERIVATION_RESULT_BYTES=65536;
export const NATIVE_DERIVATION_MANIFEST_BYTES=256*1024;
const metadata=columns.filter(column=>!['raw_json','manifest_json'].includes(column));
export const nativeDerivationResultRowSql=`SELECT ${columns.join(',')} FROM memory_derivation_results WHERE job_id=?
 AND COALESCE(length(CAST(raw_json AS BLOB)),0)<=${NATIVE_DERIVATION_RESULT_BYTES}
 AND COALESCE(length(CAST(manifest_json AS BLOB)),0)<=${NATIVE_DERIVATION_MANIFEST_BYTES}
 AND (${metadata.map(column=>`COALESCE(length(CAST(${column} AS BLOB)),0)`).join('+')})<=8192 LIMIT 2`;

/** Only data, never source or disclosure authority. Missing/oversized rows stay
 * unavailable; callers still replay the exact raw/result dependency predicate. */
export function nativeDerivationStoredRow(result:unknown):NativeDerivationStoredRow|null{
 if(!derivationResults([result],1))throw Error('memory-result-unavailable');
 const rows=(result as D1Result<Record<string,unknown>>).results;
 const bytes=(value:unknown)=>typeof value==='string'?new TextEncoder().encode(value).byteLength:value===null?0:typeof value==='number'&&Number.isFinite(value)?String(value).length:Infinity;
 if(rows.length>1||rows.some(row=>!derivationExact(row,columns)
   ||!(row.raw_json===null||typeof row.raw_json==='string')||!(row.manifest_json===null||typeof row.manifest_json==='string')||bytes(row.raw_json)>NATIVE_DERIVATION_RESULT_BYTES
   ||bytes(row.manifest_json)>NATIVE_DERIVATION_MANIFEST_BYTES||metadata.reduce((sum,column)=>sum+bytes(row[column]),0)>8192))throw Error('memory-result-unavailable');
 return rows[0] as NativeDerivationStoredRow??null;
}
