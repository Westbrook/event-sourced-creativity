import type { CreativeEvent } from '../model/events.ts';
import { attentionEvents } from '../model/attention.ts';

const text = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/https?:\/\/\S+/g, '[linked resource]').slice(0, limit) : undefined;
/** Actor identity is not sent to the provider. A relationship needs an authorized viewer identity. */
export function actorEvidence(event: CreativeEvent, currentActor?: string) {
  const actor = String(event.actor ?? '');
  const actorKind = /^user(?::|$)/.test(actor) ? 'user' : actor.startsWith('worker:') ? 'worker' : actor.startsWith('model:') ? 'model' : /^system(?::|$)/.test(actor) ? 'system' : 'unknown';
  const actorRelation = actorKind === 'user' ? currentActor ? actor === currentActor ? 'current-user' : actor === 'user' ? 'unknown' : 'other-user' : 'unknown' : actorKind === 'unknown' ? 'unknown' : 'system';
  return { actorKind, actorRelation };
}
/** Explicit fields only: no provider bodies, URLs, credentials, or arbitrary payloads. */
export function compactHistoryEvent(event: CreativeEvent) {
  const p = event.payload;
  return {
    eventId: text(event.eventId,180), schemaVersion: event.schemaVersion,
    sequence: event.sequence, type: event.type, at: event.occurredAt, recordedAt: event.recordedAt,
    ...actorEvidence(event), correlationId: text(event.correlationId,180),
    causationId: text(event.causationId,180), compensatesEventId: text(event.compensatesEventId,180),
    expiresAt: event.type === 'AttentionEpisodeObserved' ? text(p.expires_at,40) : undefined,
    project: text(p.project_id,180), document: text(p.document_id,180), block: text(p.block_id,180),
    object: text(p.object_id,180), artifact: text(p.artifact_id,180),
    objects: Array.isArray(p.object_ids) ? p.object_ids.slice(0,4).map(id=>text(id,180)) : undefined,
    text: text(p.new_value ?? p.text ?? p.message ?? p.note ?? p.statement ?? (p.properties as Record<string,unknown> | undefined)?.text, 500),
    direction: text(p.new_title ?? p.title ?? p.name ?? p.value,180),
    source: text(p.source_surface ?? p.application,80), view: text(p.document_view ?? p.route_family ?? p.surface,80),
    format: text(p.artifact_kind ?? p.output_format ?? p.format ?? p.output_kind,60),
    status: text(p.status,60), property: text(p.property_path ?? p.property,120),
    relation: text(p.relation_kind ?? p.kind,60), from: text(p.from_block_id,180), to: text(p.to_block_id,180),
  };
}
const forgottenSequence = (events: CreativeEvent[]) => events.reduce((n,e)=>e.type==='AttentionSignalsForgotten' ? Math.max(n,e.sequence) : n,0);
const attentionExpiry = (event: CreativeEvent) => Date.parse(String(event.payload.expires_at ?? ''));
const earliestExpiry = (values: number[]) => values.length ? values.reduce((min,value)=>Math.min(min,value),Infinity) : undefined;
export function retainedHistoryEvents(events: CreativeEvent[], now = Date.now()) {
  const attention = new Set(attentionEvents(events,now));
  return events.filter(e=>!e.type.startsWith('Attention') || attention.has(e));
}
// Keep authored work and its outcomes visible even during bursts of passive telemetry.
export function isCreativeHistoryEvent(event: CreativeEvent) {
  return /^(Project|Document|Block|Reference|Region|Chip|Generation|Object|Output|Artifact|Chat|Preference|PromptTechnique|Proposal|Annotation|Collection|Brief|Rights|Fact|Claim)/.test(event.type)
    && !/Viewed$|Visited$|Opened$|Preflight|Presented$/.test(event.type);
}
export const localHistoryEvidence = (events: CreativeEvent[]) => retainedHistoryEvents(events).filter(isCreativeHistoryEvent).slice(-12).map(compactHistoryEvent);

