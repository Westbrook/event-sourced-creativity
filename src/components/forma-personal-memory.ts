import { html, nothing } from "lit";
import { FormaElement } from "./forma-element";
import { requestDialogConfirmation } from "./modal-dialog.ts";
import { navigateInApp, type CommandDeparture } from "./command-departure";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "./output-navigation-focus.ts";
import { parseMemoryCustody, type MemoryCustody } from "../model/memory-custody.ts";
import { createMemoryElapsed } from "../model/memory-lifetime.ts";
import { liveConversationDigest } from "../model/memory-conversation.ts";
import { personalMemoryMessage } from "./design-system/locales/personal-memory-messages.ts";
import { createLiveMemoryClient, MemoryClientError, MEMORY_POLICY, MEMORY_TIMING, MEMORY_WRITE_CONTRACT,
  type MemoryEnrollment, type MemorySettings, type MemoryRecall, type MemoryRecallLease, type MemoryPreferences } from "../state/live-memory-client.ts";
import { createDocumentProfileClient, DocumentProfileClientError, DOCUMENT_PROFILE_CONTROL_VERSION,
  DOCUMENT_PROFILE_POLICY, NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE } from "../state/document-profile-client.ts";
import { createMemoryDerivationClient, MemoryDerivationClientError, MEMORY_DERIVATION_CONTROL, MEMORY_DERIVATION_POLICY,
  type DerivationSettings, type DerivationGrant, type DerivationOffer, type DerivationEnable, type DerivationResultEntry, type DerivationResultView, type DerivationResultItem, type DerivationControl, type DerivationProgress } from "../state/memory-derivation-client.ts";
import "./forma-personal-memory.css";

type MemoryOwner = {
  current: () => boolean; sourceCurrent: () => boolean; canSelect: () => boolean; controller: AbortController;
  projectId: string; documentId: string; organizationId: string | null;
  expectedCustody: MemoryCustody | null;
};
type ProfileClient = ReturnType<typeof createDocumentProfileClient>;
type ProfileSettings = Awaited<ReturnType<ProfileClient["settings"]>>;
type ProfileGrant = NonNullable<ProfileSettings["grant"]>;
type ProfileLease = Awaited<ReturnType<ProfileClient["inspect"]>>;
type ProfileChoice = NonNullable<ReturnType<ProfileLease["current"]>>["choices"][number];
type ProfileRequestKind = "settings" | "enable" | "revoke" | "inspect" | "suppress";
type MemoryDraft = { learn: boolean; recall: boolean; background: boolean; retention: string; expiry: string; timeZone: string; consent: boolean };
type MemoryField = "retention" | "expiry" | "timeZone";

