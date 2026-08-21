import { LitElement } from "lit";

/** Stateless design-system elements never subscribe to or import application state. */
export abstract class FormaPresentationalElement extends LitElement {
  protected override createRenderRoot() { return this; }
}
