/** Read-only pre-action witness. Unlike Locator.click, the later raw pointer
 * click cannot silently scroll an offscreen destination into view. */
export function observeLibraryControl(button) {
  const doc = button.ownerDocument, win = doc.defaultView;
  const rect = element => element.getBoundingClientRect().toJSON();
  const bounds = rect(button), style = win.getComputedStyle(button);
  const clip = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
  const ancestors = [], unsupported = [];
  for (let node = button; node; node = node.parentElement) {
    const css = win.getComputedStyle(node), box = rect(node);
    if ([css.transform, css.translate, css.rotate, css.scale, css.perspective].some(value => value && value !== "none")
      || css.clipPath !== "none" || css.maskImage !== "none" || css.filter !== "none"
      || css.zoom && !["1", "normal"].includes(css.zoom)) unsupported.push({ tag: node.localName, className: node.className });
    if (node !== button) {
      if (/^(auto|scroll|hidden|clip|overlay)$/.test(css.overflowX)) {
        clip.left = Math.max(clip.left, box.left + node.clientLeft);
        clip.right = Math.min(clip.right, box.left + node.clientLeft + node.clientWidth);
      }
      if (/^(auto|scroll|hidden|clip|overlay)$/.test(css.overflowY)) {
        clip.top = Math.max(clip.top, box.top + node.clientTop);
        clip.bottom = Math.min(clip.bottom, box.top + node.clientTop + node.clientHeight);
      }
    }
    ancestors.push({ tag: node.localName, id: node.id, className: node.className, scrollTop: node.scrollTop, scrollLeft: node.scrollLeft });
  }
  const sampleGrid = positions => positions.flatMap(x => positions.map(y => {
    const px = bounds.left + bounds.width * x, py = bounds.top + bounds.height * y;
    const top = doc.elementFromPoint(px, py);
    return { x: px, y: py, owned: top === button || button.contains(top), top: top ? { tag: top.localName, className: top.className } : null };
  }));
  const samples = sampleGrid([.1, .5, .9]);
  // The compact Assistant is circular; these declared interior samples also
  // fit that existing native body without claiming its square bounding corners.
  const interiorSamples = sampleGrid([.25, .5, .75]);
  const fragments = [], hiddenText = [];
  const walker = doc.createTreeWalker(button, win.NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, parent = node.parentElement;
    if (!node.textContent.trim() || parent.closest('svg,[aria-hidden="true"]')) continue;
    const range = doc.createRange(); range.selectNodeContents(node);
    const css = win.getComputedStyle(parent);
    const rects = [...range.getClientRects()].filter(box => box.width && box.height).map(box => box.toJSON());
    if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || !rects.length
      || css.textOverflow === "ellipsis" || !["none", "0"].includes(css.webkitLineClamp)) hiddenText.push(node.textContent);
    fragments.push(...rects);
  }
  return { bounds, clip, samples, interiorSamples, ancestors, unsupported, hiddenText, fragments,
    text: button.textContent, ariaLabel: button.getAttribute("aria-label"),
    enabled: !button.disabled, painted: button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
    type: button.type, nativeButton: button instanceof win.HTMLButtonElement,
    minimum: win.getComputedStyle(doc.documentElement).getPropertyValue("--forma-control-min-size").trim(),
    computed: { minWidth: style.minWidth, minHeight: style.minHeight, overflowX: style.overflowX, overflowY: style.overflowY,
      whiteSpace: style.whiteSpace, wordBreak: style.wordBreak, overflowWrap: style.overflowWrap },
    document: { width: doc.documentElement.clientWidth, scrollWidth: doc.documentElement.scrollWidth, scrollX: win.scrollX, scrollY: win.scrollY },
    limit: "Finite native hit samples and text rectangles; original physical pixels require separate review. No focus, scroll, style or application mutation." };
}

export function libraryCardIdentity(article) {
  const preview = article.querySelector("a.asset-focus-trigger"), title = article.querySelector("h3"), control = article.querySelector("[data-context-controls-id]");
  return { previewCount: article.querySelectorAll("a.asset-focus-trigger").length,
    href: preview?.getAttribute("href"), previewLabel: preview?.getAttribute("aria-label"),
    previewCopy: preview?.querySelector("blockquote")?.textContent,
    titleCount: article.querySelectorAll("h3").length, title: title?.textContent,
    paragraphCount: article.querySelectorAll(":scope > p").length, paragraph: article.querySelector(":scope > p")?.textContent,
    controlsCount: article.querySelectorAll("[data-context-controls-id]").length,
    controlId: control?.getAttribute("data-context-controls-id"), controlText: control?.textContent, controlLabel: control?.getAttribute("aria-label"),
    titleBeforePreview: Boolean(title && preview && title.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING),
    controlsBeforePreview: Boolean(control && preview && control.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING) };
}

