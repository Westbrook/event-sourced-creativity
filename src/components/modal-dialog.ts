import { ensureNativeModalDialog } from "./design-system/native-dialog";

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
