import {memoryAuthoredEventIds} from './memory-authorship.ts';
import {measureRetainedState,RETAINED_STATE_LIMITS} from './retained-state.ts';
import type { CreativeEvent } from "./events.ts";
import { documentViewWorkflow } from "./document-view-signals.ts";
import { promptFactIsActive } from "./prompt-policy.ts";

export const CREATOR_AXES = ["subject","composition","style","palette","lighting","exclusion"] as const;
export type CreatorAxis = typeof CREATOR_AXES[number];
export type PreferencePolarity = "affirm" | "forbid";

export type TasteBelief = {
  beliefId: string;
  claimRef: string;
  axis: CreatorAxis;
  value: string;
  polarity: PreferencePolarity;
  authority: "authored" | "inferred";
  confidence: number;
  evidenceCount: number;
  evidenceRefs: string[];
  validFrom: string;
  recordedAt: string;
  freshness: number;
  sourceClaimRef?: string | null;
  preferenceId?: string;
};

export type CompilerBlameCluster = {
  clusterId: string;
  modelId: string;
  adapterVersion: string;
  critiqueCount: number;
  positive: number;
  negative: number;
  attributed: boolean;
  axes: Array<{axis: CreatorAxis; positive: number; negative: number}>;
  sourceBlockVersions: Array<{blockId: string; version: number; critiqueCount: number; positive: number; negative: number}>;
  critiqueRefs: string[];
  compileRefs: string[];
  generationIds: string[];
  objectIds: string[];
};

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const round = (value: number, precision = 3) => Number(value.toFixed(precision));
const safeAxis = (value: unknown): CreatorAxis => CREATOR_AXES.includes(value as CreatorAxis) ? value as CreatorAxis : "style";
const concise = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\s+/g," ").slice(0,120) || "unspecified";
};
const axisFor = (property: string) => /color|palette|warm|temperature/i.test(property) ? "palette" : /light|atmosphere/i.test(property) ? "lighting" : /subject/i.test(property) ? "subject" : /position|frame|composition/i.test(property) ? "composition" : /avoid|exclude|negative/i.test(property) ? "exclusion" : "style";
const hash = (value: string) => { let result = 2166136261; for (let i=0;i<value.length;i++){result^=value.charCodeAt(i);result=Math.imul(result,16777619);} return (result>>>0).toString(16).padStart(8,"0"); };

export function standingConstraints(events: CreativeEvent[], recordedAsOf = Number.POSITIVE_INFINITY) {
  const fold = createStandingConstraintsFold(recordedAsOf);
  for (const event of events) if (!fold.accept(event)) break;
  return fold.finish();
}

/** The same authored-preference reducer for paged, complete history. */
export function createStandingConstraintsFold(recordedAsOf = Number.POSITIVE_INFINITY) {
  const active = new Map<string, TasteBelief>();
  let ended = false, finished = false;
  const accept = (event: CreativeEvent): boolean => {
    if (finished) throw new Error("constraints_fold_already_finished");
    if (ended || event.sequence > recordedAsOf) { ended = true; return false; }
    if (event.type === "PreferenceAuthored") {
      const preferenceId = String(event.payload.preference_id); const axis = safeAxis(event.payload.axis); const value = concise(event.payload.value); const polarity = event.payload.polarity === "forbid" ? "forbid" : "affirm";
      active.set(preferenceId, { beliefId:`preference:${preferenceId}`, claimRef:`preference:${preferenceId}`, preferenceId, axis, value, polarity, authority:"authored", confidence:1, evidenceCount:1, evidenceRefs:[event.eventId], validFrom:event.occurredAt, recordedAt:event.recordedAt, freshness:1, sourceClaimRef:event.payload.source_claim_ref ? String(event.payload.source_claim_ref) : null });
    }
    if (event.type === "PreferenceRevoked") active.delete(String(event.payload.preference_id));
    return true;
  };
  const finish = () => {
    if (finished) throw new Error("constraints_fold_already_finished");
    finished = true;
    return [...active.values()];
  };
  return { accept, finish, measureRetainedState:(limits=RETAINED_STATE_LIMITS)=>measureRetainedState([active],limits) };
}

