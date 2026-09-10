/** Unexecuted proposal. Read-only light-DOM measurements, not a visual pass oracle. */
export function observeContextReading(binding) {
  const require = (value, message) => { if (!value) throw new Error(`CONTEXT_READING_BINDING_STOP: ${message}`); };
  require(["controls-return", "direction-reading"].includes(binding?.stage), "declared observation stage");
  require(location.origin === "http://127.0.0.1:4186" && location.origin === binding.origin
    && location.pathname === binding.pathname && binding.pathname === "/document/doc-atmosphere/atmosphere-studies", "owned finite fixture route");
  require(document.documentElement.lang === "fr" && document.documentElement.dir === "ltr", "French/LTR");
  require(binding.zoomReceipt?.mechanism === "chrome.tabs.setZoom" && binding.zoomReceipt.factor === 2
    && binding.zoomReceipt.receiptId === "browser-zoom-200", "separate genuine-zoom attachment required");
  require(innerWidth === binding.innerWidth && innerHeight === binding.innerHeight && devicePixelRatio === binding.devicePixelRatio
    && visualViewport?.scale === 1, "unchanged genuine-zoom geometry; receipt is verified by existing openForma helper");
  const exact = (root, selector) => { const nodes = root.querySelectorAll(selector); require(nodes.length === 1, `unique ${selector}`); return nodes[0]; };
  const panel = exact(document, "section#document-context-panel.context-column");
  const hosts = [...panel.querySelectorAll("forma-context-block")].filter(host => host.block && host.surface === "document");
  const sourceIdentity = block => ({ projectId: block.projectId, documentId: block.documentId, id: block.id, handle: block.handle, type: block.type });
  const candidates = hosts.filter(host => host.block.id === "block-direction");
  require(candidates.length === 1, "unique source-declared current Direction owner");
  const owner = candidates[0], block = owner.block;
  require(block.projectId === "project-atmosphere" && block.documentId === "doc-atmosphere"
    && block.type === "direction" && block.handle === "direction/nocturne", "exact admitted seed identity");
  const copy = value => { const p = value.properties; return String(p.artifact_markdown ?? p.text ?? p.source_excerpt ?? p.description ?? p.label ?? ""); };
  const expectedText = "A quiet interior that feels held between dusk and night.";
  require(copy(block) === expectedText && block.locked === false && owner.readOnly === false, "unchanged current seed text/unlocked editable source");
  const decision = exact(owner, ":scope > section.context-decision");
  require(decision.dataset.controlsOpen === "false" && decision.dataset.selected === "true", "closed selected Controls");
  const controls = exact(decision, ":scope > .context-decision-actions > button.context-controls-toggle");
  require(controls.getAttribute("aria-expanded") === "false" && controls.getAttribute("aria-controls") === "context-controls-document-block-direction", "actual return target");
  require(document.activeElement === controls && controls.matches(":focus-visible"), "native Controls focus retained without injection");
  const paragraph = exact(owner, 'article.context-block--summary[data-block-id="block-direction"] > .block-body > p.block-copy[data-forma-content="primary"]');
  require(paragraph.textContent === expectedText, "full source-derived current Direction paragraph");
  const launcher = exact(document, "forma-assistant-panel > button.forma-assistant-launcher");
  require(launcher.getAttribute("aria-label") === "Demander à Forma" && launcher.parentElement.open === false
    && !launcher.parentElement.querySelector(':scope > .forma-assistant-panel[role="dialog"]'), "original launcher kind, not an expanded panel");
  const box = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
  const describe = node => node ? { tag: node.localName, id: node.id, classes: node.getAttribute("class") } : null;
  const viewport = { left: visualViewport.offsetLeft, top: visualViewport.offsetTop,
    right: visualViewport.offsetLeft + visualViewport.width, bottom: visualViewport.offsetTop + visualViewport.height };
  const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const inside = (a, b) => a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
  const ask = box(launcher.getBoundingClientRect());
  const ancestors = element => {
    const rows = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node), r = node.getBoundingClientRect();
      rows.push({ ...describe(node), overflowX: style.overflowX, overflowY: style.overflowY,
        clipPath: style.clipPath, contain: style.contain, scrollTop: node.scrollTop, scrollLeft: node.scrollLeft,
        scrollHeight: node.scrollHeight, scrollWidth: node.scrollWidth, clientHeight: node.clientHeight, clientWidth: node.clientWidth,
        clipBox: { left: r.left + node.clientLeft, top: r.top + node.clientTop,
          right: r.left + node.clientLeft + node.clientWidth, bottom: r.top + node.clientTop + node.clientHeight } });
    }
    return rows;
  };
  const measure = element => {
    const chain = ancestors(element), clip = { ...viewport };
    for (const parent of chain) {
      if (/auto|scroll|hidden|clip/.test(parent.overflowX)) { clip.left = Math.max(clip.left, parent.clipBox.left); clip.right = Math.min(clip.right, parent.clipBox.right); }
      if (/auto|scroll|hidden|clip/.test(parent.overflowY)) { clip.top = Math.max(clip.top, parent.clipBox.top); clip.bottom = Math.min(clip.bottom, parent.clipBox.bottom); }
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), lines = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || node.parentElement?.closest("svg")) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (!r.width || !r.height) continue;
        const rect = box(r), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
        const front = inside({ left: x, right: x, top: y, bottom: y }, viewport) ? document.elementsFromPoint(x, y)[0] : null;
        lines.push({ rect, insideClip: inside(rect, clip), intersectsLauncher: intersects(rect, ask),
          centerTop: describe(front), ownsCenter: Boolean(front && (front === element || element.contains(front))) });
      }
    }
    const style = getComputedStyle(element);
    return { text: element.textContent.trim(), box: box(element.getBoundingClientRect()), clip, lines, ancestors: chain,
      fullySampledClear: lines.length > 0 && lines.every(line => line.insideClip && !line.intersectsLauncher && line.ownsCenter),
      style: { display: style.display, visibility: style.visibility, fontSize: style.fontSize, lineHeight: style.lineHeight,
        overflowX: style.overflowX, overflowY: style.overflowY, clipPath: style.clipPath } };
  };
  const direction = { identity: sourceIdentity(block), ...measure(paragraph) };
  const metadata = hosts.map(host => {
    const identity = sourceIdentity(host.block);
    const summary = exact(host, `article.context-block--summary[data-block-id="${CSS.escape(identity.id)}"]`);
    const label = exact(summary, ":scope > .block-body > .block-heading > .block-heading-state > .context-lock-state");
    return { identity, locked: host.block.locked, ...measure(label), historicalNeighborCorrespondence: "UNRESOLVED" };
  });
  // Only propose native wheel input over the actual panel. Never scroll or focus here.
  const panelBox = panel.getBoundingClientRect(), clip = direction.clip;
  let readingInput = null;
  if (!direction.fullySampledClear && direction.lines.length > 0) {
    const first = direction.lines[0].rect, last = direction.lines.at(-1).rect;
    const deltaY = first.top < clip.top ? -80 : last.bottom > clip.bottom || direction.lines.some(line => line.intersectsLauncher) ? 80 : 0;
    for (const fraction of [0.25, 0.5, 0.75]) {
      const x = Math.max(viewport.left + 8, panelBox.left + 12);
      const top = Math.max(viewport.top + 8, panelBox.top + 8), bottom = Math.min(viewport.bottom - 8, panelBox.bottom - 8);
      const y = top + (bottom - top) * fraction, front = bottom > top ? document.elementsFromPoint(x, y)[0] : null;
      if (deltaY && front && panel.contains(front) && front !== launcher && !launcher.contains(front)) { readingInput = { x, y, deltaY }; break; }
    }
  }
  return { status: "MEASUREMENTS_ONLY", stage: binding.stage,
    originalCorrespondence: { neighboringMetadataOwner: null, lowerParagraphHistoricalIdentity: null,
      reason: "Current admitted seed identity is exact; original R4 neighbor and lower paragraph correspondence remains unproved." },
    direction, metadata, controls: { focused: true, focusVisible: true, box: box(controls.getBoundingClientRect()) },
    launcher: { ...describe(launcher), ariaLabel: launcher.getAttribute("aria-label"), box: ask },
    readingInput, scrollOwners: ancestors(paragraph), viewport: { ...viewport, innerWidth, innerHeight, devicePixelRatio, visualScale: visualViewport.scale },
    zoomReceipt: binding.zoomReceipt,
    limits: "Line rectangles, overflow clips and center hits require original-pixel review; not every-glyph, focus-perimeter, clip-path, paint-containment, touch, AT, live-auth or original M02 closure proof." };
}
