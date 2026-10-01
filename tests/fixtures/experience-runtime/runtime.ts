import type { BoundContext, CompiledRelease, Draft, ExperienceValue, FixtureReceipt, FixtureResult, Issue, RuntimeState } from "./contracts.ts";
import { canonicalJson, digest, freeze, own, valueIssues } from "./compiler.ts";
import { compareReleases } from "./patches.ts";

export function createDraft(release: CompiledRelease, id = `fixture-draft:${crypto.randomUUID()}`): Draft {
  if (!id.startsWith("fixture-draft:") || id.length > 160) throw new Error("fixture_identity_required");
  return freeze({ id, revision: 0, releaseHash: release.releaseHash, values: Object.fromEntries(release.definition.decisions.map(decision => [decision.id, { value: structuredClone(release.interactions[decision.id].defaultValue), provenance: "default" as const }])) });
}
export function draftIssues(release: CompiledRelease, draft: Draft, complete = true): Issue[] {
  if (draft.releaseHash !== release.releaseHash || !draft.id.startsWith("fixture-draft:") || !Number.isSafeInteger(draft.revision) || draft.revision < 0) return [{ code: "draft_identity", path: "$" }];
  if (Object.keys(draft.values).length !== release.definition.decisions.length) return [{ code: "draft_shape", path: "$" }];
  return release.definition.decisions.flatMap(decision => {
    const entry = own(draft.values, decision.id) ? draft.values[decision.id] : undefined;
    if (!entry || !["default", "authored"].includes(entry.provenance)) return [{ code: "draft_shape", path: decision.id }];
    return valueIssues(entry.value, release.interactions[decision.id], decision.id, complete);
  });
}
export function bindDraft(release: CompiledRelease, draft: Draft): readonly BoundContext[] {
  if (draftIssues(release, draft).length) throw new Error("draft_incomplete");
  return freeze(release.output.bindings.map(binding => ({ id: `${draft.id}:${binding.slot}`, bindingSlot: binding.slot, role: binding.role, scope: "document" as const, target: binding.target, value: structuredClone(draft.values[binding.decisionId].value), provenance: draft.values[binding.decisionId].provenance })));
}

/** Isolated in-memory transport: no fetch, persistence, provider, claim or navigation capability. */
export class FixtureTransport {
  readonly mode = "fixture" as const;
  #jobs = new Map<string, FixtureResult>();
  #pending = new Map<string, Promise<FixtureResult>>();
  calls = 0;
  loseNextResponse = false;
  async start(receipt: FixtureReceipt, output: FixtureResult["output"], context: readonly BoundContext[]): Promise<FixtureResult> {
    receipt = structuredClone(receipt);
    context = structuredClone(context);
    if (receipt.mode !== "fixture" || !receipt.draftId.startsWith("fixture-draft:") || receipt.contextHash !== await digest(context)) throw new Error("fixture_receipt_mismatch");
    const signature = canonicalJson({ receipt, output, context });
    const retained = this.#jobs.get(receipt.intentId);
    if (retained) { if (canonicalJson({ receipt: retained.receipt, output: retained.output, context: retained.context }) !== signature) throw new Error("intent_conflict"); return retained; }
    const pending = this.#pending.get(receipt.intentId);
    if (pending) { const result = await pending; if (canonicalJson({ receipt: result.receipt, output: result.output, context: result.context }) !== signature) throw new Error("intent_conflict"); return result; }
    const operation = this.#create(receipt, output, context);
    this.#pending.set(receipt.intentId, operation);
    try { return await operation; } finally { this.#pending.delete(receipt.intentId); }
  }
  async #create(receipt: FixtureReceipt, output: FixtureResult["output"], context: readonly BoundContext[]): Promise<FixtureResult> {
    this.calls += 1;
    const result = freeze({ mode: "fixture" as const, jobId: `fixture-job:${receipt.intentId}`, receipt: structuredClone(receipt), output, context: structuredClone(context) });
    this.#jobs.set(receipt.intentId, result);
    if (this.loseNextResponse) { this.loseNextResponse = false; throw new Error("response_lost"); }
    return result;
  }
  async inspect(receipt: FixtureReceipt): Promise<FixtureResult | undefined> {
    const result = this.#jobs.get(receipt.intentId);
    if (result && canonicalJson(result.receipt) !== canonicalJson(receipt)) throw new Error("fixture_receipt_mismatch");
    return result;
  }
}

async function validResult(result: FixtureResult, receipt: FixtureReceipt, output: FixtureResult["output"]) {
  const retained = structuredClone(result);
  return retained.mode === "fixture" && retained.jobId === `fixture-job:${receipt.intentId}` && retained.output === output && canonicalJson(retained.receipt) === canonicalJson(receipt) && await digest(retained.context) === receipt.contextHash ? freeze(retained) : null;
}