export function librarySectionLayout(library) {
  const heading = library.querySelector('.library-content > section:has(> .asset-grid) > .section-heading');
  const control = heading?.querySelector(':scope > button');
  const panel = library.closest('.application-creative')?.querySelector(':scope > forma-creative-assistant > forma-assistant-panel');
  const ask = panel?.querySelector(':scope > .forma-assistant-launcher');
  const box = element => element?.getBoundingClientRect().toJSON() ?? null;
  const action = box(control), launcher = box(ask);
  const overlaps = Boolean(action && launcher && Math.max(0, action.left, launcher.left) < Math.min(innerWidth, action.right, launcher.right)
    && Math.max(0, action.top, launcher.top) < Math.min(innerHeight, action.bottom, launcher.bottom));
  return { action, launcher, overlaps, heading: box(heading),
    query: library.querySelector('.library-toolbar input')?.value,
    scroll: { x: scrollX, y: scrollY },
    posture: { open: panel?.open, browseSlot: panel?.dataset.browseSlot, browseLane: panel?.dataset.browseLane,
      offset: panel?.style.getPropertyValue('--forma-assistant-obstacle-offset'),
      hovered: ask?.matches(':hover'), focused: ask === document.activeElement },
    limit: 'Read-only native rectangle intersection; word/body and actual pixels are checked separately.' };
}

/** Exact read-only arrival copy. Offscreen continuation is disclosed, never
 * treated as fully read; every currently visible glyph is protected from Ask. */
