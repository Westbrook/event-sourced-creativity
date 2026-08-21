/** Clipboard capability with an accessible, selection-based legacy fallback. */
export async function copyInterfaceText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission policies can block Clipboard API even on secure origins.
  }

  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  try { return document.execCommand("copy"); }
  catch { return false; }
  finally { input.remove(); previous?.focus({ preventScroll: true }); }
}
