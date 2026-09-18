import type { CreativeEvent } from '../model/events.ts';

const text = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/https?:\/\/\S+/g, '[linked resource]').slice(0, limit) : undefined;
/** Explicit fields only: no provider bodies, URLs, credentials, or arbitrary payloads. */
export function compactHistoryEvent(event: CreativeEvent) {
  const p = event.payload;
  return {
    sequence: event.sequence, type: event.type, at: event.occurredAt,
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
export function retainedHistoryEvents(events: CreativeEvent[]) {
  const forgotten = events.reduce((n,e)=>e.type==='AttentionSignalsForgotten' ? Math.max(n,Number(e.payload.before_sequence)||e.sequence) : n,0);
  return events.filter(e=>!e.type.startsWith('Attention') || e.type==='AttentionEpisodeObserved' && e.sequence>forgotten);
}
// Keep authored work and its outcomes visible even during bursts of passive telemetry.
export function isCreativeHistoryEvent(event: CreativeEvent) {
  return /^(Project|Document|Block|Reference|Region|Chip|Generation|Object|Output|Artifact|Chat|Preference|PromptTechnique|Proposal|Annotation|Collection|Brief|Rights|Fact|Claim)/.test(event.type)
    && !/Viewed$|Visited$|Opened$|Preflight|Presented$/.test(event.type);
}
export const localHistoryEvidence = (events: CreativeEvent[]) => retainedHistoryEvents(events).filter(isCreativeHistoryEvent).slice(-12).map(compactHistoryEvent);

const aggregates=new WeakMap<CreativeEvent[],{useful:CreativeEvent[];creative:CreativeEvent[];counts:Record<string,number>;forgotten:number}>();
/** Reuse deterministic full-history aggregates; raw evidence remains available. */
export function preparedHistory(events:CreativeEvent[],previous?:CreativeEvent[]){
 const cached=aggregates.get(events);if(cached)return cached;
 const prior=previous?aggregates.get(previous):undefined,tail=previous?events.slice(previous.length):events;
 const incremental=!!prior&&events.length>=previous!.length&&!tail.some(e=>e.type==='AttentionSignalsForgotten');
 const forgotten=incremental?prior!.forgotten:events.reduce((n,e)=>e.type==='AttentionSignalsForgotten'?Math.max(n,Number(e.payload.before_sequence)||e.sequence):n,0);
 const retainedTail=incremental?retainedHistoryEvents(tail).filter(e=>e.type!=='AttentionEpisodeObserved'||e.sequence>forgotten):[];
 const useful=incremental?[...prior!.useful,...retainedTail]:retainedHistoryEvents(events);
 const creative=incremental?[...prior!.creative,...retainedTail.filter(isCreativeHistoryEvent)]:useful.filter(isCreativeHistoryEvent);
 const counts:Record<string,number>=incremental?{...prior!.counts}:{};
 for(const event of incremental?retainedTail:useful)counts[event.type]=(counts[event.type]??0)+1;
 const value={useful,creative,counts,forgotten};aggregates.set(events,value);return value;
}

export type HistorySummary={useful:CreativeEvent[];creative:CreativeEvent[];counts:Record<string,number>;forgotten:number;accessibleEvents:number;summarizedEvents:number;creativeEvents:number;oldest?:string;newest?:string};
const summaries=new WeakMap<CreativeEvent[],HistorySummary>();
export function installHistorySummary(events:CreativeEvent[],summary:HistorySummary){summaries.set(events,summary);}
export function historySummary(events:CreativeEvent[]){return summaries.get(events);}
/** Exact counts and bounded evidence windows, without retaining unused raw bodies. */
export function createHistoryCollector(position:{documentId?:string;blockId?:string;outputId?:string}){
 let accessibleEvents=0,creativeEvents=0,forgotten=0,oldest:string|undefined,newest:string|undefined;
 const counts:Record<string,number>={},recent:CreativeEvent[]=[],focused:CreativeEvent[]=[],creative:CreativeEvent[]=[],milestones:CreativeEvent[]=[],attention:CreativeEvent[]=[],focusedAttention:CreativeEvent[]=[],attentionSequences:number[]=[];
 const push=(list:CreativeEvent[],e:CreativeEvent,n:number)=>{list.push(e);if(list.length>n)list.shift();};
 const isFocused=(e:CreativeEvent)=>!!(position.documentId&&e.payload.document_id===position.documentId||position.blockId&&e.payload.block_id===position.blockId||position.outputId&&(e.payload.object_id===position.outputId||e.payload.artifact_id===position.outputId||Array.isArray(e.payload.object_ids)&&e.payload.object_ids.includes(position.outputId)));
 return {
  accept(e:CreativeEvent){
   accessibleEvents++;oldest??=e.occurredAt;newest=e.occurredAt;
   if(e.type==='AttentionSignalsForgotten'){forgotten=Math.max(forgotten,Number(e.payload.before_sequence)||e.sequence);return;}
   if(e.type.startsWith('Attention')){if(e.type==='AttentionEpisodeObserved'){attentionSequences.push(e.sequence);push(attention,e,45);if(isFocused(e))push(focusedAttention,e,35);}return;}
   counts[e.type]=(counts[e.type]??0)+1;push(recent,e,45);if(isFocused(e))push(focused,e,35);
   if(isCreativeHistoryEvent(e)){creativeEvents++;push(creative,e,12);}
   if(/Preference|Intent|Critique|Pinned|Saved|Condition|Rejected|Failed/.test(e.type))push(milestones,e,40);
  },
  finish():HistorySummary{
   const attentionCount=attentionSequences.filter(n=>n>forgotten).length;if(attentionCount)counts.AttentionEpisodeObserved=attentionCount;
   const useful=[...new Map([...recent,...focused,...creative,...milestones,...attention.filter(e=>e.sequence>forgotten),...focusedAttention.filter(e=>e.sequence>forgotten)].map(e=>[e.sequence,e])).values()].sort((a,b)=>a.sequence-b.sequence);
   return {useful,creative,counts,forgotten,accessibleEvents,summarizedEvents:Object.values(counts).reduce((a,b)=>a+b,0),creativeEvents,oldest,newest};
  },
 };
}