function savedContextFact(value: unknown): { axis: CreatorAxis; value: string; polarity: PreferencePolarity } | null {
  if (typeof value === "string") {
    if (!value.trim()) return null;
    const [prefix, ...rest] = value.split("/");
    return { axis: axisFor(prefix), value: concise(rest.join("/") || value), polarity: "affirm" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !promptFactIsActive(value)) return null;
  const fact = value as Record<string, unknown>;
  if(fact.independent_evidence===false||fact.authorship==="accepted-memory-assisted"||fact.memory_authored_version===1)return null;
  if (!fact.properties || typeof fact.properties !== "object" || Array.isArray(fact.properties)) return null;
  const properties = fact.properties as Record<string, unknown>;
  // Read creative values, never serialize the fact's asset/identity/provenance metadata.
  const fields = ["text", "instruction", "description", "value", "colors", "palette", "lighting", "subject", "composition", "style"] as const;
  const values = fields.flatMap((key) => {
    const candidate = properties[key];
    const text = typeof candidate === "string" ? candidate.trim()
      : Array.isArray(candidate) && candidate.every((item) => typeof item === "string") ? candidate.map((item) => item.trim()).filter(Boolean).join(", ") : "";
    return text ? [{ key, text }] : [];
  });
  if (!values.length) return null;
  const kind = typeof fact.type === "string" ? fact.type : typeof fact.role === "string" ? fact.role : "";
  const intent = fact.intent ?? properties.intent;
  const polarity = kind === "exclusion" || fact.effect === "must_not_include" || intent === "avoid" || intent === "prohibit" ? "forbid" : "affirm";
  return { axis: CREATOR_AXES.includes(kind as CreatorAxis) ? kind as CreatorAxis : axisFor(`${kind} ${values.map((item) => item.key).join(" ")}`),
    value: concise([...new Set(values.map((item) => item.text))].join(" · ")), polarity };
}

function positiveContextEvidence(events: CreativeEvent[]) {
  const marked=memoryAuthoredEventIds(events);
  const rows: Array<{axis:CreatorAxis;value:string;polarity:PreferencePolarity;event:CreativeEvent;refs:string[]}> = [];
  for (const outcome of events.filter((event) => /^(ObjectSaved|ObjectPinned|ObjectExported|AddedToLibrary|PromptFanOutputPromoted)$/.test(event.type))) {
    const objectId = String(outcome.payload.object_id ?? outcome.payload.item_id ?? "");
    const completed = [...events].reverse().find((event) => event.sequence < outcome.sequence && event.type === "GenerationCompleted" && list(event.payload.object_ids).map(String).includes(objectId));
    if (!completed) continue;
    const compiled = [...events].reverse().find((event) => event.sequence < completed.sequence && event.type === "ContextCompiled" && event.payload.generation_id === completed.payload.generation_id);
    const snapshot = compiled?.payload.compiled_snapshot as Record<string, unknown> | undefined;
    for (const value of list(snapshot?.facts).slice(0,6)) {
      if(value&&typeof value==="object"&&!Array.isArray(value)&&list((value as Record<string,unknown>).source_event_refs).some(id=>marked.has(String(id))))continue;
      const fact = savedContextFact(value); if (!fact) continue;
      rows.push({...fact,event:outcome,refs:[compiled?.eventId,completed.eventId,outcome.eventId].filter((item):item is string=>Boolean(item))});
    }
  }
  return rows;
}

export function inferTasteBeliefs(events: CreativeEvent[], now = new Date()) {
  const marked=memoryAuthoredEventIds(events),assistedBlocks=new Set<string>();
  const candidates: Array<{axis:CreatorAxis;value:string;polarity:PreferencePolarity;event:CreativeEvent;refs:string[]}> = positiveContextEvidence(events);
  for (const event of events) {
    if(marked.has(event.eventId))assistedBlocks.add(String(event.payload.block_id));
    if(event.payload.memory_authored_version===1||event.payload.source_chat_turn_id||event.payload.source_surface==="assistant"||event.type==="ChipEdited"&&assistedBlocks.has(String(event.payload.block_id)))continue;
    if (event.type === "ChipEdited") candidates.push({ axis:axisFor(String(event.payload.property ?? "style")), value:concise(event.payload.new_value), polarity:"affirm", event, refs:[event.eventId] });
    if (event.type === "ObjectCritiqued") candidates.push({ axis:safeAxis(event.payload.axis_ref), value:concise(event.payload.value ?? `${String(event.payload.axis_ref ?? "style")} critique`), polarity:event.payload.polarity === "positive" ? "affirm" : "forbid", event, refs:[event.eventId] });
  }
  const retracted = new Set(events.filter((event) => event.type === "FactRetracted").map((event) => String(event.payload.fact_ref)));
  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) { const key=`${candidate.axis}:${candidate.polarity}:${candidate.value.toLowerCase()}`; groups.set(key,[...(groups.get(key)??[]),candidate]); }
  const halfLifeDays = 60;
  return [...groups].map(([key,rows]) => {
    const latest = rows.at(-1)!; const ageDays = Math.max(0,(now.getTime()-Date.parse(latest.event.occurredAt))/86_400_000); const freshness = Math.pow(.5,ageDays/halfLifeDays); const claimRef=`taste:${hash(key)}`;
    const evidenceRefs=[...new Set(rows.flatMap((row)=>row.refs))]; const confidence=round(Math.min(.94,(.48+Math.min(5,rows.length)*.09)*freshness));
    return { beliefId:`belief-${hash(key)}`,claimRef,axis:latest.axis,value:latest.value,polarity:latest.polarity,authority:"inferred" as const,confidence,evidenceCount:evidenceRefs.length,evidenceRefs,validFrom:rows[0].event.occurredAt,recordedAt:latest.event.recordedAt,freshness:round(freshness) };
  }).filter((belief)=>!retracted.has(belief.claimRef)&&belief.confidence>=.2).sort((left,right)=>right.confidence-left.confidence||right.evidenceCount-left.evidenceCount).slice(0,16);
}

