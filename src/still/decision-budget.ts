/** One request budget shared by preparation, assessment, enrichment and repair. */
export class DecisionBudget {
  readonly deadline: number;
  private readonly controller = new AbortController();
  private readonly parents: AbortSignal[];
  constructor(readonly startedAt = Date.now(), timeoutMs = 10_000, signal?: AbortSignal) {
    this.deadline = startedAt + timeoutMs;
    this.parents = [this.controller.signal, ...(signal ? [signal] : [])];
  }
  remaining() { return Math.max(0, this.deadline - Date.now()); }
  reason() { return this.parents.some(signal => signal.aborted) ? 'cancelled' : this.remaining() <= 0 ? 'latency_budget' : undefined; }
  signal(maximumMs: number) {
    return AbortSignal.any([...this.parents, AbortSignal.timeout(Math.max(1, Math.min(maximumMs, this.remaining())))]);
  }
  cancel() { this.controller.abort(); }
}

/** Retain numeric provider accounting only, never arbitrary provider metadata. */
export function decisionUsage(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const entries = Object.entries(value).filter(([key, number]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1e12).slice(0, 32);
  return entries.length ? Object.fromEntries(entries) as Record<string, number> : undefined;
}

export function decisionProviderSummary(passes: {id:string;status:string;model?:string;usage?:Record<string,number>;elapsedMs:number}[]) {
  const usage: Record<string, number> = {};
  for (const pass of passes) for (const [key, value] of Object.entries(pass.usage ?? {})) usage[key] = (Object.hasOwn(usage, key) ? usage[key] : 0) + value;
  return {
    requestedModel: 'jev-latest',
    resolvedModels: [...new Set(passes.flatMap(pass => pass.model ? [pass.model] : []))],
    usage,
    passes: passes.map(({id,status,model,usage,elapsedMs}) => ({id,status,model,usage,elapsedMs})),
  };
}
