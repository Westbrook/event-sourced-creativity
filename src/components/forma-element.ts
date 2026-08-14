import { LitElement } from "lit";
import { store } from "../state/store";

export abstract class FormaElement extends LitElement {
  protected store = store;
  #unsubscribe?: () => void;
  protected override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); this.#unsubscribe = this.store.subscribe(() => this.requestUpdate()); }
  override disconnectedCallback() { this.#unsubscribe?.(); super.disconnectedCallback(); }
}

export const icon = (name: string) => {
  const icons: Record<string, string> = {
    spark: "✦", search: "⌕", undo: "↶", redo: "↷", share: "↗", lock: "⌁", unlock: "⌁", dots: "⠿", plus: "+", close: "×", play: "▶", pause: "Ⅱ", step: "↦", download: "⇩", compare: "◫", pin: "⌖", check: "✓", branch: "⌘", info: "i", replay: "↻", folder: "▱", clock: "◷", admin: "⌬", arrow: "→", eye: "◉", edit: "✎", trash: "⌫", image: "▧", menu: "☰",
  };
  return icons[name] ?? "•";
};

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
