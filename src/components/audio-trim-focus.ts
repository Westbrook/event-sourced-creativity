/** Reveal only the already-focused owned trim control. This grants no media,
 * playback or Save authority and never scrolls the page or another modal. */
export function revealAudioTrimFocus(host: HTMLElement, target: HTMLElement, current: () => boolean): boolean {
  const document = host.ownerDocument, view = document.defaultView;
  const content = host.closest<HTMLElement>(".document-artifact-reader-content.artifact-reader-audio");
  const reader = content?.parentElement;
  const dialog = reader?.parentElement as HTMLDialogElement | null;
  if (!view || !content || !reader || !dialog || !reader.matches("article.document-artifact-reader")
    || !dialog.matches('dialog.document-artifact-view[data-artifact-kind="audio"]')) return false;
  const headers = reader.querySelectorAll<HTMLElement>(":scope > header"), footers = reader.querySelectorAll<HTMLElement>(":scope > footer");
  if (headers.length !== 1 || footers.length !== 1) return false;
  const owns = () => current() && host.isConnected && target.isConnected && content.isConnected && reader.isConnected && dialog.isConnected
    && host.ownerDocument === document && target.ownerDocument === document && document.visibilityState === "visible"
    && document.activeElement === target && host.contains(target) && target.closest("forma-audio-trim-editor") === host
    && target.matches("audio, button.audio-trim-preview") && !target.matches(":disabled")
    && target.getAttribute("aria-disabled") !== "true" && !target.closest('[hidden], [inert], [aria-hidden="true"]')
    && host.closest(".document-artifact-reader-content") === content && content.parentElement === reader
    && reader.parentElement === dialog && target.closest("dialog") === dialog && dialog.open && dialog.matches(":modal");
  if (!owns()) return false;
  const style = view.getComputedStyle(target), rect = target.getBoundingClientRect(), box = content.getBoundingClientRect();
  const header = headers[0]!.getBoundingClientRect(), footer = footers[0]!.getBoundingClientRect(), modal = dialog.getBoundingClientRect();
  const minScale = box.height / (content.offsetHeight + .5), maxScale = box.height / (content.offsetHeight - .5);
  const scale = rect.height / (target.offsetHeight - .5), viewport = view.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0, viewportHeight = viewport?.height ?? view.innerHeight;
  const outlineWidth = Number.parseFloat(style.outlineWidth), outlineOffset = Number.parseFloat(style.outlineOffset);
  const outline = style.outlineStyle !== "none" && style.outlineStyle !== "hidden" && Number.isFinite(outlineWidth) && Number.isFinite(outlineOffset)
    ? Math.max(0, outlineWidth + outlineOffset) * scale : 0;
  const top = Math.max(box.top + (content.clientTop + .5) * maxScale, header.bottom, modal.top, viewportTop) + 2;
  const bottom = Math.min(box.top + Math.max(0, content.clientTop + content.clientHeight - 1) * minScale, footer.top, modal.bottom, viewportTop + viewportHeight) - 2;
  const maxScroll = content.scrollHeight - content.clientHeight;
  if (!target.getClientRects().length || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0"
    || ![rect.top, rect.bottom, rect.width, rect.height, minScale, maxScale, scale, top, bottom, maxScroll, content.scrollTop].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || minScale <= 0 || maxScale < minScale || scale <= 0 || bottom <= top || maxScroll < 0) return false;
  const start = rect.top - outline, end = rect.bottom + outline;
  const lower = (end - bottom) / (end > bottom ? minScale : maxScale);
  const upper = (start - top) / (start < top ? minScale : maxScale);
  // A player that cannot fit is not falsely certified clear. Ordinary scrolling
  // remains available; no outline reduction or recursive scrolling is used.
  if (![lower, upper].every(Number.isFinite) || lower > upper) return false;
  const delta = Math.max(lower, Math.min(upper, 0));
  const next = Math.max(0, Math.min(maxScroll, content.scrollTop + delta));
  if (!owns()) return false;
  if (next !== content.scrollTop) content.scrollTo({ top: next, behavior: "instant" });
  if (!owns()) return false;
  const after = target.getBoundingClientRect();
  return after.top - outline >= top && after.bottom + outline <= bottom;
}