/** Consent controls only. Mounting this component never enrolls or captures activity. */
export class FormaPersonalMemory extends FormaElement {
  #presentationSuspended = false;
  #client = createLiveMemoryClient((input, init) => {
    const owner = this.#owner;
    if (!owner?.current()) throw new MemoryClientError("memory_request_cancelled");
    return this.store.guardedFetch(input, init, this.#t("heading"), { current: owner.current });
  });
  #profileClient = createDocumentProfileClient((input, init) => {
    const request = this.#profileRequest;
    if (!request?.current()) throw new Error("document_profile_request_cancelled");
    return this.store.guardedFetch(input, init, this.#t("profileHeading"), { current: request.current,
      onDispatch: () => { request.dispatched = true; } });
  });
  #purposeClient = createMemoryDerivationClient((input, init) => {
    const request = this.#purposeRequest;
    if (!request?.current()) throw new Error("memory_purpose_request_cancelled");
    return this.store.guardedFetch(input, init, this.#t("purposeHeading"), { current: request.current,
      onDispatch: () => { request.dispatched = true; } });
  });
  #purposeOpen = false;
  #purposeEpoch = 0;
  #purposeScope: { row: MemoryEnrollment; current: () => boolean } | null = null;
  #purposeSettings: DerivationSettings | null = null;
  #purposeRequest: { kind: "settings" | "enable" | "revoke" | "review" | "control"; dispatched: boolean; controller: AbortController; detach: () => void; current: () => boolean } | null = null;
  #reviewResults: readonly DerivationResultEntry[] = [];
  #reviewControls: readonly DerivationControl[] = [];
  #reviewNext: string | null = null;
  #controlNext: string | null = null;
  #reviewLoaded = false;
  #reviewPurpose: DerivationResultEntry["purpose"] | null = null;
  #reviewProgress: readonly DerivationProgress[] = [];
  #controlsLoaded = false;
  #controlsValidUntil: string | null = null;
  #reviewView: DerivationResultView | null = null;
  #reviewCorrection = '';
  #purposeDraft = { qualificationId: "", charge: false, background: false, consent: false };
  #purposeNeedsReload = false;
  #purposeError = "";
  #purposeNotice = "";
  #profileOpen = false;
  #profileEpoch = 0;
  #profileFocusRevision = 0;
  #profileScope: { row: MemoryEnrollment; current: () => boolean } | null = null;
  #profileSettings: ProfileSettings | null = null;
  #profileRequest: { kind: ProfileRequestKind; dispatched: boolean; controller: AbortController; detach: () => void; current: () => boolean; remaining?: () => number } | null = null;
  #profileView: { grant: ProfileGrant; lease: ProfileLease; current: () => boolean } | null = null;
  #profileDraft = { organize: false, inspect: false, consent: false };
  #profileError = "";
  #profileNotice = "";
  #profileNeedsReload = false;
  #profileParentRetired = false;
  #profileGrantRetired = false;
  #profileMutationNeedsReload = false;
  #owner: MemoryOwner | null = null;
  #unsubscribe?: () => void;
  #settings: MemorySettings | null = null;
  #rows: MemoryEnrollment[] = [];
  #cursor: string | null = null;
  #loaded = false;
  #busy: "read" | "save" | "forget" | "recall" | null = null;
  #error = "";
  #notice = "";
  #needsReload = false;
  #revealed: { id: string; lease: MemoryRecallLease; sourceCurrent: () => boolean; current: () => boolean; consumptionEpisodesRequested: boolean } | null = null;
  #inspectRequest: { controller: AbortController; detach: () => void; focus: OutputNavigationFocusLease | null; optionalCurrent?: () => boolean } | null = null;
  #exportRequest: { controller: AbortController; detach: () => void; current: () => boolean; focus: OutputNavigationFocusLease | null } | null = null;
  #exportEpoch = 0;
  #exportError = "";
  #exportNotice = "";
  #recallFocusVisibilityRevision = 0;
  #deadlineTimer = 0;
  #expiredEnrollment: string | null = null;
  #draft: MemoryDraft = this.#emptyDraft();
  #dirty = false;
  #selection = "";
  #draftRevision = 0;
  #confirmation: AbortController | null = null;
  #confirmationRow: MemoryEnrollment | null = null;
  #focusLeases = new Set<OutputNavigationFocusLease>();
  #invalid: Partial<Record<MemoryField, string>> = {};
  #fieldPrefix = "memory-field-" + crypto.randomUUID();
  #changed = () => { this.#syncOwner(); this.#retireRecall(); this.#scheduleDeadline(); this.requestUpdate(); };
  #retired = () => { this.#reset(); this.#syncOwner(); this.requestUpdate(); };

  #t(key: string, values?: Record<string, string | number>) { return personalMemoryMessage(this.i18n.locale, "memory.live." + key, values); }
  #emptyDraft(): MemoryDraft {
    let timeZone = "UTC";
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* Use explicit UTC. */ }
    return { learn: false, recall: false, background: false, retention: "30",
      expiry: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), timeZone, consent: false };
  }

  override connectedCallback() {
    this.#presentationSuspended = false;
    super.connectedCallback();
    this.#unsubscribe = this.store.subscribe(this.#changed);
    for (const name of ["forma-route-changed", "forma-authorization-changed", "forma-event-source-retired"])
      window.addEventListener(name, this.#retired);
    document.addEventListener("visibilitychange", this.#changed);
    window.addEventListener("focus", this.#changed);
    this.#syncOwner();
  }
  override disconnectedCallback() {
    this.#unsubscribe?.(); this.#unsubscribe = undefined;
    for (const name of ["forma-route-changed", "forma-authorization-changed", "forma-event-source-retired"])
      window.removeEventListener(name, this.#retired);
    document.removeEventListener("visibilitychange", this.#changed);
    window.removeEventListener("focus", this.#changed);
    this.#reset(); super.disconnectedCallback();
  }

  /** Closing the composing host retires work before its next DOM update. Reopening requires a fresh mount. */
  suspendPresentation() {
    this.#presentationSuspended = true;
    this.#reset();
    this.requestUpdate();
  }

  #reset() {
    this.#closeProfile(); this.#closePurposes();
    for (const focus of this.#focusLeases) focus.dispose();
    this.#focusLeases.clear(); this.#invalid = {};
    window.clearTimeout(this.#deadlineTimer); this.#deadlineTimer = 0;
    this.#retireInspect(); this.#retireExport(); this.#clearRecall();
    this.#owner?.controller.abort(); this.#confirmation?.abort();
    this.#owner = null; this.#confirmation = null; this.#confirmationRow = null;
    this.#settings = null; this.#rows = []; this.#cursor = null; this.#loaded = false;
    this.#busy = null; this.#error = ""; this.#notice = ""; this.#needsReload = false;
    this.#exportError = ""; this.#exportNotice = "";
    this.#draft = this.#emptyDraft(); this.#dirty = false; this.#draftRevision++;
    this.#expiredEnrollment = null;
    this.#selection = "";
  }

  #syncOwner(read = true) {
    if (this.#presentationSuspended) return;
    if (this.#owner?.current()) return;
    const choice = this.#owner ? "" : this.#selection;
    this.#reset();
    this.#selection = choice;
    const store = this.store, session = store.session.get(), authorization = store.captureAuthorizationScope();
    if (!this.isConnected || !session || session.impersonation || !authorization) return;
    const source = store.captureSourceOwnership(), route = store.route.get(), locale = this.i18n.locale;
    const projection = store.projection.get(), projectId = projection.projectId, activeDocumentId = projection.documentId;
    const documentId = this.#selection;
    const documentStamp = this.#documentStamp(projectId, documentId);
    const expectedCustody = this.#expectedCustody(projectId), custodyStamp = JSON.stringify(expectedCustody);
    const actor = session.user.userId, organizationId = session.projectContext?.organizationId ?? null;
    const controller = new AbortController();
    const owner: MemoryOwner = { controller, projectId, documentId, organizationId, expectedCustody,
      current: () => {
        const now = store.session.get(), projected = store.projection.get();
        return !this.#presentationSuspended && this.#owner === owner && !controller.signal.aborted && this.isConnected && this.store === store
          && Boolean(now && !now.impersonation && now.user.userId === actor)
          && store.authorizationScopeActive(authorization) && store.route.get() === route && this.i18n.locale === locale
          && projected.projectId === projectId && projected.documentId === activeDocumentId && this.#selection === documentId
          && JSON.stringify(this.#expectedCustody(projectId)) === custodyStamp
          && (!documentId || this.#documentStamp(projectId, documentId) === documentStamp && documentStamp !== null)
          && store.captureSourceOwnership()?.generation === source?.generation;
      },
      sourceCurrent: () => owner.current() && expectedCustody !== null && store.sourceOwnershipActive(source)
        && Boolean(projectId && documentId && store.projection.get().documents.some(item => item.id === documentId && item.projectId === projectId)),
      canSelect: () => owner.current() && store.sourceOwnershipActive(source),
    };
    this.#owner = owner;
    this.#scheduleDeadline();
    if (read) void this.#load(owner);
  }

  #documentStamp(projectId: string, documentId: string) {
    const document = this.store.projection.get().documents.find(item => item.id === documentId && item.projectId === projectId);
    return document ? JSON.stringify([document.createdSequence, document.sourceEvents]) : null;
  }
  #scopeKnown(projectId: string) {
    const session = this.store.session.get(), context = session?.projectContext;
    if (!Array.isArray(session?.projects)) return false;
    const matches = session.projects.filter(project => project.projectId === projectId);
    if (context) return context.projectId === projectId && matches.length === 1
      && matches[0].organizationId === context.organizationId && matches[0].projectAccessId === context.projectAccessId;
    return matches.length === 0;
  }
  #expectedCustody(projectId: string): MemoryCustody | null {
    if (!this.#scopeKnown(projectId)) return null;
    const context = this.store.session.get()?.projectContext;
    return parseMemoryCustody(context ? { kind: "organization", organizationId: context.organizationId,
      projectAccessId: context.projectAccessId, ownerUserId: context.ownerUserId } : { kind: "personal" });
  }
  #custodyChanged(owner: MemoryOwner) {
    if (!owner.current()) return;
    this.#reset(); this.#syncOwner(false);
    this.#needsReload = true; this.#error = "custodyChanged"; this.requestUpdate();
  }
  #captureFocus(): OutputNavigationFocusLease | null {
    const active = this.ownerDocument.activeElement;
    if (!active || !this.contains(active) || active.closest("forma-personal-memory") !== this) return null;
    const focus = captureOutputNavigationFocus(this.ownerDocument);
    this.#focusLeases.add(focus); return focus;
  }
  async #restoreFocus(focus: OutputNavigationFocusLease | null, owner: MemoryOwner | null, selector: string | (() => readonly string[]),
    current: () => boolean = () => true, revealHeading = false) {
    if (!focus) return;
    try {
      if (!current()) return;
      await this.updateComplete;
      if (!current() || !owner?.current() || !focus.current() || this.ownerDocument.querySelector("dialog[open]")) return;
      const selectors = typeof selector === "function" ? selector() : [selector];
      const target = selectors.map(value => this.querySelector<HTMLElement>(value)).find(candidate => candidate?.isConnected
        && candidate.closest("forma-personal-memory") === this && !candidate.matches(":disabled"));
      if (!target) return;
      focus.run(target, () => {
        if (!current() || !owner.current() || !target.isConnected || target.matches(":disabled")) return false;
        target.focus({ preventScroll: !(revealHeading && target.matches('[data-memory-focus="heading"]')) });
        return current() && owner.current() && this.ownerDocument.activeElement === target;
      });
    } catch { /* Focus continuity never changes mutation outcomes or retries work. */ }
    finally { focus.dispose(); this.#focusLeases.delete(focus); }
  }
  #retireInspect() {
    const request = this.#inspectRequest;
    this.#inspectRequest = null;
    if (!request) return;
    request.controller.abort(); request.detach();
    request.focus?.dispose(); if (request.focus) this.#focusLeases.delete(request.focus);
    request.focus = null;
    if (this.#busy === "recall") this.#busy = null;
  }
  #clearRecall() {
    // An optional inspector action may still own focus across updateComplete.
    // Retiring its receipt must dispose that lease now, even if the update stalls.
    if (this.#inspectRequest?.focus) this.#retireInspect();
    this.#revealed?.lease.retire(); this.#revealed = null;
  }
  #retireExport() {
    const request = this.#exportRequest;
    this.#exportRequest = null; this.#exportEpoch++;
    if (!request) return;
    request.controller.abort(); request.detach();
    request.focus?.dispose(); if (request.focus) this.#focusLeases.delete(request.focus);
  }
  #retireRecall() {
    this.#retireProfile(); this.#retirePurposes();
    if (this.#inspectRequest?.optionalCurrent && !this.#inspectRequest.optionalCurrent()) this.#retireInspect();
    if (this.#exportRequest && !this.#exportRequest.current()) this.#retireExport();
    if (document.visibilityState !== "visible") {
      // Retire the request identity as well as its bytes. Becoming visible again
      // cannot make an earlier Inspect response current.
      this.#recallFocusVisibilityRevision++;
      this.#retireInspect(); this.#clearRecall();
    } else if (this.#revealed && !this.#revealed.current()) {
      const expired = this.#revealed.lease.remaining() <= 0, id = this.#revealed.id, sourceCurrent = this.#revealed.sourceCurrent;
      const owner = this.#owner, row = this.#selected(), revision = this.#recallFocusVisibilityRevision;
      const enrollmentExpired = Boolean(row && Date.parse(row.expiresAt) <= Date.now());
      const current = () => Boolean(document.visibilityState === "visible" && revision === this.#recallFocusVisibilityRevision
        && sourceCurrent() && owner?.sourceCurrent() && row && row === this.#selected() && this.#rows.includes(row)
        && row.id === id);
      const subtree = this.ownerDocument.activeElement?.closest(".personal-memory-excerpts");
      const focus = (expired || enrollmentExpired) && current() && subtree?.closest("forma-personal-memory") === this ? this.#captureFocus() : null;
      this.#clearRecall();
      if (expired) this.#notice = "viewExpired";
      if (focus) {
        // Only continuity from the disappearing recall subtree is owned here.
        // A later background transition permanently withdraws this restoration.
        this.requestUpdate();
        void this.#restoreFocus(focus, owner, () => [
          ...(row && Date.parse(row.expiresAt) > Date.now() ? ['[data-memory-enrollment="' + id + '"][data-memory-action="inspect"]'] : []),
          '[data-memory-action="refresh"]', '[data-memory-focus="heading"]',
        ], current);
      }
    }
    const row = this.#selected();
    const expired = row && Date.parse(row.expiresAt) <= Date.now() ? row.id + ":" + row.revision : null;
    if (expired !== this.#expiredEnrollment) {
      this.#expiredEnrollment = expired;
      if (expired) { this.#retireInspect(); this.#clearRecall(); this.#draft.consent = false; this.#draftRevision++; }
    }
    if (this.#draft.consent && !this.#owner?.sourceCurrent()) { this.#draft.consent = false; this.#draftRevision++; }
  }
  #scheduleDeadline() {
    window.clearTimeout(this.#deadlineTimer); this.#deadlineTimer = 0;
    const owner = this.#owner;
    if (!owner?.current()) return;
    const access = this.store.session.get()?.projectContext?.expiresAt;
    const now = Date.now();
    const delays = [access, this.#selected()?.expiresAt, this.#profileSettings?.grant?.expiresAt,
      this.#controlsValidUntil,this.#reviewView?.validUntil,...this.#reviewResults.map(item=>item.expiresAt),...this.#reviewControls.map(item=>item.expiresAt),...(this.#purposeSettings?.qualifications.map(item => item.expiresAt) ?? []), ...(this.#purposeSettings?.grants.map(item => item.expiresAt) ?? [])].filter((value): value is string => Boolean(value))
      .map(value => Date.parse(value) - now).filter(value => Number.isFinite(value) && value > 0);
    const remaining = this.#revealed?.lease.remaining();
    if (remaining !== undefined) {
      if (remaining > 0) delays.push(remaining);
      else this.#retireRecall();
    }
    const profileRemaining = this.#profileView?.lease.remaining();
    if (profileRemaining !== undefined) {
      if (profileRemaining > 0) delays.push(profileRemaining);
      else this.#retireProfile();
    }
    const profileRequestRemaining = this.#profileRequest?.remaining?.();
    if (profileRequestRemaining !== undefined) {
      if (profileRequestRemaining > 0) delays.push(profileRequestRemaining);
      else this.#retireProfile();
    }
    if (!delays.length) return;
    this.#deadlineTimer = window.setTimeout(() => {
      this.#deadlineTimer = 0;
      if (!owner.current()) return;
      this.#retireRecall();
      if (access && Date.parse(access) <= Date.now()) { this.#reset(); this.#syncOwner(); }
      this.#scheduleDeadline(); this.requestUpdate();
    }, Math.min(2_147_483_647, Math.max(1, Math.min(...delays))));
  }

  #selected(): MemoryEnrollment | undefined {
    const owner = this.#owner;
    const matches = owner ? this.#rows.filter(row => row.projectId === owner.projectId && row.documentId === owner.documentId
      && row.organizationId === owner.organizationId) : [];
    return matches.length === 1 ? matches[0] : undefined;
  }
  #ambiguous() { const owner = this.#owner; return Boolean(owner && this.#rows.filter(row => row.projectId === owner.projectId
    && row.documentId === owner.documentId && row.organizationId === owner.organizationId).length > 1); }
  #accountPage() { return this.store.route.get().split(/[?#]/u)[0] === "/settings"; }
  #chooseDocument(event: Event) {
    if (!this.#eventCurrent(event) || !this.#owner?.canSelect() || this.#busy || this.#dirty || this.#confirmation) return;
    const id = (event.currentTarget as HTMLSelectElement).value;
    if (id && !this.store.projection.get().documents.some(item => item.id === id && item.projectId === this.#owner!.projectId)) return;
    this.#reset(); this.#selection = id; this.#syncOwner(); this.requestUpdate();
  }
  #setDraft() {
    const row = this.#selected();
    this.#draft = row ? { learn: row.learn, recall: row.recall, background: row.background,
      retention: String(row.retentionDays), expiry: row.expiresAt.slice(0, 10), timeZone: row.timeZone, consent: false } : this.#emptyDraft();
    this.#dirty = false; this.#invalid = {}; this.#draftRevision++;
  }
  #eventCurrent(event: Event, owner = this.#owner) {
    const target = event.currentTarget as HTMLElement | null;
    return Boolean(owner?.current() && target?.isConnected && this.contains(target)
      && target.closest("forma-personal-memory") === this && !(target as HTMLButtonElement).disabled);
  }

  async #load(owner: MemoryOwner, more = false) {
    if (!owner.current() || this.#busy || more && !this.#cursor) return;
    this.#retireExport();
    this.#exportError = ""; this.#exportNotice = "";
    this.#closeProfile();
    const after = more ? this.#cursor! : undefined;
    this.#busy = "read"; this.#error = ""; this.#clearRecall(); this.requestUpdate();
    if (!more) { this.#loaded = false; this.#rows = []; this.#settings = null; this.#cursor = null; }
    try {
      const settings = await this.#client.settings(after, owner.controller.signal);
      if (!owner.current()) return;
      if (more && this.#settings && (settings.enabled !== this.#settings.enabled || settings.policyVersion !== this.#settings.policyVersion
        || settings.writeContractVersion !== this.#settings.writeContractVersion))
        throw new MemoryClientError("memory_revision_changed", 409, false);
      if (more && settings.enrollments.some(row => this.#rows.some(previous => previous.id === row.id)))
        throw new MemoryClientError("invalid_memory_response", null, false);
      const rows = more ? [...this.#rows, ...settings.enrollments] : [...settings.enrollments];
      const cleanupScopes = new Map<string, string>();
      for (const row of rows) {
        const cleanup = row.structuredCleanup;
        if (!cleanup?.scopeKey) continue;
        const stamp = JSON.stringify([row.organizationId, row.projectId, row.documentId, cleanup.state]);
        if (cleanupScopes.has(cleanup.scopeKey) && cleanupScopes.get(cleanup.scopeKey) !== stamp)
          throw new MemoryClientError("memory_revision_changed", 409, false);
        cleanupScopes.set(cleanup.scopeKey, stamp);
      }
      this.#settings = settings; this.#rows = rows;
      this.#cursor = settings.nextAfter; this.#loaded = true; this.#needsReload = false;
      if (!this.#dirty) this.#setDraft();
      this.#scheduleDeadline();
    } catch (error) {
      if (!owner.current()) return;
      this.#error = this.#errorKey(error); this.#needsReload = true;
      if (!more) { this.#settings = null; this.#rows = []; }
    } finally { if (owner.current()) { this.#busy = null; this.requestUpdate(); } }
  }

  #errorKey(error: unknown): string {
    if (!(error instanceof MemoryClientError)) return "error";
    if (error.mutationUnknown) return "unknown";
    if (error.code === "memory_schema_unavailable" || error.status === 404 && !this.#loaded) return "schemaUnavailable";
    if (error.status === 409) return "conflict";
    if (error.status === 401 || error.status === 403 || error.code === "memory_disabled") return "denied";
    if (error.status === 400) return "validation";
    return "error";
  }

  #edit(event: Event, field: keyof MemoryDraft) {
    if (!this.#eventCurrent(event) || this.#busy || this.#needsReload || this.#confirmation) return;
    const input = event.currentTarget as HTMLInputElement;
    if (field === "learn" || field === "recall" || field === "background" || field === "consent") this.#draft[field] = input.checked;
    else this.#draft[field] = input.value;
    if (field !== "consent") this.#draft.consent = false;
    if (field === "retention" || field === "expiry" || field === "timeZone") delete this.#invalid[field];
    if (this.#error === "validation") this.#error = "";
    this.#dirty = true; this.#draftRevision++; this.#notice = ""; this.requestUpdate();
    this.#retireExport();
  }

  #canSave() {
    return Boolean(this.#owner?.sourceCurrent() && !this.#ambiguous() && this.store.session.get()?.policy.accepted
      && this.#settings?.enabled && this.#settings.writeContractVersion === MEMORY_WRITE_CONTRACT
      && this.#loaded && !this.#cursor && !this.#busy && !this.#needsReload && !this.#confirmation
      && this.#draft.consent && (this.#draft.learn || this.#draft.recall)
      && (!this.#draft.learn || this.#draft.background));
  }
  #preferences(): MemoryPreferences | null {
    const owner = this.#owner, draft = this.#draft;
    if (!owner || !this.#canSave()) return null;
    const retention = Number(draft.retention), expiresAt = draft.expiry + "T23:59:59.000Z";
    const expiry = Date.parse(expiresAt), now = Date.now();
    this.#invalid = {};
    if (!Number.isSafeInteger(retention) || retention < 1 || retention > 365) this.#invalid.retention = "invalidRetention";
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(draft.expiry) || !Number.isFinite(expiry)
      || new Date(expiry).toISOString().slice(0, 10) !== draft.expiry || expiry <= now || expiry > now + 365 * 86_400_000) this.#invalid.expiry = "invalidExpiry";
    try {
      if (!draft.timeZone || draft.timeZone.length > 80) throw new Error("invalid-time-zone");
      new Intl.DateTimeFormat("en", { timeZone: draft.timeZone }).format();
    } catch { this.#invalid.timeZone = "invalidTimeZone"; }
    if (Object.keys(this.#invalid).length) return null;
    return { projectId: owner.projectId, documentId: owner.documentId, learn: draft.learn, recall: draft.recall,
      background: draft.background, retentionDays: retention, expiresAt, timeZone: draft.timeZone,
      revision: this.#selected()?.revision ?? 0, confirmation: "ENABLE_PERSONAL_MEMORY",
      policyVersion: MEMORY_POLICY, reviewTiming: MEMORY_TIMING, expectedCustody: owner.expectedCustody! };
  }

  async #save(event: SubmitEvent) {
    event.preventDefault();
    if (!this.#eventCurrent(event)) return;
    const focus = this.#captureFocus(), preferences = this.#preferences(), owner = this.#owner;
    if (!preferences || !owner) {
      const field = (["retention", "expiry", "timeZone"] as const).find(key => this.#invalid[key]);
      this.#error = field ? "" : "validation"; this.requestUpdate();
      await this.#restoreFocus(focus, owner, field ? '[name="memory-' + field.toLowerCase() + '"]' : '[name="memory-consent"]');
      return;
    }
    this.#closeProfile(); this.#retireExport(); this.#busy = "save"; this.#error = ""; this.#notice = ""; this.#clearRecall(); this.requestUpdate();
    try {
      const previous = this.#selected();
      const saved = await this.#client.save(preferences, owner.controller.signal);
      if (!owner.current()) return;
      if (saved.enrollment.organizationId !== owner.organizationId || previous && saved.enrollment.id !== previous.id)
        throw new MemoryClientError("memory_response_invalid", 200, true);
      this.#notice = previous && saved.priorMemoryCleared ? "savedCleared" : "savedMessage";
      this.#dirty = false; this.#draft.consent = false; this.#draftRevision++;
      this.#busy = null; await this.#load(owner);
    } catch (error) {
      if (error instanceof MemoryClientError && error.code === "memory_custody_changed") this.#custodyChanged(owner);
      else if (owner.current()) { this.#error = this.#errorKey(error); this.#needsReload = true; this.#draft.consent = false; }
    } finally {
      if (owner.current()) { this.#busy = null; this.requestUpdate(); }
      await this.#restoreFocus(focus, owner, '[data-memory-action="refresh"]');
    }
  }

  async #stopLearning(event: Event, row: MemoryEnrollment) {
    const owner = this.#owner;
    if (!this.#eventCurrent(event, owner) || !owner?.sourceCurrent() || this.#busy || this.#needsReload || this.#confirmation
      || !this.#settings?.enabled || this.#settings.writeContractVersion !== MEMORY_WRITE_CONTRACT
      || !row.recall || !row.learn || row !== this.#selected() || this.#dirty
      || row.policyVersion !== MEMORY_POLICY || row.status !== "ready" || Date.parse(row.expiresAt) <= Date.now()) return;
    const focus = this.#captureFocus();
    this.#closeProfile(); this.#retireExport(); this.#busy = "save"; this.#error = ""; this.#notice = ""; this.#clearRecall(); this.requestUpdate();
    try {
      const saved = await this.#client.save({ projectId: row.projectId, documentId: row.documentId, learn: false, recall: true,
        background: false, retentionDays: row.retentionDays, timeZone: row.timeZone, expiresAt: row.expiresAt,
        revision: row.revision, confirmation: "ENABLE_PERSONAL_MEMORY", policyVersion: MEMORY_POLICY, reviewTiming: MEMORY_TIMING,
        expectedCustody: owner.expectedCustody! }, owner.controller.signal);
      if (!owner.current()) return;
      if (saved.enrollment.organizationId !== owner.organizationId || saved.enrollment.id !== row.id)
        throw new MemoryClientError("memory_response_invalid", 200, true);
      this.#notice = saved.priorMemoryCleared ? "clearedMessage" : "stopMessage"; this.#busy = null; await this.#load(owner);
    } catch (error) {
      if (error instanceof MemoryClientError && error.code === "memory_custody_changed") this.#custodyChanged(owner);
      else if (owner.current()) { this.#error = this.#errorKey(error); this.#needsReload = true; }
    } finally {
      if (owner.current()) { this.#busy = null; this.requestUpdate(); }
      await this.#restoreFocus(focus, owner, '[data-memory-action="refresh"]');
    }
  }

  async #forget(event: Event, row: MemoryEnrollment) {
    const owner = this.#owner;
    if (!this.#eventCurrent(event, owner) || !owner || this.#busy || this.#confirmation || this.#needsReload || this.#dirty || !this.#rows.includes(row)) return;
    const controller = new AbortController(), revision = this.#draftRevision;
    let focus: OutputNavigationFocusLease | null = null;
    this.#retireExport();
    this.#confirmation = controller; this.#confirmationRow = row;
    const current = () => owner.current() && this.#confirmation === controller && this.#rows.includes(row)
      && this.#draftRevision === revision && !this.#busy;
    try {
      const identity = [this.#label(row), this.#t("document", { id: row.documentId }), this.#t("project", { id: row.projectId }),
        ...(row.organizationId ? [this.#t("organization", { id: row.organizationId })] : []),
        this.#t("enrollment", { id: row.id.match(/.{1,8}/gu)!.join(" ") })].join(" · ").replace(/(\S{24})(?=\S)/gu, "$1\u200b");
      const accepted = await requestDialogConfirmation({ title: this.#t("forgetTitle"), message: identity + "\n\n" + this.#t("forgetMessage"),
        confirmLabel: this.#t("forget"), cancelLabel: this.#t("cancel"), owner: this,
        invoker: event.currentTarget as HTMLElement, signal: controller.signal, current,
        locale: this.i18n.locale, direction: this.i18n.direction, requireTrustedConfirmation: true });
      if (!accepted || !current()) return;
      focus = this.#captureFocus();
      this.#closeProfile(); this.#busy = "forget"; this.#error = ""; this.#notice = ""; this.#clearRecall(); this.requestUpdate();
      const forgotten = await this.#client.forget(row, owner.controller.signal);
      if (!owner.current()) return;
      this.#notice = forgotten.erased ? "forgot" : "forgetPending"; this.#dirty = false; this.#draft.consent = false;
      this.#busy = null; await this.#load(owner);
    } catch (error) { if (owner.current()) { this.#error = this.#errorKey(error); this.#needsReload = true; } }
    finally { if (this.#confirmation === controller) { this.#confirmation = null; this.#confirmationRow = null; }
      if (owner.current()) { this.#busy = null; this.requestUpdate(); }
      await this.#restoreFocus(focus, owner, '[data-memory-action="refresh"]'); }
  }

  #inspectVisits(event: Event, row: MemoryEnrollment, lease: MemoryRecallLease, value: MemoryRecall) {
    const revealed = this.#revealed;
    if (!revealed || revealed.lease !== lease || revealed.lease.value !== value || !revealed.current()
      || revealed.consumptionEpisodesRequested) return;
    return this.#inspect(event, row, true);
  }
  async #inspect(event: Event, row: MemoryEnrollment, consumptionEpisodesRequested = false) {
    const owner = this.#owner;
    if (!this.#eventCurrent(event, owner) || !owner?.sourceCurrent() || this.#busy || this.#needsReload || this.#confirmation
      || document.visibilityState !== "visible" || !this.#settings?.enabled || !row.recall
      || row !== this.#selected() || Date.parse(row.expiresAt) <= Date.now()) return;
    this.#retireInspect(); this.#retireExport();
    const events = this.store.events.get(), content = this.store.content.get();
    const focus = consumptionEpisodesRequested ? this.#captureFocus() : null;
    this.#clearRecall();
    const controller = new AbortController(), abort = () => controller.abort();
    owner.controller.signal.addEventListener("abort", abort, { once: true });
    const request = { controller, detach: () => owner.controller.signal.removeEventListener("abort", abort), focus,
      optionalCurrent: consumptionEpisodesRequested ? () => requestCurrent() && current() : undefined };
    this.#inspectRequest = request;
    const requestCurrent = () => this.#inspectRequest === request && !controller.signal.aborted && document.visibilityState === "visible";
    const sourceCurrent = () => document.visibilityState === "visible" && owner.sourceCurrent() && this.#rows.includes(row) && row === this.#selected()
      && this.store.events.get() === events && this.store.content.get() === content;
    const current = () => sourceCurrent() && Date.parse(row.expiresAt) > Date.now();
    this.#busy = "recall"; this.#error = ""; this.#notice = ""; this.requestUpdate();
    try {
      const lease = await (consumptionEpisodesRequested ? this.#client.recall(row, controller.signal, { consumptionEpisodes: "memory-consumption-episodes-v4" })
        : this.#client.recall(row, controller.signal));
      if (requestCurrent() && current() && lease.remaining() > 0) {
        this.#revealed = { id: row.id, lease, sourceCurrent, current: () => current() && lease.remaining() > 0, consumptionEpisodesRequested };
        this.#scheduleDeadline();
      } else lease.retire();
    } catch (error) { if (requestCurrent() && owner.current()) this.#error = this.#errorKey(error); }
    finally {
      request.detach();
      if (this.#inspectRequest === request) {
        if (owner.current()) { this.#busy = null; this.requestUpdate(); }
        // Keep the request reachable until focus restoration finishes, so Hide,
        // cancellation and privacy retirement dispose its focus lease immediately.
        if (request.focus) await this.#restoreFocus(request.focus, owner, () => [
          '[data-memory-enrollment="' + row.id + '"][data-memory-action="inspect"]',
          '[data-memory-action="refresh"]', '[data-memory-focus="heading"]',
        ], () => requestCurrent() && current());
        request.focus = null;
        if (this.#inspectRequest === request) this.#inspectRequest = null;
      }
    }
  }

  async #exportReferences(event: Event, row: MemoryEnrollment) {
    const owner = this.#owner;
    if (!this.#eventCurrent(event, owner) || !owner?.sourceCurrent() || this.#busy || this.#confirmation || this.#dirty
      || this.#needsReload || this.#exportRequest || !this.#settings?.enabled || this.#cursor || !this.store.session.get()?.policy.accepted
      || document.visibilityState !== "visible" || row !== this.#selected() || !row.recall || row.policyVersion !== MEMORY_POLICY
      || row.status !== "ready" || Date.parse(row.expiresAt) <= Date.now()) return;
    const settings = this.#settings, events = this.store.events.get(), content = this.store.content.get(), revision = this.#draftRevision;
    const rowRevision = row.revision, rowExpiry = row.expiresAt, epoch = ++this.#exportEpoch;
    const controller = new AbortController(), abort = () => controller.abort(), focus = this.#captureFocus();
    owner.controller.signal.addEventListener("abort", abort, { once: true });
    const current = () => owner.sourceCurrent() && document.visibilityState === "visible" && !controller.signal.aborted
      && !this.#busy && !this.#confirmation && !this.#dirty && !this.#needsReload && this.#settings === settings
      && this.#draftRevision === revision && this.#rows.includes(row) && row === this.#selected() && row.revision === rowRevision
      && row.expiresAt === rowExpiry && Date.parse(rowExpiry) > Date.now() && this.store.events.get() === events && this.store.content.get() === content;
    const request = { controller, detach: () => owner.controller.signal.removeEventListener("abort", abort), current, focus };
    this.#exportRequest = request; this.#exportError = ""; this.#exportNotice = ""; this.requestUpdate();
    try {
      const references = await this.#client.exportReferences(row, controller.signal);
      if (this.#exportRequest !== request || !current()) return;
      // The strict client returns only bounded reference JSON. No response body,
      // Blob URL or exported bytes enter component state or a persistent cache.
      const blob = new Blob([references], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      try {
        const link = this.ownerDocument.createElement("a");
        try {
          if (!current()) return;
          link.href = url; link.download = "forma-memory-references.json"; link.rel = "noopener";
          link.click();
          if (current()) this.#exportNotice = "exportRequested";
        } finally { link.remove(); }
      } finally { URL.revokeObjectURL(url); }
    } catch (error) {
      if (this.#exportRequest !== request || !current()) return;
      if (error instanceof MemoryClientError && [401, 403, 404, 409].includes(error.status ?? 0)) {
        this.#clearRecall(); this.#needsReload = true;
        this.#exportError = error.status === 409 ? "exportChanged" : "exportDenied";
      } else this.#exportError = "exportFailed";
    } finally {
      request.detach();
      if (this.#exportRequest === request) { this.#exportRequest = null; this.requestUpdate(); }
      await this.#restoreFocus(focus, owner, () => ['[data-memory-action="export"]', '[data-memory-action="refresh"]', '[data-memory-focus="heading"]'],
        () => this.#exportEpoch === epoch && !controller.signal.aborted && document.visibilityState === "visible");
    }
  }

  captureCommandDeparture(): CommandDeparture {
    const owner = this.#owner, revision = this.#draftRevision;
    return { element: this, current: () => (owner ? owner.current() : !this.#owner && this.isConnected) && revision === this.#draftRevision,
      blocked: () => this.#dirty || this.#busy === "save" || this.#busy === "forget" || Boolean(this.#confirmation),
      reason: () => this.#needsReload ? "memory.live.unknownReason" : "memory.live.pendingReason" };
  }

  #captureProfileFocus() {
    const subtree = this.ownerDocument.activeElement?.closest("[data-memory-profile-view]");
    return subtree?.closest("forma-personal-memory") === this ? this.#captureFocus() : null;
  }
  #restoreProfileFocus(focus: OutputNavigationFocusLease | null) {
    const owner = this.#owner, scope = this.#profileScope, settings = this.#profileSettings;
    const request = this.#profileRequest, grant = settings?.grant, revision = this.#profileFocusRevision;
    return this.#restoreFocus(focus, owner, () => [
      '[data-memory-profile-action="inspect"]', '[data-memory-profile-action="load"]', '[data-memory-focus="heading"]',
    ], () => Boolean(scope && this.#profileScope === scope && scope.current() && this.#profileSettings === settings
      && this.#profileSettings?.grant === grant && this.#profileFocusRevision === revision && !this.#profileView
      && (!this.#profileRequest || this.#profileRequest === request && request?.current())), true);
  }
  #clearProfileView() { this.#profileFocusRevision++; this.#profileView?.lease.retire(); this.#profileView = null; }
  #closeProfile() {
    this.#profileEpoch++; this.#profileOpen = false;
    const request = this.#profileRequest; this.#profileRequest = null;
    request?.controller.abort(); request?.detach(); this.#clearProfileView();
    this.#profileScope = null; this.#profileSettings = null;
    this.#profileDraft = { organize: false, inspect: false, consent: false };
    this.#profileError = ""; this.#profileNotice = ""; this.#profileNeedsReload = false; this.#profileParentRetired = false; this.#profileGrantRetired = false; this.#profileMutationNeedsReload = false;
  }
  #retireProfile() {
    if (this.#profileOpen && !this.#profileScope?.current()) { this.#closeProfile(); return; }
    if (this.#profileScope && Date.parse(this.#profileScope.row.expiresAt) <= Date.now()) this.#profileParentRetired = true;
    if (this.#profileSettings?.grant && Date.parse(this.#profileSettings.grant.expiresAt) <= Date.now()) this.#profileGrantRetired = true;
    const request = this.#profileRequest;
    if (request && !request.current()) {
      // Scope is still owned, but a dispatched mutation may already have committed.
      // Keep recovery blocked before dropping request ownership and aborting its body.
      if (request.dispatched && ["enable", "revoke", "suppress"].includes(request.kind)) {
        this.#profileNeedsReload = true; this.#profileMutationNeedsReload = true;
        this.#profileError = "profileUnknown"; this.#profileNotice = "";
      }
      this.#profileRequest = null; request.controller.abort(); request.detach();
    }
    if (this.#profileView && !this.#profileView.current()) {
      const expired = this.#profileView.lease.remaining() <= 0 || this.#profileParentRetired || this.#profileGrantRetired;
      const focus = expired ? this.#captureProfileFocus() : null;
      this.#clearProfileView(); this.#profileNotice = "profileExpired";
      if (focus) { this.requestUpdate(); void this.#restoreProfileFocus(focus); }
    }
  }
  #profileEvent(event: Event) {
    return this.#eventCurrent(event) && !(event.currentTarget as HTMLElement).matches(":disabled")
      && Boolean(this.#profileScope?.current());
  }
  #profileGrantOwned(grant: ProfileGrant) {
    const custody = this.#owner?.expectedCustody;
    return Boolean(custody && (custody.kind === "personal" ? grant.ownerUserId === this.store.session.get()?.user.userId
      : grant.ownerUserId === custody.ownerUserId && grant.organizationId === custody.organizationId && grant.projectAccessId === custody.projectAccessId));
  }
  #profileGrantCurrent(grant: ProfileGrant | null = this.#profileSettings?.grant ?? null) {
    const settings = this.#profileSettings, row = this.#profileScope?.row;
    return Boolean(grant && this.#profileGrantOwned(grant) && settings?.enabled && settings.grantCurrent && settings.grant === grant
      && this.#profileScope?.current() && row && !this.#profileNeedsReload && !this.#profileGrantRetired
      && this.#profileParentCurrent()
      && grant.enrollmentId === row.id && grant.enrollmentRevision === row.revision
      && Date.parse(grant.expiresAt) > Date.now() && Date.parse(row.expiresAt) > Date.now());
  }
  #profileParentCurrent() {
    const settings = this.#profileSettings, row = this.#profileScope?.row;
    return Boolean(this.#profileScope?.current() && this.store.session.get()?.policy.accepted && settings?.enabled && settings.parent && row
      && settings.parent.enrollmentId === row.id && settings.parent.enrollmentRevision === row.revision
      && settings.parent.retentionDays === row.retentionDays && settings.parent.expiresAt === row.expiresAt
      && this.#profileParentEligible(row) && !this.#profileNeedsReload && !this.#profileParentRetired);
  }
  #profileParentEligible(row: MemoryEnrollment) {
    return row.policyVersion === MEMORY_POLICY && row.status === "ready" && row.learn && row.recall && Date.parse(row.expiresAt) > Date.now();
  }
  #profileCanEnable() {
    return this.#profileParentCurrent() && !this.#busy && !this.#dirty && !this.#confirmation
      && !this.#profileRequest && this.#profileDraft.organize && this.#profileDraft.inspect && this.#profileDraft.consent;
  }
  async #runProfile<T>(event: Event, kind: ProfileRequestKind, operation: (signal: AbortSignal) => Promise<T>,
    accept: (value: T) => void, valid: () => boolean = () => true, displayBudget?: number) {
    const scope = this.#profileScope, owner = this.#owner;
    if (!this.#profileEvent(event) || !scope || !owner || this.#profileRequest || !valid()) return;
    // Suppression retires the client lease before dispatch. Preserve only its
    // remaining bound, never the palette bytes or a renewed display lease.
    const started = Date.now(), elapsed = displayBudget === undefined ? null : createMemoryElapsed({ wall: started, monotonic: performance.now() });
    const remaining = displayBudget === undefined ? undefined : () => {
      const moment = { wall: Date.now(), monotonic: performance.now() }, duration = elapsed!.elapsed(moment);
      return Math.max(0, Math.min(displayBudget - duration, started + displayBudget - moment.wall));
    };
    const focus = kind === "suppress" ? this.#captureProfileFocus() : null;
    this.#clearProfileView();
    const controller = new AbortController(), abort = () => controller.abort();
    owner.controller.signal.addEventListener("abort", abort, { once: true });
    const request = { kind, dispatched: false, controller, remaining, detach: () => owner.controller.signal.removeEventListener("abort", abort),
      current: (): boolean => this.#profileRequest === request && this.#profileScope === scope && scope.current()
        && !controller.signal.aborted && (remaining === undefined || remaining() > 0) && valid() };
    this.#profileRequest = request; this.#profileError = ""; this.#profileNotice = ""; this.#scheduleDeadline(); this.requestUpdate();
    // While both profile actions are disabled, continuity uses the existing
    // heading once. Settling a request never acquires focus again.
    void this.#restoreProfileFocus(focus);
    try {
      const result = await operation(controller.signal);
      if (this.#profileRequest === request) this.#retireProfile();
      if (request.current()) accept(result);
      else if (kind === "inspect") (result as ProfileLease).retire();
    } catch (error) {
      if (this.#profileRequest === request) this.#retireProfile();
      if (request.current()) {
        this.#profileNeedsReload = true;
        if (["enable", "revoke", "suppress"].includes(kind)) this.#profileMutationNeedsReload = true;
        this.#profileError = error instanceof DocumentProfileClientError && error.mutationUnknown ? "profileUnknown" : "profileError";
      }
    } finally {
      request.detach();
      elapsed?.retire();
      if (this.#profileRequest === request) this.#profileRequest = null;
      if (scope.current()) { this.#scheduleDeadline(); this.requestUpdate(); }
    }
  }
  #loadProfile(event: Event) {
    const scope = this.#profileScope, owner = this.#owner;
    if (!scope || !owner?.expectedCustody || !this.#profileEvent(event) || this.#profileRequest) return;
    const row = scope.row;
    this.#profileDraft = { organize: false, inspect: false, consent: false };
    return this.#runProfile(event, "settings", signal => this.#profileClient.settings({ projectId: row.projectId, documentId: row.documentId,
      expectedCustody: owner.expectedCustody!, ...(this.#profileParentEligible(row) ? { expectedParent: { enrollmentId: row.id, enrollmentRevision: row.revision,
        retentionDays: row.retentionDays, expiresAt: row.expiresAt } } : {}) }, signal), settings => {
      if (settings.grant && !this.#profileGrantOwned(settings.grant)) throw new DocumentProfileClientError("document_profile_custody_changed");
      this.#profileSettings = settings; this.#profileNeedsReload = false; this.#profileMutationNeedsReload = false;
      this.#profileGrantRetired = Boolean(settings.grant && Date.parse(settings.grant.expiresAt) <= Date.now());
    });
  }
  #editProfile(event: Event, field: "organize" | "inspect" | "consent") {
    if (!this.#profileEvent(event) || !this.#profileParentCurrent() || this.#busy || this.#confirmation) return;
    this.#profileDraft = { ...this.#profileDraft, [field]: (event.currentTarget as HTMLInputElement).checked,
      ...(field !== "consent" ? { consent: false } : {}) };
    this.#profileNotice = ""; this.requestUpdate();
  }
  #enableProfile(event: SubmitEvent) {
    event.preventDefault();
    if (!this.#profileEvent(event) || !this.#profileCanEnable()) return;
    const settings = this.#profileSettings!, row = this.#profileScope!.row, owner = this.#owner!;
    const draft: Parameters<ProfileClient["enable"]>[0] = { version: DOCUMENT_PROFILE_CONTROL_VERSION, policyVersion: DOCUMENT_PROFILE_POLICY,
      recipeVersion: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, projectId: row.projectId, documentId: row.documentId,
      enrollmentId: row.id, enrollmentRevision: row.revision, revision: settings.grant?.revision ?? 0,
      expectedCustody: owner.expectedCustody!, infer: true as const, inspect: true as const, background: false as const,
      retentionDays: row.retentionDays, expiresAt: row.expiresAt, confirmation: "ENABLE_DOCUMENT_PALETTE_PROFILE" as const };
    this.#profileDraft = { organize: false, inspect: false, consent: false };
    return this.#runProfile(event, "enable", signal => this.#profileClient.enable(draft, signal), result => {
      if (!this.#profileGrantOwned(result.grant)) throw new DocumentProfileClientError("document_profile_custody_changed", null, true);
      this.#profileSettings = { ...settings, grant: result.grant, grantCurrent: true }; this.#profileGrantRetired = false; this.#profileNotice = "profileSaved";
    }, () => this.#profileSettings === settings && Date.parse(row.expiresAt) > Date.now());
  }
  #revokeProfile(event: Event, grant: ProfileGrant) {
    const settings = this.#profileSettings;
    if (!settings || settings.grant !== grant || !this.#profileGrantOwned(grant) || this.#profileMutationNeedsReload) return;
    return this.#runProfile(event, "revoke", signal => this.#profileClient.revoke(grant, signal), () => {
      this.#profileSettings = { ...settings, grant: null, grantCurrent: false }; this.#profileNeedsReload = true;
      this.#profileNotice = "profileRevoked";
    }, () => this.#profileSettings === settings && settings.grant === grant);
  }
  #inspectProfile(event: Event, grant: ProfileGrant) {
    const scope = this.#profileScope;
    if (!scope || !this.#profileGrantCurrent(grant) || this.#busy || this.#dirty || this.#confirmation) return;
    return this.#runProfile(event, "inspect", signal => this.#profileClient.inspect(grant, signal), lease => {
      if (!lease.current()) { lease.retire(); this.#profileNotice = "profileExpired"; return; }
      this.#profileView = { grant, lease, current: () => this.#profileScope === scope && scope.current()
        && this.#profileGrantCurrent(grant) && lease.current() !== null };
    }, () => this.#profileGrantCurrent(grant));
  }
  #suppressProfile(event: Event, choice: ProfileChoice, view = this.#profileView) {
    if (!view || view !== this.#profileView || !view.current() || !view.lease.current()?.choices.includes(choice)) return;
    const grant = view.grant, claimKey = choice.claimKey, settings = this.#profileSettings, budget = view.lease.remaining();
    return this.#runProfile(event, "suppress", signal => this.#profileClient.suppress(grant, claimKey, 0, signal), () => {
      this.#profileNotice = "profileSuppressed";
    }, () => this.#profileSettings === settings && this.#profileGrantCurrent(grant), budget);
  }

  #toggleProfile(event: Event, row: MemoryEnrollment, renderedScope: { row: MemoryEnrollment; current: () => boolean } | null) {
    const target = event.currentTarget as HTMLDetailsElement, owner = this.#owner;
    if (!this.#eventCurrent(event, owner) || !owner?.sourceCurrent() || row !== this.#selected()
      || document.visibilityState !== "visible" || this.#profileScope !== renderedScope) return;
    if (!target.open) { this.#closeProfile(); this.#scheduleDeadline(); this.requestUpdate(); return; }
    if (this.#profileOpen || this.#busy || this.#confirmation) return;
    const epoch = ++this.#profileEpoch, events = this.store.events.get(), content = this.store.content.get();
    const revision = row.revision, expiresAt = row.expiresAt, retention = row.retentionDays;
    const scope = { row, current: (): boolean => this.#profileScope === scope && this.#profileOpen && this.#profileEpoch === epoch
      && owner.sourceCurrent() && document.visibilityState === "visible" && row === this.#selected() && this.#rows.includes(row)
      && row.revision === revision && row.expiresAt === expiresAt && row.retentionDays === retention
      && this.store.events.get() === events && this.store.content.get() === content };
    this.#profileScope = scope; this.#profileOpen = true; this.requestUpdate();
  }
  #profileEvidence(evidence: ProfileChoice["supports"][number]) {
    return html`<li><p>${this.#t("profileIntent." + evidence.intent)} · ${this.#t("profileLineage." + evidence.lineage)}</p>
      <ul>${evidence.sources.map(source => html`<li>${this.#t("profileSource", { sequence: this.i18n.number(source.sequence) })}
        <time datetime=${source.recordedAt}>${this.#t("profileRecorded", { at: "\u2068" + this.i18n.date(new Date(source.recordedAt), { dateStyle: "medium", timeStyle: "short" }) + "\u2069" })}</time>
      </li>`)}</ul></li>`;
  }
  #profilePaletteView(view: { grant: ProfileGrant; lease: ProfileLease; current: () => boolean }) {
    const profile = view.lease.current();
    if (!profile || !view.current()) return nothing;
    return html`<section class="personal-memory-activity" data-memory-profile-view>
      <h4>${this.#t("profileViewHeading")}</h4><p>${this.#t("profileLimits")}</p><p>${this.#t("profileEvidenceMeaning")}</p>
      <dl class="personal-memory-facts"><dt>${this.#t("profileChoiceCount")}</dt><dd>${this.i18n.number(profile.choices.length)}</dd></dl>
      ${profile.choices.length ? html`<ol>${profile.choices.map(choice => html`<li><article data-memory-profile-choice>
        <h5>${this.#t("profileStatus." + choice.status)}</h5>
        <p>${choice.colors.map(color => html`<code dir="ltr">${color}</code> `)}</p>
        <dl class="personal-memory-facts"><dt>${this.#t("profileSupports")}</dt><dd>${this.i18n.number(choice.supports.length)}</dd>
          <dt>${this.#t("profileCounterevidence")}</dt><dd>${this.i18n.number(choice.counterevidence.length)}</dd></dl>
        <details><summary>${this.#t("profileReferences")}</summary>
          ${choice.supports.length ? html`<h6>${this.#t("profileSupports")}</h6><ul>${choice.supports.map(item => this.#profileEvidence(item))}</ul>` : nothing}
          ${choice.counterevidence.length ? html`<h6>${this.#t("profileCounterevidence")}</h6><ul>${choice.counterevidence.map(item => this.#profileEvidence(item))}</ul>` : nothing}
        </details>
        <button type="button" class="button secondary" ?disabled=${Boolean(this.#profileRequest || this.#busy || this.#confirmation)}
          @click=${(event: Event) => this.#suppressProfile(event, choice, view)}>${this.#t("profileSuppress")}</button>
      </article></li>`)}</ol>` : html`<p data-memory-profile-empty>${this.#t("profileEmpty")}</p>`}
      <p>${this.#t("profileSuppressHelp")}</p>
      <button type="button" class="button secondary" @click=${(event: Event) => {
        if (this.#profileEvent(event) && this.#profileView === view) {
          const focus = this.#captureProfileFocus();
          this.#clearProfileView(); this.#scheduleDeadline(); this.requestUpdate();
          return this.#restoreProfileFocus(focus);
        }
      }}>${this.#t("profileHideView")}</button>
    </section>`;
  }
  #renderProfile(row: MemoryEnrollment) {
    const scope = this.#profileScope, settings = this.#profileSettings, grant = settings?.grant;
    const open = this.#profileOpen && scope?.row === row && scope.current();
    const fieldDisabled = !this.#profileParentCurrent() || Boolean(this.#busy || this.#confirmation);
    const captured = (event: Event, run: () => unknown) => { if (this.#profileScope === scope && this.#profileEvent(event)) return run(); };
    return html`<details class="personal-memory-activity" data-memory-profile ?open=${open}
      @toggle=${(event: Event) => this.#toggleProfile(event, row, scope)}>
      <summary>${this.#t("profileHeading")}</summary>
      ${open ? html`<div aria-busy=${this.#profileRequest ? "true" : "false"}>
        <p>${this.#t("profileIntro")}</p><p>${this.#t("profileManual")}</p>
        <button type="button" class="button secondary" data-memory-profile-action="load" ?disabled=${Boolean(this.#profileRequest || this.#busy || this.#confirmation)}
          @click=${(event: Event) => captured(event, () => this.#loadProfile(event))}>${this.#t("profileLoad")}</button>
        ${this.#profileRequest ? html`<p role="status">${this.#t("profileBusy")}</p>` : nothing}
        ${this.#profileError ? html`<p class="personal-memory-error" role="alert">${this.#t(this.#profileError)}</p>` : nothing}
        ${this.#profileNotice ? html`<p class="personal-memory-status" role="status">${this.#t(this.#profileNotice)}</p>` : nothing}
        ${settings ? html`
          ${!settings.enabled ? html`<p>${this.#t("profileUnavailable")}</p>` : nothing}
          ${!this.#profileParentCurrent() ? html`<p>${this.#t("profileParentRequired")}</p>` : nothing}
          ${grant ? html`<p>${this.#t(this.#profileGrantCurrent(grant) ? "profileGrantActive" : "profileGrantInactive")}</p>
            <p>${this.#t("profileGrantBounds", { days: this.i18n.number(grant.retentionDays), at: "\u2068" + this.i18n.date(new Date(grant.expiresAt), { dateStyle: "medium", timeStyle: "short" }) + "\u2069" })}</p>
            <div class="personal-memory-actions">
              <button type="button" class="button secondary" data-memory-profile-action="inspect" ?disabled=${Boolean(this.#profileRequest || this.#busy || this.#dirty || this.#confirmation) || !this.#profileGrantCurrent(grant)}
                @click=${(event: Event) => captured(event, () => this.#inspectProfile(event, grant))}>${this.#t("profileInspect")}</button>
              <button type="button" class="button ghost danger-quiet" ?disabled=${Boolean(this.#profileRequest || this.#busy || this.#confirmation || this.#profileMutationNeedsReload)}
                @click=${(event: Event) => captured(event, () => this.#revokeProfile(event, grant))}>${this.#t("profileRevoke")}</button>
            </div>` : html`<p>${this.#t("profileNoGrant")}</p>`}
          <form data-memory-profile-form @submit=${(event: SubmitEvent) => { event.preventDefault(); return captured(event, () => this.#enableProfile(event)); }}>
            <fieldset ?disabled=${fieldDisabled}><legend>${this.#t("profilePermissionHeading")}</legend>
              <p>${this.#t("profileParentBounds", { days: this.i18n.number(row.retentionDays), at: "\u2068" + this.i18n.date(new Date(row.expiresAt), { dateStyle: "medium", timeStyle: "short" }) + "\u2069" })}</p>
              <div class="personal-memory-fields">
                <label class="toggle-row"><input type="checkbox" name="memory-profile-organize" .checked=${this.#profileDraft.organize}
                  @change=${(event: Event) => captured(event, () => this.#editProfile(event, "organize"))}><span>${this.#t("profileOrganize")}</span></label>
                <label class="toggle-row"><input type="checkbox" name="memory-profile-inspect" .checked=${this.#profileDraft.inspect}
                  @change=${(event: Event) => captured(event, () => this.#editProfile(event, "inspect"))}><span>${this.#t("profileInspectConsent")}</span></label>
                <label class="toggle-row"><input type="checkbox" name="memory-profile-consent" .checked=${this.#profileDraft.consent}
                  @change=${(event: Event) => captured(event, () => this.#editProfile(event, "consent"))}><span>${this.#t("profileConsent")}</span></label>
              </div>
              <button type="submit" class="button primary" ?disabled=${!this.#profileCanEnable()}>${this.#t("profileEnable")}</button>
            </fieldset>
          </form>` : html`<p>${this.#t("profileNotLoaded")}</p>`}
        ${this.#profileView && this.#profileRequest?.kind !== "suppress" ? this.#profilePaletteView(this.#profileView) : nothing}
      </div>` : nothing}
    </details>`;
  }

  #closePurposes() {
    this.#purposeEpoch++; this.#purposeOpen = false;
    const request = this.#purposeRequest; this.#purposeRequest = null; request?.controller.abort(); request?.detach();
    this.#clearReview(); this.#reviewControls=[]; this.#controlsLoaded=false; this.#controlsValidUntil=null; this.#controlNext=null; this.#purposeScope = null; this.#purposeSettings = null; this.#purposeNeedsReload = false;
    this.#purposeDraft = { qualificationId: "", charge: false, background: false, consent: false }; this.#purposeError = ""; this.#purposeNotice = "";
  }
  #retirePurposes() {
    if (this.#purposeOpen && !this.#purposeScope?.current()) { this.#closePurposes(); return; }
    if(this.#controlsValidUntil&&Date.parse(this.#controlsValidUntil)<=Date.now()){this.#reviewControls=[];this.#controlsLoaded=false;this.#controlsValidUntil=null;}
    if(this.#reviewView&&Date.parse(this.#reviewView.validUntil)<=Date.now()){this.#reviewView=null;this.#reviewCorrection='';}
    this.#reviewResults=this.#reviewResults.filter(item=>Date.parse(item.expiresAt)>Date.now());
    this.#reviewControls=this.#reviewControls.filter(item=>Date.parse(item.expiresAt)>Date.now());
    const request = this.#purposeRequest;
    if (request && !request.current()) {
      if (request.dispatched && !["settings","review"].includes(request.kind)) { this.#purposeNeedsReload = true; this.#purposeError = "purposeUnknown"; this.#purposeNotice = ""; }
      this.#purposeRequest = null; request.controller.abort(); request.detach();
    }
    if (!this.#purposeOffer() || this.#purposeScope && Date.parse(this.#purposeScope.row.expiresAt) <= Date.now()) {
      this.#purposeDraft.charge = false; this.#purposeDraft.consent = false;
    }
  }
  #purposeEvent(event: Event) {
    return this.#eventCurrent(event) && !(event.currentTarget as HTMLElement).matches(":disabled") && Boolean(this.#purposeScope?.current());
  }
  #purposeOffer(): DerivationOffer | null {
    return this.#purposeSettings?.qualifications.find(item => item.qualificationId === this.#purposeDraft.qualificationId && Date.parse(item.expiresAt) > Date.now()) ?? null;
  }
  #purposeEligible(offer = this.#purposeOffer()) {
    const scope = this.#purposeScope;
    return Boolean(scope?.current() && offer && this.#purposeSettings?.enabled && this.#purposeSettings.processingImplemented
      && this.#purposeSettings.qualifications.includes(offer) && Date.parse(offer.expiresAt) > Date.now()
      && this.store.session.get()?.policy.accepted && this.#profileParentEligible(scope.row) && !this.#purposeNeedsReload
      && !this.#busy && !this.#dirty && !this.#confirmation);
  }
  #purposeLatest(): DerivationGrant[] {
    const result = new Map<string, DerivationGrant>();
    for (const grant of this.#purposeSettings?.grants ?? []) if ((result.get(grant.purpose)?.revision ?? 0) < grant.revision) result.set(grant.purpose, grant);
    return [...result.values()];
  }
  async #runPurpose<T>(event: Event, kind: "settings" | "enable" | "revoke" | "review" | "control", operation: (signal: AbortSignal) => Promise<T>, accept: (result: T) => void, valid = () => true) {
    const scope = this.#purposeScope, owner = this.#owner;
    if (!scope || !owner || !this.#purposeEvent(event) || this.#purposeRequest || this.#busy || this.#confirmation || !valid()) return;
    const controller = new AbortController(), abort = () => controller.abort(); owner.controller.signal.addEventListener("abort", abort, { once: true });
    const request = { kind, dispatched: false, controller, detach: () => owner.controller.signal.removeEventListener("abort", abort),
      current: (): boolean => this.#purposeRequest === request && this.#purposeScope === scope && scope.current() && !controller.signal.aborted && valid() };
    this.#purposeRequest = request; this.#purposeError = ""; this.#purposeNotice = ""; this.#scheduleDeadline(); this.requestUpdate();
    try { const result = await operation(controller.signal); if (this.#purposeRequest === request) this.#retirePurposes(); if (request.current()) accept(result); }
    catch (error) { if (this.#purposeRequest === request) this.#retirePurposes(); if (request.current()) {
      this.#clearReview(); this.#reviewControls=[]; this.#controlsLoaded=false; this.#controlsValidUntil=null; this.#purposeNeedsReload = true; this.#purposeError = error instanceof MemoryDerivationClientError && error.mutationUnknown ? "purposeUnknown" : "purposeError";
    } } finally { request.detach(); if (this.#purposeRequest === request) this.#purposeRequest = null;
      if (scope.current()) { this.#scheduleDeadline(); this.requestUpdate(); } }
  }
  #loadPurposes(event: Event) {
    const row = this.#purposeScope?.row, custody = this.#owner?.expectedCustody;
    if (!row || !custody || !this.#purposeEvent(event) || this.#purposeRequest) return;
    this.#purposeDraft = { qualificationId: "", charge: false, background: false, consent: false };
    return this.#runPurpose(event, "settings", signal => this.#purposeClient.settings({ projectId: row.projectId, documentId: row.documentId,
      expectedCustody: custody, enrollmentId: row.id, enrollmentRevision: row.revision }, signal), result => {
      this.#purposeSettings = result; this.#purposeNeedsReload = false;
    });
  }
  #editPurpose(event: Event, field: "qualificationId" | "charge" | "background" | "consent") {
    if (!this.#purposeEvent(event) || this.#purposeRequest || this.#busy || this.#dirty || this.#confirmation || this.#purposeNeedsReload) return;
    const target = event.currentTarget as HTMLInputElement;
    this.#purposeDraft = { ...this.#purposeDraft, [field]: field === "qualificationId" ? target.value : target.checked,
      ...(field !== "consent" ? { consent: false } : {}), ...(field === "qualificationId" ? { charge: false, background: false } : {}) };
    this.requestUpdate();
  }
  #enablePurpose(event: SubmitEvent) {
    event.preventDefault(); const offer = this.#purposeOffer(), settings = this.#purposeSettings, row = this.#purposeScope?.row, custody = this.#owner?.expectedCustody;
    if (!offer || !settings || !row || !custody || !this.#purposeEvent(event) || !this.#purposeEligible(offer) || this.#purposeRequest
      || !this.#purposeDraft.charge || !this.#purposeDraft.consent || this.#purposeDraft.background && !row.background) return;
    const prior = this.#purposeLatest().find(item => item.purpose === offer.terms.purpose), expiresAt = row.expiresAt < offer.expiresAt ? row.expiresAt : offer.expiresAt;
    const draft: DerivationEnable = { version: MEMORY_DERIVATION_CONTROL, policyVersion: MEMORY_DERIVATION_POLICY, purpose: offer.terms.purpose,
      qualificationId: offer.qualificationId, termsSha256: offer.termsSha256, projectId: row.projectId, documentId: row.documentId,
      enrollmentId: row.id, enrollmentRevision: row.revision, revision: prior?.revision ?? 0, expectedConsentId: prior?.consentId ?? null,
      expectedCustody: custody, monthlyCapMicroUsd: offer.terms.monthlyCapMicroUsd, background: this.#purposeDraft.background,
      retentionDays: row.retentionDays, expiresAt, sourceWindow: "future-originals" as const, chargeMyAiAllowance: true as const, confirmation: "ENABLE_DERIVED_MEMORY" as const };
    this.#purposeDraft = { ...this.#purposeDraft, charge: false, consent: false };
    return this.#runPurpose(event, "enable", signal => this.#purposeClient.enable(draft, signal), result => {
      this.#purposeSettings = { ...settings, grants: [...settings.grants.filter(item => item.purpose !== result.purpose), result] }; this.#purposeNotice = "purposeSaved";
    }, () => this.#purposeSettings === settings && this.#purposeEligible(offer));
  }
  #revokePurpose(event: Event, grant: DerivationGrant) {
    const settings = this.#purposeSettings;
    if (!settings || !this.#purposeLatest().includes(grant) || this.#purposeNeedsReload) return;
    return this.#runPurpose(event, "revoke", signal => this.#purposeClient.revoke(grant, signal), () => {
      this.#purposeNeedsReload = true; this.#purposeNotice = "purposeRevoked";
    }, () => this.#purposeSettings === settings && this.#purposeLatest().includes(grant));
  }
  #togglePurposes(event: Event, row: MemoryEnrollment, renderedScope: { row: MemoryEnrollment; current: () => boolean } | null) {
    const owner = this.#owner, target = event.currentTarget as HTMLDetailsElement;
    if (!this.#eventCurrent(event, owner) || !owner?.sourceCurrent() || row !== this.#selected() || document.visibilityState !== "visible" || this.#purposeScope !== renderedScope) return;
    if (!target.open) { this.#closePurposes(); this.#scheduleDeadline(); this.requestUpdate(); return; }
    if (this.#purposeOpen || this.#busy || this.#confirmation) return;
    const epoch = ++this.#purposeEpoch, events = this.store.events.get(), content = this.store.content.get(), revision = row.revision,
      expiry = row.expiresAt, retention = row.retentionDays, background = row.background;
    const scope = { row, current: (): boolean => this.#purposeScope === scope && this.#purposeOpen && this.#purposeEpoch === epoch && owner.sourceCurrent()
      && document.visibilityState === "visible" && row === this.#selected() && this.#rows.includes(row) && row.revision === revision
      && row.expiresAt === expiry && row.retentionDays === retention && row.background === background && this.store.events.get() === events && this.store.content.get() === content };
    this.#purposeScope = scope; this.#purposeOpen = true; this.requestUpdate();
  }
  #clearReview(){this.#reviewPurpose=null;this.#reviewProgress=[];this.#reviewResults=[];this.#reviewNext=null;this.#reviewLoaded=false;this.#reviewView=null;this.#reviewCorrection='';}
  #reviewScope(){const row=this.#purposeScope?.row,custody=this.#owner?.expectedCustody;
    return row&&custody?{projectId:row.projectId,documentId:row.documentId,expectedCustody:custody,enrollmentId:row.id,enrollmentRevision:row.revision}:null;}
  #loadReview(event:Event,next=false){const scope=this.#reviewScope();if(!scope||next&&!this.#reviewNext)return;
    const after=next?this.#reviewNext:null,purpose=next?this.#reviewPurpose:null;this.#reviewView=null;this.#reviewCorrection='';
    return this.#runPurpose(event,'review',signal=>this.#purposeClient.results(scope,after,signal,purpose),page=>{
      this.#reviewPurpose=purpose;this.#reviewProgress=page.progress;this.#reviewResults=page.results;this.#reviewNext=page.next;this.#reviewLoaded=true;this.#purposeNeedsReload=false;});}
  #loadLatestReview(event:Event,purpose:DerivationResultEntry['purpose']){
    const scope=this.#reviewScope();if(!scope)return;
    this.#clearReview();
    return this.#runPurpose(event,'review',async signal=>{
      const page=await this.#purposeClient.results(scope,null,signal,purpose);
      const latest=page.results[0];
      const view=latest?await this.#purposeClient.inspectResult(latest,signal):null;
      return {page,view};
    },({page,view})=>{
      this.#reviewPurpose=purpose;this.#reviewProgress=page.progress;this.#reviewResults=page.results;
      this.#reviewNext=page.next;this.#reviewLoaded=true;this.#reviewView=view;this.#purposeNeedsReload=false;
    });
  }
  #inspectReview(event:Event,entry:DerivationResultEntry){if(!this.#reviewResults.includes(entry))return;
    this.#reviewView=null;this.#reviewCorrection='';
    return this.#runPurpose(event,'review',signal=>this.#purposeClient.inspectResult(entry,signal),view=>{this.#reviewView=view;},()=>this.#reviewResults.includes(entry)&&Date.parse(entry.expiresAt)>Date.now());}
  #changeReview(event:Event,view:DerivationResultView,item:DerivationResultItem,action:'corrected'|'suppressed'){
    if(this.#purposeNeedsReload||this.#reviewView!==view||!view.items.includes(item))return;
    const correction=action==='corrected'?this.#reviewCorrection:null;
    if(action==='corrected'&&(!correction?.trim()||Array.from(correction).length>1000))return;
    return this.#runPurpose(event,'control',signal=>this.#purposeClient.changeResult(view,item,action,correction,signal),()=>{
      this.#clearReview();this.#reviewControls=[];this.#controlsLoaded=false;this.#purposeNotice='reviewChanged';
    },()=>this.#reviewView===view&&Date.parse(view.validUntil)>Date.now());}
  #withdrawReview(event:Event,entry:DerivationResultEntry){
    if(this.#purposeNeedsReload||!this.#reviewResults.includes(entry))return;
    return this.#runPurpose(event,'control',signal=>this.#purposeClient.withdrawResult(entry,signal),()=>{this.#clearReview();this.#purposeNotice='reviewChanged';});}
  #loadReviewControls(event:Event,next=false){const scope=this.#reviewScope();if(!scope||next&&!this.#controlNext)return;
    return this.#runPurpose(event,'review',signal=>this.#purposeClient.controls(scope,next?this.#controlNext:null,signal),page=>{
      this.#controlsValidUntil=page.validUntil;this.#reviewControls=page.controls;this.#controlNext=page.next;this.#controlsLoaded=true;this.#purposeNeedsReload=false;});}
  #releaseReviewControl(event:Event,control:DerivationControl){if(this.#purposeNeedsReload||!this.#reviewControls.includes(control))return;
    return this.#runPurpose(event,'control',signal=>this.#purposeClient.releaseControl(control,signal),()=>{
      this.#clearReview();this.#reviewControls=[];this.#controlsLoaded=false;this.#purposeNotice='reviewChanged';});}
  #renderReview(){
    const disabled=Boolean(this.#purposeRequest||this.#busy||this.#dirty||this.#confirmation),view=this.#reviewView;
    const scope=this.#purposeScope,captured=(event:Event,run:()=>unknown)=>{if(scope===this.#purposeScope&&this.#purposeEvent(event))return run();};
    return html`<section data-memory-derived-review aria-busy=${this.#purposeRequest?'true':'false'}>
      <h4>${this.#t('reviewHeading')}</h4><p>${this.#t('reviewDisclosure')}</p>
      <button type="button" class="button secondary" ?disabled=${disabled} @click=${(e:Event)=>captured(e,()=>this.#loadReview(e))}>${this.#t('reviewLoad')}</button>
      ${(['rolling-summary','profile','suggestion'] as const).map(purpose=>html`<button type="button" class="button secondary" ?disabled=${disabled} @click=${(e:Event)=>captured(e,()=>this.#loadLatestReview(e,purpose))}>${this.#t('reviewLatest.'+purpose)}</button>`)}
      ${this.#reviewProgress.map(progress=>html`<p>${this.#t('reviewProgress',{purpose:this.#t('purpose.'+progress.purpose),pending:this.i18n.number(progress.pending),completed:this.i18n.number(progress.completed),retained:this.i18n.number(progress.retained),uncertain:this.i18n.number(progress.uncertain)})}</p>`)}
      ${this.#reviewLoaded&&!this.#reviewResults.length?html`<p>${this.#t('reviewEmpty')}</p>`:nothing}
      ${this.#reviewResults.map(entry=>html`<div><span>${this.#t('purpose.'+entry.purpose)}</span>
        <button type="button" class="button secondary" ?disabled=${disabled} @click=${(e:Event)=>captured(e,()=>this.#inspectReview(e,entry))}>${this.#t('reviewInspect')}</button>
        <button type="button" class="button secondary" ?disabled=${disabled||this.#purposeNeedsReload} @click=${(e:Event)=>captured(e,()=>this.#withdrawReview(e,entry))}>${this.#t('reviewWithdraw')}</button></div>`)}
      ${this.#reviewNext?html`<button type="button" class="button secondary" ?disabled=${disabled} @click=${(e:Event)=>captured(e,()=>this.#loadReview(e,true))}>${this.#t('reviewNext')}</button>`:nothing}
      ${view&&Date.parse(view.validUntil)>Date.now()?html`<div data-memory-derived-content>
        ${view.history?html`<p data-memory-history-boundary>${this.#t('reviewHistory',{windows:this.i18n.number(view.history.windowCount),pairs:this.i18n.number(view.history.originalPairs)})} ${this.#t('reviewHistory.'+view.history.boundary)}</p>`:nothing}
        ${view.items.length?view.items.map(item=>html`<article><p>${item.text}</p>
          <button type="button" class="button secondary" ?disabled=${disabled||this.#purposeNeedsReload} @click=${(e:Event)=>captured(e,()=>this.#changeReview(e,view,item,'suppressed'))}>${this.#t('reviewSuppress')}</button>
          <button type="button" class="button secondary" ?disabled=${disabled||this.#purposeNeedsReload||!this.#reviewCorrection.trim()} @click=${(e:Event)=>captured(e,()=>this.#changeReview(e,view,item,'corrected'))}>${this.#t('reviewCorrect')}</button></article>`):html`<p>${this.#t('reviewEmpty')}</p>`}
        <label>${this.#t('reviewCorrection')}<textarea maxlength="2000" .value=${this.#reviewCorrection} ?disabled=${disabled} @input=${(e:Event)=>captured(e,()=>{if(!disabled&&this.#reviewView===view){this.#reviewCorrection=(e.currentTarget as HTMLTextAreaElement).value;this.requestUpdate();}})}></textarea></label>
      </div>`:nothing}
      <button type="button" class="button secondary" ?disabled=${disabled} @click=${(e:Event)=>captured(e,()=>this.#loadReviewControls(e))}>${this.#t('reviewControls')}</button>
      ${this.#controlsLoaded&&!this.#reviewControls.length?html`<p>${this.#t('reviewEmptyControls')}</p>`:nothing}
      ${this.#reviewControls.map(control=>html`<article><p>${this.#t('reviewAction.'+control.action)} — ${this.#t('purpose.'+control.purpose)}</p>
        ${control.correctionText?html`<p>${control.correctionText}</p>`:nothing}
        ${control.action!=='released'?html`<button type="button" class="button secondary" ?disabled=${disabled||this.#purposeNeedsReload} @click=${(e:Event)=>captured(e,()=>this.#releaseReviewControl(e,control))}>${this.#t('reviewRelease')}</button>`:nothing}</article>`)}
      ${this.#controlNext?html`<button type="button" class="button secondary" ?disabled=${disabled} @click=${(e:Event)=>captured(e,()=>this.#loadReviewControls(e,true))}>${this.#t('reviewNext')}</button>`:nothing}
    </section>`;
  }
  #renderPurposes(row: MemoryEnrollment) {
    const scope = this.#purposeScope, settings = this.#purposeSettings, open = this.#purposeOpen && scope?.row === row && scope.current(), offer = this.#purposeOffer();
    const disabled = Boolean(this.#purposeRequest || this.#busy || this.#dirty || this.#confirmation || this.#purposeNeedsReload);
    const captured = (event: Event, run: () => unknown) => { if (scope === this.#purposeScope && this.#purposeEvent(event)) return run(); };
    return html`<details class="personal-memory-activity" data-memory-purposes ?open=${open} @toggle=${(event: Event) => this.#togglePurposes(event, row, scope)}>
      <summary>${this.#t("purposeHeading")}</summary>${open ? html`<div aria-busy=${this.#purposeRequest ? "true" : "false"}>
      <p>${this.#t("purposeIntro")}</p><p>${this.#t("purposeManual")}</p>
      <button type="button" class="button secondary" ?disabled=${Boolean(this.#purposeRequest || this.#busy || this.#confirmation)} @click=${(event: Event) => captured(event, () => this.#loadPurposes(event))}>${this.#t("purposeLoad")}</button>${this.#renderReview()}
      ${this.#purposeError ? html`<p role="alert">${this.#t(this.#purposeError)}</p>` : nothing}${this.#purposeNotice ? html`<p role="status">${this.#t(this.#purposeNotice)}</p>` : nothing}
      ${settings ? html`${!settings.processingImplemented || !settings.available ? html`<p>${this.#t("purposeInactive")}</p>` : nothing}
        ${settings.financial ? html`<section data-memory-financial><p>${settings.financial.capMicroUsd===null ? this.#t("purposeCapUnset") : this.#t("purposeEffectiveCap", {
          period:settings.financial.period,cap:this.i18n.number(settings.financial.capMicroUsd/1000000,{maximumFractionDigits:6}),
          used:this.i18n.number(settings.financial.usedMicroUsd/1000000,{maximumFractionDigits:6}),reserved:this.i18n.number(settings.financial.reservedMicroUsd/1000000,{maximumFractionDigits:6}),
          remaining:this.i18n.number(settings.financial.remainingMicroUsd!/1000000,{maximumFractionDigits:6})})}</p><p>${this.#t("purposeFinanceRetention")}</p></section>` : nothing}
        <ul>${this.#purposeLatest().map(grant => html`<li>${this.#t("purpose." + grant.purpose)} · ${this.#t(grant.revokedAt ? "purposeGrantRevoked" : Date.parse(grant.expiresAt) <= Date.now() ? "purposeGrantExpired" : "purposeGrantSaved")} · <time datetime=${grant.expiresAt}>${this.i18n.date(new Date(grant.expiresAt), { dateStyle: "medium", timeStyle: "short" })}</time>
          <button type="button" class="button ghost danger-quiet" ?disabled=${Boolean(this.#purposeRequest || this.#busy || this.#confirmation || this.#purposeNeedsReload)} @click=${(event: Event) => captured(event, () => this.#revokePurpose(event, grant))}>${this.#t("purposeRevoke")}</button></li>`)}</ul>
        <form data-memory-purpose-form @submit=${(event: SubmitEvent) => { event.preventDefault(); return captured(event, () => this.#enablePurpose(event)); }}>
          <fieldset ?disabled=${disabled || !settings.enabled || !settings.processingImplemented}><legend>${this.#t("purposePermission")}</legend>
            <label>${this.#t("purposeSelect")}<select name="memory-purpose-qualification" .value=${this.#purposeDraft.qualificationId} @change=${(event: Event) => captured(event, () => this.#editPurpose(event, "qualificationId"))}>
              <option value="">${this.#t("purposeSelect")}</option>${settings.qualifications.map(item => html`<option value=${item.qualificationId}>${this.#t("purpose." + item.terms.purpose)} · ${item.terms.model}</option>`)}</select></label>
            ${offer ? html`<p>${this.#t("purposeTerms", { model: offer.terms.model, cap: this.i18n.number(offer.terms.monthlyCapMicroUsd / 1000000, { maximumFractionDigits: 6 }) })}</p>
              <p dir="auto">${offer.terms.providerRetentionDisclosure}</p>
              <p>${this.#t("purposePricing", { input: this.i18n.number(offer.terms.pricing.inputMicroUsdPerMillion / 1000000, { maximumFractionDigits: 6 }), cached: this.i18n.number(offer.terms.pricing.cachedInputMicroUsdPerMillion / 1000000, { maximumFractionDigits: 6 }), output: this.i18n.number(offer.terms.pricing.outputMicroUsdPerMillion / 1000000, { maximumFractionDigits: 6 }), maxInput: this.i18n.number(offer.terms.maximumInputTokens), maxOutput: this.i18n.number(offer.terms.maximumOutputTokens) })}</p>
              <p>${this.#t("purposeBounds", { days: this.i18n.number(row.retentionDays), at: this.i18n.date(new Date(row.expiresAt < offer.expiresAt ? row.expiresAt : offer.expiresAt), { dateStyle: "medium", timeStyle: "short" }) })}</p>` : nothing}
            <label class="toggle-row"><input type="checkbox" name="memory-purpose-charge" .checked=${this.#purposeDraft.charge} @change=${(event: Event) => captured(event, () => this.#editPurpose(event, "charge"))}>${this.#t("purposeCharge")}</label>
            <label class="toggle-row"><input type="checkbox" name="memory-purpose-background" .checked=${this.#purposeDraft.background} ?disabled=${!row.background} @change=${(event: Event) => captured(event, () => this.#editPurpose(event, "background"))}>${this.#t("purposeBackground")}</label>
            <label class="toggle-row"><input type="checkbox" name="memory-purpose-consent" .checked=${this.#purposeDraft.consent} @change=${(event: Event) => captured(event, () => this.#editPurpose(event, "consent"))}>${this.#t("purposeConsent")}</label>
            <button type="submit" class="button primary" ?disabled=${disabled || !this.#purposeEligible() || !this.#purposeDraft.charge || !this.#purposeDraft.consent}>${this.#t("purposeEnable")}</button>
          </fieldset>
        </form>` : html`<p>${this.#t("purposeNotLoaded")}</p>`}</div>` : nothing}</details>`;
  }

  #rowState(row: MemoryEnrollment): string {
    if (["forgotten", "erased", "revoked"].includes(row.status)) return "forgotten";
    if (Date.parse(row.expiresAt) <= Date.now()) return "expired";
    if (row.policyVersion !== MEMORY_POLICY || row.status !== "ready") return "reviewNeeded";
    if (!row.learn) return "paused";
    if (row.backlog) return "backlog";
    return row.lastAdmittedAt ? "saved" : "waiting";
  }
  #structuredCleanup(row: MemoryEnrollment) {
    // Cleanup belongs to the stable scope, not to the current enrollment or its toggles.
    // A legacy response without this status is not evidence of physical erasure.
    const state = this.#needsReload ? "unreported" : row.structuredCleanup?.state ?? "unreported";
    const key = state === "pending" ? "cleanupPending" : state === "complete" ? "cleanupComplete"
      : state === "unreported" ? "cleanupUnreported" : null;
    return key ? html`<p class="personal-memory-status" data-memory-cleanup=${state}>${this.#t(key)}</p>` : nothing;
  }
  #label(row: MemoryEnrollment) {
    const selected = row === this.#selected(), owner = this.#owner;
    const document = selected && owner?.sourceCurrent() ? this.store.projection.get().documents.find(item => item.id === row.documentId && item.projectId === row.projectId) : undefined;
    return document?.title || this.#t("document", { id: row.documentId });
  }
  async #hide(event: Event, row: MemoryEnrollment) {
    const owner = this.#owner;
    if (!this.#eventCurrent(event, owner) || !owner || this.#revealed?.id !== row.id || row !== this.#selected()) return;
    const focus = this.#captureFocus();
    this.#clearRecall(); this.#scheduleDeadline(); this.requestUpdate();
    await this.#restoreFocus(focus, owner, '[data-memory-enrollment="' + row.id + '"][data-memory-action="inspect"]');
  }
  #fieldError(field: MemoryField) {
    const error = this.#invalid[field];
    return error ? html`<span class="personal-memory-error" role="alert" id=${this.#fieldPrefix + "-" + field}>${this.#t(error)}</span>` : nothing;
  }
  #activityCounts(actions: NonNullable<MemoryRecall["rollingConsumption"]>["windows"][number]["document"]["actions"]) {
    return html`<dl class="personal-memory-facts" data-memory-activity-counts>
      ${Object.entries(actions).map(([action, count]) => html`
        <dt>${this.#t("activityAction." + action)}</dt><dd>${this.i18n.number(count!)}</dd>`)}
    </dl>`;
  }
  #activityView(value: MemoryRecall) {
    const activity = value.rollingConsumption;
    // The strict client owns validation. Render only inside the parent recall lease;
    // no new cache, block lookup, collection or authorization is introduced here.
    if (!activity) return html`<p data-memory-activity-unavailable>${this.#t("activityUnavailable")}</p>`;
    const until = this.i18n.date(new Date(value.lifetime.checkedAt), { dateStyle: "medium", timeStyle: "short" });
    return html`<section class="personal-memory-activity" data-memory-activity>
      <h4>${this.#t("activityHeading")}</h4>
      <p>${this.#t("activityBasis")}</p>
      <p>${this.#t("activityOverlap")}</p>
      ${activity.sourceLimitReached ? html`<p class="personal-memory-notice">${this.#t("activityLimit", { limit: this.i18n.number(activity.sourceLimit) })}</p>` : nothing}
      ${value.coverage.remainingThroughSequence !== null && value.coverage.remainingThroughSequence > value.coverage.throughSequence
        ? html`<p class="personal-memory-notice">${this.#t("activityBacklog")}</p>` : nothing}
      <div class="personal-memory-activity-windows">${activity.windows.map(window => html`
        <section class="personal-memory-activity-window" data-memory-activity-window=${window.windowDays}>
          <h5>${this.#t("activityWindow", { days: this.i18n.number(window.windowDays) })}</h5>
          <p>${this.#t("activityRange", { since: this.i18n.date(new Date(window.since), { dateStyle: "medium", timeStyle: "short" }), until })}</p>
          ${window.document.sourceIndexes.length ? this.#activityCounts(window.document.actions) : html`<p>${this.#t("activityEmpty")}</p>`}
          ${window.blocks.length ? html`<details class="personal-memory-activity-blocks">
            <summary>${this.#t("activityBlocks", { count: this.i18n.number(window.blocks.length) })}</summary>
            <p>${this.#t("activityHistorical")}</p>
            ${window.blocks.map(block => html`<article data-memory-activity-block>
              <h6>${this.#t("activityBlock")} <bdi dir="auto">${value.sources[block.sourceIndex].blockId}</bdi></h6>
              ${this.#activityCounts(block.actions)}
            </article>`)}
          </details>` : nothing}
        </section>`)}</div>
    </section>`;
  }
  #assistedOutcomeSource(value: MemoryRecall, sourceIndex: number, label: string) {
    const source = value.sources[sourceIndex];
    return html`<p>${this.#t(label, { index: this.i18n.number(sourceIndex + 1) })}
      <time datetime=${source.recordedAt}>${this.#t("outcomesRecorded", {
        at: "\u2068" + this.i18n.date(new Date(source.recordedAt), { dateStyle: "medium", timeStyle: "short" }) + "\u2069",
      })}</time></p>`;
  }
  #assistedOutcomesView(value: MemoryRecall) {
    // This optional breakdown is already strictly parsed by the client. It has
    // no independent cache, lookup, request, action or renewable child lifetime.
    const assisted = value.assistedOutcomes;
    if (!assisted) return html`<p data-memory-outcomes-unavailable>${this.#t("outcomesUnavailable")}</p>`;
    const accepted = assisted.outcomes.filter(outcome => outcome.status === "accepted").length;
    const rejected = assisted.outcomes.filter(outcome => outcome.status === "rejected").length;
    return html`<section class="personal-memory-activity" data-memory-assisted-outcomes>
      <h4>${this.#t("outcomesHeading")}</h4>
      <dl class="personal-memory-facts" data-memory-outcome-counts>
        <dt>${this.#t("outcomesAccepted")}</dt><dd>${this.i18n.number(accepted)}</dd>
        <dt>${this.#t("outcomesRejected")}</dt><dd>${this.i18n.number(rejected)}</dd>
      </dl>
      <p>${this.#t("outcomesBasis")}</p>
      <p>${this.#t("outcomesGrouping")}</p>
      <p>${this.#t("outcomesLimits")}</p>
      ${assisted.outcomes.length ? html`<details data-memory-outcome-references>
        <summary>${this.#t("outcomesDetails", { count: this.i18n.number(assisted.outcomes.length) })}</summary>
        <ol>${assisted.outcomes.map(outcome => html`<li><article data-memory-assisted-outcome>
          <h5>${this.#t(outcome.status === "accepted" ? "outcomesStatusAccepted" : "outcomesStatusRejected")}</h5>
          ${this.#assistedOutcomeSource(value, outcome.decision.sourceIndex, "outcomesDecision")}
          ${outcome.mutation ? this.#assistedOutcomeSource(value, outcome.mutation.sourceIndex, "outcomesMutation") : nothing}
        </article></li>`)}</ol>
      </details>` : html`<p>${this.#t("outcomesEmpty")}</p>`}
    </section>`;
  }
  #savedOutputsView(value: MemoryRecall) {
    // Certified output groups share the enclosing recall's source window and
    // lifetime. References here are ordinals only, never output content or links.
    const saved = value.savedOutputs;
    if (!saved) return html`<p data-memory-saved-outputs-unavailable>${this.#t("savedOutputsUnavailable")}</p>`;
    return html`<section class="personal-memory-activity" data-memory-saved-outputs>
      <h4>${this.#t("savedOutputsHeading")}</h4>
      <dl class="personal-memory-facts" data-memory-saved-output-count>
        <dt>${this.#t("savedOutputsCount")}</dt><dd>${this.i18n.number(saved.outputs.length)}</dd>
      </dl>
      <p>${this.#t("savedOutputsGrouping")}</p>
      <p>${this.#t("savedOutputsLimits")}</p>
      <p>${this.#t("savedOutputsMeaning")}</p>
      ${saved.outputs.length ? html`<ol data-memory-saved-output-references>
        ${saved.outputs.map(output => html`<li><article data-memory-saved-output>
          <time datetime=${output.generatedAt}>${this.#t("savedOutputsGenerated", {
            at: "\u2068" + this.i18n.date(new Date(output.generatedAt), { dateStyle: "medium", timeStyle: "short" }) + "\u2069",
          })}</time>
          <ul>${output.sourceIndexes.map(sourceIndex => html`<li>${this.#t("savedOutputsSource", { index: this.i18n.number(sourceIndex + 1) })}</li>`)}</ul>
        </article></li>`)}
      </ol>` : html`<p>${this.#t("savedOutputsEmpty")}</p>`}
    </section>`;
  }
  #visitsView(value: MemoryRecall, row: MemoryEnrollment) {
    const revealed = this.#revealed;
    if (!revealed || revealed.lease.value !== value || !revealed.current()) return nothing;
    if (!revealed.consumptionEpisodesRequested) return html`<div>
      <button type="button" class="button secondary" data-memory-action="visits" data-memory-enrollment=${row.id}
        aria-describedby=${this.#fieldPrefix + "-visits-help"} ?disabled=${Boolean(this.#busy || this.#needsReload || this.#confirmation)}
        @click=${(event: Event) => this.#inspectVisits(event, row, revealed.lease, value)}>${this.#t("visitsInclude")}</button>
      <p id=${this.#fieldPrefix + "-visits-help"}>${this.#t("visitsIncludeHelp")}</p>
    </div>`;
    const visits = value.consumptionEpisodes;
    if (!visits) return html`<p data-memory-visits-unavailable>${this.#t("visitsUnavailable")}</p>`;
    // Detail remains inside the same parent receipt. Artifact projections have their own source map;
    // it does not renumber assistant/outcome evidence or create a display lease.
    return html`<section class="personal-memory-activity" data-memory-visits>
      <h4>${this.#t("visitsHeading")}</h4>
      <dl class="personal-memory-facts" data-memory-visit-count>
        <dt>${this.#t("visitsCount")}</dt><dd>${this.i18n.number(visits.coverage.observationCount)}</dd>
      </dl>
      <p>${this.#t("visitsMeaning")}</p>
      <p>${this.#t("visitsLineage")}</p>
      <p>${this.#t("visitsLimits")}</p>
      ${(visits.version === "memory-consumption-episodes-v2" || visits.version === "memory-consumption-episodes-v3" || visits.version === "memory-consumption-episodes-v4") && visits.coverage.unavailableArtifactSourceCount
        ? html`<p>${this.#t("visitsArtifactUnavailable", { count: this.i18n.number(visits.coverage.unavailableArtifactSourceCount) })}</p>` : nothing}
      ${visits.episodes.length ? html`<details data-memory-visit-references>
        <summary>${this.#t("visitsDetails", { count: this.i18n.number(visits.episodes.length) })}</summary>
        <ol>${visits.episodes.map(episode => html`<li><article data-memory-visit>
          <p>${this.#t("visitsSource", { index: this.i18n.number(episode.observations[0].sourceIndex + 1) })}</p>
          ${(visits.version === "memory-consumption-episodes-v2" || visits.version === "memory-consumption-episodes-v3" || visits.version === "memory-consumption-episodes-v4") && episode.observations[0].kind === "viewer-open"
            ? html`<p>${this.#t("visitsArtifactOpened")}</p>` : nothing}
          <time datetime=${episode.firstRecordedAt}>${this.#t("visitsRecorded", {
            at: "\u2068" + this.i18n.date(new Date(episode.firstRecordedAt), { dateStyle: "medium", timeStyle: "short" }) + "\u2069",
          })}</time>
        </article></li>`)}</ol>
      </details>` : html`<p>${this.#t("visitsEmpty")}</p>`}
    </section>`;
  }
  #recallView(value: MemoryRecall, row: MemoryEnrollment) {
    const earlier = value.rollingConversation.summary;
    let digest: Pick<ReturnType<typeof liveConversationDigest>, "quotes" | "showOriginals"> = { quotes: [], showOriginals: true };
    try { digest = liveConversationDigest(earlier, "utf8-512"); }
    catch { /* Legacy code-point-bounded clips remain original-only; never weaken native byte-clipping protection. */ }
    return html`<div class="personal-memory-excerpts">
      <p>${this.#t("coverage", { count: this.i18n.number(value.coverage.sourceCount) })}</p>
      ${this.#activityView(value)}
      ${this.#assistedOutcomesView(value)}
      ${this.#savedOutputsView(value)}
      ${this.#visitsView(value, row)}
      ${earlier.length || value.rollingConversation.recent.length ? html`<p>${this.#t("extractive")}</p>` : nothing}
      ${value.coverage.sourceCount === 0 ? html`<p>${this.#t("noRecall")}</p>` : nothing}
      ${earlier.length ? html`
        <h4>${this.#t("earlier")}</h4>
        ${digest.quotes.map(quote => html`<article data-memory-local-quote=${quote.role}>
          <b>${this.#t(quote.role === "user" ? "you" : "assistant")}</b><blockquote dir="auto">${quote.text}</blockquote>
        </article>`)}
        <details data-memory-original-excerpts ?open=${digest.showOriginals}>
          <summary>${this.#t("earlier")}</summary>
          <p>${this.#t("extractive")}</p>
          ${earlier.map(excerpt => html`<article>
            <b>${this.#t("you")}</b><p>${excerpt.user}</p><b>${this.#t("assistant")}</b><p>${excerpt.assistant}</p>
          </article>`)}
        </details>` : nothing}
      ${value.rollingConversation.recent.length ? html`
        <h4>${this.#t("recent")}</h4>
        ${value.rollingConversation.recent.map(excerpt => html`<article>
          <b>${this.#t("you")}</b><p>${excerpt.user}</p><b>${this.#t("assistant")}</b><p>${excerpt.assistant}</p>
        </article>`)}` : nothing}
      <button type="button" class="button secondary" @click=${(event: Event) => this.#hide(event, row)}>${this.#t("hide")}</button>
    </div>`;
  }

  override render() {
    if (this.#presentationSuspended) return nothing;
    this.#syncOwner();
    this.#retireRecall();
    const owner = this.#owner, session = this.store.session.get(), selected = this.#selected();
    const disabled = Boolean(this.#busy || this.#confirmation || this.#needsReload || !this.#settings?.enabled || !owner?.sourceCurrent() || !session?.policy.accepted || this.#cursor);
    const writeDisabled = disabled || this.#settings?.writeContractVersion !== MEMORY_WRITE_CONTRACT;
    const document = owner?.sourceCurrent() ? this.store.projection.get().documents.find(item => item.id === owner.documentId && item.projectId === owner.projectId) : null;
    const choices = owner?.canSelect() ? this.store.projection.get().documents.filter(item => item.projectId === owner.projectId) : [];
    return html`<section class="creator-settings-card personal-memory-card" lang=${this.i18n.locale} dir=${this.i18n.direction} aria-label=${this.#t("heading")} aria-busy=${this.#busy || this.#exportRequest ? "true" : "false"}>
      <header><h2 tabindex="-1" data-memory-focus="heading">${this.#t("heading")}</h2><p>${this.#t("intro")}</p></header>
      ${session?.impersonation ? html`<p>${this.#t("impersonation")}</p>` : nothing}
      ${this.#busy ? html`<p class="personal-memory-status" role="status">${this.#t(this.#busy === "save" ? "saving" : this.#busy === "read" ? "loading" : "busy")}</p>` : nothing}
      ${this.#error ? html`<p class="personal-memory-error" role="alert">${this.#t(this.#error)}</p>` : nothing}
      ${this.#notice ? html`<p class="personal-memory-status" role="status">${this.#t(this.#notice)}</p>` : nothing}
      ${this.#exportRequest ? html`<p class="personal-memory-status" role="status">${this.#t("exportPreparing")}</p>` : nothing}
      ${this.#exportError ? html`<p class="personal-memory-error" role="alert">${this.#t(this.#exportError)}</p>` : nothing}
      ${this.#exportNotice ? html`<p class="personal-memory-status" role="status">${this.#t(this.#exportNotice)}</p>` : nothing}
      ${owner ? html`<div class="personal-memory-actions"><button type="button" class="button secondary" data-memory-action="refresh" ?disabled=${Boolean(this.#busy || this.#confirmation || this.#dirty && !this.#needsReload)}
        @click=${(event: Event) => { if (this.#eventCurrent(event)) { this.#notice = ""; this.#dirty = false; this.#draft.consent = false; this.#draftRevision++; void this.#load(owner); } }}>${this.#t("reload")}</button>
        ${this.#cursor ? html`<button type="button" class="button secondary" ?disabled=${Boolean(this.#busy || this.#dirty || this.#needsReload)} @click=${(event: Event) => { if (this.#eventCurrent(event)) void this.#load(owner, true); }}>${this.#t("more")}</button>` : nothing}</div>` : nothing}
      ${this.#loaded && !this.#settings?.enabled ? html`<p class="personal-memory-notice">${this.#t("unavailable")}</p>` : nothing}
      ${this.#loaded && this.#settings?.writeContractVersion !== MEMORY_WRITE_CONTRACT ? html`<p class="personal-memory-notice">${this.#t("writeUnavailable")}</p>` : nothing}
      ${this.#accountPage() ? html`<a class="button secondary" href="/memory" @click=${(event: MouseEvent) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); if (this.#eventCurrent(event)) void navigateInApp(this, navigation => navigation.route("/memory"));
      }}>${this.#t("openSetup")}</a>` : nothing}
      ${owner && this.#loaded ? html`
        ${choices.length ? html`<label>${this.#t("chooseDocument")}<select name="memory-document" .value=${this.#selection}
          ?disabled=${Boolean(this.#busy || this.#dirty || this.#confirmation)} @change=${this.#chooseDocument}>
          <option value="">${this.#t("choosePlaceholder")}</option>
          ${choices.map(item => html`<option value=${item.id}>${item.title} · ${item.id}</option>`)}
        </select></label>` : nothing}
        <div class="personal-memory-status"><b>${this.#t("scope")}</b>
          <p><bdi>${document?.title || this.#t("noDocument")}</bdi></p>
          ${document ? html`<p><bdi>${this.#t("project", { id: owner.projectId })}</bdi></p><p>${this.#ambiguous() ? this.#t("reviewNeeded") : selected ? this.#t(this.#rowState(selected)) : this.#cursor ? this.#t("moreNeeded") : this.#t("notEnrolled")}</p>` : nothing}
          ${document && owner.organizationId ? html`<p><bdi>${this.#t("organization", { id: owner.organizationId })}</bdi></p>` : nothing}
        </div>
        ${!session?.policy.accepted ? html`<p>${this.#t("accountConsent")}</p>` : nothing}
        ${owner.documentId && !owner.expectedCustody ? html`<p>${this.#t("scopeRequired")}</p>` : nothing}
        ${document ? html`<form novalidate @submit=${this.#save}>
          <fieldset ?disabled=${writeDisabled}>
            <legend>${this.#t("scope")} · ${document.title}</legend>
            <div class="personal-memory-fields">
              <label class="toggle-row"><input type="checkbox" name="memory-learn" .checked=${this.#draft.learn} @change=${(event: Event) => this.#edit(event, "learn")}><span>${this.#t("learn")}</span></label>
              <label class="toggle-row"><input type="checkbox" name="memory-recall" .checked=${this.#draft.recall} @change=${(event: Event) => this.#edit(event, "recall")}><span>${this.#t("recall")}</span></label>
              <label class="toggle-row"><input type="checkbox" name="memory-background" .checked=${this.#draft.background} @change=${(event: Event) => this.#edit(event, "background")}><span>${this.#t("background")}</span></label>
              <label>${this.#t("retention")}<input name="memory-retention" type="number" required min="1" max="365" step="1" .value=${this.#draft.retention}
                aria-invalid=${this.#invalid.retention ? "true" : "false"} aria-describedby=${this.#invalid.retention ? this.#fieldPrefix + "-retention" : nothing}
                @input=${(event: Event) => this.#edit(event, "retention")}>${this.#fieldError("retention")}</label>
              <label>${this.#t("expiry")}<input name="memory-expiry" type="date" required .value=${this.#draft.expiry}
                aria-invalid=${this.#invalid.expiry ? "true" : "false"} aria-describedby=${this.#invalid.expiry ? this.#fieldPrefix + "-expiry" : nothing}
                @input=${(event: Event) => this.#edit(event, "expiry")}>${this.#fieldError("expiry")}</label>
              <label>${this.#t("timeZone")}<input name="memory-timezone" required maxlength="80" .value=${this.#draft.timeZone}
                aria-invalid=${this.#invalid.timeZone ? "true" : "false"} aria-describedby=${this.#invalid.timeZone ? this.#fieldPrefix + "-timeZone" : nothing}
                @input=${(event: Event) => this.#edit(event, "timeZone")}>${this.#fieldError("timeZone")}</label>
            </div>
            <p>${this.#t("backgroundHelp")}</p><p>${this.#t("bounds")}</p><p>${this.#t("offUseForget")}</p>
            <label class="toggle-row personal-memory-confirm"><input name="memory-consent" type="checkbox" .checked=${this.#draft.consent} @change=${(event: Event) => this.#edit(event, "consent")}><span>${this.#t("consent")}</span></label>
            <div class="personal-memory-actions"><button class="button primary" type="submit" ?disabled=${!this.#canSave()}>${this.#t("save")}</button></div>
          </fieldset>
          <button class="button ghost" type="button" ?disabled=${!this.#dirty || Boolean(this.#busy || this.#confirmation)}
            @click=${(event: Event) => { if (this.#eventCurrent(event)) { this.#setDraft(); this.requestUpdate(); } }}>${this.#t("clearDraft")}</button>
        </form>` : nothing}
        <p class="personal-memory-notice">${this.#t("reminder")}</p>
        <h3>${this.#t("enrollments")}</h3>
        ${!this.#rows.length ? html`<p>${this.#t("none")}</p>` : nothing}
        <div class="personal-memory-enrollments">${this.#rows.map(row => html`<article class="personal-memory-enrollment">
          <h4><bdi>${this.#label(row)}</bdi></h4><p>${this.#t(this.#rowState(row))}</p>
          ${this.#structuredCleanup(row)}
          <dl class="personal-memory-facts">
            ${([["learnOn", row.learn], ["recallOn", row.recall], ["backgroundOn", row.background]] as const).map(([key, value]) => html`<dt>${this.#t(key)}</dt><dd>${this.#t(value ? "yes" : "no")}</dd>`)}
            <dt>${this.#t("expiryAt")}</dt><dd>${this.i18n.date(new Date(row.expiresAt), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}</dd>
            <dt>${this.#t("lastReview")}</dt><dd>${row.lastAdmittedAt ? this.i18n.date(new Date(row.lastAdmittedAt), { dateStyle: "medium", timeStyle: "short" }) : this.#t("never")}</dd>
          </dl>
          <div class="personal-memory-actions">
            ${row === selected && row.learn && row.recall && row.policyVersion === MEMORY_POLICY && row.status === "ready" && Date.parse(row.expiresAt) > Date.now() ? html`<button type="button" class="button secondary" ?disabled=${writeDisabled || this.#dirty}
              @click=${(event: Event) => this.#stopLearning(event, row)}>${this.#t("stop")}</button>` : nothing}
            ${row === selected && row.recall ? html`<button type="button" class="button secondary" data-memory-action="inspect" data-memory-enrollment=${row.id} ?disabled=${disabled || Date.parse(row.expiresAt) <= Date.now()}
              @click=${(event: Event) => this.#inspect(event, row)}>${this.#t("inspect")}</button>` : nothing}
            ${row === selected && row.recall ? html`<button type="button" class="button secondary" data-memory-action="export" data-memory-enrollment=${row.id}
              ?disabled=${disabled || this.#dirty || Boolean(this.#exportRequest) || row.policyVersion !== MEMORY_POLICY || row.status !== "ready" || Date.parse(row.expiresAt) <= Date.now()}
              @click=${(event: Event) => this.#exportReferences(event, row)}>${this.#t("export")}</button>` : nothing}
            <button type="button" class="button ghost danger-quiet" ?disabled=${Boolean(this.#busy || this.#confirmation && this.#confirmationRow !== row || this.#needsReload || this.#dirty)}
              aria-label=${this.#t("forgetLabel", { document: this.#label(row) + " · " + row.documentId, id: row.id })}
              @click=${(event: Event) => this.#forget(event, row)}>${this.#t("forget")}</button>
          </div>
          ${row === selected && row.learn && row.recall ? html`<p>${this.#t("stopHelp")}</p>` : nothing}
          ${row === selected && row.recall ? html`<p>${this.#t("inspectHelp")}</p>` : nothing}
          ${row === selected && row.recall ? html`<p>${this.#t("exportHelp")}</p>` : nothing}
          ${this.#revealed?.id === row.id && this.#revealed.current() ? this.#recallView(this.#revealed.lease.value, row) : nothing}
          ${row === selected && owner.sourceCurrent() ? html`${this.#renderProfile(row)}${this.#renderPurposes(row)}` : nothing}
        </article>`)}</div>
      ` : nothing}
    </section>`;
  }
}
if (!customElements.get("forma-personal-memory")) customElements.define("forma-personal-memory", FormaPersonalMemory);
