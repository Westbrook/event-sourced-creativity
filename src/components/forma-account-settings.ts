import { html, nothing } from "lit";
import { qualifyDisplayCollisions } from "../model/output-naming";
import { attentionEvents, attentionMetrics, ATTENTION_RETENTION_DAYS } from "../model/attention";
import { outcomeMoney, personalUsageReceiptDisclosure } from "./outcome-telemetry-summary";
import { FormaElement, icon } from "./forma-element";

/** Creator-owned controls remain available without entering platform administration. */
export class FormaAccountSettings extends FormaElement {
  override connectedCallback() {
    super.connectedCallback();
    void this.store.loadShares();
  }

  override render() {
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
          ${!impersonating&&!session.projectContext?html`${session.user.role==="admin"?html`<button type="button" class="button secondary compact" @click=${()=>{if(window.confirm(this.i18n.system("Move historical authored event bodies into erasable owner-scoped storage? Event identities, revisions, project permissions, and finished outputs are preserved.")))void this.store.migrateHistoricalEventPrivacy();}}>Migrate historical event privacy</button>`:nothing}<button type="button" class="button ghost compact danger-quiet" @click=${()=>{if(window.confirm(this.i18n.system("Permanently erase the authored context and temporary private processing data from your personal projects? Finished outputs, uploaded files, shared organization work, backups, and other devices are not deleted.")))void this.store.erasePersonalAuthoredContext();}}>Erase my personal authored context</button><p class="creator-settings-empty">Requires historical event migration first. Shared organization work, finished outputs, uploaded files, backups, and other devices remain separate.</p>`:nothing}
        </section>

        <section class="creator-settings-card" aria-labelledby="settings-spending-heading">
          <header><h2 id="settings-spending-heading">${this.i18n.t("settings.spendingHeading", "Your production spending")}</h2><p>${this.i18n.t("settings.spendingDescription", "See your own monthly paid generation, current reservations, and remaining personal limit.")}</p></header>
          ${personalFinance ? html`${cost ? html`<div class="creator-settings-budget"><div><span>${this.i18n.t("settings.spent", "Settled this month")}</span><b>${outcomeMoney(cost.usedMicrousd, this.i18n)}</b></div><div><span>${this.i18n.t("settings.reserved", "Currently reserved")}</span><b>${outcomeMoney(cost.reservedMicrousd, this.i18n)}</b></div><div><span>${this.i18n.t("settings.remaining", "Available to you")}</span><b>${outcomeMoney(cost.remainingMicrousd, this.i18n)}</b></div></div><progress max=${String(cost.limitMicrousd)} value=${String(Math.min(cost.limitMicrousd, cost.usedMicrousd + cost.reservedMicrousd))} aria-label=${this.i18n.t("settings.budgetProgress", "Personal monthly generation budget")}></progress><p class="creator-settings-budget-note">${this.i18n.t("settings.budgetLimit", "Personal monthly limit: {amount}", { amount: outcomeMoney(cost.limitMicrousd, this.i18n) })}</p>` : nothing}
          <div class="creator-settings-facts"><span>${this.i18n.t("settings.tokensUsed", "Token safety usage")}</span><b>${this.i18n.number(tokens.used)}</b><span>${this.i18n.t("settings.tokensReserved", "Reserved safety tokens")}</span><b>${this.i18n.number(tokens.reserved)}</b><span>${this.i18n.t("settings.period", "Accounting period")}</span><b>${session.costBudgets?.period ?? session.budgets.period}</b></div>
          <p class="creator-settings-budget-note">${this.i18n.t("outcome.currentPeriodOnly", "", { period: session.costBudgets?.period ?? session.budgets.period })}</p>
          ${personalUsageReceiptDisclosure(events, session.user.userId, this.i18n)}
          ` : html`<p class="creator-settings-empty">${this.i18n.t("outcome.personalUnavailable")}</p>`}
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
          <a class="button secondary compact" href="/settings/workspaces" @click=${(event:MouseEvent)=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();this.store.setRoute("/settings/workspaces");}}>${this.i18n.t("workspace.admin.open","Open workspace settings")}</a>
        </section>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-account-settings")) customElements.define("forma-account-settings", FormaAccountSettings);
