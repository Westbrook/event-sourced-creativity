export type NativeModalDialogOptions = {
  fallbackLabel?: string;
};

/** One public-safe, dependency-free contract for entering the native modal top layer. */
export function ensureNativeModalDialog(
  dialog: HTMLDialogElement | null | undefined,
  options: NativeModalDialogOptions = {},
) {
  if (!dialog || typeof dialog.showModal !== "function") return false;
  try {
    if (!dialog.hasAttribute("aria-label") && !dialog.hasAttribute("aria-labelledby")) {
      const heading = dialog.querySelector<HTMLElement>("h1,h2,h3,[role='heading']");
      if (heading) {
        if (!heading.id) heading.id = `dialog-title-${crypto.randomUUID()}`;
        dialog.setAttribute("aria-labelledby", heading.id);
      } else if (options.fallbackLabel) {
        dialog.setAttribute("aria-label", options.fallbackLabel);
      } else return false;
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
