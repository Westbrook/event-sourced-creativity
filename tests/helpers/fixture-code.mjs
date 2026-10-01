import { createHash } from 'node:crypto';
import ts from 'typescript';
const cache=new Map(),maximumBytes=16*1024*1024;
let bytes=0,hits=0,misses=0;
/** Only immutable code is shared. Callers still evaluate with fresh module,
 * Store, DOM, database and authorization ports for every fixture. */
export function fixtureCode(source, compilerOptions) {
  const key=createHash('sha256').update(ts.version).update(JSON.stringify(compilerOptions)).update('\0').update(source).digest('hex');
  if(cache.has(key)){hits++;const code=cache.get(key);cache.delete(key);cache.set(key,code);return code;}
  misses++;
  const code=ts.transpileModule(source,{compilerOptions}).outputText,size=Buffer.byteLength(code);
  if(size<=maximumBytes){while(bytes+size>maximumBytes){const oldest=cache.keys().next().value;bytes-=Buffer.byteLength(cache.get(oldest));cache.delete(oldest);}cache.set(key,code);bytes+=size;}
  return code;
}
export function fixtureCodeStats(){return{hits,misses,entries:cache.size,bytes,maximumBytes};}