type HistoryAggregate = {useful:CreativeEvent[];creative:CreativeEvent[];counts:Record<string,number>;forgotten:number;expiresAt?:number};
const aggregates=new WeakMap<CreativeEvent[],HistoryAggregate>();
/** Reuse deterministic full-history aggregates only until their first evidence expiry. */
export function preparedHistory(events:CreativeEvent[],previous?:CreativeEvent[],now=Date.now()){
 const cached=aggregates.get(events);if(cached&&(cached.expiresAt===undefined||cached.expiresAt>now))return cached;
 const prior=previous?aggregates.get(previous):undefined,tail=previous?events.slice(previous.length):events;
 const incremental=!!prior&&(prior.expiresAt===undefined||prior.expiresAt>now)&&events.length>=previous!.length&&(!previous!.length||events[previous!.length-1]===previous!.at(-1))&&!tail.some(e=>e.type==='AttentionSignalsForgotten');
 const forgotten=incremental?prior!.forgotten:forgottenSequence(events);
 const retainedTail=incremental?retainedHistoryEvents(tail,now).filter(e=>e.type!=='AttentionEpisodeObserved'||e.sequence>forgotten):[];
 const useful=incremental?[...prior!.useful,...retainedTail]:retainedHistoryEvents(events,now);
 const creative=incremental?[...prior!.creative,...retainedTail.filter(isCreativeHistoryEvent)]:useful.filter(isCreativeHistoryEvent);
 const counts:Record<string,number>=incremental?{...prior!.counts}:{};
 for(const event of incremental?retainedTail:useful)counts[event.type]=(counts[event.type]??0)+1;
 const expiresAt=earliestExpiry(useful.filter(e=>e.type==='AttentionEpisodeObserved').map(attentionExpiry));
 const value={useful,creative,counts,forgotten,expiresAt};aggregates.set(events,value);return value;
}

type AttentionRetention = {sequence:number;expiresAt:number};
export type HistorySummary=HistoryAggregate&{accessibleEvents:number;summarizedEvents:number;creativeEvents:number;oldest?:string;newest?:string;attentionRetention:AttentionRetention[]};
const summaries=new WeakMap<CreativeEvent[],HistorySummary>();
export function installHistorySummary(events:CreativeEvent[],summary:HistorySummary){summaries.set(events,summary);}
export function historySummary(events:CreativeEvent[],now=Date.now()){
 const value=summaries.get(events);if(!value||value.expiresAt===undefined||value.expiresAt>now)return value;
 const attentionRetention=value.attentionRetention.filter(e=>e.expiresAt>now&&e.sequence>value.forgotten),counts={...value.counts};
 if(attentionRetention.length)counts.AttentionEpisodeObserved=attentionRetention.length;else delete counts.AttentionEpisodeObserved;
 const refreshed={...value,useful:retainedHistoryEvents(value.useful,now).filter(e=>!e.type.startsWith('Attention')||e.sequence>value.forgotten),counts,attentionRetention,expiresAt:earliestExpiry(attentionRetention.map(e=>e.expiresAt)),summarizedEvents:Object.values(counts).reduce((a,b)=>a+b,0)};
 summaries.set(events,refreshed);return refreshed;
}
/** Capture before requesting a decision; do not extend this deadline after provider work. */
export function historyEvidenceExpiresAt(events:CreativeEvent[],now=Date.now()){
 const attention=(historySummary(events,now)??preparedHistory(events,undefined,now)).expiresAt;
 const active=new Map<string,CreativeEvent>();
 for(const event of events){const id=String(event.payload.preference_id??'');if(!id)continue;if(event.type==='PreferenceAuthored'||event.type==='PromptTechniquePreferred')active.set(id,event);if(event.type==='PreferenceRevoked'||event.type==='PromptTechniquePreferenceRevoked')active.delete(id);}
 const preferenceExpiries=[...active.values()].map(event=>Date.parse(String(event.payload.expires_at??''))).filter(expires=>expires>now);
 return earliestExpiry([...(attention===undefined?[]:[attention]),...preferenceExpiries]);
}
export type HistoryCheckpoint={accessibleEvents:number;creativeEvents:number;forgotten:number;oldest?:string;newest?:string;counts:Record<string,number>;recent:CreativeEvent[];focused:CreativeEvent[];creative:CreativeEvent[];milestones:CreativeEvent[];attention:CreativeEvent[];focusedAttention:CreativeEvent[];attentionRetention:AttentionRetention[];expiresAt?:number};
/** Exact counts and bounded evidence windows, without retaining unused raw bodies. */
export function createHistoryCollector(position:{documentId?:string;blockId?:string;outputId?:string},seed?:HistoryCheckpoint,now=Date.now()){
 const state:HistoryCheckpoint=seed?structuredClone(seed):{accessibleEvents:0,creativeEvents:0,forgotten:0,counts:{},recent:[],focused:[],creative:[],milestones:[],attention:[],focusedAttention:[],attentionRetention:[]};
 let {accessibleEvents,creativeEvents,forgotten,oldest,newest}=state;
 const {counts,recent,focused,creative,milestones,attention,focusedAttention,attentionRetention}=state;
 const push=(list:CreativeEvent[],e:CreativeEvent,n:number)=>{list.push(e);if(list.length>n)list.shift();};
 const isFocused=(e:CreativeEvent)=>!!(position.documentId&&e.payload.document_id===position.documentId||position.blockId&&e.payload.block_id===position.blockId||position.outputId&&(e.payload.object_id===position.outputId||e.payload.artifact_id===position.outputId||Array.isArray(e.payload.object_ids)&&e.payload.object_ids.includes(position.outputId)));
 const retained=()=>attentionRetention.filter(e=>e.sequence>forgotten&&e.expiresAt>now);
 const attentionWindow=(events:CreativeEvent[])=>attentionEvents(events,now).filter(e=>e.sequence>forgotten);
 return {
  checkpoint():HistoryCheckpoint{const retention=retained();return structuredClone({...state,accessibleEvents,creativeEvents,forgotten,oldest,newest,attention:attentionWindow(attention),focusedAttention:attentionWindow(focusedAttention),attentionRetention:retention,expiresAt:earliestExpiry(retention.map(e=>e.expiresAt))});},
  accept(e:CreativeEvent){
   accessibleEvents++;oldest??=e.occurredAt;newest=e.occurredAt;
   if(e.type==='AttentionSignalsForgotten'){forgotten=Math.max(forgotten,e.sequence);return;}
   if(e.type.startsWith('Attention')){if(attentionEvents([e],now).length){attentionRetention.push({sequence:e.sequence,expiresAt:attentionExpiry(e)});push(attention,e,45);if(isFocused(e))push(focusedAttention,e,35);}return;}
   counts[e.type]=(counts[e.type]??0)+1;push(recent,e,45);if(isFocused(e))push(focused,e,35);
   if(isCreativeHistoryEvent(e)){creativeEvents++;push(creative,e,12);}
   if(/Preference|Intent|Critique|Pinned|Saved|Condition|Rejected|Failed/.test(e.type))push(milestones,e,40);
  },
  finish():HistorySummary{
   const retention=retained(),summaryCounts={...counts};if(retention.length)summaryCounts.AttentionEpisodeObserved=retention.length;else delete summaryCounts.AttentionEpisodeObserved;
   const useful=[...new Map([...recent,...focused,...creative,...milestones,...attentionWindow(attention),...attentionWindow(focusedAttention)].map(e=>[e.sequence,e])).values()].sort((a,b)=>a.sequence-b.sequence);
   return {useful,creative,counts:summaryCounts,forgotten,accessibleEvents,summarizedEvents:Object.values(summaryCounts).reduce((a,b)=>a+b,0),creativeEvents,oldest,newest,attentionRetention:retention,expiresAt:earliestExpiry(retention.map(e=>e.expiresAt))};
  },
 };
}

