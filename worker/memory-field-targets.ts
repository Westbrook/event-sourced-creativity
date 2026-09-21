import { blockIntentFor } from '../src/model/block-types.ts';
import { createCreativeEventFold } from '../src/model/events.ts';
import { memoryFieldTextHash } from '../src/model/memory-field-request.ts';
import { observeNativeMemoryBlockBindings,type NativeMemoryResourceScope } from './memory-native-blocks.ts';
import type { NativeMemoryContextObserver } from './memory-live-context.ts';
import { derivationResults } from './memory-derivation-store.ts';
import { derivationExact,derivationInteger } from './memory-derivation-policy.ts';
import type { WorkerEnv } from './runtime.ts';
export type NativeMemoryFieldTarget={blockId:string;field:'text';revision:number;sequence:number;textHash:string;text:string;eventIds:string[]};
/** Current plain authored fields encountered in the explicitly consented action
 * window. This never expands to unobserved blocks, drafts, media, governed
 * context or private generated materializations. All exact historical reads and
 * latest-version absence/presence are added to the native job witness. */
export async function observeNativeMemoryFieldTargets(env:WorkerEnv,scope:NativeMemoryResourceScope,
 observations:Parameters<typeof observeNativeMemoryBlockBindings>[2],observer:NativeMemoryContextObserver){
 const db=env.DB,versions=new Map<string,NativeMemoryFieldTarget>();let overloaded=false;
 await observeNativeMemoryBlockBindings(env,scope,observations,observer,()=>{overloaded=true;},(binding,events)=>{
  if(events.some(event=>Object.hasOwn(event.payload,'memory_origin_version')))return;
  const fold=createCreativeEventFold();for(const event of events)fold.accept(event);
  const block=fold.blockSnapshot(binding.blockId);
  if(!block||block.removed||block.locked||block.scope!=='document'||blockIntentFor(block.type,block.properties)==='prohibit'
   ||['reference','model3d','sketch','output','palette'].includes(block.type)
   ||Object.keys(block.properties).some(key=>!['text','subtype'].includes(key))||typeof block.properties.text!=='string'
   ||!block.properties.text.isWellFormed()||Array.from(block.properties.text).length>1200)return;
  const previous=versions.get(block.id);if(previous&&previous.sequence>=binding.revision)return;
  versions.set(block.id,{blockId:block.id,field:'text',revision:block.sourceEvents.length,sequence:binding.revision,textHash:'',text:block.properties.text,eventIds:[...binding.eventIds]});
 });
 if(overloaded||versions.size>8)throw Error('memory_field_capacity');
 const fields=[...versions.values()].sort((a,b)=>a.blockId<b.blockId?-1:1);
 const query={sql:`SELECT wanted.value AS block_id,(SELECT COALESCE(MAX(sequence),0) FROM events event WHERE event.stream_id=?
   AND json_extract(event.payload,'$.block_id')=wanted.value AND event.type IN('BlockCreated','BlockRehomed','BlockRenamed','BlockPropertyEdited','ChipEdited','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRemoved','BlockRestored','ExtractionRequested','ExtractionCompleted','ExtractionFailed','ImageFocalPointCalculated')) AS sequence
   FROM json_each(?) wanted ORDER BY wanted.value`,bindings:['creative:'+scope.owner_user_id,JSON.stringify(fields.map(field=>field.blockId))]};
 const statement=db.prepare(query.sql).bind(...query.bindings),result=structuredClone(await statement.all<Record<string,unknown>>());
 if(env.DB!==db||!derivationResults([result],1)||result.results.length!==fields.length||result.results.some(row=>!derivationExact(row,['block_id','sequence'])||!derivationInteger(row.sequence,1)))throw Error('memory_field_current');
 observer.observe([statement],[result],[query]);
 const current=fields.filter(field=>result.results.find(row=>row.block_id===field.blockId)?.sequence===field.sequence);
 for(const field of current)field.textHash=await memoryFieldTextHash(field.text);
 if(env.DB!==db)throw Error('memory_field_database');
 return current;
}
