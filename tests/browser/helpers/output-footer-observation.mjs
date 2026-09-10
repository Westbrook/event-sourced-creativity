/**
 * Corrected launcher-only read-only observer. UNEXECUTED. Not a fixture or pass oracle.
 * R1 incorrectly required an expanded Assistant; preserve that packet as superseded.
 * Run only inside the owner-approved inert original fixture after its native
 * pre-Escape Cancel-focus stage. All bindings come from permitted fixture data.
 * Browser zoom must be independently established by the existing real-zoom
 * runner; page metrics and the supplied receipt do not establish it themselves.
 */
export function observeRequirementFooter(binding) {
  const require = (condition, message) => {
    if (!condition) throw new Error(`PRIORITY1_BINDING_STOP: ${message}`);
  };
  require(binding && binding.stage === "requirement-cancel-unactivated", "stage");
  require(["127.0.0.1", "localhost", "[::1]"].includes(location.hostname), "local fixture only");
  require(location.protocol === "http:" && location.origin === binding.origin
    && location.pathname === binding.pathname, "exact approved fixture route");
  require(document.documentElement.lang.toLowerCase().split("-")[0] === "fr", "French locale");
  require(binding.zoomReceipt?.mechanism === "chrome.tabs.setZoom"
    && binding.zoomReceipt.factor === 2
    && typeof binding.zoomReceipt.receiptId === "string"
    && binding.zoomReceipt.receiptId.length > 0, "independent genuine browser zoom receipt");
  require(innerWidth === binding.innerWidth && innerHeight === binding.innerHeight
    && devicePixelRatio === binding.devicePixelRatio, "exact registered CSS viewport and DPR");
  require(visualViewport && visualViewport.scale === 1, "no pinch/page-scale substitute");
  const identity = binding.identity;
  require(identity && ["projectId", "documentId", "authorizationScopeKey", "requirementId"]
    .every(key => typeof identity[key] === "string" && identity[key].length > 0)
    && Object.hasOwn(identity, "revision"), "exact synthetic requirement identity");
  const cards = [...document.querySelectorAll("forma-output-requirement-card")].filter(card => {
    const input = card.snapshot ?? card.newDraft;
    return input && input.requirementId === identity.requirementId
      && input.revision === identity.revision
      && ["projectId", "documentId", "authorizationScopeKey"]
        .every(key => input.scope?.[key] === identity[key]);
  });
  require(cards.length === 1, "unique current requirement owner");
  const card = cards[0];
  const exact = (root, selector) => {
    const nodes = root.querySelectorAll(selector);
    require(nodes.length === 1, `unique ${selector}`);
    return nodes[0];
  };
  const footer = exact(card, ".output-requirement-form-footer");
  const paragraph = exact(footer, ":scope > p");
  const cancel = exact(footer, ":scope > .output-requirement-actions > button[type=button]");
  const save = exact(footer, ":scope > .output-requirement-actions > button[type=submit]");
  require(typeof binding.expectedFrenchText === "string" && binding.expectedFrenchText.length > 0,
    "source-bound full French text");
  require(paragraph.textContent === binding.expectedFrenchText, "unchanged full paragraph");
  require(cancel.textContent.trim() === "Annuler" && !cancel.disabled, "native Cancel");
  require(document.activeElement === cancel && cancel.matches(":focus-visible"),
    "native Cancel focus before activation; no forced focus in observer");
  require(binding.saveDisabled === true && save.disabled === true,
    "original Save state, not changed to make case pass");
  require(binding.askKind === "launcher", "original launcher-only observation");
  const launcher = exact(document, "forma-assistant-panel > button.forma-assistant-launcher");
  const assistantOwner = launcher.parentElement;
  require(launcher instanceof HTMLButtonElement
    && launcher.getAttribute("aria-haspopup") === "dialog", "native Ask launcher");
  require(assistantOwner?.open === false
    && assistantOwner.querySelector(":scope > .forma-assistant-panel[role=dialog]") === null,
    "collapsed Assistant; an expanded panel is a different observation");
  require(binding.expectedFrenchLauncherLabel === "Demander à Forma"
    && launcher.getAttribute("aria-label") === binding.expectedFrenchLauncherLabel,
    "exact retained French launcher label");
  const launcherBounds = launcher.getBoundingClientRect();
  require(launcherBounds.width > 0 && launcherBounds.height > 0
    && getComputedStyle(launcher).visibility === "visible", "rendered launcher");
  const box = r => ({ x: r.x, y: r.y, left: r.left, top: r.top,
    right: r.right, bottom: r.bottom, width: r.width, height: r.height });
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const view = { left: visualViewport.offsetLeft, top: visualViewport.offsetTop,
    right: visualViewport.offsetLeft + visualViewport.width,
    bottom: visualViewport.offsetTop + visualViewport.height };
  const inside = r => r.left >= view.left && r.top >= view.top
    && r.right <= view.right && r.bottom <= view.bottom;
  const describe = element => element ? { tag: element.localName, id: element.id,
    classes: element.getAttribute("class") ?? "" } : null;
  const ask = box(launcherBounds);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const lines = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(box);
  require(lines.length > 0, "rendered paragraph line boxes");
  const samples = lines.map(rect => {
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const stack = inside({ left: x, right: x, top: y, bottom: y })
      ? document.elementsFromPoint(x, y) : [];
    const front = stack[0];
    return { rect, insideViewport: inside(rect), askIntersectionArea: overlap(rect, ask),
      centerTop: describe(front), paragraphOwnsCenter: Boolean(front && (front === paragraph || paragraph.contains(front))) };
  });
  const style = element => {
    const s = getComputedStyle(element);
    return { display: s.display, visibility: s.visibility, opacity: s.opacity,
      fontSize: s.fontSize, lineHeight: s.lineHeight, overflowX: s.overflowX,
      overflowY: s.overflowY, clipPath: s.clipPath, outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth, outlineOffset: s.outlineOffset };
  };
  return {
    status: "MEASUREMENTS_ONLY_REQUIRES_OWNER_VISUAL_REVIEW",
    stage: binding.stage, zoomReceipt: binding.zoomReceipt,
    identity: { projectId: identity.projectId, documentId: identity.documentId,
      authorizationScopeKey: identity.authorizationScopeKey,
      requirementId: identity.requirementId, revision: identity.revision },
    paragraph: { text: paragraph.textContent, box: box(paragraph.getBoundingClientRect()),
      style: style(paragraph), lines: samples },
    ask: { kind: "launcher", assistantState: "collapsed", box: ask, style: style(launcher),
      selector: "forma-assistant-panel > button.forma-assistant-launcher",
      ariaLabel: launcher.getAttribute("aria-label"), text: launcher.textContent.trim() },
    cancel: { box: box(cancel.getBoundingClientRect()), style: style(cancel),
      ariaLabel: cancel.getAttribute("aria-label"), focusVisible: true },
    save: { disabled: save.disabled, box: box(save.getBoundingClientRect()), style: style(save) },
    viewport: { innerWidth, innerHeight, devicePixelRatio, visualScale: visualViewport.scale,
      ...view, scrollX, scrollY },
    allParagraphLinesInsideViewport: samples.every(s => s.insideViewport),
    anyLineBoxIntersectsAsk: samples.some(s => s.askIntersectionArea > 0),
    allSampleCentersOwnedByParagraph: samples.every(s => s.paragraphOwnsCenter),
    limits: "Line boxes and center hit tests are not complete glyph, clipping, focus-perimeter or accessibility proof. No state is changed by this observer."
  };
}