export function libraryInspectionCopy(library) {
  const shell = library.closest('.application-creative');
  const panels = [...(shell?.querySelectorAll(':scope > forma-creative-assistant > forma-assistant-panel') ?? [])];
  const panel = panels[0], launchers = [...(panel?.querySelectorAll(':scope > .forma-assistant-launcher') ?? [])];
  const launcher = launchers[0];
  const inspections = [...library.querySelectorAll(':scope > .library-page > .library-main > forma-library-block-editor > section.library-block-inspection')];
  const contexts = [...(inspections[0]?.querySelectorAll(':scope > forma-context-block') ?? [])];
  const copies = [...(contexts[0]?.querySelectorAll(':scope > section.context-decision[data-controls-open="false"] > div[id="context-controls-library-block-direction"] > article.context-block--summary[data-block-id="block-direction"] > .block-body > p.block-copy[data-forma-content="primary"]') ?? [])];
  const copy = copies[0], unsupported = [], hidden = [];
  const box = element => element?.getBoundingClientRect().toJSON() ?? null;
  const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  for (const target of [copy, launcher].filter(Boolean)) for (let node = target; node; node = node.parentElement) {
    const css = getComputedStyle(node), bounds = box(node);
    if ([css.transform, css.translate, css.rotate, css.scale, css.perspective, css.clipPath, css.maskImage, css.filter]
      .some(value => value && value !== 'none') || css.zoom && !['1', 'normal'].includes(css.zoom)) {
      unsupported.push({ target: target === copy ? 'copy' : 'launcher', tag: node.localName, className: node.className });
    }
    if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || node.matches('[hidden],[inert],[aria-hidden="true"]')
      || css.textOverflow === 'ellipsis' || !['none','0'].includes(css.webkitLineClamp)) hidden.push(node.localName);
    if (target === copy && /^(auto|scroll|hidden|clip|overlay)$/.test(css.overflowX)) {
      clip.left = Math.max(clip.left, bounds.left + node.clientLeft);
      clip.right = Math.min(clip.right, bounds.left + node.clientLeft + node.clientWidth);
    }
    if (target === copy && /^(auto|scroll|hidden|clip|overlay)$/.test(css.overflowY)) {
      clip.top = Math.max(clip.top, bounds.top + node.clientTop);
      clip.bottom = Math.min(clip.bottom, bounds.top + node.clientTop + node.clientHeight);
    }
  }
  const fragments = [], launcherBox = box(launcher);
  let ordinal = 0;
  const intersect = (a, b) => Boolean(a && b && Math.max(a.left, b.left) < Math.min(a.right, b.right)
    && Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom));
  if (copy) {
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (const { segment, index } of segmenter.segment(node.textContent)) {
        if (!segment.trim()) continue;
        const glyphId = ordinal++;
        const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + segment.length);
        for (const bounds of range.getClientRects()) {
          if (!bounds.width || !bounds.height) continue;
          const visible = intersect(bounds, clip);
          const clipped = { left: Math.max(bounds.left, clip.left), right: Math.min(bounds.right, clip.right),
            top: Math.max(bounds.top, clip.top), bottom: Math.min(bounds.bottom, clip.bottom) };
          const top = visible ? document.elementFromPoint((clipped.left + clipped.right) / 2, (clipped.top + clipped.bottom) / 2) : null;
          fragments.push({ glyphId, text: segment, bounds: bounds.toJSON(), visible,
            fullyInClip: bounds.left >= clip.left && bounds.right <= clip.right && bounds.top >= clip.top && bounds.bottom <= clip.bottom,
            hitOwned: Boolean(top && (top === copy || copy.contains(top))),
            launcherOverlap: visible && intersect(clipped, launcherBox) });
        }
      }
    }
  }
  const store = library.store, context = contexts[0], editor = inspections[0]?.parentElement;
  const projection = store?.projection.get(), source = store?.captureSourceOwnership(), auth = store?.captureAuthorizationScope();
  const selected = projection?.libraryBlocks.filter(block => block.id === context?.block?.id) ?? [];
  const active = document.activeElement, activeStyle = active ? getComputedStyle(active) : null;
  const focusPaint = activeStyle ? { focusVisible: active.matches(':focus-visible'), bounds: box(active),
    outlineStyle: activeStyle.outlineStyle, outlineWidth: activeStyle.outlineWidth, outlineOffset: activeStyle.outlineOffset,
    boxShadow: activeStyle.boxShadow, textShadow: activeStyle.textShadow, background: activeStyle.background,
    border: activeStyle.border, transform: activeStyle.transform, translate: activeStyle.translate, rotate: activeStyle.rotate,
    scale: activeStyle.scale, perspective: activeStyle.perspective, filter: activeStyle.filter, clipPath: activeStyle.clipPath,
    maskImage: activeStyle.maskImage, zoom: activeStyle.zoom, opacity: activeStyle.opacity, visibility: activeStyle.visibility,
    beforeContent: getComputedStyle(active, '::before').content, afterContent: getComputedStyle(active, '::after').content } : null;
  const admissionDiagnostic = { focusPaint, route: store?.route.get(), routeDataReady: store?.routeDataReady(),
    editorCount: library.querySelectorAll('.library-main > forma-library-block-editor').length,
    editorBlockId: editor?.blockId, contextBlockId: context?.block?.id, selectedBlockCount: selected.length,
    exactBlockObject: context?.block === selected[0], sameSerializedBlock: JSON.stringify(context?.block) === JSON.stringify(selected[0]), projectMatches: context?.block?.projectId === projection?.projectId,
    ownerSameStore: panel?.parentElement?.store === store, editorSameStore: editor?.store === store, contextSameStore: context?.store === store,
    sourceActive: store?.sourceOwnershipActive(source), authorizationActive: store?.authorizationScopeActive(auth),
    active: { tag: active?.localName, id: active?.id, className: active?.className, nativeCensus: active?.matches('a[href], button, input, textarea, select, summary, [role="button"], [contenteditable="true"]') },
    panelDataset: panel ? { ...panel.dataset } : null, panelStyle: panel?.getAttribute('style') };
  return { admissionDiagnostic, ownerCounts: { panels: panels.length, launchers: launchers.length, inspections: inspections.length,
      contexts: contexts.length, copies: copies.length }, connected: Boolean(library.isConnected && copy?.isConnected && launcher?.isConnected),
    readOnly: contexts[0]?.readOnly, surface: contexts[0]?.surface, blockId: contexts[0]?.block?.id, copy: copy?.textContent,
    direction: { attribute: copy?.getAttribute("dir"), computed: copy ? getComputedStyle(copy).direction : null },
    nativeLauncher: launcher instanceof HTMLButtonElement, launcherEnabled: launcher ? !launcher.disabled : false,
    copyBox: box(copy), launcher: launcherBox, clip, unsupported, hidden, fragments,
    overlaps: fragments.filter(fragment => fragment.launcherOverlap),
    glyphCount: ordinal, visibleCount: fragments.filter(fragment => fragment.visible).length,
    offscreenCount: fragments.filter(fragment => !fragment.visible).length,
    scroll: { x: scrollX, y: scrollY }, width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    posture: { open: panel?.open, browseSlot: panel?.dataset.browseSlot, browseLane: panel?.dataset.browseLane,
      hovered: launcher?.matches(':hover'), focused: launcher === document.activeElement },
    limit: 'Exact owned paragraph grapheme rectangles intersecting the current clip, against the collapsed launcher; original pixels reviewed separately. No offscreen full-reading, AT, focus authority or source authorization claim.' };
}
