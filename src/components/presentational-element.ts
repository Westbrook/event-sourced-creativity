import { LitElement, type PropertyValues } from "lit";
import { FormaLocaleController } from "./design-system/locale-controller";
import { localizeTemplateResult } from "./design-system/localized-template";

/** Stateless design-system elements never subscribe to or import application state. */
export abstract class FormaPresentationalElement extends LitElement {
  #locale?: FormaLocaleController;
  protected get i18n() { return this.#locale ||= new FormaLocaleController(this); }
  protected override createRenderRoot() { return this; }

  protected override update(changed: PropertyValues) {
    const render = this.render;
    this.render = () => localizeTemplateResult(render.call(this), this.i18n);
    try { super.update(changed); }
    finally { this.render = render; }
  }
}
