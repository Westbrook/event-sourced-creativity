import { STILL_FORMATS, STILL_MODES } from './routes.ts';

const SURFACES = ['main','formats','workflow','palette','more','result','recovery'] as const;
const STEPS = ['browse','edit','configure','review','submit','pending','result','recovery'] as const;
const MODES = [...STILL_MODES,'generate'] as const;
const VIEWS = ['projects','documents','ideas','document','results','artifact','generation','rejection'] as const;
const IDEA_KINDS = ['direction','subject','environment','style','exclusion','message','material','audience','emotion','composition','reference'] as const;

/** Bounded client observations, never authority to execute or leave a workflow. */
export type SurfaceContext = {
  version: 1;
  surface: typeof SURFACES[number];
  mode?: typeof MODES[number];
  step?: typeof STEPS[number];
  dirtyDraft?: boolean;
  pendingOperation?: boolean;
  blockingReview?: boolean;
  interactionLocked?: boolean;
  selectedParameters?: { format?: typeof STILL_FORMATS[number]; kind?: typeof IDEA_KINDS[number]; itemCount?: number };
  readiness?: { hasContext?: boolean; hasSelection?: boolean; inputsComplete?: boolean; canSubmit?: boolean };
  visibleActionIds?: string[];
  selectedTargetIds?: string[];
  returnPath?: { view: typeof VIEWS[number] };
  targetRevision?: number;
};

/** The user supplies this goal; it is not inferred from navigation or engagement. */
export type ExplicitGoal = { source: 'explicit-user'; text: string; criteria: string[] };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function member<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined;
}
function ids(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  // IDs are opaque tokens. Descriptions, URLs and draft text have no place here.
  return [...new Set(value.slice(0,40).filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,179}$/.test(id)))];
}

/** Reconstruct the allowlisted shape; arbitrary properties never reach Jev. */
export function cleanSurfaceContext(value: unknown, allowedActionIds?: readonly string[]): SurfaceContext | undefined {
  const input = record(value);
  if (!input || input.version !== 1) return undefined;
  const surface = member(input.surface,SURFACES);
  if (!surface) return undefined;
  const result: SurfaceContext = {version:1,surface};
  const mode = member(input.mode,MODES), step = member(input.step,STEPS);
  if (mode) result.mode = mode;
  if (step) result.step = step;
  for (const key of ['dirtyDraft','pendingOperation','blockingReview','interactionLocked'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  const parameters = record(input.selectedParameters);
  if (parameters) {
    const selected: NonNullable<SurfaceContext['selectedParameters']> = {};
    const format = member(parameters.format,STILL_FORMATS), kind = member(parameters.kind,IDEA_KINDS);
    if (format) selected.format = format;
    if (kind) selected.kind = kind;
    if (typeof parameters.itemCount === 'number' && Number.isInteger(parameters.itemCount) && parameters.itemCount >= 1 && parameters.itemCount <= 40) selected.itemCount = parameters.itemCount;
    if (Object.keys(selected).length) result.selectedParameters = selected;
  }
  const readiness = record(input.readiness);
  if (readiness) {
    const selected: NonNullable<SurfaceContext['readiness']> = {};
    for (const key of ['hasContext','hasSelection','inputsComplete','canSubmit'] as const) {
      if (typeof readiness[key] === 'boolean') selected[key] = readiness[key];
    }
    if (Object.keys(selected).length) result.readiness = selected;
  }
  for (const key of ['visibleActionIds','selectedTargetIds'] as const) {
    const selected = ids(input[key]);
    if (selected) result[key] = key === 'visibleActionIds' && allowedActionIds ? selected.filter(id=>allowedActionIds.includes(id)) : selected;
  }
  const returnView = member(record(input.returnPath)?.view,VIEWS);
  if (returnView) result.returnPath = {view:returnView};
  if (typeof input.targetRevision === 'number' && Number.isSafeInteger(input.targetRevision) && input.targetRevision >= 0) result.targetRevision = input.targetRevision;
  return result;
}

function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= limit ? text : undefined;
}

export function cleanExplicitGoal(value: unknown): ExplicitGoal | undefined {
  const input = record(value);
  if (!input || input.source !== 'explicit-user') return undefined;
  const text = boundedText(input.text,2000);
  if (!text) return undefined;
  const criteria = Array.isArray(input.criteria)
    ? [...new Set(input.criteria.slice(0,5).map(item=>boundedText(item,240)).filter((item): item is string=>!!item))]
    : [];
  return {source:'explicit-user',text,criteria};
}