function currentTasteBeliefs(events:CreativeEvent[]) {
  const latestVersion = events.filter((event)=>event.type==="TasteModelVersioned").at(-1);
  const retracted = new Set(events.filter((event)=>event.type==="FactRetracted").map((event)=>String(event.payload.fact_ref)));
  const versionBeliefs = list(latestVersion?.payload.beliefs).map((item)=>item as TasteBelief).filter((item)=>!retracted.has(item.claimRef));
  // An old model snapshot cannot launder assisted evidence after attribution
  // becomes available. Rebuild this derived view; explicitly authored preferences
  // and retractions remain authoritative and are never removed by this filter.
  const assisted=events.some(event=>event.payload.memory_authored_version===1||event.type==='ContextCompiled'&&list((event.payload.compiled_snapshot as Record<string,unknown>|undefined)?.facts).some(value=>value&&typeof value==='object'&&('independent_evidence' in value&&value.independent_evidence===false||'authorship' in value&&value.authorship==='accepted-memory-assisted')));
  return versionBeliefs.length&&!assisted ? versionBeliefs : inferTasteBeliefs(events);
}

export function preferenceCapsule(events: CreativeEvent[], limit = 8) {
  const authored = standingConstraints(events),inferred=currentTasteBeliefs(events);
  const authoredKeys = new Set(authored.map((item)=>`${item.axis}:${item.value.toLowerCase()}:${item.polarity}`));
  return [...authored,...inferred.filter((item)=>!authoredKeys.has(`${item.axis}:${item.value.toLowerCase()}:${item.polarity}`))].sort((left,right)=>Number(right.authority==="authored")-Number(left.authority==="authored")||right.confidence-left.confidence).slice(0,limit);
}