export class ExperienceRuntime {
  readonly release: CompiledRelease;
  readonly transport: FixtureTransport;
  #presentation: CompiledRelease;
  #state: RuntimeState;
  #epoch = 0;
  #available = true;
  #disposed = false;
  #listeners = new Set<() => void>();
  constructor(release: CompiledRelease, transport = new FixtureTransport(), draft?: Draft) {
    if (release.qualification !== "fixture" || transport.mode !== "fixture") throw new Error("fixture_qualification_required");
    this.release = release; this.#presentation = release; this.transport = transport;
    const initial = draft ?? createDraft(release);
    if (draftIssues(release, initial, false).length) throw new Error("draft_invalid");
    this.#state = freeze({ phase: "setup", draft: structuredClone(initial), issues: [] });
  }
  get state() { return this.#state; }
  get presentation() { return this.#presentation; }
  subscribe(listener: () => void) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #set(state: RuntimeState) { if (this.#disposed) return; this.#state = freeze(state); for (const listener of this.#listeners) listener(); }
  change(id: string, value: ExperienceValue): boolean {
    if (this.#disposed || !["setup", "preparing", "review", "blocked"].includes(this.state.phase) || !own(this.release.interactions, id)) return false;
    if (valueIssues(value, this.release.interactions[id], id, false).length) return false;
    const prior = this.state.draft.values[id];
    if (prior.provenance === "authored" && canonicalJson(prior.value) === canonicalJson(value)) return true;
    this.#epoch += 1;
    const draft = { ...this.state.draft, revision: this.state.draft.revision + 1, values: { ...this.state.draft.values, [id]: { value: structuredClone(value), provenance: "authored" as const } } };
    this.#set({ phase: this.#available ? "setup" : "blocked", draft, issues: this.#available ? [] : [{ code: "capability_unavailable", path: "$" }] });
    return true;
  }
  previewPresentation(candidate: CompiledRelease): boolean {
    if (this.#disposed || !["setup", "blocked"].includes(this.state.phase) || compareReleases(this.release, candidate).risk === "semantic") return false;
    this.#presentation = candidate;
    this.#set(this.state);
    return true;
  }
  availability(available: boolean) {
    if (available === this.#available) return;
    this.#available = available;
    if (["submitting", "complete", "uncertain"].includes(this.state.phase)) return;
    this.#epoch += 1;
    this.#set({ phase: available ? "setup" : "blocked", draft: this.state.draft, issues: available ? [] : [{ code: "capability_unavailable", path: "$" }] });
  }
  async prepare(): Promise<boolean> {
    if (this.#disposed || !this.#available || !["setup", "review"].includes(this.state.phase)) return false;
    const draft = this.state.draft;
    const issues = draftIssues(this.release, draft);
    if (issues.length) { this.#set({ phase: "setup", draft, issues }); return false; }
    const epoch = ++this.#epoch;
    this.#set({ phase: "preparing", draft, issues: [] });
    const contextHash = await digest(bindDraft(this.release, draft));
    const identity = { mode: "fixture" as const, draftId: draft.id, revision: draft.revision, releaseHash: draft.releaseHash, contextHash };
    const receipt = { ...identity, intentId: await digest(identity) };
    if (this.#disposed || epoch !== this.#epoch || !this.#available) return false;
    this.#set({ phase: "review", draft, issues: [], receipt });
    return true;
  }
  back(): boolean {
    if (this.#disposed || this.state.phase !== "review") return false;
    this.#epoch += 1;
    this.#set({ phase: "setup", draft: this.state.draft, issues: [] });
    return true;
  }
  async submit(): Promise<boolean> {
    if (this.#disposed || !this.#available || this.state.phase !== "review" || !this.state.receipt) return false;
    const { draft, receipt } = this.state;
    const epoch = ++this.#epoch;
    this.#set({ phase: "submitting", draft, receipt, issues: [] });
    try {
      const result = await validResult(await this.transport.start(receipt, this.release.output.output, bindDraft(this.release, draft)), receipt, this.release.output.output);
      if (this.#disposed || epoch !== this.#epoch) return false;
      if (!result) throw new Error("result_identity_changed");
      this.#set({ phase: "complete", draft, receipt, result, issues: [] });
      return true;
    } catch {
      if (!this.#disposed && epoch === this.#epoch) this.#set({ phase: "uncertain", draft, receipt, issues: [{ code: "check_result", path: "$" }] });
      return false;
    }
  }
  async recover(): Promise<boolean> {
    if (this.#disposed || this.state.phase !== "uncertain" || !this.state.receipt) return false;
    const { draft, receipt } = this.state;
    const epoch = ++this.#epoch;
    try {
      const inspected = await this.transport.inspect(receipt);
      const result = inspected ? await validResult(inspected, receipt, this.release.output.output) : null;
      if (this.#disposed || epoch !== this.#epoch) return false;
      if (!result) { this.#set({ phase: "uncertain", draft, receipt, issues: [{ code: "result_unavailable", path: "$" }] }); return false; }
      this.#set({ phase: "complete", draft, receipt, result, issues: [] });
      return true;
    } catch { return false; }
  }
  handoff(): Readonly<{ mode: "fixture"; available: false }> { return { mode: "fixture", available: false }; }
  dispose() { this.#disposed = true; this.#epoch += 1; this.#listeners.clear(); }
}
