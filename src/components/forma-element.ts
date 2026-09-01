import { store, type FormaStore } from "../state/store";
import { FormaPresentationalElement } from "./presentational-element";

export { FormaPresentationalElement } from "./presentational-element";
export { icon } from "./icons";

/** Application-connected organisms rerender when their shared projection changes. */
export abstract class FormaElement extends FormaPresentationalElement {
  protected store = store;
  /** Object identity only; callers still own connected, Source and authorization checks. */
  static hasStoreIdentity(element: FormaElement, expected: FormaStore): boolean { return element.store === expected; }
  #unsubscribe?: () => void;
  override connectedCallback() { super.connectedCallback(); this.#unsubscribe = this.store.subscribe(() => this.requestUpdate()); }
  override disconnectedCallback() { this.#unsubscribe?.(); super.disconnectedCallback(); }
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export async function copyTextToClipboard(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through for browsers or permission policies that block Clipboard API access.
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try { return document.execCommand("copy"); }
  catch { return false; }
  finally { field.remove(); }
}
