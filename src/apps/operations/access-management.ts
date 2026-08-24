import { html, nothing } from "lit";
import { FORMA_CAPABILITIES } from "../../platform/capabilities";
import { APPLICATIONS } from "../../platform/applications";
import { FormaPresentationalElement } from "../../components/presentational-element";

type PlatformUser = { user_id: string; email: string; display_name: string; role: string };
type PlatformGrant = { grant_id: string; user_id: string; display_name: string; email: string; capability: string; scope_type: string; expires_at: string | null };

const AVAILABLE_APPLICATION_CAPABILITIES=new Set<string>(APPLICATIONS.flatMap((application)=>application.requiredCapabilities));
const SPECIALIST_CAPABILITIES = FORMA_CAPABILITIES.filter((capability) => AVAILABLE_APPLICATION_CAPABILITIES.has(capability)&&(capability.startsWith("product.") || capability.startsWith("evaluation.synthetic.") || capability.startsWith("evaluation.qualification.") || capability.startsWith("design.") || capability.startsWith("engineering.")));

/** Operators grant exact specialist permissions without promoting someone to global administrator. */
export class FormaAccessManagement extends FormaPresentationalElement {
  #users: PlatformUser[] = [];
  #grants: PlatformGrant[] = [];
  #issue = "";
  #user = "";
  #capability: string = SPECIALIST_CAPABILITIES[0];

  override connectedCallback() { super.connectedCallback(); void this.#load(); }

  async #load() {
    try {
      const [users, grants] = await Promise.all([fetch("/api/admin/users"), fetch("/api/platform/access")]);
      if (!users.ok || !grants.ok) throw new Error("Your account cannot manage platform access.");
      this.#users = ((await users.json()) as { users: PlatformUser[] }).users;
      this.#grants = ((await grants.json()) as { grants: PlatformGrant[] }).grants;
      this.#user ||= this.#users[0]?.user_id ?? "";
      this.#issue = "";
    } catch (error) { this.#issue = error instanceof Error ? error.message : "Access records are unavailable."; }
    this.requestUpdate();
  }

  async #grant(event: SubmitEvent) {
    event.preventDefault();
    const response = await fetch("/api/platform/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: this.#user, capability: this.#capability }) });
    if (!response.ok) { this.#issue = "That capability could not be granted."; this.requestUpdate(); return; }
    await this.#load();
  }

  async #revoke(grantId: string) {
    const response = await fetch(`/api/platform/access/${encodeURIComponent(grantId)}`, { method: "DELETE" });
    if (!response.ok) { this.#issue = "That capability could not be revoked."; this.requestUpdate(); return; }
    await this.#load();
  }

  override render() {
    return html`<section class="access-management page-pad" aria-labelledby="access-management-heading"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">${this.i18n.t("shell.operations", "Platform Operations")}</span><h1 id="access-management-heading">${this.i18n.t("access.heading", "Specialist access")}</h1><p>${this.i18n.t("access.description", "Grant the minimum explicit product, evaluation, design, or engineering authority. Revoking a grant takes effect on the next protected request.")}</p></div></header>
      ${this.#issue ? html`<p role="alert">${this.i18n.system(this.#issue)}</p>` : nothing}
      <form class="access-grant-form" @submit=${(event: SubmitEvent) => this.#grant(event)}><label>${this.i18n.t("access.person", "Person")}<select .value=${this.#user} @change=${(event: Event) => { this.#user = (event.target as HTMLSelectElement).value; }}>${this.#users.map((user) => html`<option value=${user.user_id}>${user.display_name} · ${user.email}</option>`)}</select></label><label>${this.i18n.t("access.capability", "Exact capability")}<select .value=${this.#capability} @change=${(event: Event) => { this.#capability = (event.target as HTMLSelectElement).value; }}>${SPECIALIST_CAPABILITIES.map((capability) => html`<option value=${capability}>${capability}</option>`)}</select></label><button class="button primary" type="submit">${this.i18n.t("access.grant", "Grant scoped access")}</button></form>
      <section aria-labelledby="access-current-heading"><h2 id="access-current-heading">${this.i18n.t("access.current", "Active specialist grants")}</h2>${this.#grants.length ? html`<ul class="access-grant-list">${this.#grants.map((grant) => html`<li><div><strong>${grant.display_name}</strong><span>${grant.capability}</span><small>${grant.scope_type}${grant.expires_at ? ` · ${this.i18n.t("access.expires", "Expires")} ${grant.expires_at}` : ""}</small></div><button class="button secondary compact" type="button" @click=${() => this.#revoke(grant.grant_id)}>${this.i18n.t("access.revoke", "Revoke")}</button></li>`)}</ul>` : html`<p>${this.i18n.t("access.none", "No specialist capabilities have been delegated.")}</p>`}</section>
    </section>`;
  }
}

if (!customElements.get("forma-access-management")) customElements.define("forma-access-management", FormaAccessManagement);
