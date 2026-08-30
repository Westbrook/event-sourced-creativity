import type { AuthoringPreview } from "../../worker/authoring-commits.ts";
import { validWorkspaceQuickEditEvents, workspaceQuickEditNeedsTarget, type WorkspaceQuickEditIntent } from "../model/workspace-local-proposal.ts";

export type WorkspaceQuickEditScope = { key: string; projectId: string; documentId: string };
export type WorkspaceQuickEditState = {
  scope: WorkspaceQuickEditScope; intent: WorkspaceQuickEditIntent | null; draft: string; targetBlockId: string | null;
  preview: AuthoringPreview | null; previewId: string; approvalHash: string; pending: boolean; uncertain: boolean; authoredDraft: boolean;
  applied: boolean; stale: boolean; notice: string;
};
type Action = "preview" | "apply" | "retrieve" | "resume" | "dismiss";
type Outcome = { status?: string; error?: string; preview?: AuthoringPreview; previewId?: string; approvalHash?: string; operationId?: string; stale?: boolean; retryable?: boolean; dismissed?: boolean };
type Ports = {
  scope(): WorkspaceQuickEditScope | null; request(body: Record<string, unknown>): Promise<Response>;
  changed(): void; applied(): Promise<unknown>; createId?(): string;
};
const sameScope = (left: WorkspaceQuickEditScope | null, right: WorkspaceQuickEditScope | null) =>
  Boolean(left && right && left.key === right.key && left.projectId === right.projectId && left.documentId === right.documentId);