/** Explicit authored preferences are separate from old preference mentions and passive behavior. */
export function activePreferenceEvidence(events:CreativeEvent[],position:{projectId?:string;documentId?:string;blockId?:string;collectionIds?:string[]},currentActor?:string,now=Date.now()){
 const active=new Map<string,CreativeEvent>();let revoked=0,expired=0,outOfScope=0,unsupportedScope=0;
 for(const event of events){
  const id=typeof event.payload.preference_id==='string'?event.payload.preference_id:'';if(!id)continue;
  if(event.type==='PreferenceAuthored'||event.type==='PromptTechniquePreferred')active.set(id,event);
  if(event.type==='PreferenceRevoked'||event.type==='PromptTechniquePreferenceRevoked'){active.delete(id);revoked++;}
 }
 const preferences=[];
 for(const [id,event] of active){
  const p=event.payload,scope=String(p.scope??'account'),scopeId=String(p.scope_id??''),expiresAt=p.expires_at===undefined?undefined:Date.parse(String(p.expires_at));
  if(p.revoked===true){revoked++;continue;}
  if(expiresAt!==undefined&&(!Number.isFinite(expiresAt)||expiresAt<=now)){expired++;continue;}
  if(!['account','project','document','collection','idea','block'].includes(scope)){unsupportedScope++;continue;}
  const applies=scope==='account'||!!scopeId&&(scope==='project'?scopeId===position.projectId:scope==='document'?scopeId===position.documentId:scope==='collection'?!!position.collectionIds?.includes(scopeId):scopeId===position.blockId);
  if(!applies){outOfScope++;continue;}
  preferences.push({id:text(id,180),status:'active' as const,scope:{kind:scope,id:text(scopeId,180)},source:{kind:'authored' as const,eventId:text(event.eventId,180),sequence:event.sequence,at:event.occurredAt,recordedAt:event.recordedAt,...actorEvidence(event,currentActor),claimRef:text(p.source_claim_ref,180)},axis:text(p.axis,80),value:text(p.value??p.statement,500),polarity:text(p.polarity,40),technique:text(p.technique,80),expiresAt:expiresAt===undefined?undefined:new Date(expiresAt).toISOString()});
 }
 return {active:preferences,coverage:{active:preferences.length,revoked,expired,outOfScope,unsupportedScope},guidance:'Active explicit preferences are scoped guidance, not current requests. Revoked or expired preferences do not apply. Actor relationship is unknown without a verified viewer identity.'};
}
