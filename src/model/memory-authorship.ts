import type { CreativeBlock, CreativeEvent, EventInput } from './events.ts';

/** Negative attribution only. This is neither a Memory read permission nor an
 * erasure dependency. Accepted and deliberately copied authored work survives
 * withdrawal of its private supporting inference. */
export function isMemoryAuthoredEvent(event:CreativeEvent):boolean{
 return event.payload.memory_authored_version===1&&(event.type==='BlockCreated'||event.type==='BlockPropertyEdited');
}
export function memoryAuthoredEventIds(events:readonly CreativeEvent[]):ReadonlySet<string>{
 return new Set(events.filter(isMemoryAuthoredEvent).map(event=>event.eventId));
}
export function memoryAuthoredBlockIds(blocks:readonly CreativeBlock[],events:readonly CreativeEvent[]):ReadonlySet<string>{
 const marked=memoryAuthoredEventIds(events);return new Set(blocks.filter(block=>block.sourceEvents.some(id=>marked.has(id))).map(block=>block.id));
}
/** Public-to-provider negative attribution carries no private source identity. */
export const memoryAuthoredAttribution=Object.freeze({authorship:'accepted-memory-assisted',independent_evidence:false} as const);

/** Called only with a native-authorized source projection before hashing the
 * human-review plan. Pointers never load a source or grant access. Preserve just
 * the negative marker, not private turn/execution IDs or a source capability. */
export function preserveMemoryAuthoredCopies(planned:readonly EventInput[],blocks:readonly CreativeBlock[],sourceEvents:readonly CreativeEvent[]):EventInput[]{
 const assisted=memoryAuthoredBlockIds(blocks,sourceEvents);
 return planned.map(event=>{
  if(event.type!=='BlockCreated')return event;
  const properties=event.payload.properties;
  const nested=properties&&typeof properties==='object'&&!Array.isArray(properties)?properties as Record<string,unknown>:{};
  const source=event.payload.copied_from_block_id??nested.copied_from_block_id;
  return typeof source==='string'&&assisted.has(source)?{...event,payload:{...event.payload,memory_authored_version:1}}:event;
 });
}