/** Component-lifetime presentation only. The existing server preview/receipt is the sole recovery record. */
export class WorkspaceLocalProposal {
  #ports: Ports; #state: WorkspaceQuickEditState | null = null; #sequence = 0;
  constructor(ports: Ports) { this.#ports = ports; }
  get value() { return this.#state && sameScope(this.#state.scope, this.#ports.scope()) ? this.#state : null; }
  reset() { this.#sequence++; this.#state = null; this.#ports.changed(); }
  #id() { return this.#ports.createId?.() ?? crypto.randomUUID(); }
  #fresh(scope: WorkspaceQuickEditScope, prompt: string, targetBlockId: string | null): WorkspaceQuickEditState {
    return { scope, intent: prompt ? { operationId: this.#id(), prompt, targetBlockId } : null, draft: prompt, targetBlockId,
      preview: null, previewId: "", approvalHash: "", pending: false, uncertain: false, authoredDraft: Boolean(prompt), applied: false, stale: false, notice: "" };
  }
  async start(prompt: string, targetBlockId: string | null) {
    const scope = this.#ports.scope(), previous = this.value;
    if (!scope || !prompt.trim() || prompt.length > 1200 || previous?.pending || previous?.uncertain || previous?.applied) return false;
    this.#sequence++; this.#state = this.#fresh(scope, prompt, targetBlockId);
    if (workspaceQuickEditNeedsTarget(prompt) && !targetBlockId) { this.#state.notice = "target"; this.#ports.changed(); return true; }
    const opened = this.#state; await this.preview(); return this.value === opened;
  }
  edit(prompt: string, targetBlockId: string | null) {
    const state = this.value;
    if (!state || state.pending || state.uncertain || state.applied) return;
    // Editing is explicit new authorship, never a silent rebase of the approved operation.
    this.#sequence++; this.#state = this.#fresh(state.scope, prompt, targetBlockId);
    this.#ports.changed();
  }
  async preview(fresh = false) {
    const state = this.value;
    if (!state || state.pending || state.uncertain || state.applied || !state.draft.trim() || state.draft.length > 1200) return;
    if (workspaceQuickEditNeedsTarget(state.draft) && !state.targetBlockId) { state.notice = "target"; this.#ports.changed(); return; }
    if (fresh) { state.intent = { operationId: this.#id(), prompt: state.draft, targetBlockId: state.targetBlockId }; state.preview = null; state.previewId = ""; state.approvalHash = ""; state.stale = false; }
    if (!state.intent) state.intent = { operationId: this.#id(), prompt: state.draft, targetBlockId: state.targetBlockId };
    await this.#request("preview", state);
  }
  async accept() {
    const state = this.value;
    if (!state || state.pending || state.uncertain || state.applied || state.stale || !state.preview) return;
    await this.#request("apply", state);
  }
  async check() {
    const state = this.value;
    if (!state || state.pending) return;
    await this.#request(state.previewId && state.approvalHash ? "retrieve" : "resume", state);
  }
  async resume() {
    const scope = this.#ports.scope();
    if (!scope || this.value) return;
    this.#sequence++; this.#state = this.#fresh(scope, "", null);
    await this.#request("resume", this.#state);
  }
  async dismiss() {
    const state = this.value;
    if (!state || state.pending || state.uncertain) return;
    if (!state.previewId || !state.approvalHash) { this.reset(); return; }
    await this.#request("dismiss", state);
  }
  #active(state: WorkspaceQuickEditState, sequence: number) { return sequence === this.#sequence && this.value === state; }
  #matchesPreview(preview: AuthoringPreview, state: WorkspaceQuickEditState) {
    return preview.projectId === state.scope.projectId && preview.documentId === state.scope.documentId && preview.canvasId === null
      && preview.blockId === "" && /^[a-f0-9]{64}$/u.test(preview.approvalHash) && Boolean(preview.previewId)
      && preview.localReview?.origin === "rule-based" && preview.localReview.providerCalls === 0 && validWorkspaceQuickEditEvents(preview.events)
      && (!state.intent || preview.localReview.operationId === state.intent.operationId && (!state.authoredDraft || preview.localReview.prompt === state.intent.prompt && preview.localReview.targetBlockId === state.intent.targetBlockId))
      && (!state.previewId || preview.previewId === state.previewId && preview.approvalHash === state.approvalHash);
  }
  async #request(action: Action, state: WorkspaceQuickEditState) {
    if (!this.value || state.pending) return;
    const sequence = ++this.#sequence, wasApplied = state.applied;
    state.pending = true; state.notice = ""; this.#ports.changed();
    const identity = { projectId: state.scope.projectId, documentId: state.scope.documentId };
    const body = action === "preview" ? { action, ...identity, ...state.intent }
      : action === "resume" ? { action, ...identity, ...(state.intent ? { operationId: state.intent.operationId } : {}) }
      : { action, ...identity, previewId: state.previewId, approvalHash: state.approvalHash };
    try {
      const response = await this.#ports.request(body);
      if (!this.#active(state, sequence)) return;
      // Denial headers are authoritative even when the body stalls or cannot be parsed.
      // Preserve the exact operation/approval handle and only this actor's own local draft.
      if ([401, 403, 404, 410].includes(response.status)) {
        state.preview = null; state.uncertain = true; state.notice = "unavailable";
        if (!state.authoredDraft) { state.draft = ""; state.targetBlockId = null; if (state.intent) state.intent = { ...state.intent, prompt: "", targetBlockId: null }; }
        return;
      }
      const outcome = await response.json() as Outcome;
      if (!this.#active(state, sequence)) return;
      if (outcome.preview && !this.#matchesPreview(outcome.preview, state)) throw new Error("workspace_quick_edit_response_mismatch");
      if (outcome.preview) {
        state.preview = outcome.preview; state.previewId = outcome.preview.previewId; state.approvalHash = outcome.preview.approvalHash;
        if (!state.intent || !state.authoredDraft) { const review = outcome.preview.localReview!; state.intent = { operationId: review.operationId, prompt: review.prompt, targetBlockId: review.targetBlockId }; state.draft = review.prompt; state.targetBlockId = review.targetBlockId; }
      }
      if (response.ok && outcome.status === "applied") {
        if (!outcome.previewId || !/^[a-f0-9]{64}$/u.test(outcome.approvalHash ?? "")
          || state.previewId && outcome.previewId !== state.previewId || state.approvalHash && outcome.approvalHash !== state.approvalHash
          || state.intent && outcome.operationId !== state.intent.operationId) throw new Error("workspace_quick_edit_receipt_mismatch");
        state.previewId = outcome.previewId; state.approvalHash = outcome.approvalHash!; state.applied = true; state.uncertain = false; state.stale = false; state.notice = "applied";
        if (!wasApplied) { try { await this.#ports.applied(); } catch { if (this.#active(state, sequence)) state.notice = "refresh"; } }
        return;
      }
      if (response.ok && (outcome.status === "dismissed" || outcome.dismissed)) { this.reset(); return; }
      if (response.ok && outcome.status === "none") {
        if (!state.intent) { this.reset(); return; }
        state.uncertain = false; state.notice = "notSaved"; return;
      }
      if (outcome.status === "applying") { state.uncertain = true; state.notice = "uncertain"; return; }
      if (!response.ok) {
        if (response.status >= 500) { state.uncertain = true; state.notice = "uncertain"; return; }
        // A failed read is not a not-applied receipt; preserve the exact IDs but hide unverified server text.
        if (action === "retrieve" || action === "resume" || action === "apply" && outcome.status !== "not-applied") {
          state.preview = null; state.uncertain = true; state.notice = "unavailable";
          if (!state.authoredDraft) { state.draft = ""; state.targetBlockId = null; if (state.intent) state.intent = { ...state.intent, prompt: "", targetBlockId: null }; }
          return;
        }
        state.uncertain = false;
        state.stale = /(?:stale|source_|target_|expired|retention|custody|authorization)/u.test(outcome.error ?? "");
        state.notice = state.stale ? "stale" : response.status === 403 ? "permission" : outcome.error === "workspace_quick_edit_temperature_required" ? "temperature" : "invalid";
        return;
      }
      if (!["preview", "retrieve", "resume"].includes(action) || outcome.status !== "not-applied" || !outcome.preview) throw new Error("workspace_quick_edit_outcome_unavailable");
      state.uncertain = false; state.stale = Boolean(outcome.stale); state.notice = state.stale ? "stale" : outcome.retryable ? "retryable" : "";
    } catch {
      if (this.#active(state, sequence)) { state.uncertain = true; state.notice = "uncertain"; }
    } finally {
      if (this.#active(state, sequence)) { state.pending = false; this.#ports.changed(); }
    }
  }
}
