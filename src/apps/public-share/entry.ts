import { html } from "lit";
import { FORMA_SUPPORTED_LOCALES, formaLocaleFamily, setFormaLocale } from "../../components/design-system/localization";
import { FormaPresentationalElement } from "../../components/presentational-element";
import "../../components/forma-shared-view";

/** Exact-token guest review never imports account state, authenticated chrome, or attention telemetry. */
export class FormaPublicShare extends FormaPresentationalElement {
  override render() {
    const path = location.pathname.replace(/\/+$/, "");
    const token = path.startsWith("/share/") ? decodeURIComponent(path.slice("/share/".length)) : "";
    return html`<a class="skip-link" href="#main-content">${this.i18n.t("shell.skip")}</a><div class="shared-locale-switcher"><label class="locale-switcher"><span>${this.i18n.t("language.label")}</span><select .value=${formaLocaleFamily(this.i18n.locale)} @change=${async (event: Event) => { await setFormaLocale((event.target as HTMLSelectElement).value); this.requestUpdate(); }}>${FORMA_SUPPORTED_LOCALES.map((locale) => html`<option value=${locale.locale} lang=${locale.locale} dir=${locale.direction}>${locale.label}</option>`)}</select></label></div><forma-shared-view .token=${token}></forma-shared-view>`;
  }
}

if (!customElements.get("forma-public-share")) customElements.define("forma-public-share", FormaPublicShare);
