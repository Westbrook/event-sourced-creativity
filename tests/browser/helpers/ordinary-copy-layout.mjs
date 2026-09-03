/**
 * Browser-only, read-only ordinary-copy measurement. Native Range rectangles
 * are text layout fragments, NOT glyph-ink pixels. No focus/scroll/style writes,
 * placement routine, Store reads, all-paragraph scan, or critical-region waiver.
 */
export function measureOrdinaryCopy(owner, options) {
  const doc = owner.ownerDocument, win = doc.defaultView;
  const describe = element => element ? { tag: element.tagName, id: element.id || null,
    className: element.getAttribute("class"), role: element.getAttribute("role") } : null;
  const rect = value => ({ left: value.left, top: value.top, right: value.right, bottom: value.bottom,
    width: value.right - value.left, height: value.bottom - value.top });
  const positive = value => value.width > 0 && value.height > 0;
  const intersection = (a, b) => rect({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const viewport = rect({ left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight });
  const styleKeys = ["display", "visibility", "opacity", "color", "backgroundColor", "backgroundImage",
    "position", "zIndex", "pointerEvents", "direction", "writingMode", "whiteSpace", "lineHeight",
    "fontFamily", "fontSize", "fontStyle", "textShadow", "overflowX", "overflowY", "overflowClipMargin",
    "borderLeftWidth", "borderRightWidth", "borderTopWidth", "borderBottomWidth",
    "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
    "transform", "translate", "rotate", "scale", "perspective", "zoom", "clip", "clipPath", "maskImage",
    "contain", "filter", "backdropFilter", "scrollbarGutter", "scrollbarWidth", "boxShadow",
    "left", "right", "top", "bottom", "insetInlineStart", "insetInlineEnd", "width", "height",
    "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "boxSizing"];
  const readStyle = element => {
    const style = win.getComputedStyle(element);
    return Object.fromEntries(styleKeys.map(key => [key, style[key]]));
  };
  const inspectBox = element => ({ element: describe(element), raw: rect(element.getBoundingClientRect()),
    clientLeft: element.clientLeft, clientTop: element.clientTop, clientWidth: element.clientWidth,
    clientHeight: element.clientHeight, offsetWidth: element.offsetWidth, offsetHeight: element.offsetHeight,
    scrollLeft: element.scrollLeft, scrollTop: element.scrollTop, scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight, fragmentCount: element.getClientRects().length, style: readStyle(element) });
  const zeroRadius = value => /^0(?:\.0+)?(?:px|%)?(?:\s+0(?:\.0+)?(?:px|%)?)?$/.test(value.trim());
  const transparent = value => value === "transparent" || /^rgba\([^,]+,[^,]+,[^,]+,\s*0(?:\.0+)?\)$/.test(value);
  const opaque = value => /^rgb\([^/]+\)$/.test(value)
    || /^rgba\([^,]+,[^,]+,[^,]+,\s*1(?:\.0+)?\)$/.test(value);
  const clipPattern = /^(auto|scroll|hidden|clip|overlay)$/;
  const geometry = (element, raw) => {
    let clip = viewport, opacity = 1, displayed = true;
    const ancestors = [], unsupported = [];
    for (let node = element; node; node = node.parentElement) {
      const item = inspectBox(node), s = item.style, reasons = [];
      opacity *= Number(s.opacity);
      displayed &&= s.display !== "none" && s.visibility === "visible";
      if ([s.transform, s.translate, s.rotate, s.scale, s.perspective].some(value => value && value !== "none"))
        reasons.push("transformed coordinate chain");
      if (s.zoom && s.zoom !== "normal" && Number(s.zoom) !== 1) reasons.push("CSS zoom");
      if (s.clipPath && s.clipPath !== "none") reasons.push("clip-path");
      if (s.clip && s.clip !== "auto") reasons.push("legacy clip");
      if (s.maskImage && s.maskImage !== "none") reasons.push("mask");
      if (s.filter && s.filter !== "none") reasons.push("filter");
      if (/(^|\s)(paint|strict|content)(\s|$)/.test(s.contain)) reasons.push("paint containment");
      const x = clipPattern.test(s.overflowX), y = clipPattern.test(s.overflowY);
      item.clipAxes = { x, y }; item.client = null; item.clientBasis = null;
      if (x || y) {
        const bars = win.getComputedStyle(node, "::-webkit-scrollbar");
        const borderless = [s.borderLeftWidth, s.borderRightWidth, s.borderTopWidth, s.borderBottomWidth]
          .every(value => Number.parseFloat(value) === 0);
        const nativeBars = ["auto", "thin"].includes(s.scrollbarWidth) && bars.width === "auto" && bars.height === "auto";
        // Reuse ONLY the already-calibrated observer's exact borderless/native
        // no-layout-gutter branch. No guessed border/gutter or rounded-arc math.
        const exact = node instanceof win.HTMLElement && item.fragmentCount === 1 && borderless
          && item.clientLeft === 0 && item.clientTop === 0 && item.offsetWidth === item.clientWidth
          && item.offsetHeight === item.clientHeight && s.scrollbarGutter === "auto"
          && (s.scrollbarWidth === "none" || nativeBars);
        item.client = exact ? item.raw : rect({ left: item.raw.left + item.clientLeft,
          top: item.raw.top + item.clientTop, right: item.raw.left + item.clientLeft + item.clientWidth,
          bottom: item.raw.top + item.clientTop + item.clientHeight });
        item.clientBasis = exact ? "fractional-borderless-padding-box" : "integer-client-UNASSESSED";
        if (!exact) reasons.push("client precision outside bounded ordinary-copy observer");
        if ([s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius]
          .some(value => !zeroRadius(value))) reasons.push("rounded clipping is not proved by this observer");
        if ((s.overflowX === "clip" || s.overflowY === "clip") && s.overflowClipMargin && s.overflowClipMargin !== "0px")
          reasons.push("nondefault overflow-clip-margin");
        clip = rect({ left: x ? Math.max(clip.left, item.client.left) : clip.left,
          right: x ? Math.min(clip.right, item.client.right) : clip.right,
          top: y ? Math.max(clip.top, item.client.top) : clip.top,
          bottom: y ? Math.min(clip.bottom, item.client.bottom) : clip.bottom });
      }
      if (reasons.length) unsupported.push({ element: item.element, reasons });
      ancestors.push(item);
      if (node.matches(":modal,:popover-open")) break;
    }
    return { raw, clip, visible: intersection(raw, clip), displayed, opacity, ancestors, unsupported };
  };
  const topAt = (x, y) => {
    let node = doc.elementFromPoint(x, y);
    for (;;) {
      const next = node?.shadowRoot?.elementFromPoint?.(x, y);
      if (!next || next === node) return node;
      node = next;
    }
  };
  const points = box => {
    const x = (box.left + box.right) / 2, y = (box.top + box.bottom) / 2;
    const dx = Math.min(1, box.width / 4), dy = Math.min(1, box.height / 4);
    return [[x, y], [box.left + dx, y], [box.right - dx, y], [x, box.top + dy], [x, box.bottom - dy]];
  };
  const { focus, launcher, ownerSelector, selectors, primarySelector } = options;
  const panel = launcher?.parentElement, shell = owner.closest(".application-creative");
  const expectedOwner = owner.isConnected && doc.querySelectorAll(ownerSelector).length === 1 && doc.querySelector(ownerSelector) === owner;
  const expectedLauncher = Boolean(launcher?.isConnected && launcher.matches("button.forma-assistant-launcher")
    && panel?.matches("forma-assistant-panel") && panel.closest(".application-creative") === shell
    && doc.querySelectorAll("forma-assistant-panel > button.forma-assistant-launcher").length === 1
    && doc.querySelector("forma-assistant-panel > button.forma-assistant-launcher") === launcher);
  const active = doc.activeElement === focus && focus?.matches(":focus-visible") && owner.contains(focus);
  const issues = [], unassessed = [], observedObstructions = [], rawIntersections = [];
  if (!expectedOwner || !expectedLauncher || !active) issues.push("current owner/launcher/native focus identity changed");
  if (doc.querySelectorAll(":modal,:popover-open").length) issues.push("ordinary-copy frame still has a native top layer");
  if (!expectedLauncher) return { schema: "ordinary-copy-range-r1", issues, unassessed, observedObstructions, rawIntersections };
  const launcherGeometry = geometry(launcher, rect(launcher.getBoundingClientRect()));
  const launcherStyle = readStyle(launcher), panelStyle = readStyle(panel);
  const fillIsOpaque = opaque(launcherStyle.backgroundColor) && launcherStyle.backgroundImage === "none"
    && launcherGeometry.opacity === 1;
  if (panelStyle.position !== "fixed" || panel.dataset.studioLauncher === "true")
    issues.push("ordinary page does not have the expected floating Assistant owner");
  if (!launcherGeometry.displayed || !positive(launcherGeometry.visible)) issues.push("current launcher is not visibly laid out");
  if (launcherGeometry.unsupported.length) unassessed.push({ kind: "launcher-geometry", details: launcherGeometry.unsupported });
  const elements = [...new Set(selectors.flatMap(selector => [...owner.querySelectorAll(selector)]))];
  const primaryNodes = [...owner.querySelectorAll(primarySelector)];
  if (primaryNodes.length !== 1) issues.push("primary ordinary-copy target must be unique");
  const copy = elements.map((element, index) => {
    const style = readStyle(element), walker = doc.createTreeWalker(element, win.NodeFilter.SHOW_TEXT), fragments = [];
    const elementGeometry = geometry(element, rect(element.getBoundingClientRect()));
    if (!element.textContent.trim() || !elementGeometry.displayed || !(elementGeometry.opacity > 0) || transparent(style.color))
      issues.push({ kind: "selected ordinary copy is empty or style-hidden", copyIndex: index, element: describe(element) });
    let textIndex = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || node.parentElement.closest("script,style,svg,.forma-icon")) continue;
      const range = doc.createRange(); range.selectNodeContents(node);
      for (const value of range.getClientRects()) {
        const raw = rect(value); if (!positive(raw)) continue;
        const measured = geometry(node.parentElement, raw), visible = measured.visible;
        const inViewport = positive(intersection(raw, viewport));
        const hasVisibleLayout = measured.displayed && measured.opacity > 0 && positive(visible)
          && !transparent(win.getComputedStyle(node.parentElement).color);
        const identity = { copyIndex: index, textIndex, fragmentIndex: fragments.length };
        const fragment = { ...identity, raw, visible, clip: measured.clip, hasVisibleLayout,
          ancestors: measured.ancestors, unsupported: measured.unsupported, midpointHit: null, overlap: null };
        if (inViewport && measured.unsupported.length) unassessed.push({ kind: "copy-geometry", ...identity, details: measured.unsupported });
        if (hasVisibleLayout) {
          const textStyle = win.getComputedStyle(node.parentElement);
          if (textStyle.textShadow !== "none" || textStyle.writingMode !== "horizontal-tb")
            unassessed.push({ kind: "copy-paint-extent", ...identity, textShadow: textStyle.textShadow, writingMode: textStyle.writingMode });
          const mid = topAt((visible.left + visible.right) / 2, (visible.top + visible.bottom) / 2);
          fragment.midpointHit = { top: describe(mid), copyOwnerFirst: Boolean(mid && element.contains(mid)) };
          const overlap = intersection(visible, launcherGeometry.visible);
          if (positive(overlap)) {
            const hits = points(overlap).map(([x, y]) => {
              const top = topAt(x, y);
              return { x, y, top: describe(top), launcherFirst: Boolean(top && launcher.contains(top)),
                copyOwnerFirst: Boolean(top && element.contains(top)),
                stack: doc.elementsFromPoint(x, y).slice(0, 6).map(describe) };
            });
            fragment.overlap = { rectangle: overlap, hits, fillIsOpaque };
            rawIntersections.push({ ...identity, rectangle: overlap });
            if (hits.some(hit => hit.launcherFirst) && fillIsOpaque
              && measured.unsupported.length === 0 && launcherGeometry.unsupported.length === 0) {
              observedObstructions.push({ ...identity, rectangle: overlap, hits,
                meaning: "Opaque Assistant has a native top hit inside a visible nonempty text-node Range fragment; not glyph-ink area." });
            } else unassessed.push({ kind: "range-overlap-paint-order", ...identity, rectangle: overlap, hits, fillIsOpaque });
          }
        }
        fragments.push(fragment);
      }
      textIndex += 1;
    }
    return { index, element: describe(element), primary: element === primaryNodes[0], text: element.textContent.trim(),
      raw: rect(element.getBoundingClientRect()), style, fragments };
  });
  const primary = copy.filter(item => item.primary);
  const primaryFragments = primary.flatMap(item => item.fragments);
  const visiblePrimaryFragments = primaryFragments.filter(fragment => fragment.hasVisibleLayout).length;
  const primaryOutsideViewport = primary.length === 1 && primaryFragments.length > 0
    && primaryFragments.every(fragment => !positive(intersection(fragment.raw, viewport)));
  // Natural viewport absence must not conceal hidden, unknown, or clipped
  // ancestry. Prove this independently of the viewport from existing records.
  const primaryAncestrySupported = primaryFragments.length > 0
    && primaryFragments.every(fragment => fragment.unsupported.length === 0);
  const primaryStyleVisible = primaryFragments.length > 0 && primaryFragments.every(fragment =>
    fragment.ancestors.length > 0 && fragment.ancestors.every(ancestor =>
      ancestor.style.display !== "none" && ancestor.style.visibility === "visible" && Number(ancestor.style.opacity) > 0)
    && !transparent(fragment.ancestors[0].style.color));
  const primaryUnclippedByAncestors = primaryFragments.length > 0 && primaryFragments.every(fragment =>
    fragment.ancestors.every(ancestor =>
      (!ancestor.clipAxes.x || ancestor.client && fragment.raw.left >= ancestor.client.left && fragment.raw.right <= ancestor.client.right)
      && (!ancestor.clipAxes.y || ancestor.client && fragment.raw.top >= ancestor.client.top && fragment.raw.bottom <= ancestor.client.bottom)));
  const primaryControlOnly = options.allowPrimaryOffscreen === true && primaryOutsideViewport
    && primaryAncestrySupported && primaryStyleVisible && primaryUnclippedByAncestors;
  if (primaryOutsideViewport && (!primaryAncestrySupported || !primaryStyleVisible || !primaryUnclippedByAncestors))
    unassessed.push({ kind: "offscreen-primary-ancestry", supported: primaryAncestrySupported,
      styleVisible: primaryStyleVisible, unclippedByAncestors: primaryUnclippedByAncestors });
  if (primary.length !== 1 || !visiblePrimaryFragments && !primaryControlOnly)
    issues.push("primary ordinary copy has no measured visible text fragment; not a clearance pass");
  const animations = [...new Set([owner, panel].flatMap(node => node.getAnimations({ subtree: true })))]
    .filter(animation => animation.pending || animation.playState === "running")
    .map(animation => ({ playState: animation.playState, target: describe(animation.effect?.target),
      transitionProperty: animation.transitionProperty ?? null, animationName: animation.animationName ?? null }));
  if (animations.length) unassessed.push({ kind: "active-observed-owner-animation", animations });
  const nativeInventory = [...doc.querySelectorAll("a[href],button,input,textarea,select,summary,[role='button'],[contenteditable='true'],.output-requirement-warning,.output-recipe-entry,forma-ui-notice")]
    .filter(node => !panel.contains(node)).map(node => {
      const label = node.parentElement;
      const proxy = node instanceof win.HTMLInputElement && node.type === "file" && node.isConnected
        && label instanceof win.HTMLLabelElement && label.matches("label.button.file-button") && label.control === node
        && node.labels.length === 1 && node.labels[0] === label && Number(win.getComputedStyle(node).opacity) === 0
        && label.querySelectorAll("input,button,select,textarea,output,meter,progress").length === 1;
      const paint = proxy ? label : node;
      const measured = geometry(paint, rect(paint.getBoundingClientRect()));
      return { nativeOwner: describe(node), paintTarget: describe(paint), nativeFileLabel: proxy,
        disabled: node.matches(":disabled"), active: node === focus, ...measured };
    }).filter(item => positive(intersection(item.raw, viewport)));
  return { schema: "ordinary-copy-range-r1", checkedAt: new Date().toISOString(),
    url: doc.location.href, language: doc.documentElement.lang, direction: doc.documentElement.dir,
    viewport: { ...viewport, dpr: win.devicePixelRatio, scrollX: win.scrollX, scrollY: win.scrollY,
      visual: win.visualViewport ? { width: win.visualViewport.width, height: win.visualViewport.height,
        scale: win.visualViewport.scale, offsetLeft: win.visualViewport.offsetLeft, offsetTop: win.visualViewport.offsetTop } : null },
    current: { expectedOwner, expectedLauncher, active, focus: describe(focus), owner: describe(owner) },
    launcher: { ...launcherGeometry, style: launcherStyle, panelStyle, dataset: { ...panel.dataset },
      hovered: launcher.matches(":hover"), ownFocused: launcher.contains(doc.activeElement), fillIsOpaque,
      inlineOffset: panel.style.getPropertyValue("--forma-assistant-obstacle-offset") },
    selectors, primarySelector, primary: { visibleFragments: visiblePrimaryFragments, outsideViewport: primaryOutsideViewport,
      offscreenEligibility: { supportedAncestry: primaryAncestrySupported, styleVisible: primaryStyleVisible,
        unclippedByAncestors: primaryUnclippedByAncestors },
      disposition: primaryControlOnly ? "UNOBSERVED primary: naturally outside the shallow control viewport; only actually visible neighboring copy is checked"
        : visiblePrimaryFragments ? "OBSERVED visible primary fragments" : "PREREQUISITE FAILED: no visible primary fragments" },
    copy, rawIntersections, observedObstructions, unassessed, issues, animations,
    nativeInventory, nativeInventoryDisposition: "Diagnostic current native controls/three existing critical regions, including disabled peers and actual file-label association. Not an additional all-control or critical-copy certification; selected focus uses the unchanged calibrated observer.",
    limits: ["Native text-node Range boxes include layout whitespace and are not glyph-ink pixels.",
      "Five finite native hit samples establish only sampled paint/hit ordering; no screenshot-only certification.",
      "Only actual current viewport fragments and these ordinary header/card selectors; offscreen copy is not certified.",
      "Pointer-events:none text remains in the geometry inventory; hit absence does not prove absent text paint.",
      "No decorative Assistant shadow/antialiasing/contrast/AT or whole-surface conformance claim.",
      "Unsupported clip/paint remains unassessed, never a passing approximation; no EPS or outward clip enlargement."] };
}
