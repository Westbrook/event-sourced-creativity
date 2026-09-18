/** Conservative logical allocation accounting, not a JavaScript heap meter.
 * Activation still requires actual Worker-runtime qualification. */
export const RETAINED_STATE_LIMITS=Object.freeze({bytes:8*1024*1024,nodes:100_000,depth:96});
export class RetainedStateCapacityError extends Error {constructor(){super('retained_state_capacity');}}
export function measureRetainedState(roots:unknown,limits:{bytes:number;nodes:number;depth:number}=RETAINED_STATE_LIMITS){
  let bytes=0,nodes=0;const seen=new WeakSet<object>(),pending:Array<{value:unknown;depth:number}>=[{value:roots,depth:0}];
  const refuse=():never=>{throw new RetainedStateCapacityError();};
  if(Object.values(limits).some(value=>!Number.isSafeInteger(value)||value<1))refuse();
  while(pending.length){
    const {value,depth}=pending.pop()!;
    if(depth>limits.depth||++nodes>limits.nodes)refuse();
    if(value===null||value===undefined){bytes+=8;}
    else if(typeof value==='string')bytes+=24+value.length*2;
    else if(typeof value==='number'||typeof value==='boolean')bytes+=16;
    else if(typeof value!=='object')refuse();
    else if(!seen.has(value)){
      seen.add(value);bytes+=64;
      const budget=()=>{if(bytes>limits.bytes)refuse();};
      const enqueue=(entry:unknown)=>{if(pending.length+nodes>=limits.nodes)refuse();pending.push({value:entry,depth:depth+1});};
      if(value instanceof Map){bytes+=value.size*48;budget();for(const [key,entry] of value){enqueue(key);enqueue(entry);}}
      else if(value instanceof Set){bytes+=value.size*32;budget();for(const entry of value)enqueue(entry);}
      else if(Array.isArray(value)){bytes+=value.length*16;budget();for(const entry of value)enqueue(entry);}
      else {
        const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)refuse();
        for(const key in value){if(!Object.hasOwn(value,key))continue;bytes+=16+key.length*2;budget();enqueue((value as Record<string,unknown>)[key]);}
      }
    }
    if(bytes>limits.bytes||pending.length+nodes>limits.nodes)refuse();
  }
  return {bytes,nodes};
}

export function combineRetainedStateMeasurements(measurements:Iterable<{bytes:number;nodes:number}>,limits=RETAINED_STATE_LIMITS){
  let bytes=0,nodes=0;
  for(const measurement of measurements){bytes+=measurement.bytes;nodes+=measurement.nodes;
    if(bytes>limits.bytes||nodes>limits.nodes)throw new RetainedStateCapacityError();}
  return {bytes,nodes};
}
