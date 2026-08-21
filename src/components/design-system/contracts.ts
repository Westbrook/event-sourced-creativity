/** The shared, intentionally small public vocabulary used by every UI family. */
export type FormaTone = "neutral" | "accent" | "positive" | "warning" | "danger";
export type FormaSize = "small" | "medium" | "large";
export type FormaButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface FormaOption {
  label: string;
  value: string;
  disabled?: boolean;
  description?: string;
}

/** Semantic events deliberately coexist with native bubbling form events. */
export function emitFormaEvent<T>(element: HTMLElement, name: string, detail: T, options: { cancelable?: boolean } = {}) {
  return element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable: options.cancelable ?? false }));
}

/** Independent family imports are safe during route transitions and HMR. */
export function defineFormaElements(definitions: ReadonlyArray<readonly [string, CustomElementConstructor]>) {
  for (const [name, constructor] of definitions) {
    if (!customElements.get(name)) customElements.define(name, constructor);
  }
}

export const nextFormaId = (family: string) => `forma-${family}-${crypto.randomUUID()}`;
