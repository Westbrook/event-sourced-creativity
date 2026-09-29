/**
 * Read-only browser geometry observer for native accessibility regression checks.
 * Run only through a public Playwright Locator.evaluate call on the expected
 * native control. This function observes; it never focuses, scrolls, dispatches,
 * changes styles, or imports/reimplements Forma's placement routine.
 *
 * Reuses measureFormaD400PaneFocus / measureFormaLauncherFocus /
 * measureFormaTaskCopy preserved in D428-reused-browser-measurement-helpers.txt.
 * Body/outline rectangles, clipping intersections and finite hit samples are
 * evidence, not a pixel renderer or an assistive-technology certification.
 */
export function measureFormaFocusVisibility(target, options = {}) {
  const doc = target.ownerDocument, win = doc.defaultView;
  const failures = [], unassessed = [];
  const describe = element => element ? {
    tag: element.tagName, id: element.id || null,
    className: element.getAttribute("class"), role: element.getAttribute("role"),
    ariaLabel: element.getAttribute("aria-label"),
  } : null;
  const rectangle = element => {
    const r = element.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const rectFromEdges = r => ({ ...r, width: r.right - r.left, height: r.bottom - r.top });
  const positive = r => r.width > 0 && r.height > 0;
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const containsRect = (outer, inner) => inner.left >= outer.left && inner.right <= outer.right
    && inner.top >= outer.top && inner.bottom <= outer.bottom;
  const composedParent = element => element.assignedSlot || element.parentElement || element.getRootNode().host || null;
  const containsNode = (ancestor, element) => {
    for (let current = element; current; current = composedParent(current)) if (current === ancestor) return true;
    return false;
  };
  const ancestry = element => {
    const result = [];
    for (let current = element; current; current = composedParent(current)) {
      result.push(current);
      // Top-layer elements escape the clipping/transform of their DOM ancestors.
      // The boundary's own client area still clips its ordinary descendants.
      if (current.matches(":modal, :popover-open")) break;
    }
    return result;
  };
  const layer = element => ancestry(element).find(node => node.matches(":modal, :popover-open")) || null;
  const viewport = rectFromEdges({ left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight });
  const transparent = color => color === "transparent"
    || /^rgba\([^,]+,[^,]+,[^,]+,\s*0(?:\.0+)?\s*\)$/.test(color)
    || /\/\s*0(?:\.0+)?%?\s*\)$/.test(color);
  const clipPattern = /^(auto|scroll|hidden|clip|overlay)$/;

  const geometry = (element, envelope = rectangle(element)) => {
    const raw = rectangle(element), ownStyle = win.getComputedStyle(element);
    const clip = { ...viewport }, ancestors = [], unknown = [];
    const nodes = ancestry(element);
    let opacity = 1;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index], style = win.getComputedStyle(node);
      opacity *= Number(style.opacity);
      const unsupported = [];
      if ([style.transform, style.translate, style.rotate, style.scale, style.perspective]
        .some(value => value && value !== "none")) unsupported.push("transformed coordinate chain");
      if (style.zoom && style.zoom !== "normal" && Number(style.zoom) !== 1) unsupported.push("CSS zoom coordinate chain");
      if (style.clipPath && style.clipPath !== "none") unsupported.push("clip-path");
      if (style.clip && style.clip !== "auto") unsupported.push("legacy clip");
      if (style.maskImage && style.maskImage !== "none") unsupported.push("mask");
      if (/(^|\s)(paint|strict|content)(\s|$)/.test(style.contain)) unsupported.push("paint containment");
      if (style.filter && style.filter !== "none") unsupported.push("filter paint extent");
      const x = index > 0 && clipPattern.test(style.overflowX);
      const y = index > 0 && clipPattern.test(style.overflowY);
      let client = null, clientBasis = "integer-client", roundedProof = null;
      if (x || y) {
        const r = rectangle(node);
        client = rectFromEdges({ left: r.left + node.clientLeft, top: r.top + node.clientTop,
          right: r.left + node.clientLeft + node.clientWidth, bottom: r.top + node.clientTop + node.clientHeight });
        // client/offset dimensions are integers; a borderless, gutter-free
        // single box retains its fractional padding edge in the native DOMRect.
        const borderless = [style.borderLeftWidth, style.borderRightWidth, style.borderTopWidth, style.borderBottomWidth]
          .every(value => Number.parseFloat(value) === 0);
        if (borderless && node.getClientRects().length === 1 && node.clientLeft === 0 && node.clientTop === 0
          && node.offsetWidth === node.clientWidth && node.offsetHeight === node.clientHeight
          && style.scrollbarGutter === "auto") {
          const scrollbar = win.getComputedStyle(node, "::-webkit-scrollbar");
          const nativeScrollbar = ["auto", "thin"].includes(style.scrollbarWidth)
            && scrollbar.width === "auto" && scrollbar.height === "auto";
          if (style.scrollbarWidth === "none" || nativeScrollbar) {
            client = r;
            clientBasis = "fractional-borderless-padding-box";
          } else if (r.width !== node.clientWidth || r.height !== node.clientHeight) {
            unsupported.push("fractional client area with customized or unknown scrollbar");
          }
        }
        if (x) { clip.left = Math.max(clip.left, client.left); clip.right = Math.min(clip.right, client.right); }
        if (y) { clip.top = Math.max(clip.top, client.top); clip.bottom = Math.min(clip.bottom, client.bottom); }
        if ((style.overflowX === "clip" || style.overflowY === "clip")
          && style.overflowClipMargin && style.overflowClipMargin !== "0px") unsupported.push("nondefault overflow-clip-margin");
        const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius];
        const cornerShapes = ["corner-top-left-shape", "corner-top-right-shape", "corner-bottom-left-shape", "corner-bottom-right-shape"]
          .map(name => style.getPropertyValue(name));
        const finitePx = value => /^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(value) && Number.isFinite(Number.parseFloat(value));
        const radiusParts = radii.flatMap(value => value.trim().split(/\s+/));
        if (radii.some(value => /%|calc\(/.test(value))) unsupported.push("percentage/calculated rounded clipping");
        else if (radii.some(value => value.trim().split(/\s+/).length > 2) || !radiusParts.every(finitePx)) {
          unsupported.push("unsupported rounded clipping radius");
        } else {
          const radius = Math.max(0, ...radiusParts.map(Number.parseFloat));
          if (radius > 0 && (envelope.left < client.left + radius || envelope.right > client.right - radius)
            && (envelope.top < client.top + radius || envelope.bottom > client.bottom - radius)) {
            roundedProof = { radii, cornerShapes, radius, client:null, integerInset:null, inside:false };
            const borders = [style.borderLeftWidth, style.borderRightWidth, style.borderTopWidth, style.borderBottomWidth];
            const scrollbar = win.getComputedStyle(node, "::-webkit-scrollbar");
            const nativeScrollbar = style.scrollbarWidth === "none" || (["auto", "thin"].includes(style.scrollbarWidth)
              && scrollbar.width === "auto" && scrollbar.height === "auto");
            const nativeRects = node.getClientRects();
            const singleRect = nativeRects.length === 1 ? nativeRects[0] : null;
            const ordinaryChromiumBox = /(?:Chrome|Chromium)\//.test(win.navigator.userAgent)
              && node instanceof win.HTMLElement && node !== doc.documentElement && node !== doc.body
              && !/table/.test(style.display) && nativeRects.length === 1;
            const borderPixels = borders.map(Number.parseFloat);
            const [left, right, top, bottom] = borderPixels;
            const metrics = { clientLeft:node.clientLeft, clientTop:node.clientTop,
              clientWidth:node.clientWidth, clientHeight:node.clientHeight,
              offsetWidth:node.offsetWidth, offsetHeight:node.offsetHeight };
            const matchingRect = singleRect && Object.keys(r).every(key => Number.isFinite(r[key]) && singleRect[key] === r[key]);
            const exactPaddingBox = ordinaryChromiumBox && nativeScrollbar && !unsupported.length && !unknown.length
              && cornerShapes.every(value => value === "round")
              && style.overflowX === "hidden" && style.overflowY === "hidden" && style.scrollbarGutter === "auto"
              && borders.every(finitePx) && borderPixels.every(value => Number.isInteger(value) && value >= 0)
              && Object.values(metrics).every(value => Number.isInteger(value) && value >= 0) && Boolean(matchingRect)
              && r.width === r.right - r.left && r.height === r.bottom - r.top
              && r.width === metrics.offsetWidth && r.height === metrics.offsetHeight
              && metrics.clientLeft === left && metrics.clientTop === top
              && r.width === metrics.clientWidth + left + right && r.height === metrics.clientHeight + top + bottom;
            const paddingWitness = { exact:exactPaddingBox, raw:r, borders, borderPixels, metrics,
              rectCount:nativeRects.length, singleRect:singleRect ? Object.fromEntries(Object.keys(r).map(key => [key,singleRect[key]])) : null,
              overflowX:style.overflowX, overflowY:style.overflowY, scrollbarGutter:style.scrollbarGutter,
              scrollbarWidth:style.scrollbarWidth, scrollbar:{ width:scrollbar.width, height:scrollbar.height },
              ordinaryChromiumBox, nativeScrollbar, supportedChain:!unsupported.length && !unknown.length };
            roundedProof.paddingWitness = paddingWitness;
            if (x && y && ordinaryChromiumBox && cornerShapes.every(value => value === "round")
              && borders.every(finitePx) && nativeScrollbar && !unsupported.length && !unknown.length) {
              // Hidden overflow without a reserved gutter has exact padding
              // edges only when the native border/client/offset boxes agree.
              // Otherwise retain the one-pixel bound for independent rounding.
              const integerInset = clientBasis === "integer-client" && !exactPaddingBox ? 1 : 0;
              const proof = rectFromEdges({ left:Math.max(client.left + integerInset, r.left + left),
                right:Math.min(client.right - integerInset, r.right - right),
                top:Math.max(client.top + integerInset, r.top + top),
                bottom:Math.min(client.bottom - integerInset, r.bottom - bottom) });
              // Inner radii cannot exceed the largest computed outer radius.
              // This uniform-R rounded rectangle is a conservative convex
              // subset; all four envelope corners prove the ENTIRE envelope.
              const inside = 2 * radius <= proof.width && 2 * radius <= proof.height && containsRect(proof, envelope)
                && [[envelope.left,envelope.top],[envelope.right,envelope.top],
                  [envelope.left,envelope.bottom],[envelope.right,envelope.bottom]].every(([px,py]) => {
                  const dx = Math.max(proof.left + radius - px, 0, px - (proof.right - radius));
                  const dy = Math.max(proof.top + radius - py, 0, py - (proof.bottom - radius));
                  return dx * dx + dy * dy <= radius * radius;
                });
              roundedProof = { radii, cornerShapes, radius, client:proof, integerInset, paddingWitness, inside };
            }
            if (!roundedProof.inside) unsupported.push("rounded clipping near envelope");
          }
        }
      }
      if (unsupported.length) unknown.push({ element: describe(node), reasons: unsupported });
      if (x || y) ancestors.push({ element: describe(node), client, clientBasis, roundedProof, overflowX: style.overflowX, overflowY: style.overflowY,
        scrollTop: node.scrollTop, scrollLeft: node.scrollLeft, scrollHeight: node.scrollHeight, scrollWidth: node.scrollWidth });
    }
    const intersection = rectFromEdges(clip);
    const visible = rectFromEdges({ left: Math.max(raw.left, clip.left), top: Math.max(raw.top, clip.top),
      right: Math.min(raw.right, clip.right), bottom: Math.min(raw.bottom, clip.bottom) });
    return { element: describe(element), raw, visible, intersection, ancestors, unknown,
      topLayer: describe(layer(element)),
      paintedBox: element.isConnected && positive(raw) && positive(visible) && ownStyle.display !== "none"
        && ownStyle.visibility === "visible" && opacity > 0,
      opacity, visibility: ownStyle.visibility, pointerEvents: ownStyle.pointerEvents, boxShadow: ownStyle.boxShadow };
  };

  // Queries cross open shadow roots; assigned light DOM is deduplicated.
  const roots = [doc];
  for (let index = 0; index < roots.length; index += 1) {
    for (const element of roots[index].querySelectorAll("*")) if (element.shadowRoot) roots.push(element.shadowRoot);
  }
  const queryAll = selectors => [...new Set(roots.flatMap(root => selectors.flatMap(selector => [...root.querySelectorAll(selector)])))];
  const deepTopAt = (x, y) => {
    let element = doc.elementFromPoint(x, y);
    for (;;) {
      const next = element?.shadowRoot?.elementFromPoint?.(x, y);
      if (!next || next === element) return element;
      element = next;
    }
  };
  const samplePoints = r => {
    const dx = Math.min(2, r.width / 4), dy = Math.min(2, r.height / 4);
    const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
    // Side midpoints avoid calling the empty corners of a native round/pill
    // control an obstruction. Explicit overlay rectangles still cover corners.
    return [[x, r.top + dy], [r.right - dx, y], [x, r.bottom - dy], [r.left + dx, y], [x, y]];
  };
  const sample = (element, r) => samplePoints(r).map(([x, y]) => {
    const top = deepTopAt(x, y);
    return { x, y, targetFirst: Boolean(top && containsNode(element, top)), top: describe(top),
      stack: doc.elementsFromPoint(x, y).slice(0, 5).map(describe) };
  });

  // The only supported paint proxy is Forma's intentionally invisible native
  // file input inside its unique direct label. Focus ALWAYS belongs to INPUT.
  let paintTarget = target, paintProxy = null;
  if (options.nativeFileLabel === true) {
    const label = target.parentElement, inputStyle = win.getComputedStyle(target);
    const valid = target instanceof win.HTMLInputElement && target.type === "file"
      && target.isConnected && !target.matches(":disabled") && target.getClientRects().length === 1
      && Number(inputStyle.opacity) === 0 && label instanceof win.HTMLLabelElement
      && label.matches("label.file-button") && label.isConnected && label.control === target
      && target.labels.length === 1 && target.labels[0] === label
      && label.querySelectorAll("input,button,select,textarea,output,meter,progress").length === 1;
    paintProxy = { kind:"native-file-direct-label", valid, nativeOwner:describe(target), nativeRaw:rectangle(target),
      nativeOpacity:inputStyle.opacity, paintTarget:describe(label), paintTargetFocused:Boolean(label?.matches(":focus")) };
    if (valid) paintTarget = label;
    else failures.push({ code:"invalid-native-file-label-proxy", details:paintProxy });
  }
  const style = win.getComputedStyle(paintTarget), raw = rectangle(paintTarget);
  const focusVisible = target.matches(":focus-visible");
  const outlinePainted = !["none", "hidden"].includes(style.outlineStyle) && !transparent(style.outlineColor)
    && Number.parseFloat(style.outlineWidth) > 0;
  const extent = outlinePainted ? Math.max(0, Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)) : 0;
  const envelope = rectFromEdges({ left: raw.left - extent, top: raw.top - extent, right: raw.right + extent, bottom: raw.bottom + extent });
  const focusGeometry = geometry(paintTarget, envelope);
  const active = target.getRootNode().activeElement === target && target.matches(":focus");
  const hitSamples = positive(raw) ? sample(paintTarget, raw) : [];
  if (!active) failures.push({ code: "wrong-active-element", expected: describe(target), actual: describe(target.getRootNode().activeElement) });
  if (!focusGeometry.paintedBox) failures.push({ code: "target-not-painted" });
  if (!containsRect(focusGeometry.intersection, envelope)) failures.push({ code: "focus-envelope-clipped", envelope, intersection: focusGeometry.intersection });
  if (hitSamples.some(hit => !hit.targetFirst)) failures.push({ code: "target-hit-obstructed", samples: hitSamples.filter(hit => !hit.targetFirst) });
  if ((options.requireFocusVisible || paintProxy) && !focusVisible) failures.push({ code: "focus-visible-not-active" });
  if ((options.requireFocusVisible || paintProxy) && !outlinePainted && style.boxShadow === "none") unassessed.push({ code: "focus-paint-not-established", note: "Border/proxy/custom focus indicators require a separate measured owner." });
  if (style.outlineStyle === "auto") unassessed.push({ code: "native-auto-outline-paint" });
  if (style.boxShadow !== "none") unassessed.push({ code: "focus-shadow-paint", boxShadow: style.boxShadow });
  if (paintTarget.getClientRects().length !== 1) unassessed.push({ code: "fragmented-target" });
  if (win !== win.top) unassessed.push({ code: "cross-frame-outer-clipping" });
  if (win.visualViewport && Math.abs(win.visualViewport.scale - 1) > 0.000001) unassessed.push({ code: "pinch-scaled-viewport" });
  if (focusGeometry.unknown.length) unassessed.push({ code: "focus-complex-geometry", details: focusGeometry.unknown });

  const overlaySelectors = options.overlaySelectors || [".forma-assistant-launcher", ":popover-open", ":modal"];
  const overlayNodes = queryAll(overlaySelectors);
  const overlays = overlayNodes.map(element => ({ node: element, measurement: geometry(element) }));
  // This is a source-owned ordinary light-DOM proof, not a general paint-order
  // engine. In one native modal, a positive-z direct button is above a lower
  // direct header only when that header cannot contribute higher descendant
  // contexts or generated paint. Closed shadow trees remain outside coverage.
  const overlayPaintOrderProofs = [];
  const modalHeaderBelowFocusedButton = (element, area, header, measurement) => {
    if (element !== target || paintTarget !== target || area !== envelope
      || !(element instanceof win.HTMLButtonElement) || header.tagName !== "HEADER") return null;
    const card = element.parentElement, modal = card?.parentElement;
    if (!card || header.parentElement !== card || !(modal instanceof win.HTMLDialogElement) || !modal.matches(":modal")) return null;
    const proof = { kind: "native-modal-direct-header-below-positive-button", proven: false, scope: "observable-ordinary-light-dom-only",
      control: describe(element), header: describe(header), card: describe(card), modal: describe(modal),
      controlZ: null, headerZ: null, audit: [], rejected: [], geometryUnknown: measurement.unknown };
    const reject = (node, reason) => proof.rejected.push({ element: describe(node), reason });
    const integerZ = value => /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
    const controlStyle = win.getComputedStyle(element), headerStyle = win.getComputedStyle(header);
    proof.controlZ = integerZ(controlStyle.zIndex);
    proof.headerZ = headerStyle.zIndex === "auto" ? 0 : integerZ(headerStyle.zIndex);
    if (proof.controlZ === null || proof.controlZ <= 0) reject(element, "control has no strictly positive integer stacking level");
    if (proof.headerZ === null || proof.controlZ === null || proof.headerZ >= proof.controlZ) reject(header, "header is not at a strictly lower stacking level");
    if (!active || !focusVisible || !outlinePainted || element.matches(":disabled") || win !== win.top) {
      reject(element, "not the current enabled keyboard-focused painted top-document native button");
    }
    if (controlStyle.position !== "absolute" || headerStyle.position !== "relative") {
      reject(header, "unsupported direct-sibling positioning");
    }
    if (card.tagName !== "ARTICLE" || win.getComputedStyle(card).position !== "relative"
      || win.getComputedStyle(card).display !== "grid" || modal.children.length !== 1 || modal.firstElementChild !== card
      || card.querySelectorAll(":scope > header").length !== 1 || layer(element) !== modal || layer(header) !== modal
      || doc.querySelectorAll("dialog:modal").length !== 1) reject(card, "not the exact single native modal/grid-card/direct-header topology");
    if ([element, header, card, modal].some(node => node.getClientRects().length !== 1)) reject(card, "fragmented direct topology");
    if (focusGeometry.unknown.length || measurement.unknown.some(entry =>
      entry.reasons.some(reason => reason !== "rounded clipping near envelope"))) {
      reject(header, "geometry uncertainty other than retained subtractive header rounding");
    }

    const properties = ["display", "position", "z-index", "opacity", "visibility", "pointer-events", "transform", "translate", "rotate", "scale",
      "perspective", "transform-style", "filter", "backdrop-filter", "clip-path", "clip", "mask-image",
      "contain", "container-type", "content-visibility", "mix-blend-mode", "isolation", "will-change", "zoom", "view-transition-name"];
    const plain = { transform: "none", translate: "none", rotate: "none", scale: "none", perspective: "none",
      "transform-style": "flat", filter: "none", "backdrop-filter": "none", "clip-path": "none", clip: "auto", "mask-image": "none",
      contain: "none", "container-type": "normal", "content-visibility": "visible", "mix-blend-mode": "normal",
      isolation: "auto", "will-change": "auto", "view-transition-name": "none" };
    const ordinaryTags = new Set(["BUTTON", "ARTICLE", "DIALOG", "HEADER", "DIV", "SPAN", "P",
      "H1", "H2", "H3", "H4", "H5", "H6", "B", "STRONG", "EM", "I", "SMALL"]);
    const headerNodes = [header, ...header.querySelectorAll("*")];
    for (const node of [element, card, modal, ...headerNodes]) {
      const computed = win.getComputedStyle(node);
      const css = Object.fromEntries(properties.map(name => [name, computed.getPropertyValue(name)]));
      const inHeader = headerNodes.includes(node), descendant = inHeader && node !== header;
      const pseudo = ["::before", "::after"].map(selector => {
        const value = win.getComputedStyle(node, selector);
        return { selector, content: value.content, display: value.display, position: value.position, zIndex: value.zIndex };
      });
      // A single finite blur of the exact common modal's backdrop is behind
      // its own children; it does not reorder the audited header and button.
      // This does not admit foreground filter or any descendant backdrop effect.
      const modalBlur = node === modal ? /^blur\((\d+(?:\.\d+)?|\.\d+)px\)$/.exec(css["backdrop-filter"]) : null;
      const commonModalBackdropBlur = Boolean(modalBlur && Number.isFinite(Number(modalBlur[1])));
      proof.audit.push({ element: describe(node), inHeader, css, pseudo, commonModalBackdropBlur,
        lightRoot: node.getRootNode() === doc, openShadow: Boolean(node.shadowRoot), assignedSlot: Boolean(node.assignedSlot) });
      if (!(node instanceof win.HTMLElement) || !ordinaryTags.has(node.tagName) || !node.isConnected
        || node.ownerDocument !== doc || node.getRootNode() !== doc || node.shadowRoot || node.assignedSlot || node.hasAttribute("is")) {
        reject(node, "nonordinary, shadow, slotted, customized or stale observable subtree");
      }
      if (node !== modal && node.matches(":modal, :popover-open")) reject(node, "separate native top layer in audited subtree");
      if (Object.entries(plain).some(([name, expected]) => css[name] !== expected
          && !(name === "backdrop-filter" && commonModalBackdropBlur))
        || !["1", "normal"].includes(css.zoom) || Number(css.opacity) !== 1) reject(node, "unsupported paint/context effect");
      if (!["none", "contents"].includes(css.display) && css.visibility !== "visible") reject(node, "unsupported visibility");
      if (css.display === "contents") reject(node, "boxless subtree is not supported");
      if (pseudo.some(value => !["none", "normal"].includes(value.content) && value.display !== "none")) {
        reject(node, "generated pseudo-element paint is not certified");
      }
      if (descendant) {
        const z = css["z-index"] === "auto" ? 0 : integerZ(css["z-index"]);
        if (z === null || z > 0 || !["static", "relative", "absolute"].includes(css.position)) {
          reject(node, "higher or unsupported descendant stacking context");
        }
      }
    }
    // Clipping only subtracts from the audited lower header. Its raw rounded
    // diagnostics stay in the result; no body-hit sample establishes z-order.
    proof.proven = proof.rejected.length === 0;
    return proof;
  };
  // This separate proof orders only two exact native paint roots. A hit on the
  // focused button is not ring clearance: both atomic roots must be observed.
  // Any additional rendered root (including a closing popover) stays unknown.
  let renderedNativeInventory = null;
  const ownModalBelowFocusedAutoPopover = (element, area, overlay, measurement) => {
    if (element !== target || paintTarget !== target || area !== envelope
      || !(element instanceof win.HTMLButtonElement) || !(overlay instanceof win.HTMLElement)) return null;
    const popover = layer(element), modal = layer(overlay);
    if (!(popover instanceof win.HTMLElement) || popover.popover !== "auto" || !popover.matches(":popover-open")
      || !(modal instanceof win.HTMLDialogElement) || !modal.matches(":modal")
      || popover === modal || !modal.contains(popover)) return null;
    const proof = { kind: "native-auto-popover-above-own-modal-content", proven: false,
      scope: "two-rendered-native-roots-observable-light-dom-only", control: describe(element),
      overlay: describe(overlay), popover: describe(popover), modal: describe(modal),
      chains: [], renderedRoots: [], rootBoxes: [], witness: null, rejected: [],
      geometryUnknown: measurement.unknown };
    const reject = (node, reason) => proof.rejected.push({ element: describe(node), reason });
    if (!active || !focusVisible || !outlinePainted || element.matches(":disabled") || win !== win.top) {
      reject(element, "not the current enabled keyboard-focused painted top-document native button");
    }
    if (focusGeometry.unknown.length || measurement.unknown.length) reject(overlay, "unresolved target or overlay geometry");
    const modals = queryAll(["dialog:modal"]);
    if (!modal.open || modals.length !== 1 || modals[0] !== modal || doc.fullscreenElement) {
      reject(modal, "not the unique current native modal without fullscreen");
    }
    for (const start of [element, overlay]) {
      const chain = [];
      for (let node = start; node; node = node.parentElement) {
        const renderedOverlay = win.getComputedStyle(node).getPropertyValue("overlay");
        chain.push({ element: describe(node), overlay: renderedOverlay });
        if (!node.isConnected || node.ownerDocument !== doc || node.getRootNode() !== doc
          || node.shadowRoot || node.assignedSlot || node.tagName === "SLOT" || node.hasAttribute("is")) {
          reject(node, "noncurrent, shadow, slotted or customized owner chain");
        }
        if (renderedOverlay !== (node === popover || node === modal ? "auto" : "none")
          || node.matches(":fullscreen")) reject(node, "unrecognized rendered native layer in owner chain");
        if (node === modal) break;
      }
      proof.chains.push(chain);
      if (start.closest("dialog:modal") !== modal) reject(start, "owner chain does not terminate in the same current modal");
    }
    // A selected lower overlay cannot smuggle an unobservable native root in
    // a custom/shadow subtree. Unrelated closed shadow trees remain a limit.
    for (const node of [overlay, ...overlay.querySelectorAll("*")]) {
      if (node.getRootNode() !== doc || node.shadowRoot || node.assignedSlot || node.tagName === "SLOT"
        || node.localName.includes("-") || node.hasAttribute("is")) reject(node, "nonordinary observable overlay subtree");
    }
    if (!renderedNativeInventory) renderedNativeInventory = queryAll(["*"])
      .map(node => ({ node, value: win.getComputedStyle(node).getPropertyValue("overlay") }))
      .filter(entry => entry.value !== "none");
    proof.renderedRoots = renderedNativeInventory.map(({ node, value }) => ({ element: describe(node), overlay: value,
      popover: node.popover ?? null, popoverOpen: node.matches(":popover-open"), modal: node.matches(":modal") }));
    if (renderedNativeInventory.length !== 2
      || ![popover, modal].every(root => renderedNativeInventory.some(entry => entry.node === root && entry.value === "auto"))) {
      reject(modal, "additional, pending-removal or unsupported rendered native layer");
    }
    const finitePx = value => /^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(value) && Number.isFinite(Number.parseFloat(value));
    const safeBoxes = [popover, modal].map(root => {
      const measured = geometry(root), computed = win.getComputedStyle(root);
      const radii = [computed.borderTopLeftRadius, computed.borderTopRightRadius, computed.borderBottomLeftRadius, computed.borderBottomRightRadius];
      const corners = ["corner-top-left-shape", "corner-top-right-shape", "corner-bottom-left-shape", "corner-bottom-right-shape"]
        .map(name => computed.getPropertyValue(name));
      const parts = radii.flatMap(value => value.trim().split(/\s+/));
      const supported = radii.every(value => value.trim().split(/\s+/).length <= 2) && parts.every(finitePx)
        && corners.every(value => value === "round");
      const radius = supported ? Math.max(0, ...parts.map(Number.parseFloat)) : NaN;
      const box = measured.raw;
      const safe = rectFromEdges({ left: box.left + radius, top: box.top + radius,
        right: box.right - radius, bottom: box.bottom - radius });
      proof.rootBoxes.push({ element: describe(root), raw: box, safe: supported ? safe : null, radii, corners,
        pointerEvents: computed.pointerEvents, geometryUnknown: measured.unknown });
      if (!supported || !positive(safe) || !measured.paintedBox || measured.unknown.length
        || root.getClientRects().length !== 1 || computed.pointerEvents !== "auto") {
        reject(root, "native root has no supported single hittable interior");
      }
      return safe;
    });
    if (!proof.rejected.length) {
      const common = rectFromEdges({ left: Math.max(viewport.left, ...safeBoxes.map(box => box.left)),
        top: Math.max(viewport.top, ...safeBoxes.map(box => box.top)),
        right: Math.min(viewport.right, ...safeBoxes.map(box => box.right)),
        bottom: Math.min(viewport.bottom, ...safeBoxes.map(box => box.bottom)) });
      if (!positive(common)) reject(popover, "native roots have no common observed interior");
      else {
        const x = (common.left + common.right) / 2, y = (common.top + common.bottom) / 2;
        const stack = doc.elementsFromPoint(x, y), popoverIndex = stack.indexOf(popover), modalIndex = stack.indexOf(modal);
        proof.witness = { x, y, common, popoverIndex, modalIndex, stack: stack.map(describe) };
        if (popoverIndex < 0 || modalIndex < 0 || popoverIndex !== stack.lastIndexOf(popover)
          || modalIndex !== stack.lastIndexOf(modal) || popoverIndex >= modalIndex) {
          reject(popover, "both exact atomic roots are not uniquely observed in descending paint order");
        }
      }
    }
    proof.proven = proof.rejected.length === 0;
    return proof;
  };
  const collisions = (element, area) => overlays.flatMap(({ node, measurement }) => {
    if (containsNode(node, element) || containsNode(element, node) || !measurement.paintedBox || !overlap(area, measurement.visible)) return [];
    const elementLayer = layer(element), overlayLayer = layer(node);
    if (elementLayer && !overlayLayer) return []; // Ordinary DOM cannot paint above the native top layer.
    const nativeOrder = ownModalBelowFocusedAutoPopover(element, area, node, measurement);
    if (nativeOrder) {
      overlayPaintOrderProofs.push(nativeOrder);
      if (nativeOrder.proven) return [];
    }
    const paintOrder = modalHeaderBelowFocusedButton(element, area, node, measurement);
    if (paintOrder) {
      overlayPaintOrderProofs.push(paintOrder);
      if (paintOrder.proven) return [];
    }
    const intersection = rectFromEdges({ left: Math.max(area.left, measurement.visible.left), top: Math.max(area.top, measurement.visible.top),
      right: Math.min(area.right, measurement.visible.right), bottom: Math.min(area.bottom, measurement.visible.bottom) });
    const elementBox = rectangle(element);
    const bodyIntersection = rectFromEdges({ left: Math.max(elementBox.left, intersection.left), top: Math.max(elementBox.top, intersection.top),
      right: Math.min(elementBox.right, intersection.right), bottom: Math.min(elementBox.bottom, intersection.bottom) });
    const probe = positive(bodyIntersection) ? bodyIntersection : intersection;
    const top = deepTopAt((probe.left + probe.right) / 2, (probe.top + probe.bottom) / 2);
    // An actual overlay hit inside the body proves that sampled obstruction.
    // A ring-only collision, pointer-transparent overlay, or unknown paint order
    // remains unassessed; a bounding rectangle alone never proves z-order.
    return [{ overlay: measurement.element, intersection, geometryUnknown: measurement.unknown,
      observedBodyObstruction: positive(bodyIntersection) && Boolean(top && containsNode(node, top)), topAtIntersection: describe(top) }];
  });
  const recordCollisions = (code, element, entries) => {
    const observed = entries.filter(entry => entry.observedBodyObstruction);
    const uncertain = entries.filter(entry => !entry.observedBodyObstruction);
    if (observed.length) failures.push({ code, element: describe(element), collisions: observed });
    if (uncertain.length) unassessed.push({ code: `${code}-paint-order`, element: describe(element), collisions: uncertain });
  };
  const focusCollisions = collisions(paintTarget, envelope);
  recordCollisions("focus-overlay-collision", paintTarget, focusCollisions);

  const regionSelectors = options.regionSelectors || [];
  const regions = queryAll(regionSelectors).map(element => {
    const result = geometry(element), regionCollisions = result.paintedBox ? collisions(element, result.visible) : [];
    recordCollisions("visible-task-region-overlay-collision", element, regionCollisions);
    if (result.paintedBox && result.unknown.length) unassessed.push({ code: "region-complex-geometry", region: result.element, details: result.unknown });
    return { ...result, text: element.textContent.trim().slice(0, 400), collisions: regionCollisions };
  });
  const controls = options.checkVisibleControls ? queryAll(["a[href],button,input,textarea,select,summary,[role='button'],[contenteditable='true']"])
    .filter(element => !ancestry(element).some(node => node.tagName === "FORMA-ASSISTANT-PANEL"))
    .map(element => {
      const result = geometry(element), controlCollisions = result.paintedBox ? collisions(element, result.visible) : [];
      recordCollisions("visible-native-control-overlay-collision", element, controlCollisions);
      // Other controls are checked for foreign-overlay obstruction, not their
      // complete focus/paint conformance. Rounded clipping can only subtract
      // from this conservative rectangle. With no overlay overlap, that one
      // uncertainty cannot hide a collision; retain it visibly in the report.
      // Do not extend this allowance to filters/transforms/unknown paint bounds.
      const roundedClipOnly = result.unknown.length > 0 && result.unknown.every(item =>
        item.reasons.every(reason => reason === "rounded clipping near envelope"));
      const boundedNoOverlay = element !== target && roundedClipOnly && controlCollisions.length === 0
        && overlays.every(({ measurement }) => measurement.unknown.length === 0);
      if (result.paintedBox && result.unknown.length && !boundedNoOverlay) {
        unassessed.push({ code: "control-complex-geometry", control: result.element, details: result.unknown });
      }
      return { ...result, collisions: controlCollisions,
        overlayAssessment: boundedNoOverlay ? "no-foreign-overlay-overlap-with-conservative-box" : "ordinary-geometry-check" };
    }).filter(result => result.paintedBox) : [];

  return { schema: "forma-dom-focus-visibility-r1", stage: options.stage || null, checkedAt: new Date().toISOString(),
    url: doc.location.href, lang: doc.documentElement.lang, dir: doc.documentElement.dir,
    viewport: { ...viewport, dpr: win.devicePixelRatio, visual: win.visualViewport ? {
      width: win.visualViewport.width, height: win.visualViewport.height, scale: win.visualViewport.scale,
      offsetLeft: win.visualViewport.offsetLeft, offsetTop: win.visualViewport.offsetTop } : null },
    focus: { ...focusGeometry, active, documentHasFocus: doc.hasFocus(), focusVisible, outline: style.outline, outlineOffset: style.outlineOffset,
      outlineExtent: extent, envelope, hitSamples, collisions: focusCollisions, ...(paintProxy ? { paintProxy } : {}) },
    coverage: { overlaySelectors, regionSelectors, checkVisibleControls: Boolean(options.checkVisibleControls),
      otherControls: "Foreign-overlay obstruction only; rounded clipping disjoint from all overlays is retained but not a failure.",
      openShadowRoots: roots.length - 1 },
    overlays: overlays.map(({ measurement }) => measurement), overlayPaintOrderProofs, regions, controls, failures, unassessed,
    limits: ["Finite body hit samples plus explicit overlay rectangle checks; not exhaustive pixel paint order.",
      "Decorative overlay shadows outside border boxes and pseudo-elements are not certified.",
      "A current positive-z direct native modal button can discharge an audited lower ordinary sibling header; raw rounded diagnostics remain.",
      "An exact auto-popover can discharge own-modal content only with two known rendered native roots and their observed atomic-root order; other layers remain unassessed.",
      "Native-root order is not sampled ring-pixel clearance; known geometry and all other collision/paint guards remain independent.",
      "Focused-control/critical-region complex geometry and non-none target shadows cannot become an automatic pass.",
      "Round-corner proofs use a conservative inner rectangle for ordinary Chromium boxes; unsupported shapes, axes and scrollbars remain unassessed.",
      "Other controls' unresolved clipping-only rounded corners are not certified; disjoint conservative overlay boxes can be cleared.",
      "Closed shadow trees, native select pickers, assistive technology and browser chrome need their own evidence.",
      "Raw values, DOM/source ownership, side effects and keyboard event delivery remain caller assertions."],
    pass: failures.length === 0 && unassessed.length === 0 };
}
