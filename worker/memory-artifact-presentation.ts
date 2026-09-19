import type { EventRow } from './runtime.ts';
/** Personal viewing activity is not shared project content. Preserve pagination
 * identity but withhold the observation type, target, actor and correlation. */
export function presentActorArtifactView(event:EventRow,actorUserId:string):EventRow{
  return ['DocumentArtifactViewed','BlockInspected'].includes(event.type)&&event.actor!=='user:'+actorUserId
    ?{...event,type:'ProjectResourceRestricted',actor:'private',clientId:'private',payload:{restricted:true},correlationId:'',causationId:null,compensatesEventId:null}:event;
}
export function presentActorArtifactPage<T extends {events:EventRow[]}>(page:T,actorUserId:string){
  return {...page,events:page.events.map(event=>presentActorArtifactView(event,actorUserId))};
}
