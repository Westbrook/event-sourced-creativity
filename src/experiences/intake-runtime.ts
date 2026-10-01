import { canonicalJson, compileExperience, digest, freeze, jsonIssues, valueIssues } from "./compiler.ts";
import type { CompiledRelease, DecisionValue, ExperienceValue, Issue } from "./contracts.ts";
import { experienceDocumentRoute, initialValues, intakeValueIssues, isDraftId, isIntentId, experienceIds, registeredExperience, type ExperiencePlan, type IntakeRequest } from "./intake.ts";
import type { ExperienceSurface } from "./view.ts";

type State = Readonly<{ phase: "setup" | "preparing" | "review" | "submitting" | "complete" | "uncertain"; draft: { values: Readonly<Record<string, DecisionValue>> }; issues: readonly Issue[] }>;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type ExperienceRecoveryAdmission = Readonly<{ experienceId: string; id: string; byIntent: boolean }>;
/** Verified Document-creation provenance, not generated output or an execution grant.
 * Event identities correspond by index to the immutable plan's native events.
 * A consumer must compare its captured receipt with the runtime's current getter
 * and independently qualify any subsequent native operation and source custody. */
export type ExperienceDocumentReceipt = Readonly<{
  kind: "document-commit";
  plan: ExperiencePlan;
  documentRoute: string;
  head: number;
  appended: readonly Readonly<{ eventId: string; sequence: number }>[];
}>;
/** A retained context-authoring flow. Completion means Document creation, not generation. */
export class ExperienceIntakeRuntime implements ExperienceSurface {
  readonly mode = "intake" as const;
  #release?: CompiledRelease;
  readonly admissionRelease?: CompiledRelease;
  readonly #experienceId: string;
  #state: State;
  #request?: IntakeRequest;
  #plan?: ExperiencePlan;
  #resume?: Readonly<{ id: string; byIntent: boolean }>;
  #route?: string;
  #completion?: Readonly<{ epoch: number; receipt: ExperienceDocumentReceipt }>;
  #listeners = new Set<() => void>();
  #fetch: Fetcher;
  #epoch = 0;
  #disposed = false;
  #abort = new AbortController();
  constructor(admission: CompiledRelease | ExperienceRecoveryAdmission, fetcher: Fetcher = fetch) {
    this.#fetch = fetcher;
    if ("releaseHash" in admission) {
      this.#release = admission; this.admissionRelease = admission; this.#experienceId = admission.definition.id;
      this.#state = freeze({ phase: "setup", draft: { values: initialValues(admission) }, issues: [] });
    } else {
      if (!experienceIds.includes(admission.experienceId) || typeof admission.byIntent !== "boolean" || !(admission.byIntent ? isIntentId(admission.id) : typeof admission.id === "string" && isDraftId(admission.id))) throw new Error("experience_route_invalid");
      this.#experienceId = admission.experienceId;
      this.#resume = Object.freeze({ id: admission.id, byIntent: admission.byIntent });
      // Original-plan recovery never creates defaults, mints an intent or admits today's release.
      this.#state = freeze({ phase: "uncertain", draft: { values: {} }, issues: [] });
    }
  }
  get state() { return this.#state; }
  get release() { return this.#release; }
  get presentation() { return this.release; }
  get documentRoute() { return this.#route; }
  get documentReceipt(): ExperienceDocumentReceipt | undefined {
    return this.#completion && this.#current(this.#completion.epoch) && this.#state.phase === "complete"
      ? this.#completion.receipt : undefined;
  }
  get recovery() { return Boolean(this.#resume); }
  get draftId() { return this.#plan?.draftId ?? (this.#resume && !this.#resume.byIntent ? this.#resume.id : undefined); }
  get intentId() { return this.#request?.intentId ?? (this.#resume?.byIntent ? this.#resume.id : undefined); }
  get canRetry() { return !this.#disposed && Boolean(this.#plan || this.#request) && (!this.admissionRelease || !this.#plan || this.#plan.release.releaseHash === this.admissionRelease.releaseHash); }
  subscribe(callback: () => void) { this.#listeners.add(callback); return () => this.#listeners.delete(callback); }
  #set(phase: State["phase"], issues: readonly Issue[] = []) { if (!this.#disposed) { this.#state = freeze({ ...this.#state, phase, issues }); for (const callback of [...this.#listeners]) callback(); } }
  #current(epoch: number) { return !this.#disposed && epoch === this.#epoch; }
  #error(error: unknown) { return [{ code: error instanceof Error ? error.message : "experience_unavailable", path: "$" }]; }
  async #get(path: string, body?: unknown) {
    const response = await this.#fetch(path, { ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), credentials: "same-origin", cache: "no-store", redirect: "error", signal: this.#abort.signal });
    const value = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "experience_unavailable");
    return value;
  }
  async #acceptPlan(value: Record<string, unknown>) {
    const plan = structuredClone(value.plan) as ExperiencePlan;
    if (jsonIssues(plan).length || !plan || plan.version !== 1 || !isDraftId(plan.draftId) || !isIntentId(plan.request?.intentId) || plan.request.releaseHash !== plan.release.releaseHash || plan.request.experienceId !== this.#experienceId || intakeValueIssues(plan.release, plan.request.values).length) throw new Error("experience_result_mismatch");
    const compiled = await compileExperience(plan.release.definition, { version: "forma-experience-fixture@1", qualification: "fixture", interactions: Object.fromEntries(Object.values(plan.release.interactions).map(interaction => [interaction.id, interaction])), outputs: { [plan.release.output.id]: plan.release.output }, copy: plan.release.copy });
    if (!compiled.ok || canonicalJson(compiled.release) !== canonicalJson(plan.release) || !this.#resume && plan.release.releaseHash !== this.admissionRelease?.releaseHash) throw new Error("experience_result_mismatch");
    if (this.#request && canonicalJson(this.#request) !== canonicalJson(plan.request)) throw new Error("experience_result_mismatch");
    if (this.#resume && (this.#resume.byIntent ? plan.request.intentId : plan.draftId) !== this.#resume.id) throw new Error("experience_result_mismatch");
    const { draftHash, ...base } = plan;
    if (await digest(base) !== draftHash) throw new Error("experience_result_mismatch");
    return freeze(plan);
  }
  change(id: string, value: ExperienceValue) {
    if (this.#disposed || this.state.phase !== "setup" || !this.release || !this.release.interactions[id] || valueIssues(value, this.release.interactions[id], id, false).length) return false;
    this.#plan = undefined; this.#request = undefined; this.#resume = undefined;
    this.#state = freeze({ ...this.#state, draft: { values: { ...this.state.draft.values, [id]: { value: structuredClone(value), provenance: "authored" } } } });
    this.#set("setup"); return true;
  }
  async prepare() {
    if (this.#disposed || this.state.phase !== "setup" || !this.release) return;
    const issues = intakeValueIssues(this.release, this.state.draft.values); if (issues.length) { this.#set("setup", issues); return; }
    this.#request ??= freeze({ intentId: crypto.randomUUID(), experienceId: this.release.definition.id, releaseHash: this.release.releaseHash, values: structuredClone(this.state.draft.values) });
    await this.#save();
  }
  async #save() {
    const epoch = ++this.#epoch; this.#set("preparing");
    if (!this.#current(epoch)) return;
    try {
      const plan = await this.#acceptPlan(await this.#get("/api/experiences/drafts", this.#request));
      if (!this.#current(epoch)) return;
      this.#plan = plan; this.#set("review");
    } catch (error) { if (this.#current(epoch)) this.#set("uncertain", this.#error(error)); }
  }
  back() { if (!this.#disposed && this.state.phase === "review") this.#set("setup"); }
  async resume(id: string, byIntent = false) {
    if (this.#disposed || this.state.phase !== "setup" || !(byIntent ? isIntentId(id) : isDraftId(id))) return;
    this.#resume = Object.freeze({ id, byIntent });
    const epoch = ++this.#epoch; this.#set("preparing");
    if (!this.#current(epoch)) return;
    try {
      const plan = await this.#acceptPlan(await this.#get(byIntent ? `/api/experiences/drafts?intentId=${id}` : `/api/experiences/drafts/${id}`));
      if (!this.#current(epoch)) return;
      this.#request = plan.request; this.#plan = plan; this.#release = plan.release; this.#state = freeze({ ...this.#state, draft: { values: plan.request.values } });
      this.#set("uncertain"); await this.recover();
    } catch (error) { if (this.#current(epoch)) this.#set("uncertain", this.#error(error)); }
  }
  async #finish(value: Record<string, unknown>, epoch: number) {
    const plan = this.#plan!;
    if (value.status !== "complete" || value.draftId !== plan.draftId || value.draftHash !== plan.draftHash || value.projectId !== plan.projectId || value.documentId !== plan.documentId || value.documentRoute !== experienceDocumentRoute(plan) || !Array.isArray(value.rejected) || value.rejected.length || !Number.isSafeInteger(value.head) || !Array.isArray(value.appended) || value.appended.length !== plan.events.length || new Set(value.appended.map(event => event.eventId)).size !== plan.events.length) throw new Error("experience_result_mismatch");
    const events = value.appended;
    if (events.some((event, index) => !event || typeof event.eventId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(event.eventId) || event.actor !== "user" || event.streamId !== plan.streamId || event.clientId !== "web:experience-intake" || event.correlationId !== `experience-intake:${plan.projectId}` || event.schemaVersion !== 1 || event.compensatesEventId !== null || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || index > 0 && event.sequence !== events[index - 1].sequence + 1 || event.type !== plan.events[index].type || canonicalJson(event.payload) !== canonicalJson(plan.events[index].payload)) || Number(value.head) < events.at(-1).sequence) throw new Error("experience_result_mismatch");
    if (!this.#current(epoch)) return;
    const receipt: ExperienceDocumentReceipt = freeze({ kind: "document-commit", plan,
      documentRoute: experienceDocumentRoute(plan), head: value.head as number,
      appended: events.map(event => ({ eventId: event.eventId as string, sequence: event.sequence as number })) });
    this.#completion = Object.freeze({ epoch, receipt });
    this.#route = receipt.documentRoute; this.#set("complete");
  }
  async submit() {
    if (this.#disposed || !["review", "uncertain"].includes(this.state.phase)) return;
    if (!this.canRetry) { this.#set("uncertain", [{ code: "experience_release_changed", path: "$" }]); return; }
    const plan = this.#plan, request = this.#request, epoch = ++this.#epoch;
    this.#set("submitting");
    if (!this.#current(epoch)) return;
    try {
      // Only this explicit action may re-admit an original intent for a POST.
      const currentRelease = await registeredExperience(this.#experienceId);
      if (!this.#current(epoch)) return;
      if (!currentRelease || currentRelease.releaseHash !== (plan?.release.releaseHash ?? request?.releaseHash)) throw new Error("experience_release_changed");
      if (!plan) { if (request) await this.#save(); return; }
      await this.#finish(await this.#get(`/api/experiences/drafts/${plan.draftId}/commit`, { draftHash: plan.draftHash }), epoch);
    } catch (error) { if (this.#current(epoch)) this.#set("uncertain", this.#error(error)); }
  }
  async recover() {
    if (this.#disposed || this.state.phase !== "uncertain") return;
    const epoch = ++this.#epoch; this.#set("preparing");
    if (!this.#current(epoch)) return;
    try {
      if (!this.#plan) {
        const lookup = this.#request ? `/api/experiences/drafts?intentId=${this.#request.intentId}` : this.#resume ? this.#resume.byIntent ? `/api/experiences/drafts?intentId=${this.#resume.id}` : `/api/experiences/drafts/${this.#resume.id}` : undefined;
        if (!lookup) throw new Error("experience_draft_unavailable");
        const plan = await this.#acceptPlan(await this.#get(lookup));
        if (!this.#current(epoch)) return;
        this.#plan = plan; this.#request = plan.request; this.#release = plan.release; this.#state = freeze({ ...this.#state, draft: { values: plan.request.values } });
      }
      await this.#finish(await this.#get(`/api/experiences/drafts/${this.#plan.draftId}/receipt`), epoch);
    } catch (error) { if (this.#current(epoch)) this.#set("uncertain", this.#error(error)); }
  }
  dispose() { this.#disposed = true; this.#epoch++; this.#abort.abort(); this.#listeners.clear(); }
}
