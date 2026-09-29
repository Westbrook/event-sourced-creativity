/**
 * Read-only modal layout evidence. The current focused native control supplies
 * its independently measured ancestor clip from measureFormaFocusVisibility.
 * No focus, scrolling, event dispatch, state, or styling is changed here.
 * Text ranges/control boxes are bounded layout evidence, not AT or pixel proof.
 */
export function measureModalLayout(dialog, options = {}) {
  const win = dialog.ownerDocument.defaultView, doc = dialog.ownerDocument;
  const failures = [];
  const rect = element => {
    const r = element.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const contains = (a, b) => b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom;
  const card = dialog.querySelector(":scope > .modal-card");
  const heading = doc.getElementById(dialog.getAttribute("aria-labelledby"));
  const close = card?.querySelector(":scope > button.modal-close");
  if (!(dialog instanceof win.HTMLDialogElement) || !dialog.matches(":modal") || !card
    || !heading || !card.contains(heading) || !close || !options.focusClip) {
    return { failures: ["missing-current-native-modal-measurement-prerequisite"] };
  }
  const style = win.getComputedStyle(card), box = rect(card), closeBox = rect(close);
  const rootFont = Number.parseFloat(win.getComputedStyle(doc.documentElement).fontSize);
  const clearanceToken = win.getComputedStyle(dialog).getPropertyValue("--forma-focus-clearance").trim();
  const clearance = /^-?\d*\.?\d+px$/.test(clearanceToken) ? Number.parseFloat(clearanceToken)
    : /^-?\d*\.?\d+rem$/.test(clearanceToken) ? Number.parseFloat(clearanceToken) * rootFont : null;
  if (!(clearance > 0)) failures.push("unsupported-focus-clearance-token");
  const closeClearance = { left: closeBox.left - (clearance ?? 0), right: closeBox.right + (clearance ?? 0),
    top: closeBox.top - (clearance ?? 0), bottom: closeBox.bottom + (clearance ?? 0) };
  const content = { left: box.left + card.clientLeft + Number.parseFloat(style.paddingLeft),
    right: box.left + card.clientLeft + card.clientWidth - Number.parseFloat(style.paddingRight) };
  const ranges = element => {
    const result = [], walker = doc.createTreeWalker(element, win.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || node.parentElement.closest('[aria-hidden="true"],.forma-icon,script,style')) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) {
        result.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      }
    }
    return result;
  };
  const headingRanges = ranges(heading);
  if (!headingRanges.length) failures.push("heading-has-no-text-ranges");
  if (headingRanges.some(r => overlaps(r, closeClearance))) failures.push("heading-text-intersects-close-clearance");
  if (options.headingMustBeVisible && headingRanges.some(r => !contains(options.focusClip, r))) {
    failures.push("heading-not-fully-visible-at-native-close-focus");
  }
  const contentRows = [...card.querySelectorAll(":scope > h2,:scope > p,:scope > label,:scope > footer,:scope > .metric-grid")]
    .filter(element => win.getComputedStyle(element).display !== "none").map(element => {
      const bounds = rect(element), textRanges = ranges(element);
      // One CSS pixel here covers integer clientWidth rounding in gutter/flow
      // checks only. The existing focused-body/outline observer remains exact.
      if (bounds.left < content.left - 1 || bounds.right > content.right + 1) failures.push("content-outside-card-gutter");
      if (element.scrollWidth > element.clientWidth + 1) failures.push("content-horizontal-overflow");
      if (textRanges.some(r => r.left < bounds.left - 1 || r.right > bounds.right + 1)) failures.push("text-outside-own-inline-box");
      const visibleRanges = textRanges.flatMap(r => {
        const visible = { left: Math.max(r.left, options.focusClip.left), right: Math.min(r.right, options.focusClip.right),
          top: Math.max(r.top, options.focusClip.top), bottom: Math.min(r.bottom, options.focusClip.bottom) };
        if (visible.right <= visible.left || visible.bottom <= visible.top) return [];
        const top = doc.elementFromPoint((visible.left + visible.right) / 2, (visible.top + visible.bottom) / 2);
        const ownHit = Boolean(top && element.contains(top));
        if (!ownHit) failures.push("visible-modal-text-hit-obstructed");
        return [{ ...visible, ownHit, topTag: top?.tagName ?? null }];
      });
      return { tag: element.tagName, className: element.className, text: element.textContent,
        bounds, textRanges, visibleRanges, fullyVisible: textRanges.every(r => contains(options.focusClip, r)) };
    });
  const controls = [...card.querySelectorAll("button,input:not([type=hidden]),select,textarea,summary")]
    .filter(element => win.getComputedStyle(element).display !== "none").map(element => {
      const bounds = rect(element), enabled = !element.matches(":disabled");
      if (enabled && (bounds.width < 44 || bounds.height < 44)) failures.push("enabled-modal-control-below-44");
      return { tag: element.tagName, type: element.getAttribute("type"), text: element.textContent,
        name: element.getAttribute("aria-label"), enabled, bounds };
    });
  const footer = card.querySelector(":scope > footer");
  const peers = footer ? [...footer.querySelectorAll(":scope > button")].map(rect) : [];
  const expectedGap = footer ? Number.parseFloat(win.getComputedStyle(footer).columnGap) : null;
  const sameRowPairs = [];
  for (let a = 0; a < peers.length; a += 1) for (let b = a + 1; b < peers.length; b += 1) {
    const first = peers[a], second = peers[b];
    if (first.top >= second.bottom || second.top >= first.bottom) continue; // Wrapped rows are valid.
    const gap = Math.max(first.left, second.left) - Math.min(first.right, second.right);
    const heightDifference = Math.abs(first.height - second.height);
    sameRowPairs.push({ a, b, gap, expectedGap, heightDifference });
    if (heightDifference > 1) failures.push("same-row-footer-heights-differ");
    if (!Number.isFinite(expectedGap) || gap < expectedGap - 1) failures.push("same-row-footer-gap-lost");
  }
  if (card.scrollWidth > card.clientWidth + 1) failures.push("modal-card-horizontal-overflow");
  return { schema: "forma-native-modal-layout-r1", url: doc.location.href,
    language: doc.documentElement.lang, direction: doc.documentElement.dir,
    dialogDirection: win.getComputedStyle(dialog).direction, cardDirection: style.direction,
    headingText: heading.textContent, headingRanges, headingMustBeVisible: Boolean(options.headingMustBeVisible),
    close: closeBox, clearanceToken, clearance, closeClearance, card: box, content,
    focusClip: options.focusClip, cardScroll: { top: card.scrollTop, left: card.scrollLeft,
      height: card.scrollHeight, clientHeight: card.clientHeight, width: card.scrollWidth, clientWidth: card.clientWidth },
    contentRows, controls, sameRowPairs, failures,
    limits: ["Vertical modal scrolling is allowed; offscreen copy is recorded, not certified visible.",
      "Text-range center hits and layout boxes do not certify contrast, glyph paint, screen readers, or every pixel.",
      "Focus/outline/ancestor clipping is assessed separately by the unchanged native focus observer."] };
}
