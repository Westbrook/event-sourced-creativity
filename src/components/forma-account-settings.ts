import { html, nothing } from "lit";
import { qualifyDisplayCollisions } from "../model/output-naming";
import { attentionEvents, attentionMetrics, ATTENTION_RETENTION_DAYS } from "../model/attention";
import { outcomeMoney, personalUsageReceiptDisclosure } from "./outcome-telemetry-summary";
import { FormaElement, icon } from "./forma-element";
import { navigateInApp } from "./command-departure";
import { requestDialogConfirmation } from "./modal-dialog.ts";
import { holdPreviewErrorCode, readHoldPreviewBody, validateHoldPreviewResponse, validHoldPreviewJobId } from "../model/budget-hold-preview.ts";

/** Creator-owned controls remain available without entering platform administration. */
export class FormaAccountSettings extends FormaElement {
  #holdJobId = "";
  #holdContextKey = "";
  #holdRead: { controller: AbortController; current: () => boolean } | null = null;
  #holdStatus: "idle" | "loading" | "ready" | "failed" | "invalid" | "malformed" = "idle";
  #holdReceipt = "";
  #holdHttpStatus: number | null = null;
  #holdObservedAt = "";
  #holdApplyEnabled = false;
  #holdContext() {
    const session = this.store.session.get(), scope = this.store.captureAuthorizationScope(), route = this.store.route.get();
    if (!this.isConnected || route.split(/[?#]/u)[0] !== "/settings" || !session?.policy.accepted || session.user.role !== "admin" || session.impersonation || session.projectContext || !scope || scope.shared) return "";
    return JSON.stringify([scope.key, session.user.userId, session.policy.version, route, this.store.projection.get().projectId]);
  }
  #retireHold(clearInput = false) {
    this.#holdRead?.controller.abort(); this.#holdRead = null;
    this.#holdReceipt = ""; this.#holdHttpStatus = null; this.#holdObservedAt = ""; this.#holdApplyEnabled = false; this.#holdStatus = "idle";
    if (clearInput) this.#holdJobId = "";
  }
  #checkHold = () => {
    const context = this.#holdContext();
    if (this.#holdContextKey !== context || this.#holdRead && !this.#holdRead.current()) {
      this.#retireHold(true); this.#holdContextKey = context; this.requestUpdate();
    }
  };
  #holdAuthorityChanged = () => { this.#retireHold(true); this.#holdContextKey = this.#holdContext(); this.requestUpdate(); };
  #setHoldJobId(event: Event) {
    this.#checkHold();
    if (!this.#holdContextKey) return;
    this.#retireHold(); this.#holdJobId = (event.currentTarget as HTMLInputElement).value; this.requestUpdate();
  }
  async #inspectHold() {
    this.#checkHold();
    const context = this.#holdContextKey, jobId = this.#holdJobId, ownerId = this.store.session.get()?.user.userId;
    if (!context || !ownerId || this.#holdStatus === "loading") return;
    this.#retireHold();
    if (!validHoldPreviewJobId(jobId)) { this.#holdStatus = "invalid"; this.requestUpdate(); return; }
    const controller = new AbortController();
    const read = { controller, current: (): boolean => this.#holdRead === read && !controller.signal.aborted && this.#holdContext() === context && this.#holdJobId === jobId };
    this.#holdRead = read; this.#holdStatus = "loading"; this.requestUpdate();
    try {
      const response = await this.store.guardedFetch("/api/admin/budget-hold-dispositions", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview", jobId }),
      }, "inspect a read-only hold preview", { current: read.current });
      if (!read.current()) return;
      this.#holdHttpStatus = response.status; this.#holdObservedAt = new Date().toISOString();
      const text = await readHoldPreviewBody(response);
      if (!read.current()) return;
      const body: unknown = JSON.parse(text);
      if (!response.ok) {
        this.#holdStatus = "failed";
        // Preserve the exact source-free error response, not a guessed diagnosis.
        if (holdPreviewErrorCode(body)) this.#holdReceipt = text;
      } else if (validateHoldPreviewResponse(body, jobId, ownerId)) {
        this.#holdReceipt = text; this.#holdApplyEnabled = body.applyEnabled; this.#holdStatus = "ready";
      } else this.#holdStatus = "malformed";
    } catch { if (read.current()) this.#holdStatus = "failed"; }
    finally { if (read.current()) this.requestUpdate(); }
  }
  #holdPreviewTemplate() {
    if (!this.#holdContextKey) return nothing;
    return html`<section class="settings-hold-preview" aria-labelledby="settings-hold-preview-heading" aria-busy=${this.#holdStatus === "loading" ? "true" : "false"}>
      <h3 id="settings-hold-preview-heading">${this.i18n.t("settings.holdPreview.heading", "Read-only hold preview")}</h3>
      <p>${this.i18n.t("settings.holdPreview.help", "Inspect one retained slideshow attempt using your signed-in administrator account. This makes no provider request and changes no balance.")}</p>
      <label>${this.i18n.t("settings.holdPreview.jobId", "Exact job ID")}<input type="text" dir="ltr" autocomplete="off" spellcheck="false" maxlength="100" .value=${this.#holdJobId} @input=${(event: Event) => this.#setHoldJobId(event)}></label>
      <button type="button" class="button secondary compact" aria-disabled=${this.#holdStatus === "loading" ? "true" : "false"} @click=${() => void this.#inspectHold()}>${this.i18n.t("settings.holdPreview.inspect", "Inspect hold")}</button>
      <button type="button" class="button ghost compact" @click=${() => { this.#retireHold(true); this.requestUpdate(); }}>${this.i18n.t("settings.holdPreview.clear", "Clear preview")}</button>
      <p role="status">${this.#holdStatus === "idle" ? nothing : this.i18n.t(`settings.holdPreview.${this.#holdStatus}`)}</p>
      ${this.#holdApplyEnabled ? html`<p role="alert">${this.i18n.t("settings.holdPreview.enabledWarning", "Adjustments are enabled on the server. This read-only control cannot apply them.")}</p>` : nothing}
      ${this.#holdHttpStatus === null ? nothing : html`<p>${this.i18n.t("settings.holdPreview.httpStatus", "HTTP status")}: <bdi>${String(this.#holdHttpStatus)}</bdi> · ${this.i18n.t("settings.holdPreview.observedAt", "Observed at")}: <bdi>${this.#holdObservedAt}</bdi></p>`}
      ${this.#holdReceipt ? html`<label class="generation-accounting-receipt-label">${this.i18n.t("settings.holdPreview.receipt", "Private hold-preview receipt (JSON)")}<textarea rows="18" dir="ltr" readonly spellcheck="false" .value=${this.#holdReceipt}></textarea></label>` : nothing}
      <p class="creator-settings-budget-note">${this.i18n.t("settings.holdPreview.caution", "This preview is not approval or provider billing evidence. Any administrative release requires separate approval.")}</p>
    </section>`;
  }
  #privacyConfirmation: { controller: AbortController; current: () => boolean; sent: boolean } | null = null;
  #unsubscribeConfirmation?: () => void;
  #checkConfirmation = () => {
    this.#checkHold();
    const pending = this.#privacyConfirmation;
    if (pending && !pending.current()) pending.controller.abort();
  };
  override connectedCallback() {
    super.connectedCallback();
    this.#unsubscribeConfirmation = this.store.subscribe(this.#checkConfirmation);
    window.addEventListener("forma-authorization-changed", this.#holdAuthorityChanged);
    void this.store.loadShares();
  }
  override disconnectedCallback() {
    this.#retireHold(true); this.#holdContextKey = "";
    window.removeEventListener("forma-authorization-changed", this.#holdAuthorityChanged);
    this.#privacyConfirmation?.controller.abort();
    this.#unsubscribeConfirmation?.(); this.#unsubscribeConfirmation = undefined;
    super.disconnectedCallback();
  }

  async #confirmPrivacy(event: Event, action: "migrate" | "erase") {
    if (this.#privacyConfirmation) return;
    const session = this.store.session.get(), authorization = this.store.captureAuthorizationScope();
    if (!session || !authorization || session.impersonation || session.projectContext
      || action === "migrate" && session.user.role !== "admin") return;
    const route = this.store.route.get(), role = session.user.role, controller = new AbortController();
    const invoker = event.currentTarget as HTMLElement | null;
    const pending = { controller, sent: false, current: (): boolean => {
      const now = this.store.session.get();
      return this.#privacyConfirmation === pending && !controller.signal.aborted && this.isConnected
        && this.store.route.get() === route && this.store.authorizationScopeActive(authorization)
        && Boolean(now && !now.impersonation && !now.projectContext && now.user.role === role);
    } };
    this.#privacyConfirmation = pending;
    const label = this.i18n.system(action === "migrate" ? "Migrate historical event privacy" : "Erase my personal authored context");
    try {
      const accepted = await requestDialogConfirmation({
        title: label, confirmLabel: label, cancelLabel: this.i18n.t("action.cancel"),
        message: this.i18n.system(action === "migrate"
          ? "Move historical authored event bodies into erasable owner-scoped storage? Event identities, revisions, project permissions, and finished outputs are preserved."
          : "Permanently erase the authored context and temporary private processing data from your personal projects? Finished outputs, uploaded files, shared organization work, backups, and other devices are not deleted."),
        locale: this.i18n.locale, direction: this.i18n.direction, owner: this, invoker,
        signal: controller.signal, current: pending.current,
      });
      if (!accepted || !pending.current()) return;
      pending.sent = true; this.requestUpdate();
      if (action === "migrate") await this.store.migrateHistoricalEventPrivacy();
      else await this.store.erasePersonalAuthoredContext();
    } finally {
      if (this.#privacyConfirmation === pending) { this.#privacyConfirmation = null; this.requestUpdate(); }
    }
  }

  override render() {
    this.#checkHold();
    const session = this.store.session.get();
    if (!session) return nothing;

    const events = this.store.events.get();
    const attention = attentionMetrics(events);
    const episodes = attentionEvents(events).slice(-5).reverse();
    const shares = this.store.canManageProjectShares() ? this.store.shares.get().filter((share) => share.active) : [];
    const isolate=(text:string)=>"\u2068"+text+"\u2069";
    const shareContext=new Map(shares.map((share)=>{
      const title=this.store.projection.get().documents.find((document)=>document.id===share.resourceId)?.title??this.i18n.t("settings.sharedDocument","Shared document");
      const expiry=this.i18n.t("share.expires","Expires {date}",{date:isolate(this.i18n.date(new Date(share.expiresAt),{dateStyle:"medium",timeStyle:"short"}))});
      return [share.shareId,{title,expiry}] as const;
    }));
    const revokeNames=qualifyDisplayCollisions(shares.map((share)=>({
      key:share.shareId,label:this.i18n.t("share.revokeNamed","{action} — {document} · {expiry}",{
        action:this.i18n.t("share.revoke","Revoke"),document:isolate(shareContext.get(share.shareId)!.title),expiry:shareContext.get(share.shareId)!.expiry,
      }),
    })),number=>this.i18n.t("share.linkQualifier","Review link {number}",{number:this.i18n.number(number)}),
    id=>this.i18n.t("share.linkIdentity","Review link ID {id}",{id:isolate("["+encodeURIComponent(id)+"]")}));
    const personalFinance = session.policy.accepted && !session.impersonation && !session.projectContext;
    const cost = personalFinance ? session.costBudgets?.user : undefined;
    const tokens = session.budgets.user;
    const impersonating = Boolean(session.impersonation);

    return html`<section class="creator-settings-page page-pad" aria-labelledby="creator-settings-heading">
      <header class="page-header page-header--hero creator-settings-header">
        <div class="page-header-copy">
          <span class="eyebrow">${this.i18n.t("settings.eyebrow", "Your account")}</span>
          <h1 id="creator-settings-heading">${this.i18n.t("settings.heading", "Privacy, sharing & usage")}</h1>
          <p>${this.i18n.t("settings.description", "Control your personal creative account without opening platform administration.")}</p>
        </div>
      </header>

      <div class="creator-settings-grid">
        <section class="creator-settings-card" aria-labelledby="settings-privacy-heading">
          <header><h2 id="settings-privacy-heading">${this.i18n.t("settings.privacyHeading", "Privacy & attention")}</h2><p>${this.i18n.t("settings.privacyDescription", "Optional attention signals are off by default, belong to this account, and never include typed text, pointer paths, or microphone data.")}</p></header>
          <form class="creator-settings-preferences" @submit=${(event: SubmitEvent) => event.preventDefault()}>
            <label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.instrumentation} @change=${(event: Event) => this.store.patchUi({ instrumentation: (event.target as HTMLInputElement).checked })}><span>${this.i18n.t("account.recordViews", "Record explicit view actions")}</span></label>
            <label class="toggle-row"><input type="checkbox" .checked=${this.store.ui.attentionCapture} ?disabled=${impersonating} @change=${(event: Event) => this.store.setAttentionCapture((event.target as HTMLInputElement).checked)}><span>${this.i18n.t("account.useAttention", "Use attention signals to improve Forma")}</span></label>
          </form>
          ${this.store.ui.attentionCapture ? html`<button type="button" class="button secondary compact" @click=${() => this.store.setAttentionPaused(!this.store.ui.attentionPaused)}>${this.store.ui.attentionPaused ? icon("play") : icon("pause")} ${this.store.ui.attentionPaused ? this.i18n.t("account.resume", "Resume on this device") : this.i18n.t("account.pause", "Pause on this device")}</button>` : nothing}
          <div class="creator-settings-facts"><span>${this.i18n.t("settings.savedEpisodes", "Saved attention episodes")}</span><b>${this.i18n.number(attention.episodes)}</b><span>${this.i18n.t("settings.signalRetention", "Signal retention")}</span><b>${this.i18n.plural("account.days", ATTENTION_RETENTION_DAYS, "{count} day", "{count} days")}</b><span>${this.i18n.t("settings.contentRetention", "Temporary prompts and processing data")}</span><b>${this.i18n.plural("account.days", session.policy.retentionDays, "{count} day", "{count} days")}</b><span>${this.i18n.t("settings.outputRetention", "Finished outputs")}</span><b>${this.i18n.t("settings.outputRetentionValue", "Retained with your work")}</b><span>${this.i18n.t("settings.evidenceRetention", "Exact private input receipts")}</span><b>${this.i18n.plural("account.days", session.policy.evidenceRetentionDays??365, "{count} day", "{count} days")}</b><span>${this.i18n.t("settings.processing", "Provider processing")}</span><b>${session.policy.accepted ? this.i18n.t("settings.approved", "Approved") : this.i18n.t("settings.notApproved", "Not approved")}</b></div>
          ${episodes.length ? html`<ol class="creator-settings-episodes" aria-label=${this.i18n.t("settings.recentSignals", "Recent attention signals")}>${episodes.map((event) => html`<li><b>${String(event.payload.context ?? "Creative work").replaceAll("-", " ")}</b><span>${this.i18n.number(Math.round(Number(event.payload.active_ms ?? 0) / 1_000))}s</span></li>`)}</ol>` : html`<p class="creator-settings-empty">${this.i18n.t("settings.noSignals", "No personal attention signals are currently retained.")}</p>`}
          <button type="button" class="button ghost compact danger-quiet" @click=${() => this.store.forgetAttentionSignals()}>${this.i18n.t("settings.forget", "Forget my attention data")}</button>
          ${!impersonating&&!session.projectContext?html`${session.user.role==="admin"?html`<button type="button" class="button secondary compact" ?disabled=${this.#privacyConfirmation?.sent ?? false} @click=${(event: Event)=>this.#confirmPrivacy(event,"migrate")}>Migrate historical event privacy</button>`:nothing}<button type="button" class="button ghost compact danger-quiet" ?disabled=${this.#privacyConfirmation?.sent ?? false} @click=${(event: Event)=>this.#confirmPrivacy(event,"erase")}>Erase my personal authored context</button><p class="creator-settings-empty">Requires historical event migration first. Shared organization work, finished outputs, uploaded files, backups, and other devices remain separate.</p>`:nothing}
        </section>

        <section class="creator-settings-card" aria-labelledby="settings-spending-heading">
          <header><h2 id="settings-spending-heading">${this.i18n.t("settings.spendingHeading", "Your production spending")}</h2><p>${this.i18n.t("settings.spendingDescription", "See your own monthly paid generation, current reservations, and remaining personal limit.")}</p></header>
          ${personalFinance ? html`${cost ? html`<div class="creator-settings-budget"><div><span>${this.i18n.t("settings.spent", "Settled this month")}</span><b>${outcomeMoney(cost.usedMicrousd, this.i18n)}</b></div><div><span>${this.i18n.t("settings.reserved", "Currently reserved")}</span><b>${outcomeMoney(cost.reservedMicrousd, this.i18n)}</b></div><div><span>${this.i18n.t("settings.remaining", "Available to you")}</span><b>${outcomeMoney(cost.remainingMicrousd, this.i18n)}</b></div></div><progress max=${String(cost.limitMicrousd)} value=${String(Math.min(cost.limitMicrousd, cost.usedMicrousd + cost.reservedMicrousd))} aria-label=${this.i18n.t("settings.budgetProgress", "Personal monthly generation budget")}></progress><p class="creator-settings-budget-note">${this.i18n.t("settings.budgetLimit", "Personal monthly limit: {amount}", { amount: outcomeMoney(cost.limitMicrousd, this.i18n) })}</p>` : nothing}
          <div class="creator-settings-facts"><span>${this.i18n.t("settings.tokensUsed", "Token safety usage")}</span><b>${this.i18n.number(tokens.used)}</b><span>${this.i18n.t("settings.tokensReserved", "Reserved safety tokens")}</span><b>${this.i18n.number(tokens.reserved)}</b><span>${this.i18n.t("settings.period", "Accounting period")}</span><b>${session.costBudgets?.period ?? session.budgets.period}</b></div>
          <p class="creator-settings-budget-note">${this.i18n.t("outcome.currentPeriodOnly", "", { period: session.costBudgets?.period ?? session.budgets.period })}</p>
          ${personalUsageReceiptDisclosure(events, session.user.userId, this.i18n)}
          ` : html`<p class="creator-settings-empty">${this.i18n.t("outcome.personalUnavailable")}</p>`}
          ${this.#holdPreviewTemplate()}
        </section>

        ${this.store.canManageProjectShares()?html`<section class="creator-settings-card" aria-labelledby="settings-sharing-heading">
          <header><h2 id="settings-sharing-heading">${this.i18n.t("settings.sharingHeading", "Your active review links")}</h2><p>${this.i18n.t("settings.sharingDescription", "Each private link opens exactly one approved document and its current authorized media. Close a link here whenever review is finished.")}</p></header>
          ${shares.length ? html`<ol class="creator-settings-shares">${shares.map((share) => {
            const context=shareContext.get(share.shareId)!,name=revokeNames.get(share.shareId)!;
            return html`<li><div><b><bdi>${context.title}</bdi></b><span>${context.expiry}${name.qualifier?html` · ${name.qualifier}`:nothing}</span></div><button type="button" class="button secondary compact" aria-label=${name.label} @click=${() => this.store.revokeShare(share.shareId)}>${this.i18n.t("share.revoke", "Revoke")}</button></li>`;
          })}</ol>` : html`<p class="creator-settings-empty">${this.i18n.t("settings.noShares", "You have no active private review links.")}</p>`}
        </section>`:nothing}

        <section class="creator-settings-card" aria-labelledby="settings-workspaces-heading">
          <header><h2 id="settings-workspaces-heading">${this.i18n.t("workspace.admin.organizations","Your organizations")}</h2><p>${this.i18n.t("workspace.admin.settingsDescription","Review your invitations, open shared projects, or manage organizations you own.")}</p></header>
          <div class="creator-settings-facts"><span>${this.i18n.t("workspace.admin.organizations","Your organizations")}</span><b>${this.i18n.number(session.organizations?.length??0)}</b><span>${this.i18n.t("workspace.admin.sharedProjects","Projects shared with you")}</span><b>${this.i18n.number(session.projects?.length??0)}</b></div>
          <a class="button secondary compact" href="/settings/workspaces" @click=${(event:MouseEvent)=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();void navigateInApp(this,navigation=>navigation.route("/settings/workspaces"));}}>${this.i18n.t("workspace.admin.open","Open workspace settings")}</a>
        </section>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-account-settings")) customElements.define("forma-account-settings", FormaAccountSettings);
