import { LitElement } from "lit";
import { FormaLocaleController } from "./design-system/localization";

/** Stateless design-system elements never subscribe to or import application state. */
export abstract class FormaPresentationalElement extends LitElement {
  #locale?: FormaLocaleController;
  protected get i18n() { return this.#locale ||= new FormaLocaleController(this); }
  protected override createRenderRoot() { return this; }
}