export function compilerBlameLedger(events: CreativeEvent[]): CompilerBlameCluster[] {
  type MutableCluster = Omit<CompilerBlameCluster,"axes"|"sourceBlockVersions"|"critiqueRefs"|"compileRefs"|"generationIds"|"objectIds"> & {
    axes: Map<CreatorAxis,{positive:number;negative:number}>;
    sourceBlockVersions: Map<string,{blockId:string;version:number;critiqueCount:number;positive:number;negative:number}>;
    critiqueRefs: Set<string>;
    compileRefs: Set<string>;
    generationIds: Set<string>;
    objectIds: Set<string>;
  };
  const clusters = new Map<string,MutableCluster>();
  for (const critique of events.filter((event)=>event.type==="ObjectCritiqued")) {
    const objectId=String(critique.payload.object_id??"");
    const completed=[...events].reverse().find((event)=>event.sequence<critique.sequence&&event.type==="GenerationCompleted"&&list(event.payload.object_ids).map(String).includes(objectId));
    const generationId=String(completed?.payload.generation_id??"");
    const compiled=generationId?[...events].reverse().find((event)=>event.sequence<(completed?.sequence??critique.sequence)&&event.type==="ContextCompiled"&&String(event.payload.generation_id)===generationId):undefined;
    const modelId=String(completed?.payload.model_id??compiled?.payload.model_id??"unresolved-model");
    const adapterVersion=String(compiled?.payload.adapter_version??"unresolved-adapter");
    const clusterId=`${modelId}:${adapterVersion}`;
    const cluster=clusters.get(clusterId)??{clusterId,modelId,adapterVersion,critiqueCount:0,positive:0,negative:0,attributed:false,axes:new Map(),sourceBlockVersions:new Map(),critiqueRefs:new Set(),compileRefs:new Set(),generationIds:new Set(),objectIds:new Set()};
    const axis=safeAxis(critique.payload.axis_ref); const positive=critique.payload.polarity==="positive";
    cluster.critiqueCount+=1; cluster.positive+=Number(positive); cluster.negative+=Number(!positive); cluster.attributed ||= Boolean(completed&&compiled);
    const axisRow=cluster.axes.get(axis)??{positive:0,negative:0}; axisRow.positive+=Number(positive); axisRow.negative+=Number(!positive); cluster.axes.set(axis,axisRow);
    for (const source of list(compiled?.payload.source_block_versions)) {
      if (!source||typeof source!=="object") continue;
      const row=source as Record<string,unknown>; const blockId=String(row.block_id??""); if(!blockId)continue; const version=Number(row.version??0); const key=`${blockId}@${version}`;
      const sourceRow=cluster.sourceBlockVersions.get(key)??{blockId,version,critiqueCount:0,positive:0,negative:0}; sourceRow.critiqueCount+=1; sourceRow.positive+=Number(positive); sourceRow.negative+=Number(!positive); cluster.sourceBlockVersions.set(key,sourceRow);
    }
    cluster.critiqueRefs.add(critique.eventId); if(compiled)cluster.compileRefs.add(compiled.eventId); if(generationId)cluster.generationIds.add(generationId); if(objectId)cluster.objectIds.add(objectId); clusters.set(clusterId,cluster);
  }
  return [...clusters.values()].map((cluster)=>({
    ...cluster,
    axes:CREATOR_AXES.flatMap((axis)=>{const row=cluster.axes.get(axis);return row?[{axis,...row}]:[]}),
    sourceBlockVersions:[...cluster.sourceBlockVersions.values()].sort((left,right)=>right.critiqueCount-left.critiqueCount||left.blockId.localeCompare(right.blockId)),
    critiqueRefs:[...cluster.critiqueRefs],compileRefs:[...cluster.compileRefs],generationIds:[...cluster.generationIds],objectIds:[...cluster.objectIds],
  })).sort((left,right)=>right.critiqueCount-left.critiqueCount||left.clusterId.localeCompare(right.clusterId));
}

export function tasteMetrics(events: CreativeEvent[]) {
  const versions=events.filter((event)=>event.type==="TasteModelVersioned"),inferred=currentTasteBeliefs(events).length;
  const authored=events.filter((event)=>event.type==="PreferenceAuthored"); const promoted=authored.filter((event)=>Boolean(event.payload.source_claim_ref)).length;
  const critiques=events.filter((event)=>event.type==="ObjectCritiqued");
  const axisLedger=CREATOR_AXES.map((axis)=>({axis,positive:critiques.filter((event)=>event.payload.axis_ref===axis&&event.payload.polarity==="positive").length,negative:critiques.filter((event)=>event.payload.axis_ref===axis&&event.payload.polarity!=="positive").length}));
  const compilerBlame=compilerBlameLedger(events);
  const generationPromotions=events.filter((event)=>event.type==="IdeationPromoted");const completedGenerationPromotions=generationPromotions.filter((promotion)=>events.some((event)=>event.type==="GenerationCompleted"&&String(event.payload.promotion_id??"")===String(promotion.payload.promotion_id??promotion.eventId))).length;
  const workflow=documentViewWorkflow(events);
  return {versions:versions.length,inferred,activeAuthored:standingConstraints(events).length,promoted,promotionRate:inferred?round(Math.min(1,promoted/inferred)):0,generationPromotions:generationPromotions.length,completedGenerationPromotions,generationPromotionSuccessRate:generationPromotions.length?round(completedGenerationPromotions/generationPromotions.length):0,axisLedger,compilerBlame,attributedCritiques:compilerBlame.filter((cluster)=>cluster.attributed).reduce((total,cluster)=>total+cluster.critiqueCount,0),workflow};
}

export function beliefHistory(events: CreativeEvent[]) {
  return events.filter((event)=>/^(TasteModelVersioned|PreferenceAuthored|PreferenceRevoked|FactRetracted|ClaimSuperseded|IdeationPromoted)$/.test(event.type)).map((event)=>({eventId:event.eventId,sequence:event.sequence,type:event.type,occurredAt:event.occurredAt,recordedAt:event.recordedAt,payload:event.payload})).reverse();
}
