import { ensureNativeModalDialog } from "./design-system/native-dialog";
import { captureOutputNavigationFocus } from "./output-navigation-focus.ts";

/**
 * Promote declaratively rendered dialogs into the browser's native top layer.
 * Removing `open` instead of calling close() avoids firing application-specific
 * dismissal handlers before showModal() establishes inert background content.
 */
export function ensureModalDialog(dialog: HTMLDialogElement | null | undefined) {
  if (!dialog) return false;
  return ensureNativeModalDialog(dialog, {
    fallbackLabel: currentFormaLocale().messages["dialog.heading"] ?? "Dialog",
  });
}

export type TextDialogOptions = {
  title: string;
  label: string;
  value?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  maxLength?: number;
};

export type ConfirmationDialogOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  locale?: string;
  direction?: "ltr" | "rtl";
  owner: HTMLElement;
  invoker: HTMLElement | null;
  signal: AbortSignal;
  current: () => boolean;
  requireTrustedConfirmation?: boolean;
};

/** One owned, themed confirmation. Approval is not a request or a completion receipt. */
export function requestDialogConfirmation(options: ConfirmationDialogOptions): Promise<boolean> {
  const ownerDocument = options.owner.ownerDocument;
  const current = () => {
    try { return !options.signal.aborted && options.owner.isConnected && options.current(); }
    catch { return false; }
  };
  if (!current() || !ownerDocument.body || ownerDocument.querySelector("dialog[open]")) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const locale = currentFormaLocale();
    const dialog = ownerDocument.createElement("dialog");
    dialog.className = "modal shared-confirmation-dialog";
    dialog.lang = options.locale ?? locale.locale;
    dialog.dir = options.direction ?? locale.direction;
    dialog.setAttribute("closedby", "any");
    const form = ownerDocument.createElement("form");
    form.className = "modal-card ui-dialog-card";
    form.method = "dialog";
    const heading = ownerDocument.createElement("h2"), detail = ownerDocument.createElement("p");
    heading.id = `confirmation-title-${crypto.randomUUID()}`;
    detail.id = `${heading.id}-detail`;
    heading.textContent = options.title;
    detail.textContent = options.message;
    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.setAttribute("aria-describedby", detail.id);
    const footer = ownerDocument.createElement("footer");
    const cancel = ownerDocument.createElement("button"), confirm = ownerDocument.createElement("button");
    cancel.type = "button"; cancel.className = "button ghost";
    cancel.textContent = options.cancelLabel ?? locale.messages["action.cancel"] ?? "Cancel";
    confirm.type = "submit"; confirm.className = "button primary";
    confirm.textContent = options.confirmLabel;
    footer.append(cancel, confirm); form.append(heading, detail, footer); dialog.append(form);
    let settled = false, positivePress = false, trustedPress = false;
    const disposers: Array<() => void> = [];
    const listen = (target: EventTarget, type: string, listener: EventListener) => {
      target.addEventListener(type, listener);
      disposers.push(() => target.removeEventListener(type, listener));
    };
    const anotherDialog = () => [...ownerDocument.querySelectorAll("dialog[open]")].some((value) => value !== dialog);
    const finish = (approved: boolean, restore: boolean) => {
      if (settled) return;
      const accepted = approved && current() && dialog.isConnected && dialog.open && !anotherDialog();
      const invoker = options.invoker;
      const returnFocus = restore && current() && invoker?.isConnected && invoker.ownerDocument === ownerDocument
        && !(invoker as HTMLButtonElement).disabled && !anotherDialog()
        && (dialog.contains(ownerDocument.activeElement) || ownerDocument.activeElement === invoker);
      settled = true;
      for (const dispose of disposers.splice(0)) dispose();
      // Retired dialogs are removed directly: no stale queued close/focus handoff.
      if (returnFocus && invoker) {
        const focus = captureOutputNavigationFocus(ownerDocument, { ownedRouteFocus: (element) => dialog.contains(element) });
        try {
          focus.run(invoker, () => {
            if (dialog.open) dialog.close(accepted ? "confirm" : "cancel");
            dialog.remove();
            if (!current() || anotherDialog() || !focus.current()) return false;
            invoker.focus({ preventScroll: true });
            return true;
          });
        } finally { focus.dispose(); }
      }
      dialog.remove(); dialog.replaceChildren();
      resolve(accepted && current() && !anotherDialog());
    };
    listen(confirm, "click", (event) => { positivePress = true; trustedPress = event.isTrusted; });
    listen(form, "submit", (event) => {
      event.preventDefault();
      const pressed = positivePress, trusted = trustedPress; positivePress = false; trustedPress = false;
      if (!pressed || (event as SubmitEvent).submitter !== confirm || confirm.disabled
        || options.requireTrustedConfirmation && (!event.isTrusted || !trusted)) return;
      finish(true, true);
    });
    listen(cancel, "click", () => finish(false, true));
    listen(dialog, "cancel", (event) => { event.preventDefault(); finish(false, true); });
    listen(dialog, "click", (event) => { if (event.target === dialog) finish(false, true); });
    // returnValue alone is never positive evidence, including programmatic close("confirm").
    listen(dialog, "close", () => finish(false, false));
    listen(options.signal, "abort", () => finish(false, false));
    listen(ownerDocument, "forma-locale-change", () => finish(false, false));
    if (!current()) { finish(false, false); return; }
    ownerDocument.body.append(dialog);
    try {
      const observer = new MutationObserver((records) => {
        if (!current() || !dialog.isConnected || records.some((record) => [...record.removedNodes]
          .some((node) => node === dialog || node === options.owner || node.contains(dialog) || node.contains(options.owner)))) finish(false, false);
      });
      disposers.push(() => observer.disconnect());
      observer.observe(ownerDocument.body, { childList: true, subtree: true });
      if (!current() || !ensureModalDialog(dialog) || !current()) { finish(false, false); return; }
      cancel.focus({ preventScroll: true });
    } catch { finish(false, false); }
  });
}

