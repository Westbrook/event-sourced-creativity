import type { CreativeEvent } from "./events";

export const ATTENTION_RETENTION_DAYS = 14;
export const ATTENTION_STORAGE_KEY = "forma:attention-episodes:v1";
export const ATTENTION_PREFERENCE_KEY = "forma:attention-enabled:v1";
const scopedKey=(key:string,scope:string)=>`${key}:${encodeURIComponent(scope||"anonymous")}`;

export type AttentionEpisode = {
  episode_id: string;
  surface: string;
  context: string;
  document_view?: string;
  document_id?: string;
  focused?: boolean;
  started_at: string;
  ended_at: string;
  expires_at: string;
  active_ms: number;
  idle_ms: number;
  visible_refs: string[];
  terminal_type: string;
  terminal_ref: string | null;
  outcome_weight: number;
  friction_score: number;
  capture_version: "attention-v1" | "attention-v2";
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number, precision = 3) => Number(value.toFixed(precision));

const TERMINAL_VALUE: Record<string, number> = {
  ObjectSaved: 1,
  ObjectPinned: 1,
  AddedToLibrary: 1,
  BriefItemAccepted: 1,
  PreferenceAuthored: 1,
  ObjectCritiqued: 1,
  DocumentCreated: .9,
  EmptyCanvasChosen: .9,
  BlockCreated: .8,
  BlockPropertyEdited: .8,
  ObjectViewed: .78,
  ComparisonOpened: .72,
  GenerationRequested: .7,
  IdeationPromoted: 1,
  PromptFanOutputPromoted: 1,
  route_changed: .32,
  page_hidden: .12,
  idle_timeout: .08,
  capture_disabled: 0,
};

export function buildAttentionEpisode(input: Omit<AttentionEpisode,"outcome_weight"|"friction_score"|"capture_version"|"expires_at">, retentionDays = ATTENTION_RETENTION_DAYS): AttentionEpisode {
  const total = Math.max(1, input.active_ms + input.idle_ms); const activeRatio = clamp(input.active_ms / total);
  const terminalValue = TERMINAL_VALUE[input.terminal_type] ?? .45;
  // Attention can reinforce explicit evidence, but its authority is capped at one quarter of a direct action.
  const outcomeWeight = clamp(terminalValue * (.25 + activeRatio * .75) * .25, 0, .25);
  const elapsedSeconds = total / 1000; const longActive = clamp((elapsedSeconds - 30) / 150);
  const contextRisk = /writing-direction|generation|studio-context/.test(input.context) ? 1 : .55;
  const unresolvedTerminal = /^(route_changed|page_hidden|DocumentCreated|EmptyCanvasChosen|idle_timeout)$/.test(input.terminal_type) ? 1 : .25;
  const frictionScore = clamp(longActive * activeRatio * contextRisk * unresolvedTerminal);
  const expiresAt = new Date(Date.parse(input.ended_at) + retentionDays * 86_400_000).toISOString();
  return { ...input, expires_at: expiresAt, outcome_weight: round(outcomeWeight), friction_score: round(frictionScore), capture_version:"attention-v2" };
}

export function attentionEvents(events: CreativeEvent[], now = Date.now()) {
  const forgottenAt = events.filter((event) => event.type === "AttentionSignalsForgotten").at(-1)?.sequence ?? 0;
  return events.filter((event) => event.type === "AttentionEpisodeObserved" && event.sequence > forgottenAt && Date.parse(String(event.payload.expires_at ?? "")) > now);
}

export function attentionMetrics(events: CreativeEvent[], now = Date.now()) {
  const episodes = attentionEvents(events, now); const activeMs = episodes.reduce((sum,event)=>sum+Number(event.payload.active_ms??0),0);
  const weights = episodes.map((event)=>Number(event.payload.outcome_weight??0)); const friction = episodes.filter((event)=>Number(event.payload.friction_score??0)>=.45);
  return {
    episodes: episodes.length,
    activeMinutes: round(activeMs/60_000,1),
    highIntent: episodes.filter((event)=>Number(event.payload.outcome_weight??0)>=.18).length,
    frictionFlags: friction.length,
    meanWeight: round(weights.length?weights.reduce((sum,value)=>sum+value,0)/weights.length:0),
    latest: episodes.at(-1) ?? null,
  };
}

export function loadLocalAttentionEpisodes(now = Date.now(), scope = "anonymous"): AttentionEpisode[] {
  try {
    const key=scopedKey(ATTENTION_STORAGE_KEY,scope);const parsed=JSON.parse(localStorage.getItem(key)??"[]") as unknown;
    if(!Array.isArray(parsed))return[];
    const kept=parsed.filter((item):item is AttentionEpisode=>Boolean(item&&typeof item==="object"&&Date.parse(String((item as AttentionEpisode).expires_at))>now)).slice(-100);
    localStorage.setItem(key,JSON.stringify(kept));return kept;
  } catch { return []; }
}

export function saveLocalAttentionEpisode(episode: AttentionEpisode, scope = "anonymous") {
  try { localStorage.setItem(scopedKey(ATTENTION_STORAGE_KEY,scope),JSON.stringify([...loadLocalAttentionEpisodes(Date.now(),scope),episode].slice(-100))); } catch { /* Device storage is an optional review surface. */ }
}

export function clearLocalAttentionEpisodes(scope = "anonymous") { try { localStorage.removeItem(scopedKey(ATTENTION_STORAGE_KEY,scope)); } catch { /* Storage may be unavailable. */ } }
export function readAttentionPreference(scope = "anonymous") { try { return localStorage.getItem(scopedKey(ATTENTION_PREFERENCE_KEY,scope))==="true"; } catch { return false; } }
export function writeAttentionPreference(enabled:boolean, scope = "anonymous") { try { localStorage.setItem(scopedKey(ATTENTION_PREFERENCE_KEY,scope),String(enabled)); } catch { /* The preference remains session-local when storage is blocked. */ } }
