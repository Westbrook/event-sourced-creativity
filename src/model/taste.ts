import type { CreativeEvent } from "./events.ts";

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
  const active = new Map<string, TasteBelief>();
  for (const event of events) {
    if (event.sequence > recordedAsOf) break;
    if (event.type === "PreferenceAuthored") {
      const preferenceId = String(event.payload.preference_id); const axis = safeAxis(event.payload.axis); const value = concise(event.payload.value); const polarity = event.payload.polarity === "forbid" ? "forbid" : "affirm";
      active.set(preferenceId, { beliefId:`preference:${preferenceId}`, claimRef:`preference:${preferenceId}`, preferenceId, axis, value, polarity, authority:"authored", confidence:1, evidenceCount:1, evidenceRefs:[event.eventId], validFrom:event.occurredAt, recordedAt:event.recordedAt, freshness:1, sourceClaimRef:event.payload.source_claim_ref ? String(event.payload.source_claim_ref) : null });
    }
    if (event.type === "PreferenceRevoked") active.delete(String(event.payload.preference_id));
  }
  return [...active.values()];
}

function positiveContextEvidence(events: CreativeEvent[]) {
  const rows: Array<{axis:CreatorAxis;value:string;polarity:PreferencePolarity;event:CreativeEvent;refs:string[]}> = [];
  for (const outcome of events.filter((event) => /^(ObjectSaved|ObjectPinned|ObjectExported|AddedToLibrary)$/.test(event.type))) {
    const objectId = String(outcome.payload.object_id ?? outcome.payload.item_id ?? "");
    const completed = [...events].reverse().find((event) => event.sequence < outcome.sequence && event.type === "GenerationCompleted" && list(event.payload.object_ids).map(String).includes(objectId));
    if (!completed) continue;
    const compiled = [...events].reverse().find((event) => event.sequence < completed.sequence && event.type === "ContextCompiled" && event.payload.generation_id === completed.payload.generation_id);
    const snapshot = compiled?.payload.compiled_snapshot as Record<string, unknown> | undefined;
    for (const fact of list(snapshot?.facts).map(String).slice(0,6)) {
      const [prefix,...rest] = fact.split("/"); const axis = axisFor(prefix); const value = concise(rest.join("/") || fact);
      rows.push({axis,value,polarity:"affirm",event:outcome,refs:[compiled?.eventId,completed.eventId,outcome.eventId].filter((item):item is string=>Boolean(item))});
    }
  }
  return rows;
}

export function inferTasteBeliefs(events: CreativeEvent[], now = new Date()) {
  const candidates: Array<{axis:CreatorAxis;value:string;polarity:PreferencePolarity;event:CreativeEvent;refs:string[]}> = positiveContextEvidence(events);
  for (const event of events) {
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

export function preferenceCapsule(events: CreativeEvent[], limit = 8) {
  const authored = standingConstraints(events);
  const latestVersion = events.filter((event)=>event.type==="TasteModelVersioned").at(-1);
  const retracted = new Set(events.filter((event)=>event.type==="FactRetracted").map((event)=>String(event.payload.fact_ref)));
  const versionBeliefs = list(latestVersion?.payload.beliefs).map((item)=>item as TasteBelief).filter((item)=>!retracted.has(item.claimRef));
  const inferred = versionBeliefs.length ? versionBeliefs : inferTasteBeliefs(events);
  const authoredKeys = new Set(authored.map((item)=>`${item.axis}:${item.value.toLowerCase()}:${item.polarity}`));
  return [...authored,...inferred.filter((item)=>!authoredKeys.has(`${item.axis}:${item.value.toLowerCase()}:${item.polarity}`))].sort((left,right)=>Number(right.authority==="authored")-Number(left.authority==="authored")||right.confidence-left.confidence).slice(0,limit);
}

export function tasteMetrics(events: CreativeEvent[]) {
  const versions=events.filter((event)=>event.type==="TasteModelVersioned"); const latest=versions.at(-1); const retracted=new Set(events.filter((event)=>event.type==="FactRetracted").map((event)=>String(event.payload.fact_ref))); const inferred=list(latest?.payload.beliefs).map((item)=>item as TasteBelief).filter((item)=>!retracted.has(item.claimRef)).length;
  const authored=events.filter((event)=>event.type==="PreferenceAuthored"); const promoted=authored.filter((event)=>Boolean(event.payload.source_claim_ref)).length;
  const critiques=events.filter((event)=>event.type==="ObjectCritiqued");
  const axisLedger=CREATOR_AXES.map((axis)=>({axis,positive:critiques.filter((event)=>event.payload.axis_ref===axis&&event.payload.polarity==="positive").length,negative:critiques.filter((event)=>event.payload.axis_ref===axis&&event.payload.polarity!=="positive").length}));
  return {versions:versions.length,inferred,activeAuthored:standingConstraints(events).length,promoted,promotionRate:inferred?round(Math.min(1,promoted/inferred)):0,axisLedger};
}

export function beliefHistory(events: CreativeEvent[]) {
  return events.filter((event)=>/^(TasteModelVersioned|PreferenceAuthored|PreferenceRevoked|FactRetracted|ClaimSuperseded)$/.test(event.type)).map((event)=>({eventId:event.eventId,sequence:event.sequence,type:event.type,occurredAt:event.occurredAt,recordedAt:event.recordedAt,payload:event.payload})).reverse();
}