/** Accessible, themed replacement for native prompt(), without exposing private input globally. */
export function requestDialogText(options: TextDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const locale = currentFormaLocale();
    const dialog = document.createElement("dialog");
    dialog.className = "modal shared-text-dialog";
    dialog.lang = locale.locale;
    dialog.dir = locale.direction;
    dialog.setAttribute("closedby", "any");

    const form = document.createElement("form");
    form.className = "modal-card shared-text-dialog-card";
    form.method = "dialog";

    const heading = document.createElement("h2");
    heading.id = `dialog-title-${crypto.randomUUID()}`;
    heading.textContent = options.title;
    dialog.setAttribute("aria-labelledby", heading.id);

    const label = document.createElement("label");
    const labelText = document.createElement("span");
    labelText.textContent = options.label;
    const input = document.createElement("input");
    input.value = options.value ?? "";
    input.required = true;
    input.maxLength = options.maxLength ?? 120;
    label.append(labelText, input);

    const footer = document.createElement("footer");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "button ghost";
    cancel.textContent = options.cancelLabel ?? locale.messages["action.cancel"] ?? "Cancel";
    cancel.addEventListener("click", () => dialog.close("cancel"));
    const confirm = document.createElement("button");
    confirm.className = "button primary";
    confirm.value = "confirm";
    confirm.textContent = options.confirmLabel ?? locale.messages["action.save"] ?? "Save";
    footer.append(cancel, confirm);
    form.append(heading, label, footer);
    dialog.append(form);

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close("cancel");
    });
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm" ? input.value.trim() || null : null);
      dialog.remove();
    }, { once: true });

    document.body.append(dialog);
    ensureModalDialog(dialog);
    input.focus();
    input.select();
  });
}
import { currentFormaLocale } from "./design-system/localization";
