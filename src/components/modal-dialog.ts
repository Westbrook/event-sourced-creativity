/**
 * Promote declaratively rendered dialogs into the browser's native top layer.
 * Removing `open` instead of calling close() avoids firing application-specific
 * dismissal handlers before showModal() establishes inert background content.
 */
export function ensureModalDialog(dialog: HTMLDialogElement | null | undefined) {
  if (!dialog || typeof dialog.showModal !== "function") return false;
  try {
    if (!dialog.hasAttribute("aria-label") && !dialog.hasAttribute("aria-labelledby")) {
      const heading = dialog.querySelector<HTMLElement>("h1,h2,h3,[role='heading']");
      if (heading) {
        if (!heading.id) heading.id = `dialog-title-${crypto.randomUUID()}`;
        dialog.setAttribute("aria-labelledby", heading.id);
      } else dialog.setAttribute("aria-label", "Dialog");
    }
    if (dialog.matches(":modal")) return true;
    if (dialog.open) dialog.removeAttribute("open");
    dialog.showModal();
    return true;
  } catch {
    dialog.setAttribute("open", "");
    return false;
  }
}

export type TextDialogOptions = {
  title: string;
  label: string;
  value?: string;
  confirmLabel?: string;
  maxLength?: number;
};

/** Accessible, themed replacement for native prompt(), without exposing private input globally. */
export function requestDialogText(options: TextDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal shared-text-dialog";
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
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => dialog.close("cancel"));
    const confirm = document.createElement("button");
    confirm.className = "button primary";
    confirm.value = "confirm";
    confirm.textContent = options.confirmLabel ?? "Save";
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
