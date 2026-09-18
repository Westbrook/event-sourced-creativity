import {createCreativeEventFold,type CreativeEvent,type CreativeProjection} from '../src/model/events.ts';
import {measureRetainedState,combineRetainedStateMeasurements,RetainedStateCapacityError} from '../src/model/retained-state.ts';

type Row=Record<string,unknown>;
const limits=Object.freeze({bytes:16_000_000,nodes:100_000,depth:96});
/** Every original-version event enters the existing reducer. Retain only the
 * evidence consumed by Image's later global-alias, revision and rights checks;
 * neither source selection nor private authorization is established here. */
export function createImageEventConsumer(outputId:string,key:string,decode:(row:Row)=>CreativeEvent){
  let current=createCreativeEventFold();
  let prior:ReturnType<typeof createCreativeEventFold>|null=createCreativeEventFold();
  let initial:Pick<CreativeProjection,'projectId'|'libraryOutputs'>|null=null;
  let documentId='',count=0,head=0,finished=false;
  const ids=new Set<string>(),events:CreativeEvent[]=[],envelopes:Row[]=[];
  const check=(extra?:unknown)=>{
    try{return combineRetainedStateMeasurements([current.measureRetainedState(limits),...(prior?[prior.measureRetainedState(limits)]:[]),
      measureRetainedState([ids,events,envelopes,initial,extra],limits)],limits);}
    catch(error){if(error instanceof RetainedStateCapacityError)throw Error('image_witness_capacity_retained');throw error;}
  };
  return {
    accept(row:Row){
      if(finished)throw Error('image_witness_unavailable');
      const event=decode(row),p=event.payload;
      if(event.sequence<=head||ids.has(event.eventId))throw Error('image_witness_changed');
      ids.add(event.eventId);count++;head=event.sequence;
      if(!current.accept(event)||prior&&!prior.accept(event))throw Error('image_witness_changed');
      const generated=event.type==='GenerationCompleted'||event.type==='IdeationPreviewCompleted';
      const target=generated&&(p.object_id===outputId||Array.isArray(p.object_ids)&&p.object_ids.includes(outputId));
      if(target&&prior){
        documentId=String(p.document_id??'');const projection=prior.finish({documentId});
        initial={projectId:projection.projectId,libraryOutputs:projection.libraryOutputs.filter(value=>value.id===outputId)};prior=null;
      }
      const edit=event.type==='GeneratedImageEdited'&&(p.output_id===outputId||p.object_id===outputId);
      const collision=['DocumentRenderCompleted','DocumentArtifactEdited'].includes(event.type)&&[outputId,key].includes(String(p.artifact_id??''));
      if(generated||edit||collision||event.type==='ReferenceIngested'||event.type==='RightsAsserted')events.push(event);
      if(target||edit)envelopes.push(row);
    },
    checkpoint(){if(finished)throw Error('image_witness_unavailable');return check();},
    finish(){
      if(finished||!initial)throw Error('image_witness_unavailable');
      check();const projection=current.finish({documentId,projectId:initial.projectId});check(projection);finished=true;
      return {events,envelopes,initial,projection,count,head};
    },
  };
}
