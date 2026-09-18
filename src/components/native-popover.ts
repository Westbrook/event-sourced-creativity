/**
 * Positioning only. Native popover/target attributes own opening, dismissal,
 * focus traversal and the top layer; this helper never opens a surface.
 */
export function positionNativePopover(trigger: HTMLElement, panel: HTMLElement) {
  const view = trigger.ownerDocument.defaultView;
  if (!view || !trigger.isConnected || !panel.isConnected) return;
  const rect = trigger.getBoundingClientRect(), viewport = view.visualViewport;
  const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? view.innerWidth, height = viewport?.height ?? view.innerHeight;
  if (![rect.left, rect.right, rect.top, rect.bottom, x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
  const gap = 6, computed = view.getComputedStyle(panel);
  const safe = (side: string) => Math.max(8, Number.parseFloat(computed.getPropertyValue("--forma-popover-safe-" + side)) || 0);
  const leftEdge=x+safe("left"),rightEdge=x+width-safe("right"),topEdge=y+safe("top"),bottomEdge=y+height-safe("bottom");
  const availableWidth=Math.max(0,rightEdge-leftEdge);
  panel.style.setProperty("--forma-popover-max-width", availableWidth + "px");
  const panelWidth = Math.min(availableWidth, Math.max(0, Number.parseFloat(computed.width) || 384));
  const anchorTop = Math.max(topEdge, Math.min(rect.top, bottomEdge));
  const anchorBottom = Math.max(topEdge, Math.min(rect.bottom, bottomEdge));
  const desired = view.getComputedStyle(trigger).direction === "rtl" ? rect.left : rect.right - panelWidth;
  const left = Math.max(leftEdge, Math.min(desired, rightEdge - panelWidth));
  const below = Math.max(0, bottomEdge - anchorBottom - gap);
  const above = Math.max(0, anchorTop - gap - topEdge);
  const placeBelow = below >= Math.min(320, height / 2) || below >= above;
  panel.setAttribute("data-forma-popover-positioned", "true");
  panel.style.setProperty("--forma-popover-left", left + "px");
  panel.style.setProperty("--forma-popover-top", placeBelow ? Math.max(topEdge, anchorBottom + gap) + "px" : "auto");
  panel.style.setProperty("--forma-popover-bottom", placeBelow ? "auto" : Math.max(0, view.innerHeight - anchorTop + gap) + "px");
  panel.style.setProperty("--forma-popover-max-height", Math.max(0, placeBelow ? below : above) + "px");
}

/** Keep only an already-open native panel aligned; dispose on close or unmount. */
export function observeNativePopoverPosition(trigger: HTMLElement, panel: HTMLElement) {
  const view = trigger.ownerDocument.defaultView;
  const reposition = () => { if (panel.matches(":popover-open")) positionNativePopover(trigger, panel); };
  view?.addEventListener("resize", reposition);
  view?.addEventListener("scroll", reposition, true);
  view?.visualViewport?.addEventListener("resize", reposition);
  view?.visualViewport?.addEventListener("scroll", reposition);
  reposition();
  return () => {
    view?.removeEventListener("resize", reposition);
    view?.removeEventListener("scroll", reposition, true);
    view?.visualViewport?.removeEventListener("resize", reposition);
    view?.visualViewport?.removeEventListener("scroll", reposition);
  };
}
