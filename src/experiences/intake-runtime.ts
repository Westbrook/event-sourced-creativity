import { canonicalJson, compileExperience, digest, exactKeys, freeze, jsonIssues, record, valueIssues } from "./compiler.ts";
import type { CompiledRelease, DecisionValue, ExperienceValue, Issue } from "./contracts.ts";
import { buildExperiencePlan, experienceDocumentRoute, initialValues, intakeValueIssues, isDraftId, isIntentId, type ExperiencePlan, type IntakeRequest, type ExperienceReferenceIntent, readExperienceReferenceIntent } from "./intake.ts";
import type { ExperienceIntakeReceipt } from "./native-host.ts";

type State = Readonly<{ phase: "setup" | "preparing" | "review" | "submitting" | "complete" | "uncertain"; draft: { values: Readonly<Record<string, DecisionValue>>; reference?: ExperienceReferenceIntent }; issues: readonly Issue[] }>;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
/** Expected authenticated display context only; the server retains authority. */
export type SponsorImageIntakeBinding = Readonly<{ version: 1; campaignId: string; actorUserId: string }>;
/** A retained context-authoring flow. Completion means Document creation, not generation. */
export class ExperienceIntakeRuntime {
  readonly mode = "intake" as const;
  #release: CompiledRelease;
  readonly admissionRelease: CompiledRelease;
  #state: State;
  #request?: IntakeRequest;
  #plan?: ExperiencePlan;
  #resume?: Readonly<{ id: string; byIntent: boolean }>;
  #route?: string;
  #receipt?: ExperienceIntakeReceipt;
  #listeners = new Set<() => void>();
  #fetch: Fetcher;
  #sponsorImage?: SponsorImageIntakeBinding;
  #epoch = 0;
  #disposed = false;
  #referenceReady = true;
  #abort = new AbortController();
  constructor(release: CompiledRelease, fetcher?: Fetcher, sponsorImage?: SponsorImageIntakeBinding) {
    if (sponsorImage !== undefined) {
      if (typeof fetcher !== "function" || jsonIssues(sponsorImage).length || !record(sponsorImage)
        || !exactKeys(sponsorImage, ["version", "campaignId", "actorUserId"]) || sponsorImage.version !== 1
        || typeof sponsorImage.campaignId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(sponsorImage.campaignId)
        || typeof sponsorImage.actorUserId !== "string" || !sponsorImage.actorUserId || sponsorImage.actorUserId.trim() !== sponsorImage.actorUserId
        || sponsorImage.actorUserId.length > 240 || [...sponsorImage.actorUserId].some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)
        || release.definition.id !== "image" || release.output.output !== "image") throw new Error("sponsor_intake_client_binding_invalid");
      this.#sponsorImage = freeze(structuredClone(sponsorImage));
    }
    const request = fetcher === undefined ? fetch : fetcher;
    this.#release = release; this.admissionRelease = release; this.#fetch = (path, init) => request(path, init);
    this.#referenceReady = release.output.output !== "video";
    this.#state = freeze({ phase: "setup", draft: { values: initialValues(release) }, issues: [] });
  }
  get state() { return this.#state; }
  get release() { return this.#release; }
  get presentation() { return this.release; }
  get documentRoute() { return this.#route; }
  /** Validated saved draft material for read-only review, never generation authority. */
  get preparedPlan() { return this.#plan; }
  get committedPlan() { return this.#receipt ? this.#plan : undefined; }
  get receipt() { return this.#receipt; }
  get referenceReady() { return this.#referenceReady; }
  get draftId() { return this.#plan?.draftId ?? (this.#resume && !this.#resume.byIntent ? this.#resume.id : undefined); }
  get intentId() { return this.#request?.intentId ?? (this.#resume?.byIntent ? this.#resume.id : undefined); }
  get canRetry() { return Boolean(this.#plan || this.#request) && (!this.#plan || this.#plan.release.releaseHash === this.admissionRelease.releaseHash); }
  subscribe(callback: () => void) { this.#listeners.add(callback); return () => this.#listeners.delete(callback); }
  #set(phase: State["phase"], issues: readonly Issue[] = []) { if (!this.#disposed) { this.#state = freeze({ ...this.#state, phase, issues }); for (const callback of this.#listeners) callback(); } }
  #error(error: unknown) { return [{ code: error instanceof Error ? error.message : "experience_unavailable", path: "$" }]; }
  async #get(path: string, body?: unknown) {
    const response = await this.#fetch(path, { ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), credentials: "same-origin", cache: "no-store", redirect: "error", signal: this.#abort.signal });
    const value = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "experience_unavailable");
    return value;
  }
  async #acceptPlan(value: Record<string, unknown>) {
    const plan = structuredClone(value.plan) as ExperiencePlan;
    if (jsonIssues(plan).length || !plan || plan.version !== 1 || !isDraftId(plan.draftId) || !isIntentId(plan.request?.intentId) || plan.request.releaseHash !== plan.release.releaseHash || plan.request.experienceId !== this.admissionRelease.definition.id || intakeValueIssues(plan.release, plan.request.values).length) throw new Error("experience_result_mismatch");
    const compiled = await compileExperience(plan.release.definition, { version: "forma-experience-context@2", qualification: "context-authoring", interactions: Object.fromEntries(Object.values(plan.release.interactions).map(interaction => [interaction.id, interaction])), outputs: { [plan.release.output.id]: plan.release.output }, copy: plan.release.copy });
    if (!compiled.ok || canonicalJson(compiled.release) !== canonicalJson(plan.release) || !this.#resume && plan.release.releaseHash !== this.admissionRelease.releaseHash) throw new Error("experience_result_mismatch");
    if (this.#request && canonicalJson(this.#request) !== canonicalJson(plan.request)) throw new Error("experience_result_mismatch");
    if (this.#resume && (this.#resume.byIntent ? plan.request.intentId : plan.draftId) !== this.#resume.id) throw new Error("experience_result_mismatch");
    if (typeof plan.streamId !== "string" || !plan.streamId.startsWith("creative:")) throw new Error("experience_result_mismatch");
    const rebuilt = await buildExperiencePlan(plan.streamId.slice("creative:".length), plan.request, plan.release, plan.reference);
    let expected = rebuilt;
    if (this.#sponsorImage) {
      if (plan.streamId !== `creative:${this.#sponsorImage.actorUserId}` || plan.release.definition.id !== "image" || plan.release.output.output !== "image"
        || !exactKeys(plan.request, ["intentId", "experienceId", "releaseHash", "values"]) || Object.hasOwn(plan, "reference")) throw new Error("experience_result_mismatch");
      const { draftHash: _nativeHash, ...nativeBase } = rebuilt;
      const receiptId = `sponsor-intake-${(await digest({ campaignId: this.#sponsorImage.campaignId, actor: this.#sponsorImage.actorUserId, intent: plan.request.intentId })).slice(7)}`;
      const marked = { ...nativeBase, sponsor_intake: { version: 1 as const, receiptId } };
      expected = { ...marked, draftHash: await digest(marked) };
    }
    if (canonicalJson(expected) !== canonicalJson(plan)) throw new Error("experience_result_mismatch");
    const { draftHash, ...base } = plan;
    if (await digest(base) !== draftHash) throw new Error("experience_result_mismatch");
    return freeze(plan);
  }
  change(id: string, value: ExperienceValue) {
    if (this.#disposed || this.state.phase !== "setup" || !this.release.interactions[id] || valueIssues(value, this.release.interactions[id], id, false).length) return false;
    this.#plan = undefined; this.#request = undefined; this.#resume = undefined;
    this.#state = freeze({ ...this.#state, draft: { ...this.state.draft, values: { ...this.state.draft.values, [id]: { value: structuredClone(value), provenance: "authored" } } } });
    this.#set("setup"); return true;
  }
  /** UI readiness is not server authority. Every referenced prepare/commit rereads it. */
  changeReference(value: unknown, ready: boolean) {
    if (this.#disposed || this.state.phase !== "setup" || !["model3d", "video"].includes(this.release.output.output)) return false;
    const reference = value === null ? null : readExperienceReferenceIntent(this.release.output.output, value);
    if (value !== null && !reference || typeof ready !== "boolean") return false;
    this.#plan = undefined; this.#request = undefined; this.#resume = undefined; this.#referenceReady = ready && (this.release.output.output !== "video" || reference !== null);
    this.#state = freeze({ ...this.#state, draft: { values: this.state.draft.values, ...(reference ? { reference } : {}) } });
    this.#set("setup"); return true;
  }
  async prepare() {
    if (this.#disposed || this.state.phase !== "setup") return;
    if (!this.#referenceReady) { this.#set("setup", [{ code: `${this.release.output.output}_reference_not_ready`, path: "$reference" }]); return; }
    const issues = intakeValueIssues(this.release, this.state.draft.values); if (issues.length) { this.#set("setup", issues); return; }
    this.#request ??= freeze({ intentId: crypto.randomUUID(), experienceId: this.release.definition.id, releaseHash: this.release.releaseHash, values: structuredClone(this.state.draft.values), ...(this.state.draft.reference ? { reference: this.state.draft.reference } : {}) });
    await this.#save();
  }
  async #save() {
    const epoch = ++this.#epoch; this.#set("preparing");
    try {
      const plan = await this.#acceptPlan(await this.#get("/api/experiences/drafts", this.#request));
      if (this.#disposed || epoch !== this.#epoch) return;
      this.#plan = plan; this.#set("review");
    } catch (error) { if (epoch === this.#epoch) this.#set("uncertain", this.#error(error)); }
  }
  back() { if (this.state.phase === "review") this.#set("setup"); }
  async resume(id: string, byIntent = false) {
    if (this.#disposed || this.state.phase !== "setup" || !(byIntent ? isIntentId(id) : isDraftId(id))) return;
    this.#resume = Object.freeze({ id, byIntent });
    const epoch = ++this.#epoch; this.#set("preparing");
    try {
      const plan = await this.#acceptPlan(await this.#get(byIntent ? `/api/experiences/drafts?intentId=${id}` : `/api/experiences/drafts/${id}`));
      if (this.#disposed || epoch !== this.#epoch) return;
      this.#request = plan.request; this.#plan = plan; this.#release = plan.release; this.#referenceReady = true; this.#state = freeze({ ...this.#state, draft: { values: plan.request.values, ...(plan.request.reference ? { reference: plan.request.reference } : {}) } });
      this.#set("uncertain"); await this.recover();
    } catch (error) { if (epoch === this.#epoch) this.#set("uncertain", this.#error(error)); }
  }
  async #finish(value: Record<string, unknown>, epoch: number) {
    const plan = this.#plan!;
    if (value.status !== "complete" || value.generation !== "unavailable" || value.draftId !== plan.draftId || value.draftHash !== plan.draftHash || value.projectId !== plan.projectId || value.documentId !== plan.documentId || value.documentRoute !== experienceDocumentRoute(plan) || !Array.isArray(value.rejected) || value.rejected.length || !Number.isSafeInteger(value.head) || !Array.isArray(value.appended) || value.appended.length !== plan.events.length || new Set(value.appended.map(event => event && typeof event === "object" ? event.eventId : undefined)).size !== plan.events.length) throw new Error("experience_result_mismatch");
    const events = value.appended as Array<Record<string, any>>;
    if (events.some((event, index) => !event || typeof event.eventId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(event.eventId) || event.actor !== "user" || event.streamId !== plan.streamId || event.clientId !== "web:experience-intake" || event.correlationId !== `experience-intake:${plan.projectId}` || event.schemaVersion !== 1 || event.compensatesEventId !== null || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || index > 0 && event.sequence !== events[index - 1].sequence + 1 || event.type !== plan.events[index].type || canonicalJson(event.payload) !== canonicalJson(plan.events[index].payload)) || Number(value.head) < events[events.length - 1].sequence) throw new Error("experience_result_mismatch");
    if (this.#disposed || epoch !== this.#epoch) return;
    this.#receipt = freeze(structuredClone(value)) as ExperienceIntakeReceipt;
    this.#route = value.documentRoute as string; this.#set("complete");
  }
  async submit() {
    if (this.#disposed || !["review", "uncertain"].includes(this.state.phase)) return;
    if (!this.canRetry) { this.#set("uncertain", [{ code: "experience_release_changed", path: "$" }]); return; }
    if (!this.#plan) { if (this.#request) await this.#save(); return; }
    const epoch = ++this.#epoch; this.#set("submitting");
    try { await this.#finish(await this.#get(`/api/experiences/drafts/${this.#plan.draftId}/commit`, { draftHash: this.#plan.draftHash }), epoch); }
    catch (error) { if (epoch === this.#epoch) this.#set("uncertain", this.#error(error)); }
  }
  async recover() {
    if (this.#disposed || this.state.phase !== "uncertain") return;
    const epoch = ++this.#epoch; this.#set("preparing");
    try {
      if (!this.#plan) {
        const lookup = this.#request ? `/api/experiences/drafts?intentId=${this.#request.intentId}` : this.#resume ? this.#resume.byIntent ? `/api/experiences/drafts?intentId=${this.#resume.id}` : `/api/experiences/drafts/${this.#resume.id}` : undefined;
        if (!lookup) throw new Error("experience_draft_unavailable");
        const plan = await this.#acceptPlan(await this.#get(lookup));
        if (this.#disposed || epoch !== this.#epoch) return;
        this.#plan = plan; this.#request = plan.request; this.#release = plan.release; this.#referenceReady = true; this.#state = freeze({ ...this.#state, draft: { values: plan.request.values, ...(plan.request.reference ? { reference: plan.request.reference } : {}) } });
      }
      if (this.#disposed || epoch !== this.#epoch) return;
      await this.#finish(await this.#get(`/api/experiences/drafts/${this.#plan.draftId}/receipt`), epoch);
    } catch (error) { if (epoch === this.#epoch) this.#set("uncertain", this.#error(error)); }
  }
  dispose() { this.#disposed = true; this.#epoch++; this.#abort.abort(); this.#listeners.clear(); }
}
