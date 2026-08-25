import { html } from "lit";
import { formaLocaleFamily, setFormaLocale } from "../../components/design-system/localization";
import { FormaPresentationalElement } from "../../components/presentational-element";
import "../../components/design-system/language-picker";
import "../../components/forma-shared-view";

/** Exact-token guest review never imports account state, authenticated chrome, or attention telemetry. */
export class FormaPublicShare extends FormaPresentationalElement {
  override render() {
    const path = location.pathname.replace(/\/+$/, "");
    const token = path.startsWith("/share/") ? decodeURIComponent(path.slice("/share/".length)) : "";
    return html`<a class="skip-link" href="#main-content">${this.i18n.t("shell.skip")}</a><div class="shared-locale-switcher"><forma-ui-language-picker .label=${this.i18n.t("language.label")} .value=${formaLocaleFamily(this.i18n.locale)} @forma-change=${async (event: CustomEvent<{ value: string }>) => { await setFormaLocale(event.detail.value); this.requestUpdate(); }}></forma-ui-language-picker></div><forma-shared-view .token=${token}></forma-shared-view>`;
  }
}

if (!customElements.get("forma-public-share")) customElements.define("forma-public-share", FormaPublicShare);
