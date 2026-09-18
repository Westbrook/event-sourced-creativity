import { test, expect, attachJSON, browserMetrics, applyBrowserZoom, captureViewport } from "./fixtures.mjs";
import { tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";
import { measureFormaFocusVisibility } from "../helpers/forma-dom-focus-visibility.mjs";

const copy = {
  en: { focus: "Focus view", exit: "Exit focus", close: "Close", canvasClose: "Close document output",
    more: "More actions", inspect: "Inspect inputs", read: "Read slide", visual: "Slide view", openShared: "Slideshow",
    previous: "Previous", next: "Next", tools: "Slideshow controls", jump: "Jump to slide", style: "Slide style",
    list: "List", present: "Present slide" },
  fr: { focus: "Vue ciblée", exit: "Quitter le mode concentration", close: "Fermer", canvasClose: "Fermer le résultat du document",
    more: "Plus d’actions", inspect: "Examiner les entrées", read: "Lire la diapositive", visual: "Vue Diapositive", openShared: "Diaporama",
    previous: "Précédent", next: "Suivant", tools: "Commandes du diaporama", jump: "Aller à la diapositive", style: "Style de diapositive",
    list: "Liste", present: "Présenter la diapositive" },
};
const targets = {
  shared: { owner: "#shared > forma-shared-view", opener: ".shared-presentation-open",
    dialog: "dialog.shared-presentation-dialog", card: ".shared-presentation-card",
    focus: ".shared-presentation-focus-toggle", close: ".shared-presentation-actions > button:last-child",
    header: ":scope > .shared-presentation-card > header",
    obstacles: ["> .shared-presentation-card > header", "> .shared-presentation-card > .shared-presentation-stage",
      "> .shared-presentation-card > .shared-presentation-stage > nav"] },
  document: { owner: "#shared > forma-document-artifacts", opener: ".document-artifact-list > button[data-forma-content=primary]",
    dialog: "dialog.document-artifact-view[data-artifact-kind=slides]", card: ".document-artifact-reader",
    focus: ".artifact-viewer-focus-toggle", close: ".document-artifact-reader-actions > button:last-child",
    header: ":scope > .document-artifact-reader > .artifact-viewer-header",
    obstacles: ["> .document-artifact-reader > .artifact-viewer-header", "> .document-artifact-reader > footer",
      "> .document-artifact-reader > .document-artifact-reader-content > forma-presentation-deck > .presentation-deck > .presentation-deck-toolbar",
      "> .document-artifact-reader > .document-artifact-reader-content > forma-presentation-deck > .presentation-deck > .presentation-deck-stage > nav",
      "> .document-artifact-reader > .document-artifact-reader-content > forma-presentation-deck > .presentation-deck > .presentation-deck-stage > .presentation-deck-supporting"] },
  canvas: { owner: "#shared > forma-canvas-application > forma-canvas-surface", opener: ".canvas-artifact-open",
    dialog: "dialog.canvas-artifact-viewer[data-artifact-kind=slides]", card: ".canvas-artifact-viewer-card",
    focus: ":scope > .canvas-artifact-viewer-card > .canvas-viewer-focus-toggle",
    close: ":scope > .canvas-artifact-viewer-card > .modal-close", header: ":scope > .canvas-artifact-viewer-card > header",
    obstacles: ["> .canvas-artifact-viewer-card > header", "> .canvas-artifact-viewer-card > footer",
      "> .canvas-artifact-viewer-card > .canvas-artifact-viewer-content > forma-presentation-deck > .presentation-deck > .presentation-deck-toolbar",
      "> .canvas-artifact-viewer-card > .canvas-artifact-viewer-content > forma-presentation-deck > .presentation-deck > .presentation-deck-stage > nav",
      "> .canvas-artifact-viewer-card > .canvas-artifact-viewer-content > forma-presentation-deck > .presentation-deck > .presentation-deck-stage > .presentation-deck-supporting"] },
};
const fixtureSnapshot = page => page.evaluate(() => globalThis.formaIsolatedPresentation?.snapshot() ?? null);
const defaults = [".forma-assistant-launcher", ":popover-open", ":modal"];

// Diagnostic layout only; the unchanged calibrated focus observer owns all
// modal clipping, outline, body-hit and explicit-overlay acceptance decisions.
function viewerLayout(dialog, selectors) {
  const doc = dialog.ownerDocument, win = doc.defaultView;
  const box = node => {
    const style = win.getComputedStyle(node);
    return { tag: node.tagName, className: node.className, text: node.textContent,
      rect: node.getBoundingClientRect().toJSON(), position: style.position, zIndex: style.zIndex,
      pointerEvents: style.pointerEvents, display: style.display, visibility: style.visibility, backgroundColor: style.backgroundColor,
      overflowX: style.overflowX, overflowY: style.overflowY, overflowClipMargin: style.overflowClipMargin,
      scrollLeft: node.scrollLeft, scrollTop: node.scrollTop,
      gridTemplateRows: style.gridTemplateRows, flexDirection: style.flexDirection,
      clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight };
  };
  const header = dialog.querySelector(selectors.header), heading = header?.querySelector("h2");
  const range = heading ? doc.createRange() : null;
  if (range) range.selectNodeContents(heading);
  return { checkedAt: new Date().toISOString(), nativeModal: dialog instanceof win.HTMLDialogElement && dialog.matches(":modal"),
    dataOutputFocus: dialog.getAttribute("data-output-focus"), dialog: box(dialog),
    card: box(dialog.querySelector(":scope > " + selectors.card)), header: header ? box(header) : null,
    heading: heading ? { text: heading.textContent, dir: heading.getAttribute("dir"),
      rawRanges: [...range.getClientRects()].map(rect => rect.toJSON()) } : null,
    focus: box(dialog.querySelector(selectors.focus)), close: box(dialog.querySelector(selectors.close)),
    obstacles: (selectors.obstacles ?? []).map(path => {
      const nodes = [...dialog.querySelectorAll(":scope " + path)], node = nodes[0];
      return { path, count: nodes.length, current: nodes.length === 1 && node.isConnected && node.closest("dialog:modal") === dialog,
        geometry: node ? box(node) : null };
    }),
    limit: "Separately timed DOM boxes/raw ranges are diagnostic, not simultaneous screenshot, glyph, contrast, full-copy or paint-order certification." };
}

// Public rendered reading state only; no scroll/focus assignment or glyph-fit oracle.
function readingLayout(node) {
  const doc = node.ownerDocument, win = doc.defaultView, style = win.getComputedStyle(node);
  const dialog = node.closest("dialog:modal"), article = node.querySelector(":scope > article");
  return { checkedAt: new Date().toISOString(), connected: node.isConnected, tag: node.tagName, className: node.className,
    active: doc.activeElement === node, focusVisible: node.matches(":focus-visible"), tabIndex: node.tabIndex,
    nativeModal: dialog instanceof win.HTMLDialogElement && dialog.matches(":modal"),
    text: node.textContent, heading: article?.querySelector("h3")?.textContent, articleLabel: article?.getAttribute("aria-label"),
    raw: node.getBoundingClientRect().toJSON(), articleRaw: article?.getBoundingClientRect().toJSON(),
    clientWidth: node.clientWidth, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth,
    scrollHeight: node.scrollHeight, scrollLeft: node.scrollLeft, scrollTop: node.scrollTop,
    overflowX: style.overflowX, overflowY: style.overflowY,
    limit: "Separately timed native scroll bounds and complete DOM text; no script scrolling, glyph-fit or full reading-accessibility certification." };
}

// These are the current Document header's four ordinary light-DOM text owners.
// Region boxes alone do not prove that their own clipped/ellipsized text fits.
async function verifyDocumentNormalHeaderCopy({ page, dialog, focus, selectors, testInfo, custody }) {
  const stage = "isolated-03a-document-normal-header-copy";
  const paths = [
    "> .artifact-viewer-identity > h2",
    "> .artifact-viewer-identity > .artifact-viewer-kicker > span",
    "> .artifact-viewer-identity > .artifact-viewer-kicker > .artifact-review-status",
    "> .artifact-viewer-identity > details.artifact-viewer-details > summary",
  ];
  const header = dialog.locator(selectors.header);
  await expect(dialog).toHaveAttribute("data-output-focus", "false");
  await expect(header).toHaveCount(1);
  for (const path of paths) await expect(header.locator(":scope " + path)).toHaveCount(1);
  await expect(header.locator(":scope > .artifact-viewer-identity > h2")).toHaveText("Shared protected presentation");
  await expect(focus).toBeFocused();
  await custody(stage + "-before");
  const reference = await focus.evaluateHandle((target, paths) => {
    const dialog = target.closest("dialog.document-artifact-view:modal");
    const header = dialog?.querySelector(":scope > .document-artifact-reader > .artifact-viewer-header");
    if (!dialog || !header) throw new Error("Current native Document header is unavailable");
    const identity = header.querySelector(":scope > .artifact-viewer-identity");
    const actionGroup = header.querySelector(":scope > .document-artifact-reader-actions");
    const nodes = paths.map(path => header.querySelector(":scope " + path));
    if (!identity || !actionGroup || nodes.some(node => !node)) throw new Error("Current header subtree is unavailable");
    const chains = nodes.map(node => {
      const chain = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        chain.push(parent); if (parent === header) break;
      }
      return chain;
    });
    const peers = [...new Set([...nodes, ...nodes.flatMap(node => [...node.children]), ...chains.flat(), actionGroup])];
    const detailsBody = nodes[3].parentElement.querySelector(":scope > div");
    return { target, dialog, header, paths, owner: dialog.closest("forma-document-artifacts"), identity, nodes, chains, peers, actionGroup, detailsBody,
      actions: [...actionGroup.querySelectorAll(":scope > button")] };
  }, paths);
  const read = reference => {
    const { target, dialog, header, identity, owner, nodes, actions, paths, chains, peers, actionGroup, detailsBody } = reference;
    const doc = target.ownerDocument, win = doc.defaultView;
    const rect = node => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const transparent = color => color === "transparent"
      || /^rgba\([^,]+,[^,]+,[^,]+,\s*0(?:\.0+)?\s*\)$/.test(color)
      || /\/\s*0(?:\.0+)?%?\s*\)$/.test(color);
    const styleEvidence = node => {
      const style = win.getComputedStyle(node), unsupported = [];
      const styles = Object.fromEntries(["display", "visibility", "opacity", "color", "webkitTextFillColor", "textShadow",
        "overflowX", "overflowY", "whiteSpace", "textOverflow", "webkitLineClamp", "webkitBoxOrient", "writingMode", "contentVisibility",
        "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "overflowWrap", "wordBreak",
        "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
        "position", "zIndex", "cssFloat", "mixBlendMode", "backdropFilter", "isolation", "backgroundColor", "backgroundImage",
        "boxShadow", "outlineStyle", "outlineWidth", "outlineOffset", "borderImageSource",
        "borderLeftWidth", "borderRightWidth", "borderTopWidth", "borderBottomWidth",
        "transform", "translate", "rotate", "scale", "perspective", "zoom", "filter", "clip", "clipPath", "maskImage", "contain"]
        .map(key => [key, style[key]]));
      if (style.display === "none" || style.visibility !== "visible" || !(Number(style.opacity) > 0)
        || transparent(style.color) || transparent(style.webkitTextFillColor)) unsupported.push("text owner is not visibly painted");
      if (style.writingMode !== "horizontal-tb" || style.contentVisibility !== "visible") unsupported.push("unsupported text layout posture");
      if ([style.transform, style.translate, style.rotate, style.scale, style.perspective, style.filter, style.clipPath, style.maskImage]
        .some(value => value && value !== "none") || style.zoom && style.zoom !== "normal" && Number(style.zoom) !== 1
        || style.clip && style.clip !== "auto" || /(^|\s)(paint|strict|content)(\s|$)/.test(style.contain)
        || style.textShadow !== "none") unsupported.push("unsupported text paint effect");
      const ownClip = [style.overflowX, style.overflowY].some(value => /^(auto|scroll|hidden|clip|overlay)$/.test(value));
      // Use the existing observer for ancestor clips. Own clipped text is
      // admitted only in the current single, zero-padding, borderless,
      // nonrounded hidden/clip box; a scrolling text owner is unsupported.
      // No second clipping engine or nonzero clip-margin approximation.
      if (ownClip && ([style.overflowX, style.overflowY].some(value => /^(auto|scroll|overlay)$/.test(value))
        || node.getClientRects().length !== 1 || node.clientLeft !== 0 || node.clientTop !== 0
        || node.offsetWidth !== node.clientWidth || node.offsetHeight !== node.clientHeight || style.scrollbarGutter !== "auto"
        || [style.borderLeftWidth, style.borderRightWidth, style.borderTopWidth, style.borderBottomWidth,
          style.paddingLeft, style.paddingRight, style.paddingTop, style.paddingBottom,
          style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius]
          .some(value => value !== "0px")
        || [style.overflowX, style.overflowY].includes("clip") && style.overflowClipMargin !== "0px")) {
        unsupported.push("unsupported own text clipping box");
      }
      const generated = ["::before", "::after"].map(pseudo => {
        const value = win.getComputedStyle(node, pseudo);
        return { pseudo, content: value.content, display: value.display };
      });
      if (generated.some(value => value.display !== "none" && !["none", "normal"].includes(value.content)))
        unsupported.push("generated text or paint is outside this fragment contract");
      const ordinaryUnsupported = [];
      if (!["static", "relative"].includes(style.position) || style.zIndex !== "auto" || style.cssFloat !== "none")
        ordinaryUnsupported.push("out-of-flow or independently layered header paint");
      if (Number(style.opacity) !== 1 || style.mixBlendMode !== "normal" || style.backdropFilter !== "none" || style.isolation !== "auto")
        ordinaryUnsupported.push("group, blend or backdrop paint");
      if (style.boxShadow !== "none") ordinaryUnsupported.push("unbounded box shadow");
      if (style.borderImageSource !== "none") ordinaryUnsupported.push("unbounded border-image paint");
      if (!["none", "hidden"].includes(style.outlineStyle) && Number.parseFloat(style.outlineWidth) !== 0)
        ordinaryUnsupported.push("outline outside the peer body");
      if (style.display.includes("list-item")) ordinaryUnsupported.push("unmeasured marker paint");
      const plainBox = transparent(style.backgroundColor) && style.backgroundImage === "none" && style.borderImageSource === "none"
        && [style.borderLeftWidth, style.borderRightWidth, style.borderTopWidth, style.borderBottomWidth].every(value => value === "0px");
      return { styles, generated, unsupported, ordinaryUnsupported, plainBox };
    };
    const currentActions = [...header.querySelectorAll(":scope > .document-artifact-reader-actions > button")];
    const copies = nodes.map((node, index) => {
      const range = doc.createRange(); range.selectNodeContents(node);
      const children = [...node.children];
      const supportedTextShape = index === 2 ? node.tagName === "P" && children.length === 1
        && children[0].tagName === "B" && children[0].children.length === 0 : children.length === 0;
      return { path: paths[index], tag: node.tagName, className: node.getAttribute("class"), text: node.textContent,
        raw: rect(node), rawRanges: [...range.getClientRects()].map(r => ({ left: r.left, top: r.top, right: r.right,
          bottom: r.bottom, width: r.width, height: r.height })), supportedTextShape, ancestorIndexes: chains[index].map(node => peers.indexOf(node)),
        textOwners: [node, ...children].map(element => ({ tag: element.tagName, ...styleEvidence(element) })) };
    });
    const details = nodes[3].parentElement, kicker = nodes[1].parentElement;
    const exactChildren = (parent, expected) => parent.children.length === expected.length
      && [...parent.children].every((node, index) => node === expected[index]);
    const bodyStyle = detailsBody ? win.getComputedStyle(detailsBody) : null;
    // Closed native DETAILS can retain child layout. This exact ordinary body
    // must instead be unpainted under the default native visibility check.
    const detailsBodyEvidence = detailsBody ? {
      tag: detailsBody.tagName, nativeDiv: detailsBody instanceof win.HTMLDivElement,
      current: detailsBody.parentElement === details && details.querySelector(":scope > div") === detailsBody,
      display: bodyStyle.display, contentVisibility: bodyStyle.contentVisibility,
      clientRects: [...detailsBody.getClientRects()].map(r => ({ left: r.left, top: r.top, right: r.right,
        bottom: r.bottom, width: r.width, height: r.height })),
      checkVisibilityAvailable: typeof detailsBody.checkVisibility === "function",
      checkVisibility: typeof detailsBody.checkVisibility === "function" ? detailsBody.checkVisibility() : null,
    } : null;
    const ordinaryHeaderShapeParts = {
      headerChildren: exactChildren(header, [identity, actionGroup]),
      identityChildren: exactChildren(identity, [kicker, nodes[0], details]),
      kickerChildren: exactChildren(kicker, [nodes[1], nodes[2]]),
      detailsChildren: Boolean(detailsBody) && exactChildren(details, [nodes[3], detailsBody]),
      actionChildren: exactChildren(actionGroup, actions),
      detailsBodyCurrent: detailsBodyEvidence?.current === true,
      detailsBodyNativeDiv: detailsBodyEvidence?.nativeDiv === true,
      detailsBodyGrid: detailsBodyEvidence?.display === "grid",
      detailsBodyContentVisible: detailsBodyEvidence?.contentVisibility === "visible",
      detailsBodyVisibilityAvailable: detailsBodyEvidence?.checkVisibilityAvailable === true,
      detailsBodyNotPainted: detailsBodyEvidence?.checkVisibility === false,
    };
    const ordinaryHeaderShape = Object.values(ordinaryHeaderShapeParts).every(Boolean);
    return { current: owner?.isConnected && doc.querySelectorAll("#shared > forma-document-artifacts").length === 1
        && doc.querySelector("#shared > forma-document-artifacts") === owner && owner.contains(dialog)
        && dialog instanceof win.HTMLDialogElement && dialog.open && dialog.matches(":modal")
        && doc.querySelectorAll("dialog:modal").length === 1 && dialog.getAttribute("data-output-focus") === "false"
        && dialog.querySelector(":scope > .document-artifact-reader > .artifact-viewer-header") === header
        && header.querySelector(":scope > .artifact-viewer-identity") === identity
        && nodes.every((node, index) => node?.isConnected && node.getRootNode() === doc && !node.shadowRoot && !node.assignedSlot
          && header.querySelectorAll(":scope " + paths[index]).length === 1 && header.querySelector(":scope " + paths[index]) === node)
        && actions.length >= 2 && currentActions.length === actions.length && currentActions.every((node, index) => node === actions[index])
        && actions.includes(target) && target === dialog.querySelector(".artifact-viewer-focus-toggle")
        && peers.every(node => node.isConnected && header.contains(node))
        && chains.every((chain, index) => chain.at(-1) === header && nodes[index].parentElement === chain[0]
          && chain.every((node, position) => position === chain.length - 1 || node.parentElement === chain[position + 1])),
      active: doc.activeElement === target, focusVisible: target.matches(":focus-visible"),
      detailsClosed: details instanceof win.HTMLDetailsElement && !details.open && details.parentElement === identity
        && nodes[3].tagName === "SUMMARY" && details.querySelector(":scope > summary") === nodes[3],
      copies, ordinaryHeaderShape, ordinaryHeaderShapeParts, detailsBodyEvidence,
      header: { tag: header.tagName, className: header.getAttribute("class"), raw: rect(header) },
      peers: peers.map(node => ({ tag: node.tagName, className: node.getAttribute("class"), raw: rect(node),
        containsCopies: nodes.map(copy => node.contains(copy)), ownedByCopies: nodes.map(copy => copy.contains(node)), ...styleEvidence(node) })),
      actions: actions.map(node => ({ tag: node.tagName, className: node.getAttribute("class"),
        text: node.textContent, ariaLabel: node.getAttribute("aria-label"), disabled: node.disabled, raw: rect(node),
        focusOwner: node === target, ...styleEvidence(node) })) };
  };
  try {
    const before = await page.evaluate(read, reference);
    await attachJSON(testInfo, stage + "-before", { checkedAt: new Date().toISOString(), state: before });
    expect({ current: before.current, active: before.active, focusVisible: before.focusVisible, detailsClosed: before.detailsClosed })
      .toEqual({ current: true, active: true, focusVisible: true, detailsClosed: true });
    const headerPath = selectors.owner + " " + selectors.dialog + ":modal > .document-artifact-reader > .artifact-viewer-header";
    // Only the observed ordinary visible-overflow case can use a larger proof
    // envelope. Hidden/clipped owners and non-overhanging fragments retain the
    // exact original containment branch. With no visible overhang, the original
    // four-region measurement is also unchanged.
    const visibleBlockOverhang = (copy, fragment) => {
      const styles = copy.textOwners[0].styles;
      return styles.overflowX === "visible" && styles.overflowY === "visible" && styles.webkitLineClamp === "none"
        && fragment.width > 0 && fragment.height > 0 && (fragment.top < copy.raw.top || fragment.bottom > copy.raw.bottom);
    };
    const needsHeaderEnvelope = before.copies.some(copy => copy.rawRanges.some(fragment => visibleBlockOverhang(copy, fragment)));
    const copySelectors = paths.map(path => headerPath + " " + path);
    const regionSelectors = needsHeaderEnvelope ? [...copySelectors, headerPath] : copySelectors;
    const overlaySelectors = [...defaults, ...(selectors.obstacles ?? []).map(path =>
      selectors.owner + " " + selectors.dialog + ":modal " + path), ...copySelectors,
      headerPath + " > .document-artifact-reader-actions > button"];
    let observation, measurementError;
    try { observation = await verifyFocus(page, focus, testInfo, stage, { regionSelectors, overlaySelectors }); }
    catch (error) { measurementError = error; }
    const after = await page.evaluate(read, reference);
    await attachJSON(testInfo, stage + "-after", { checkedAt: new Date().toISOString(), state: after,
      limit: "Current plain-text owner bodies and DOM Range fragments only; no glyph, contrast, native marker, closed-shadow or simultaneous screenshot-paint certificate." });
    await custody(stage + "-after");
    if (measurementError) throw measurementError;
    expect(after, "Header measurement must preserve exact native owners, focus, full texts, action states and raw layout").toEqual(before);
    expect(observation.regions).toHaveLength(paths.length + Number(needsHeaderEnvelope));
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    let supportedBlockOverhangs = 0;
    for (const [index, copy] of after.copies.entries()) {
      const region = observation.regions[index];
      expect(copy.tag).toBe(["H2", "SPAN", "P", "SUMMARY"][index]);
      expect(copy.text.trim().length, copy.path + ": current full text is nonempty").toBeGreaterThan(0);
      expect(copy.supportedTextShape, copy.path + ": undeclared text subtree is not a pass").toBe(true);
      for (const [ownerIndex, owner] of copy.textOwners.entries()) {
        expect(owner.unsupported, copy.path + ": unsupported text paint is not a pass").toEqual([]);
        if (ownerIndex > 0) expect([owner.styles.overflowX, owner.styles.overflowY],
          copy.path + ": descendant text clipping is outside the owner-box contract").toEqual(["visible", "visible"]);
      }
      expect(region.element).toMatchObject({ tag: copy.tag, className: copy.className });
      expect(region.paintedBox, copy.path + ": a hidden region is not a pass").toBe(true);
      expect(region.unknown).toEqual([]); expect(region.collisions).toEqual([]);
      expect(region.raw, copy.path + ": observer and Range reads must agree on the actual owner box").toEqual(copy.raw);
      expect(region.visible, copy.path + ": complete region body remains inside calibrated ancestor clips").toEqual(copy.raw);
      expect(copy.rawRanges.length, copy.path + ": actual full-text Range fragments are required").toBeGreaterThan(0);
      for (const fragment of copy.rawRanges) {
        expect(Object.values(fragment).every(Number.isFinite), copy.path + ": finite native Range geometry").toBe(true);
        expect(fragment.width).toBeGreaterThanOrEqual(0); expect(fragment.height).toBeGreaterThanOrEqual(0);
      }
      // Retain degenerate whitespace records, but they cannot supply positive
      // text evidence or hide an out-of-box positive full-content fragment.
      const positiveFragments = copy.rawRanges.filter(fragment => fragment.width > 0 && fragment.height > 0);
      expect(positiveFragments.length, copy.path + ": positive native text fragments are required").toBeGreaterThan(0);
      for (const fragment of positiveFragments) {
        if (visibleBlockOverhang(copy, fragment)) {
          expect(needsHeaderEnvelope).toBe(true);
          expect(after.ordinaryHeaderShape, "No undeclared visible branch may borrow the header proof").toBe(true);
          const enclosing = observation.regions[paths.length];
          expect(enclosing.element).toMatchObject({ tag: "HEADER", className: "artifact-viewer-header" });
          expect(enclosing.paintedBox).toBe(true);
          expect(enclosing.unknown).toEqual([]); expect(enclosing.collisions).toEqual([]);
          expect(enclosing.raw).toEqual(after.header.raw); expect(enclosing.visible).toEqual(after.header.raw);
          // Including HEADER itself matters: geometry(region) does not clip by
          // the region's own overflow. No intervening clip may borrow this proof.
          for (const ancestorIndex of copy.ancestorIndexes) {
            const ancestor = after.peers[ancestorIndex];
            expect(ancestor.unsupported).toEqual([]); expect(ancestor.ordinaryUnsupported).toEqual([]);
            expect([ancestor.styles.overflowX, ancestor.styles.overflowY]).toEqual(["visible", "visible"]);
            expect(ancestor.styles.webkitLineClamp).toBe("none");
          }
          for (const textOwner of copy.textOwners) {
            expect(textOwner.ordinaryUnsupported).toEqual([]);
            expect(textOwner.styles.webkitLineClamp).toBe("none");
          }
          // Inline fitting stays strict. A font-metric rectangle may exceed
          // its line box only vertically, within the entire calibrated HEADER
          // and the copy's original ancestor intersection; no new clip math.
          for (const box of [copy.raw, region.visible]) {
            expect(fragment.left, copy.path + ": full text starts inside its own visible box").toBeGreaterThanOrEqual(box.left);
            expect(fragment.right, copy.path + ": full text is not ellipsized or clipped at inline end").toBeLessThanOrEqual(box.right);
          }
          for (const box of [after.header.raw, region.intersection]) {
            expect(fragment.left).toBeGreaterThanOrEqual(box.left); expect(fragment.right).toBeLessThanOrEqual(box.right);
            expect(fragment.top).toBeGreaterThanOrEqual(box.top); expect(fragment.bottom).toBeLessThanOrEqual(box.bottom);
          }
          for (const peer of after.peers) {
            if (peer.containsCopies[index] || peer.ownedByCopies[index]) continue;
            // Unknown extents reject BEFORE raw-disjoint shortcuts. A plain
            // transparent DETAILS/kicker/action wrapper cannot hide the range;
            // opaque/decorated overlapping containers cannot be treated as text.
            expect(peer.unsupported).toEqual([]); expect(peer.ordinaryUnsupported).toEqual([]);
            if (overlap(fragment, peer.raw)) expect(peer.plainBox, "Overlapping peer-container paint is unsupported").toBe(true);
          }
          for (const [peerIndex, peerCopy] of after.copies.entries()) {
            if (peerIndex === index) continue;
            for (const peerRange of peerCopy.rawRanges.filter(value => value.width > 0 && value.height > 0))
              expect(overlap(fragment, peerRange), "Different header texts must not overlap").toBe(false);
          }
          for (const action of after.actions) {
            expect(action.unsupported).toEqual([]);
            // The current Focus outline is already proved by the unchanged
            // observer; no other peer gets an outside-body paint exemption.
            expect(action.ordinaryUnsupported.filter(reason => !action.focusOwner || reason !== "outline outside the peer body")).toEqual([]);
            expect(overlap(fragment, action.raw), "Text metrics must not enter a native action body").toBe(false);
          }
          expect(overlap(fragment, observation.focus.envelope), "Text metrics must not enter the current native Focus ring").toBe(false);
          supportedBlockOverhangs += 1;
          continue;
        }
        for (const box of [copy.raw, region.visible]) {
          expect(fragment.left, copy.path + ": full text starts inside its own visible box").toBeGreaterThanOrEqual(box.left);
          expect(fragment.right, copy.path + ": full text is not ellipsized or clipped at inline end").toBeLessThanOrEqual(box.right);
          expect(fragment.top, copy.path + ": full text starts inside its own visible block").toBeGreaterThanOrEqual(box.top);
          expect(fragment.bottom, copy.path + ": full text is not clipped at block end").toBeLessThanOrEqual(box.bottom);
        }
      }
    }
    await attachJSON(testInfo, stage + "-result", { disposition: "CURRENT_HEADER_BODY_AND_TEXT_FRAGMENT_ASSERTIONS_PASSED",
      copyCount: paths.length, actionPeerCount: after.actions.length, supportedBlockOverhangs, focusUnchanged: true, detailsStillClosed: true,
      limit: "Exactly four current Document normal-header text owners. Supported visible vertical font-metric overhang uses a calibrated enclosing HEADER and explicit ordinary peer-paint exclusions, not glyph ink or inferred stacking. Equal separately timed reads are not continuous-motion, accessibility or other-viewer coverage." });
  } finally { await reference.dispose(); }
}

// Optional failed-case diagnostics only. No variant is an acceptance result.
function sharedClipState(reference) {
  const { owner, dialog, card, target, inner } = reference, doc = target.ownerDocument, win = doc.defaultView;
  const describe = node => {
    const style = win.getComputedStyle(node);
    return { tag: node.tagName, className: node.className, rect: node.getBoundingClientRect().toJSON(),
      overflowX: style.overflowX, overflowY: style.overflowY, overflowClipMargin: style.overflowClipMargin,
      borderRadius: style.borderRadius, position: style.position, zIndex: style.zIndex,
      outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset,
      clientWidth: node.clientWidth, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth,
      scrollHeight: node.scrollHeight, scrollLeft: node.scrollLeft, scrollTop: node.scrollTop };
  };
  const ranges = node => {
    if (!node) return null;
    const range = doc.createRange(); range.selectNodeContents(node);
    return { text: node.textContent, rects: [...range.getClientRects()].map(rect => rect.toJSON()) };
  };
  const currentInner = [...card.querySelectorAll(".shared-presentation-stage,.shared-presentation-reading,.shared-presentation-reader")];
  return {
    current: owner.isConnected && dialog.isConnected && card.isConnected && target.isConnected
      && doc.querySelectorAll("#shared > forma-shared-view").length === 1
      && doc.querySelector("#shared > forma-shared-view") === owner && owner.contains(dialog)
      && owner.querySelectorAll("dialog.shared-presentation-dialog:modal").length === 1
      && owner.querySelector("dialog.shared-presentation-dialog:modal") === dialog
      && card.parentElement === dialog && dialog.querySelector(":scope > .shared-presentation-card") === card
      && target instanceof win.HTMLButtonElement && target.closest(".shared-presentation-card") === card
      && target.matches(".shared-presentation-reading-toggle") && doc.activeElement === target && target.matches(":focus-visible"),
    innerIdentity: currentInner.length === inner.length && currentInner.every((node, index) => node === inner[index]),
    state: { focused: dialog.getAttribute("data-output-focus"), reading: target.getAttribute("aria-pressed"),
      open: dialog.open, modal: dialog.matches(":modal"), title: dialog.querySelector("h2")?.textContent,
      text: card.textContent },
    supports: { visible: win.CSS.supports("overflow", "visible"), clip: win.CSS.supports("overflow", "clip"),
      clipMargin6: win.CSS.supports("overflow-clip-margin", "6px") },
    viewport: { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio,
      visualWidth: win.visualViewport?.width, visualHeight: win.visualViewport?.height, scale: win.visualViewport?.scale,
      rootClientWidth: doc.documentElement.clientWidth, rootScrollWidth: doc.documentElement.scrollWidth,
      rootClientHeight: doc.documentElement.clientHeight, rootScrollHeight: doc.documentElement.scrollHeight,
      scrollX: win.scrollX, scrollY: win.scrollY },
    dialog: describe(dialog), card: describe(card), target: describe(target),
    ranges: { heading: ranges(dialog.querySelector("h2")), target: ranges(target) },
    innerReading: currentInner.map(node => ({ ...describe(node), ranges: ranges(node) })),
  };
}

async function compareSharedClip(page, target, testInfo, stage, custody, originalError, overlaySelectors) {
  const prefix = stage + "-clip-compare";
  const reference = await target.evaluateHandle(node => {
    const dialog = node.closest("dialog.shared-presentation-dialog:modal"), card = node.closest(".shared-presentation-card");
    if (!dialog || !card) throw new Error("Shared comparison has no current native modal/card");
    return { target: node, dialog, card, owner: dialog.closest("forma-shared-view"),
      inner: [...card.querySelectorAll(".shared-presentation-stage,.shared-presentation-reading,.shared-presentation-reader")] };
  });
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshot = () => page.evaluate(sharedClipState, reference);
  const sample = async (name, css) => {
    const before = await snapshot();
    if (!before.current || !before.innerIdentity) throw new Error("Shared comparison lost its original owner, reading subtree or native focus");
    const rawObserver = await target.evaluate(measureFormaFocusVisibility,
      { stage: prefix + "-" + name, requireFocusVisible: true, overlaySelectors });
    await attachJSON(testInfo, prefix + "-" + name, { disposition: "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE", name, css,
      sampledAt: new Date().toISOString(), before, rawObserver,
      originalFailure: String(originalError), observerLimit: name === "clip-margin"
        ? "Nonzero overflow-clip-margin is unsupported by the unchanged observer; its raw result is not a clip-margin verdict."
        : "Raw observer result is retained for comparison, never credited as a variation pass.",
      timingLimit: "DOM ranges, observer and screenshot are separately timed; no glyph or simultaneous-paint certification." });
    await captureViewport(page, testInfo, prefix + "-" + name);
    const after = await snapshot();
    await attachJSON(testInfo, prefix + "-" + name + "-post-screenshot",
      { disposition: "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE", after });
    if (!after.current || !after.innerIdentity) throw new Error("Shared comparison capture changed original native custody");
    return after;
  };
  try {
    await custody(prefix + "-baseline-source-before");
    const baseline = await sample("baseline", null);
    await custody(prefix + "-baseline-source-after");
    const card = "#shared > forma-shared-view dialog.shared-presentation-dialog:modal > .shared-presentation-card";
    const variants = [
      { name: "visible", css: card + "{overflow:visible!important;}" },
      { name: "clip-margin", css: card + "{overflow:clip!important;overflow-clip-margin:6px!important;}" },
      { name: "inset", css: card + " > header > .shared-presentation-actions > .button:focus-visible{outline-offset:calc(-1 * var(--forma-focus-ring-width,.1875rem))!important;}" },
    ];
    for (const variant of variants) {
      if (JSON.stringify(await snapshot()) !== JSON.stringify(baseline)) throw new Error("Shared baseline changed before the next diagnostic variant");
      await custody(prefix + "-" + variant.name + "-source-before");
      let style, exactRestoration = false;
      try {
        style = await page.addStyleTag({ content: variant.css });
        await frame();
        await sample(variant.name, variant.css);
        await custody(prefix + "-" + variant.name + "-source-after");
      } finally {
        if (style) {
          try { await style.evaluate(node => node.remove()); } finally { await style.dispose(); }
        }
        await frame();
        const restored = await snapshot();
        exactRestoration = JSON.stringify(restored) === JSON.stringify(baseline);
        await attachJSON(testInfo, prefix + "-" + variant.name + "-restored",
          { disposition: "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE", styleRemoved: !style || await page.locator("style").evaluateAll(
            (nodes, css) => !nodes.some(node => node.textContent === css), variant.css), exactRestoration, restored });
        await custody(prefix + "-" + variant.name + "-source-restored");
      }
      if (!exactRestoration) throw new Error("Shared style removal did not restore the original focus/owner/scroll/layout state; stop comparison");
    }
  } finally { await reference.dispose(); }
}

const profiles = [
  { surface: "shared", name: "French true desktop 200%", geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2, locale: "fr" } },
  { surface: "document", name: "French true desktop 200%", geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2, locale: "fr" } },
  { surface: "canvas", name: "French true desktop 200%", geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2, locale: "fr" } },
  { surface: "canvas", name: "English short viewport", geometry: { viewport: { width: 844, height: 390 }, zoom: 1 } },
];
for (const profile of profiles) {
  const { surface } = profile;
  test.describe(profile.name, () => {
    test.use({ geometry: profile.geometry });
  test(`Isolated E5 ${surface[0].toUpperCase() + surface.slice(1)}: real Slides owner, native modal controls, synthetic data only`,
    async ({ page, context, geometry }, testInfo) => {
      const selectors = targets[surface], language = geometry.locale ?? "en-US", expected = copy[language.split("-")[0]];
      const apiBypasses = [], pageErrors = [], downloads = [], layouts = [], boundaryFocusFindings = [];
      const pageError = error => pageErrors.push(String(error));
      page.on("pageerror", pageError);
      page.on("download", download => downloads.push({ name: download.suggestedFilename() }));
      // Registered before navigation, after the unchanged context guard.
      // A forgotten fetch/XHR/beacon path can NEVER reach any API server.
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.startsWith("/api/") || !["GET", "HEAD"].includes(request.method())) {
          apiBypasses.push({ method: request.method(), origin: url.origin, path: url.pathname, resourceType: request.resourceType() });
          await route.abort("blockedbyclient"); return;
        }
        await route.fallback(); // Retain the original local-origin/font/write guard.
      });
      testInfo.annotations.push({ type: "scope", description:
        "ISOLATED SYNTHETIC RENDERER: no genuine account/share/API authority or populated-workflow acceptance. Original 51-case suite (11 calibration + 40 app-flow cases) is separate." });
      let ownerIdentity, openerIdentity, fields, baseline, url, historyLength;
      try {
        const response = await page.goto(`/tests/presentation-responsive.fixture.html?isolated=${surface}&locale=${language}`,
          { waitUntil: "domcontentloaded" });
        expect(response?.status(), "The separately served original source fixture must be reachable").toBe(200);
        await expect.poll(() => fixtureSnapshot(page)).toMatchObject({ schema: "forma-isolated-presentation-r1",
          surface, scope: "synthetic-renderer-only", apiIsolationBeforeOwner: true,
          owner: { connected: true, actualRegistryInstance: true, hostContainsOwner: true } });
        await expect(page.locator("forma-shell")).toHaveCount(0);
        await expect(page.locator("#viewer")).toBeHidden();
        await expect(page.locator("#preview")).toBeHidden();
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => page.evaluate(() => ({
          loaded: [...document.fonts].some(face => face.family.replace(/['"]/g, "") === "Manrope" && face.status === "loaded"),
          selected: getComputedStyle(document.body).fontFamily.split(",")[0].trim().replace(/['"]/g, ""),
        }))).toEqual({ loaded: true, selected: "Manrope" });
        await attachJSON(testInfo, "isolated-application-assets", await page.evaluate(() => ({
          scope: "source modules with synthetic fixture data", language: document.documentElement.lang,
          scripts: [...document.scripts].map(item => item.src).filter(Boolean),
          stylesheets: [...document.styleSheets].map(item => item.href).filter(Boolean),
          fonts: [...document.fonts].map(face => ({ family: face.family, status: face.status })),
        })));
        await applyBrowserZoom(page, context, geometry.zoom, testInfo);
        expect(await page.evaluate(() => matchMedia("(max-height: 37.5rem) and (orientation: landscape)").matches),
          "All four isolated cases must actually reach the current E5 short-landscape rule").toBe(true);
        if (geometry.viewport) {
          const metrics = await browserMetrics(page);
          expect({ width: metrics.width, height: metrics.height }).toEqual(geometry.viewport);
        }
        const owner = page.locator(selectors.owner), opener = owner.locator(selectors.opener);
        await expect(owner).toHaveCount(1);
        await expect(opener).toHaveCount(1);
        await expect(opener).toBeVisible();
        await expect(opener).toBeEnabled();
        if (surface === "shared") await expect(opener).toHaveAccessibleName(expected.openShared);
        if (surface === "canvas") await expect.poll(async () =>
          (await fixtureSnapshot(page)).reads.filter(item => item.fixture === "declared-canvas-event-read").length).toBeGreaterThan(0);
        baseline = await fixtureSnapshot(page);
        expect(baseline.forbidden).toEqual([]);
        expect(baseline.custody.artifacts).toHaveLength(1);
        expect(baseline.custody.artifacts[0]).toMatchObject({ id: "responsive-shared-artifact", kind: "slides", itemCount: 2 });
        expect(baseline.custody.optimisticEvents).toEqual([]);
        expect(baseline.custody.jobs).toEqual([]);
        if (surface !== "shared") expect(baseline.sourceActive).toBe(true);
        url = page.url(); historyLength = await page.evaluate(() => history.length);
        ownerIdentity = await owner.elementHandle(); openerIdentity = await opener.elementHandle();
        fields = await owner.evaluateHandle(node => [...node.querySelectorAll("input,textarea,select")].map(element => ({
          element, value: element.value, checked: "checked" in element ? element.checked : null,
        })));
        const custody = async stage => {
          const current = await fixtureSnapshot(page);
          await attachJSON(testInfo, stage + "-custody", { scope: current.scope, owner: current.owner,
            sourceActive: current.sourceActive, custody: current.custody, forbidden: current.forbidden });
          expect(current.custody, stage + ": original synthetic source must stay unchanged").toEqual(baseline.custody);
          expect(current.forbidden).toEqual([]);
          expect(current.owner).toEqual(baseline.owner);
          if (surface !== "shared") expect(current.sourceActive).toBe(true);
          expect(page.url()).toBe(url);
          expect(await page.evaluate(() => history.length)).toBe(historyLength);
          expect(await owner.evaluate((node, original) => node === original && node.isConnected, ownerIdentity)).toBe(true);
          expect(await page.evaluate(retained => retained.every(item => item.element.isConnected
            && item.element.value === item.value && (!("checked" in item.element) || item.element.checked === item.checked)), fields)).toBe(true);
          expect(apiBypasses).toEqual([]);
          expect(downloads).toEqual([]);
        };
        const entry = async stage => {
          await expect(opener).toBeFocused();
          expect(await opener.evaluate((node, original) => node === original && node.isConnected
            && node instanceof HTMLButtonElement && node.matches(":focus-visible"), openerIdentity)).toBe(true);
          if (surface === "canvas") {
            const observation = await opener.evaluate(measureFormaFocusVisibility, { stage, requireFocusVisible: true });
            await attachJSON(testInfo, stage, observation);
            await attachJSON(testInfo, stage + "-scope", { disposition: "UNASSESSED_ENTRY_GEOMETRY",
              reason: "Real Canvas card transforms/paint containment are unsupported. Native owner/return identity only; no geometry pass." });
            await captureViewport(page, testInfo, stage);
            // Keep the raw result, including failures/unknowns. It is not a
            // modal clearance result and cannot be counted as one.
          } else await verifyFocus(page, opener, testInfo, stage);
          await custody(stage);
        };
        const dialog = owner.locator(selectors.dialog), focus = dialog.locator(selectors.focus), close = dialog.locator(selectors.close);
        const strict = async (target, stage, readingRegion = false) => {
          await expect(dialog).toHaveCount(1);
          expect(await dialog.evaluate(node => node instanceof HTMLDialogElement && node.matches(":modal"))).toBe(true);
          await expect(dialog.locator(selectors.header)).toHaveCount(1);
          if (readingRegion) {
            await expect(target).toHaveCount(1);
            expect(await target.evaluate(node => node.tabIndex === 0 && node.isConnected
              && node.matches(".shared-presentation-reading,.presentation-deck-reading"))).toBe(true);
            await expect(target.locator(":scope > article")).toHaveCount(1);
            await expect(target.locator(":scope > article")).not.toHaveAccessibleName("");
          } else await expect(target).not.toHaveAccessibleName("");
          for (const path of selectors.obstacles ?? []) await expect(dialog.locator(":scope " + path)).toHaveCount(1);
          const layout = await dialog.evaluate(viewerLayout, selectors);
          layouts.push({ stage, ...layout });
          await attachJSON(testInfo, stage + "-layout", layout);
          for (const obstacle of layout.obstacles) expect(obstacle.current, stage + ": current owned obstacle " + obstacle.path).toBe(true);
          // Keep all calibrated defaults. Exact sibling regions catch ring-only
          // overlap; the unchanged observer still excludes actual ancestors and
          // handles separate native popover layers without a caller-side waiver.
          const overlaySelectors = [...defaults, ...(selectors.obstacles ?? []).map(path =>
            selectors.owner + " " + selectors.dialog + ":modal " + path)];
          let observation;
          try {
            observation = await verifyFocus(page, target, testInfo, stage,
              { overlaySelectors });
          } catch (error) {
            if (process.env.FORMA_A11Y_E5_CLIP_COMPARE === "1" && surface === "shared" && stage === "isolated-05-reading-toggle") {
              try { await compareSharedClip(page, target, testInfo, stage, custody, error, overlaySelectors); }
              catch (diagnosticError) {
                try { await attachJSON(testInfo, stage + "-clip-compare-error",
                  { disposition: "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE", originalFailure: String(error), diagnosticError: String(diagnosticError) }); }
                catch { /* The original failure must remain the thrown result. */ }
              }
            }
            throw error;
          }
          expect(observation.focus.raw.width, stage + ": native 44px width floor").toBeGreaterThanOrEqual(44);
          expect(observation.focus.raw.height, stage + ": native 44px height floor").toBeGreaterThanOrEqual(44);
          await custody(stage);
        };
        const go = async (target, stage) => { await tabTo(page, target); await strict(target, stage); };
        // A separate native reading journey, admitted only after strict(region)
        // has already passed. Home is an explicit successful-path return step.
        const nativeReadingScroll = async (region, stage) => {
          const retained = await region.elementHandle();
          const read = async name => {
            const state = await region.evaluate(readingLayout);
            const same = await region.evaluate((node, original) => node === original && node.isConnected, retained);
            await attachJSON(testInfo, stage + "-" + name + "-state", { sameCurrentRegion: same, state });
            expect(same).toBe(true);
            expect({ active: state.active, focusVisible: state.focusVisible, nativeModal: state.nativeModal })
              .toEqual({ active: true, focusVisible: true, nativeModal: true });
            return state;
          };
          try {
            const basis = await region.evaluate(node => {
              const style = getComputedStyle(node);
              return { writingMode: style.writingMode, overflowX: style.overflowX, overflowY: style.overflowY,
                paddingBottom: Number.parseFloat(style.paddingBottom), borderBottom: Number.parseFloat(style.borderBottomWidth) };
            });
            expect(basis).toMatchObject({ writingMode: "horizontal-tb", overflowX: "hidden", overflowY: "auto" });
            expect(Number.isFinite(basis.paddingBottom) && Number.isFinite(basis.borderBottom)).toBe(true);
            await attachJSON(testInfo, stage + "-basis", { ...basis,
              endpoint: "Complete ARTICLE border-box end inside the reader's inner bottom; trailing reader padding is diagnostic only." });
            const before = await read("before");
            expect(before.clientHeight).toBeGreaterThan(0);
            expect(before.scrollTop, "Newly entered reading content starts at its native top; do not repair it").toBe(0);
            expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth);
            await custody(stage + "-before");
            if (before.scrollHeight <= before.clientHeight) {
              expect(before.articleRaw.left).toBeGreaterThanOrEqual(before.raw.left);
              expect(before.articleRaw.right).toBeLessThanOrEqual(before.raw.right);
              expect(before.articleRaw.top).toBeGreaterThanOrEqual(before.raw.top);
              expect(before.articleRaw.bottom).toBeLessThanOrEqual(before.raw.bottom - basis.borderBottom);
              await attachJSON(testInfo, stage + "-result", { disposition: "NO_SCROLL_NEEDED_CURRENT_RENDERED_CONTENT_BOUNDS_FIT",
                basis, before, keys: [], limit: "No overflow or native scroll movement is invented; not a glyph or hidden-details fit certificate." });
              await custody(stage + "-fits");
              return;
            }
            await page.keyboard.press("End");
            let endError;
            try {
              await expect.poll(async () => {
                const current = await region.evaluate(readingLayout);
                return current.active && current.focusVisible && current.nativeModal && current.scrollTop > before.scrollTop
                  && current.articleRaw.bottom <= current.raw.bottom - basis.borderBottom;
              }, { message: "Native End must move this overflowing reader and expose its complete ARTICLE endpoint" }).toBe(true);
            } catch (error) { endError = error; }
            const end = await read("end");
            await attachJSON(testInfo, stage + "-content-end", { basis,
              articleBottom: end.articleRaw.bottom, readerInnerBottom: end.raw.bottom - basis.borderBottom,
              articleEndClearance: end.raw.bottom - basis.borderBottom - end.articleRaw.bottom,
              trailingPaddingClearance: end.raw.bottom - basis.borderBottom - end.articleRaw.bottom - basis.paddingBottom,
              limit: "Derived from the same recorded End state; full trailing reader padding is not required and cannot hide a clipped ARTICLE endpoint." });
            if (endError) throw endError;
            expect(end.text).toBe(before.text); expect(end.raw).toEqual(before.raw);
            expect(end.scrollHeight).toBe(before.scrollHeight); expect(end.scrollLeft).toBe(before.scrollLeft);
            await strict(region, stage + "-native-end", true);
            await page.keyboard.press("Home");
            let homeError;
            try { await expect.poll(() => region.evaluate(node => node.scrollTop)).toBe(0); }
            catch (error) { homeError = error; }
            const home = await read("home");
            if (homeError) throw homeError;
            expect(home.text).toBe(before.text); expect(home.raw).toEqual(before.raw);
            expect(home.articleRaw).toEqual(before.articleRaw);
            expect(home.scrollHeight).toBe(before.scrollHeight); expect(home.scrollLeft).toBe(before.scrollLeft);
            await strict(region, stage + "-native-home", true);
            await attachJSON(testInfo, stage + "-result", { disposition: "NATIVE_END_HOME_ASSERTIONS_PASSED",
              basis, before, end, home, keys: ["End", "Home"],
              endpoint: "The complete final ARTICLE border-box end is visible inside the unchanged reader's inner bottom; no trailing-padding, rounded max-scroll or epsilon requirement.",
              limit: "Only this isolated current reader and its unchanged DOM content; no full glyph, AT, genuine-account or production certification." });
          } finally { await retained.dispose(); }
        };
        const open = async stage => {
          await page.keyboard.press("Enter");
          await expect(dialog).toHaveCount(1);
          await expect(dialog).toHaveAttribute("data-output-focus", "false");
          await expect(dialog.locator(selectors.header + " h2")).toHaveText("Shared protected presentation");
          await attachJSON(testInfo, stage + "-initial-focus", await page.evaluate(() => {
            const node = document.activeElement; return { tag: node?.tagName, className: node?.className,
              label: node?.getAttribute("aria-label"), text: node?.textContent, focusVisible: node?.matches(":focus-visible") };
          }));
          await expect(focus).toHaveAccessibleName(expected.focus);
          await expect(close).toHaveAccessibleName(surface === "canvas" ? expected.canvasClose : expected.close);
        };
        await tabTo(page, opener);
        await entry("isolated-01-entry");
        await open("isolated-02-open");
        await go(focus, "isolated-03-normal-focus");
        if (surface === "document") await verifyDocumentNormalHeaderCopy({ page, dialog, focus, selectors, testInfo, custody });
        await go(close, "isolated-04-normal-close");
        if (surface === "shared") {
          await expect(dialog.locator(".artifact-viewer-actions-popover")).toHaveCount(0);
          const readingToggle = dialog.locator(".shared-presentation-reading-toggle");
          await go(readingToggle, "isolated-05-reading-toggle");
          if (await readingToggle.getAttribute("aria-pressed") === "true") {
            await page.keyboard.press("Enter");
            await expect(readingToggle).toHaveAttribute("aria-pressed", "false");
            await strict(readingToggle, "isolated-05a-choose-visual");
          }
          await expect(readingToggle).toHaveAccessibleName(expected.read);
          await page.keyboard.press("Enter");
          const reading = dialog.locator(".shared-presentation-reading");
          await expect(readingToggle).toHaveAttribute("aria-pressed", "true");
          await expect(reading).toBeFocused();
          await expect(reading.locator("h3")).toHaveText(baseline.authoredItems[0].title);
          await expect(reading).toContainText(baseline.authoredItems[0].body);
          await attachJSON(testInfo, "isolated-reading-custody", { currentNativeReadingFocus: true,
            text: await reading.textContent(), geometry: "UNASSESSED: not a modal-control or full glyph/reading-fit claim" });
          await strict(reading, "isolated-05b-native-reading", true);
          await nativeReadingScroll(reading, "isolated-05b-reading-scroll");
          const originalReading = await reading.elementHandle(), initialReading = await reading.evaluate(readingLayout);
          await attachJSON(testInfo, "isolated-05b-reading-state", initialReading);
          try {
            const navigation = dialog.locator(".shared-presentation-stage > nav");
            await expect(navigation).toHaveCount(1);
            await expect(navigation.locator(":scope > button")).toHaveCount(2);
            const previous = navigation.locator(":scope > button").first(), next = navigation.locator(":scope > button").last();
            await expect(previous).toHaveAccessibleName(expected.previous);
            await expect(next).toHaveAccessibleName(expected.next);
            await expect(previous).toBeDisabled(); await expect(next).toBeEnabled();
            for (const step of [{ target: next, peer: previous, index: 1, stage: "isolated-05c-reading-next" },
              { target: previous, peer: next, index: 0, stage: "isolated-05d-reading-previous" }]) {
              await go(step.target, step.stage);
              const triggerIdentity = await step.target.elementHandle(), peerIdentity = await step.peer.elementHandle();
              try {
                await page.keyboard.press("Enter");
                await expect(readingToggle).toHaveAttribute("aria-pressed", "true");
                await expect(reading.locator("h3")).toHaveText(baseline.authoredItems[step.index].title);
                await expect(reading).toContainText(baseline.authoredItems[step.index].body);
                await expect(step.target).toBeDisabled(); await expect(step.peer).toBeEnabled();
                expect(await reading.evaluate((node, retained) => node === retained && node.isConnected, originalReading)).toBe(true);
                expect(await step.peer.evaluate((node, retained) => node === retained && node.isConnected, peerIdentity)).toBe(true);
                const native = await step.target.evaluate((node, retained) => {
                  const active = node.ownerDocument.activeElement, peer = retained.peer, modal = node.closest("dialog:modal");
                  const describe = element => element ? { tag: element.tagName, className: element.className, text: element.textContent,
                    label: element.getAttribute("aria-label"), disabled: element.matches(":disabled"),
                    focusVisible: element.matches(":focus-visible"), raw: element.getBoundingClientRect().toJSON() } : null;
                  return { sameTrigger: node === retained.trigger && node.isConnected, disabled: node.disabled,
                    enabledPeerFocused: peer instanceof HTMLButtonElement && peer.isConnected && !peer.disabled
                      && modal?.contains(peer) && active === peer,
                    triggerRetainedFocus: active === node, focusInsideCurrentModal: Boolean(modal?.contains(active)),
                    trigger: describe(node), predeterminedPeer: describe(peer), active: describe(active) };
                }, { trigger: triggerIdentity, peer: peerIdentity });
                const rawTriggerObservation = await step.target.evaluate(measureFormaFocusVisibility, { stage: step.stage + "-post-enter-trigger",
                  requireFocusVisible: true, overlaySelectors: [...defaults, ...selectors.obstacles.map(path =>
                    selectors.owner + " " + selectors.dialog + ":modal " + path)] });
                await attachJSON(testInfo, step.stage + "-post-navigation", { native, rawTriggerObservation,
                  reading: await reading.evaluate(readingLayout),
                  focusDisposition: native.enabledPeerFocused ? "PREDETERMINED_ENABLED_PEER_REQUIRES_STRICT_CHECK" : "REVIEW_REQUIRED_INVALID_BOUNDARY_FOCUS",
                  limit: "Raw disabled-trigger observation is diagnostic, never a focus pass. Subsequent native Tab cannot repair this verdict." });
                expect(native.sameTrigger).toBe(true); expect(native.disabled).toBe(true);
                if (native.enabledPeerFocused) await strict(step.peer, step.stage + "-native-peer-handoff");
                else {
                  boundaryFocusFindings.push({ stage: step.stage, native });
                  testInfo.annotations.push({ type: "review-required", description: step.stage
                    + ": post-Enter focus did not reach the predetermined enabled peer; preserve observations and fail this journey even if later Tab succeeds." });
                }
                await custody(step.stage + "-after-enter");
              } finally { await peerIdentity.dispose(); await triggerIdentity.dispose(); }
            }
            await tabTo(page, reading, 80, "Shift+Tab");
            await strict(reading, "isolated-05e-reading-return", true);
            const returnedReading = await reading.evaluate(readingLayout);
            await attachJSON(testInfo, "isolated-05e-reading-state", returnedReading);
            expect(returnedReading.text).toBe(initialReading.text);
            expect(await reading.evaluate((node, retained) => node === retained && node.isConnected, originalReading)).toBe(true);
          } finally { await originalReading.dispose(); }
          await tabTo(page, readingToggle, 80, "Shift+Tab");
          await expect(readingToggle).toHaveAccessibleName(expected.visual);
          await strict(readingToggle, "isolated-06-slide-view-toggle");
          await page.keyboard.press("Enter");
          await expect(readingToggle).toHaveAttribute("aria-pressed", "false");
          await expect(dialog.locator(".shared-presentation-stage")).toHaveAttribute("data-slide-posture", "visual");
          await strict(readingToggle, "isolated-07-visual-return");
        } else {
          const menu = dialog.locator(":scope > " + selectors.card + " > footer > forma-ui-popover.artifact-viewer-actions-popover");
          const trigger = menu.locator(":scope > .ui-popover > button.ui-popover-trigger");
          const panel = menu.locator(":scope > .ui-popover > section.ui-popover-panel");
          await expect(menu).toHaveCount(1);
          await expect(trigger).toHaveAccessibleName(expected.more);
          await expect(panel).toHaveAttribute("popover", "auto");
          const panelId = await panel.getAttribute("id");
          expect(panelId).toBeTruthy();
          await expect(trigger).toHaveAttribute("popovertarget", panelId);
          await expect(trigger).toHaveAttribute("aria-controls", panelId);
          await go(trigger, "isolated-05-more-trigger");
          await page.keyboard.press("Enter");
          await expect(panel).toBeVisible();
          expect(await panel.evaluate(node => node.matches(":popover-open"))).toBe(true);
          const action = panel.locator(".artifact-viewer-actions-body > button").first();
          await expect(action).toHaveAccessibleName(expected.inspect);
          await go(action, "isolated-06-more-action-unactivated");
          await page.keyboard.press("Escape");
          await expect(panel).not.toBeVisible();
          await expect(dialog).toHaveAttribute("data-output-focus", "false");
          await strict(trigger, "isolated-07-more-escape-return");
          if (surface === "canvas" || surface === "document") {
            const deck = dialog.locator(surface === "canvas"
              ? ":scope > .canvas-artifact-viewer-card > .canvas-artifact-viewer-content > forma-presentation-deck"
              : ":scope > .document-artifact-reader > .document-artifact-reader-content > forma-presentation-deck");
            await expect(deck).toHaveCount(1);
            expect(await deck.evaluate(node => node.isConnected && node instanceof customElements.get("forma-presentation-deck"))).toBe(true);
            await expect(deck.locator(":scope > .presentation-deck--slideshow")).toHaveCount(1);
            const toolbar = deck.locator(".presentation-deck-toolbar"), tools = toolbar.locator(":scope > .presentation-deck-tools-toggle");
            await expect(toolbar).toHaveAttribute("data-tools-open", "false");
            await expect(tools).toHaveAccessibleName(expected.tools);
            await expect(tools).toHaveAttribute("aria-expanded", "false");
            await expect(toolbar.locator(":scope > div")).toHaveCount(2);
            const controlled = (await tools.getAttribute("aria-controls")).split(/\s+/).filter(Boolean);
            expect(controlled).toHaveLength(2);
            for (let index = 0; index < controlled.length; index++) {
              await expect(toolbar.locator(":scope > div").nth(index)).toHaveAttribute("id", controlled[index]);
              await expect(toolbar.locator(":scope > div").nth(index)).toBeHidden();
            }
            await go(tools, "isolated-07a-closed-deck-tools");
            // Operate only the real compact-tools disclosure. The selects are
            // focused but never changed; export, fullscreen and label controls
            // remain unactivated. This is not a tools-action/authorization test.
            const toolOwnership = await toolbar.evaluateHandle(node => ({
              toolbar: node, deck: node.closest("forma-presentation-deck"),
              trigger: node.querySelector(":scope > .presentation-deck-tools-toggle"),
              groups: [...node.querySelectorAll(":scope > div")],
              fields: [...node.querySelectorAll("input,textarea,select")].map(element => ({
                element, value: element.value, checked: "checked" in element ? element.checked : null,
                selectedIndex: element instanceof HTMLSelectElement ? element.selectedIndex : null,
              })),
            }));
            try {
              for (const expanded of [true, false]) {
                const stage = expanded ? "isolated-07a-tools-open" : "isolated-07a-tools-closed";
                await page.keyboard.press("Enter");
                await expect(toolbar).toHaveAttribute("data-tools-open", String(expanded));
                await expect(tools).toHaveAttribute("aria-expanded", String(expanded));
                await expect(toolbar.locator(":scope > div")).toHaveCount(2);
                for (let index = 0; index < controlled.length; index++) {
                  const group = toolbar.locator(":scope > div").nth(index);
                  await expect(group).toHaveAttribute("id", controlled[index]);
                  if (expanded) await expect(group).toBeVisible();
                  else await expect(group).toBeHidden();
                }
                const state = await toolbar.evaluate((node, original) => {
                  const groups = [...node.querySelectorAll(":scope > div")], fields = [...node.querySelectorAll("input,textarea,select")];
                  const trigger = node.querySelector(":scope > .presentation-deck-tools-toggle"), modal = node.closest("dialog:modal");
                  return { sameToolbar: node === original.toolbar && node.isConnected,
                    sameDeck: node.closest("forma-presentation-deck") === original.deck && original.deck.isConnected,
                    sameTrigger: trigger === original.trigger && trigger instanceof HTMLButtonElement && trigger.isConnected && !trigger.disabled,
                    nativeFocus: document.activeElement === trigger && trigger.matches(":focus-visible") && Boolean(modal?.contains(trigger)),
                    sameGroups: groups.length === original.groups.length && groups.every((group, index) =>
                      group === original.groups[index] && group.isConnected && group.parentElement === node),
                    unchangedFields: fields.length === original.fields.length && original.fields.every((item, index) =>
                      item.element === fields[index] && item.element.isConnected && item.element.value === item.value
                      && (!("checked" in item.element) || item.element.checked === item.checked)
                      && (!(item.element instanceof HTMLSelectElement) || item.element.selectedIndex === item.selectedIndex)),
                    fields: fields.map(element => ({ tag: element.tagName, label: element.getAttribute("aria-label"),
                      value: element.value, checked: "checked" in element ? element.checked : null })),
                    groups: groups.map(group => ({ id: group.id, text: group.textContent, raw: group.getBoundingClientRect().toJSON(),
                      display: getComputedStyle(group).display, visibility: getComputedStyle(group).visibility })),
                    toolbar: { raw: node.getBoundingClientRect().toJSON(), clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
                      scrollTop: node.scrollTop, scrollLeft: node.scrollLeft }, expanded: trigger.getAttribute("aria-expanded") };
                }, toolOwnership);
                await attachJSON(testInfo, stage + "-state", { ...state,
                  limit: "Current tools disclosure, native select focus and DOM field custody only; no select-value changes, export, fullscreen, checkbox action or full-copy fit claim." });
                for (const key of ["sameToolbar", "sameDeck", "sameTrigger", "nativeFocus", "sameGroups", "unchangedFields"])
                  expect(state[key], stage + ": " + key).toBe(true);
                expect(state.fields.length).toBeGreaterThanOrEqual(2);
                await strict(tools, stage);
                if (expanded) {
                  const jump = toolbar.locator(":scope > div > .presentation-deck-jump--compact > select");
                  const style = toolbar.locator(":scope > div > .presentation-deck-style > select");
                  await expect(jump).toHaveCount(1); await expect(style).toHaveCount(1);
                  await expect(jump).toHaveAccessibleName(expected.jump); await expect(style).toHaveAccessibleName(expected.style);
                  await go(jump, "isolated-07a-tools-jump-unactivated");
                  await go(style, "isolated-07a-tools-style-unactivated");
                  // Observe the open disclosure's actual reading/control space.
                  // A zero-size existing reader is not an absent/visual branch.
                  const openStage = deck.locator(":scope > .presentation-deck--slideshow > .presentation-deck-stage[data-slide-posture]");
                  const openViewport = openStage.locator(":scope > .presentation-deck-viewport");
                  const openReading = openViewport.locator(":scope > .presentation-deck-reading");
                  const openNav = openStage.locator(":scope > nav");
                  const openPrevious = openNav.locator(":scope > button").first();
                  const openNext = openNav.locator(":scope > button").last();
                  const openReadingToggle = openStage.locator(":scope > .presentation-deck-supporting > .presentation-deck-reading-toggle");
                  for (const node of [openStage, openViewport, openNav, openPrevious, openNext, openReadingToggle])
                    await expect(node).toHaveCount(1);
                  await expect(openNav.locator(":scope > button")).toHaveCount(2);
                  const openPosture = await openStage.getAttribute("data-slide-posture");
                  const openReadingCount = await openReading.count();
                  const openSummaries = openReading.locator(":scope > article > details > summary");
                  const openSummaryCount = await openSummaries.count();
                  const openOwnership = await openStage.evaluateHandle(node => ({
                    stage: node, deck: node.closest("forma-presentation-deck"), modal: node.closest("dialog:modal"),
                    viewport: node.querySelector(":scope > .presentation-deck-viewport"),
                    reading: node.querySelector(":scope > .presentation-deck-viewport > .presentation-deck-reading"),
                    summaries: [...node.querySelectorAll(":scope > .presentation-deck-viewport > .presentation-deck-reading > article > details > summary")],
                    details: [...node.querySelectorAll(":scope > .presentation-deck-viewport > .presentation-deck-reading > article > details")]
                      .map(element => ({ element, open: element.open })),
                    controls: [...node.querySelectorAll(":scope > nav > button, :scope > .presentation-deck-supporting > .presentation-deck-reading-toggle")],
                  }));
                  try {
                    const before = await openStage.evaluate((node, retained) => {
                      const box = element => {
                        if (!element) return null;
                        const style = getComputedStyle(element);
                        return { tag: element.tagName, className: element.className, label: element.getAttribute("aria-label"),
                          raw: element.getBoundingClientRect().toJSON(), tabIndex: element.tabIndex,
                          active: element.ownerDocument.activeElement === element, focusVisible: element.matches(":focus-visible"),
                          disabled: element.matches(":disabled"), display: style.display, visibility: style.visibility,
                          overflowX: style.overflowX, overflowY: style.overflowY, gridTemplateRows: style.gridTemplateRows,
                          paddingBlock: style.paddingBlock, rowGap: style.rowGap,
                          clientWidth: element.clientWidth, clientHeight: element.clientHeight,
                          scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
                          scrollLeft: element.scrollLeft, scrollTop: element.scrollTop };
                      };
                      return { current: node === retained.stage && node.isConnected && retained.deck?.isConnected
                          && node.closest("forma-presentation-deck") === retained.deck
                          && retained.modal instanceof HTMLDialogElement && retained.modal.matches(":modal")
                          && node.closest("dialog:modal") === retained.modal && retained.viewport?.parentElement === node,
                        posture: node.getAttribute("data-slide-posture"), stage: box(node), viewport: box(retained.viewport),
                        reading: box(retained.reading), summaries: retained.summaries.map(box),
                        controls: retained.controls.map(box), detailOpen: retained.details.map(item => item.open) };
                    }, openOwnership);
                    const beforeReading = openReadingCount === 1 ? await openReading.evaluate(readingLayout) : null;
                    await attachJSON(testInfo, "isolated-07a-tools-reading-before", { before, reading: beforeReading,
                      disposition: openReadingCount === 1 ? "CURRENT_READER_REQUIRES_NATIVE_FOCUS" : "VISUAL_READER_UNOBSERVED",
                      limit: "Raw separately timed boxes are not clearance proof. Disabled Previous is diagnostic only; no control, summary, posture or source is activated/changed." });
                    expect(before.current).toBe(true);
                    expect(["reading", "visual"]).toContain(openPosture);
                    expect(openReadingCount).toBe(openPosture === "reading" ? 1 : 0);
                    await expect(deck.locator(".presentation-deck-position")).toHaveText("1 / 2");
                    await expect(openPrevious).toHaveAccessibleName(expected.previous);
                    await expect(openPrevious).toBeDisabled();
                    await expect(openNext).toHaveAccessibleName(expected.next);
                    await expect(openNext).toBeEnabled();
                    await expect(openReadingToggle).toHaveAccessibleName(openPosture === "reading" ? expected.visual : expected.read);
                    await expect(openReadingToggle).toBeEnabled();
                    if (openReadingCount === 1) {
                      expect(openSummaryCount, "The actual reading article retains its source-evidence disclosure").toBeGreaterThanOrEqual(1);
                      await expect(openReading.locator("h3")).toHaveText(baseline.authoredItems[0].title);
                      await expect(openReading).toContainText(baseline.authoredItems[0].body);
                      await tabTo(page, openReading);
                      expect(await openReading.evaluate((node, retained) => node === retained.reading
                        && node.isConnected && node.parentElement === retained.viewport, openOwnership)).toBe(true);
                      await strict(openReading, "isolated-07a-tools-reading-region", true);
                      for (let index = 0; index < openSummaryCount; index++) {
                        const summary = openSummaries.nth(index);
                        expect(await summary.evaluate((node, retained) => node === retained.reference.summaries[retained.index]
                          && node.isConnected && retained.reference.reading.contains(node),
                        { reference: openOwnership, index })).toBe(true);
                        await tabTo(page, summary);
                        await strict(summary, "isolated-07a-tools-reading-summary-" + (index + 1));
                      }
                    } else testInfo.annotations.push({ type: "scope", description:
                      "Open tools actually remained visual: reading-region and descendant native focus UNOBSERVED; no reading posture was forced." });
                    await go(openNext, "isolated-07a-tools-next-unactivated");
                    await go(openReadingToggle, "isolated-07a-tools-reading-toggle-unactivated");
                    const after = await openStage.evaluate((node, retained) => ({
                      sameStage: node === retained.stage && node.isConnected && node.closest("forma-presentation-deck") === retained.deck,
                      sameModal: retained.modal.isConnected && retained.modal.matches(":modal") && node.closest("dialog:modal") === retained.modal,
                      sameViewport: node.querySelector(":scope > .presentation-deck-viewport") === retained.viewport,
                      sameReading: node.querySelector(":scope > .presentation-deck-viewport > .presentation-deck-reading") === retained.reading,
                      sameSummaries: (() => {
                        const current = [...node.querySelectorAll(":scope > .presentation-deck-viewport > .presentation-deck-reading > article > details > summary")];
                        return current.length === retained.summaries.length && current.every((element, index) => element === retained.summaries[index] && element.isConnected);
                      })(),
                      unchangedDetails: retained.details.every(item => item.element.isConnected && item.element.open === item.open),
                      sameControls: (() => {
                        const current = [...node.querySelectorAll(":scope > nav > button, :scope > .presentation-deck-supporting > .presentation-deck-reading-toggle")];
                        return current.length === retained.controls.length && current.every((element, index) => element === retained.controls[index] && element.isConnected);
                      })(),
                    }), openOwnership);
                    const afterReading = openReadingCount === 1 ? await openReading.evaluate(readingLayout) : null;
                    await attachJSON(testInfo, "isolated-07a-tools-reading-after", { after, reading: afterReading,
                      disposition: openReadingCount === 1 ? "OPEN_READER_AND_ENABLED_CONTROLS_NATIVE_FOCUS_CHECKED" : "OPEN_ENABLED_CONTROLS_CHECKED_READER_UNOBSERVED",
                      limit: "Only observed open-state native focus/paint. No summary expansion, control activation, End/Home, full-copy, AT or genuine-account credit." });
                    for (const [key, value] of Object.entries(after)) expect(value, "open-tools unchanged " + key).toBe(true);
                    if (beforeReading) for (const key of ["text", "heading", "articleLabel"])
                      expect(afterReading[key], "open-tools unchanged reading " + key).toBe(beforeReading[key]);
                    await expect(openStage).toHaveAttribute("data-slide-posture", openPosture);
                    await expect(deck.locator(".presentation-deck-position")).toHaveText("1 / 2");
                    await expect(toolbar).toHaveAttribute("data-tools-open", "true");
                    await expect(tools).toHaveAttribute("aria-expanded", "true");
                    await custody("isolated-07a-tools-reading-unchanged");
                  } finally { await openOwnership.dispose(); }
                  await tabTo(page, tools, 80, "Shift+Tab");
                  await strict(tools, "isolated-07a-tools-close-entry");
                }
              }
            } finally { await toolOwnership.dispose(); }
            // List deliberately recreates the stage and compact Jump select.
            // Keep this AFTER every original toolOwnership assertion above.
            const viewStage = "isolated-07a-list-present";
            const overlaySelectors = [...defaults, ...selectors.obstacles.map(path =>
              selectors.owner + " " + selectors.dialog + ":modal " + path)];
            await go(tools, viewStage + "-tools-reopen-entry");
            await page.keyboard.press("Enter");
            await expect(toolbar).toHaveAttribute("data-tools-open", "true");
            await expect(tools).toHaveAttribute("aria-expanded", "true");
            await strict(tools, viewStage + "-tools-open");
            const viewButtons = toolbar.locator(":scope > div > .presentation-deck-view-switch > button");
            await expect(viewButtons).toHaveCount(2);
            const listButton = viewButtons.first(), slideshowButton = viewButtons.last();
            await expect(listButton).toHaveAccessibleName(expected.list);
            await expect(slideshowButton).toHaveAccessibleName(expected.openShared);
            await expect(listButton).toHaveAttribute("aria-pressed", "false");
            await expect(slideshowButton).toHaveAttribute("aria-pressed", "true");
            await go(listButton, viewStage + "-list-entry");
            const viewOwnership = await deck.evaluateHandle(node => {
              const toolbar = node.querySelector(".presentation-deck-toolbar");
              const stage = node.querySelector(":scope > .presentation-deck--slideshow > .presentation-deck-stage");
              const release = toolbar.querySelector(".presentation-deck-export");
              return { deck: node, root: node.querySelector(":scope > .presentation-deck--slideshow"),
                modal: node.closest("dialog:modal"), toolbar, tools: toolbar.querySelector(":scope > .presentation-deck-tools-toggle"),
                groups: [...toolbar.querySelectorAll(":scope > div")], stage,
                viewport: stage?.querySelector(":scope > .presentation-deck-viewport"),
                reading: stage?.querySelector(":scope > .presentation-deck-viewport > .presentation-deck-reading"),
                posture: stage?.getAttribute("data-slide-posture"),
                jump: toolbar.querySelector(".presentation-deck-jump--compact > select"),
                fields: [...toolbar.querySelectorAll("input,textarea,select")].map(element => ({
                  element, value: element.value, checked: "checked" in element ? element.checked : null,
                  selectedIndex: element instanceof HTMLSelectElement ? element.selectedIndex : null,
                })),
                release, rights: { disabled: release.disabled, title: release.title,
                  busy: release.getAttribute("aria-busy"), description: release.getAttribute("aria-describedby") } };
            });
            let presentIdentity;
            try {
              const before = await page.evaluate(retained => ({
                current: retained.deck.isConnected && retained.root?.isConnected && retained.toolbar.isConnected
                  && retained.modal instanceof HTMLDialogElement && retained.modal.matches(":modal")
                  && retained.stage?.isConnected && retained.viewport?.parentElement === retained.stage
                  && retained.jump instanceof HTMLSelectElement && retained.jump.isConnected,
                index: retained.jump?.selectedIndex, value: retained.jump?.value, posture: retained.posture,
                fieldCount: retained.fields.length, rights: retained.rights,
              }), viewOwnership);
              await attachJSON(testInfo, viewStage + "-before", before);
              expect(before.current).toBe(true); expect(before.index).toBe(0); expect(before.value).toBe("0");
              await custody(viewStage + "-before");
              await page.keyboard.press("Enter");
              const list = deck.locator(":scope > .presentation-deck--list > ol.presentation-deck-list");
              await expect(list).toHaveCount(1);
              await expect(deck.locator(".presentation-deck-stage")).toHaveCount(0);
              await expect(listButton).toHaveAttribute("aria-pressed", "true");
              await expect(slideshowButton).toHaveAttribute("aria-pressed", "false");
              await expect(listButton).toBeFocused();
              expect(await listButton.evaluate(node => node.matches(":focus-visible"))).toBe(true);
              await expect(toolbar).toHaveAttribute("data-tools-open", "true");
              await expect(tools).toHaveAttribute("aria-expanded", "true");
              const listItems = list.locator(":scope > li");
              await expect(listItems).toHaveCount(baseline.authoredItems.length);
              await expect(list.locator(":scope > li[aria-current=true]")).toHaveCount(1);
              const currentItem = listItems.nth(before.index);
              await expect(currentItem).toHaveAttribute("aria-current", "true");
              await expect(currentItem).toContainText(baseline.authoredItems[before.index].title);
              await expect(currentItem).toContainText(baseline.authoredItems[before.index].body);
              const listState = await page.evaluate(retained => ({
                sameDeckAndModal: retained.deck.isConnected && retained.deck.closest("dialog:modal") === retained.modal
                  && retained.modal.matches(":modal"),
                sameRootAndToolbar: retained.root.isConnected && retained.root.matches(".presentation-deck--list")
                  && retained.deck.querySelector(":scope > .presentation-deck--list") === retained.root
                  && retained.deck.querySelector(".presentation-deck-toolbar") === retained.toolbar,
                retiredStage: !retained.stage.isConnected, retiredViewport: !retained.viewport.isConnected,
                retiredReading: !retained.reading || !retained.reading.isConnected,
                retiredCompactJump: !retained.jump.isConnected
                  && retained.toolbar.querySelectorAll(".presentation-deck-jump--compact > select").length === 0,
                otherFieldsUnchanged: retained.fields.filter(item => item.element !== retained.jump).every(item =>
                  item.element.isConnected && item.element.value === item.value
                  && (!("checked" in item.element) || item.element.checked === item.checked)
                  && (!(item.element instanceof HTMLSelectElement) || item.element.selectedIndex === item.selectedIndex)),
              }), viewOwnership);
              await attachJSON(testInfo, viewStage + "-list-state", { ...listState,
                intendedChange: "Native List retires the original stage/viewport/reader and compact Jump, not the source or selected item." });
              for (const [key, value] of Object.entries(listState)) expect(value, viewStage + ": " + key).toBe(true);
              const present = currentItem.locator(":scope > .presentation-deck-list-header > button");
              await expect(present).toHaveCount(1);
              await expect(present).toHaveAccessibleName(expected.present + " " + (before.index + 1));
              await expect(present).toBeEnabled();
              presentIdentity = await present.elementHandle();
              await tabTo(page, present);
              const presentObservation = await verifyFocus(page, present, testInfo, viewStage + "-present-entry", { overlaySelectors });
              expect(presentObservation.focus.raw.width).toBeGreaterThanOrEqual(44);
              expect(presentObservation.focus.raw.height).toBeGreaterThanOrEqual(44);
              await custody(viewStage + "-present-entry");
              await page.keyboard.press("Enter");
              const currentStage = deck.locator(":scope > .presentation-deck--slideshow > .presentation-deck-stage[data-slide-posture]");
              await expect(currentStage).toHaveCount(1);
              await expect(currentStage).toHaveAttribute("tabindex", "-1");
              await expect(currentStage).toBeFocused(); // The real Present handler, never test focus/Tab repair.
              await expect(list).toHaveCount(0);
              await expect(listButton).toHaveAttribute("aria-pressed", "false");
              await expect(slideshowButton).toHaveAttribute("aria-pressed", "true");
              await expect(toolbar).toHaveAttribute("data-tools-open", "true");
              await expect(tools).toHaveAttribute("aria-expanded", "true");
              await expect(deck.locator(".presentation-deck-position")).toHaveText("1 / 2");
              const returned = await currentStage.evaluate((node, retained) => {
                const fields = [...retained.toolbar.querySelectorAll("input,textarea,select")];
                const viewport = node.querySelector(":scope > .presentation-deck-viewport");
                const reading = viewport?.querySelector(":scope > .presentation-deck-reading");
                const groups = [...retained.toolbar.querySelectorAll(":scope > div")];
                return { currentNewStage: node.isConnected && node !== retained.stage && !retained.stage.isConnected
                    && node.closest("forma-presentation-deck") === retained.deck
                    && node.parentElement === retained.root && retained.root.matches(".presentation-deck--slideshow"),
                  sameModal: retained.modal.isConnected && retained.modal.matches(":modal") && node.closest("dialog:modal") === retained.modal,
                  currentNewViewport: Boolean(viewport?.isConnected && viewport !== retained.viewport && !retained.viewport.isConnected),
                  currentReadingMatchesPosture: node.getAttribute("data-slide-posture") === "reading"
                    ? Boolean(reading?.isConnected && reading !== retained.reading) : !reading,
                  originalReadingRetired: !retained.reading || !retained.reading.isConnected,
                  sameToolbarAndTools: retained.toolbar.isConnected && retained.deck.querySelector(".presentation-deck-toolbar") === retained.toolbar
                    && retained.toolbar.querySelector(":scope > .presentation-deck-tools-toggle") === retained.tools,
                  sameGroups: groups.length === retained.groups.length && groups.every((group, index) => group === retained.groups[index]),
                  equivalentFieldsWithOnlyJumpRecreated: fields.length === retained.fields.length && retained.fields.every((item, index) => {
                    const current = fields[index];
                    return current.isConnected && (item.element === retained.jump ? current !== item.element && !item.element.isConnected
                      && current.matches(".presentation-deck-jump--compact > select") : current === item.element)
                      && current.value === item.value && (!("checked" in current) || current.checked === item.checked)
                      && (!(current instanceof HTMLSelectElement) || current.selectedIndex === item.selectedIndex);
                  }),
                  sameRights: retained.release.isConnected && retained.toolbar.querySelector(".presentation-deck-export") === retained.release
                    && retained.release.disabled === retained.rights.disabled && retained.release.title === retained.rights.title
                    && retained.release.getAttribute("aria-busy") === retained.rights.busy
                    && retained.release.getAttribute("aria-describedby") === retained.rights.description,
                  nativeStageFocus: document.activeElement === node && node.matches(":focus-visible"),
                };
              }, viewOwnership);
              const posture = await currentStage.getAttribute("data-slide-posture");
              expect(["reading", "visual"]).toContain(posture);
              const currentContent = currentStage.locator(posture === "reading"
                ? ":scope > .presentation-deck-viewport > .presentation-deck-reading > article"
                : ":scope > .presentation-deck-viewport > .presentation-deck-frame > forma-presentation-slide");
              await expect(currentContent).toHaveCount(1);
              await expect(currentContent).toContainText(baseline.authoredItems[before.index].title);
              await expect(currentContent).toContainText(baseline.authoredItems[before.index].body);
              expect(await presentIdentity.evaluate(node => !node.isConnected)).toBe(true);
              await attachJSON(testInfo, viewStage + "-returned", { ...returned, index: before.index, posture,
                previousPosture: before.posture, currentText: await currentContent.textContent(),
                limit: "Intended local view change and current source content only; recreated nodes are not credited as retained old reading identities." });
              for (const [key, value] of Object.entries(returned)) expect(value, viewStage + ": " + key).toBe(true);
              for (const path of selectors.obstacles) await expect(dialog.locator(":scope " + path)).toHaveCount(1);
              const layout = await dialog.evaluate(viewerLayout, selectors);
              layouts.push({ stage: viewStage + "-native-stage", ...layout });
              await attachJSON(testInfo, viewStage + "-native-stage-layout", layout);
              for (const obstacle of layout.obstacles) expect(obstacle.current).toBe(true);
              // The real stage is intentionally unnamed; do not relax strict()
              // for ordinary controls or invent an accessible-name requirement.
              const stageObservation = await verifyFocus(page, currentStage, testInfo, viewStage + "-native-stage", { overlaySelectors });
              expect(stageObservation.focus.raw.width).toBeGreaterThanOrEqual(44);
              expect(stageObservation.focus.raw.height).toBeGreaterThanOrEqual(44);
              expect(stageObservation.focus.outlineExtent, "The actual stage keeps its complete outward 3px + 3px ring").toBe(6);
              await custody(viewStage + "-native-stage");
              await tabTo(page, tools, 80, "Shift+Tab");
              await strict(tools, viewStage + "-tools-close-entry");
              await page.keyboard.press("Enter");
              await expect(toolbar).toHaveAttribute("data-tools-open", "false");
              await expect(tools).toHaveAttribute("aria-expanded", "false");
              for (let index = 0; index < controlled.length; index++)
                await expect(toolbar.locator(":scope > div").nth(index)).toBeHidden();
              await strict(tools, viewStage + "-tools-closed");
            } finally { await presentIdentity?.dispose(); await viewOwnership.dispose(); }
            expect(await panel.evaluate(node => node.matches(":popover-open"))).toBe(false);
            const readingToggle = deck.locator(".presentation-deck-reading-toggle");
            await go(readingToggle, "isolated-07b-deck-reading-toggle");
            if (await readingToggle.getAttribute("aria-pressed") === "true") {
              await page.keyboard.press("Enter");
              await expect(readingToggle).toHaveAttribute("aria-pressed", "false");
              await strict(readingToggle, "isolated-07c-deck-choose-visual");
            }
            await expect(readingToggle).toHaveAccessibleName(expected.read);
            await expect(deck.locator(".presentation-deck-position")).toHaveText("1 / 2");
            await page.keyboard.press("Enter");
            const reading = deck.locator(".presentation-deck-reading");
            await expect(readingToggle).toHaveAttribute("aria-pressed", "true");
            await expect(reading).toBeFocused();
            await expect(reading.locator("h3")).toHaveText(baseline.authoredItems[0].title);
            await expect(reading).toContainText(baseline.authoredItems[0].body);
            await strict(reading, "isolated-07d-deck-native-reading", true);
            if (surface === "canvas") {
              // Content allocation, not a glyph/paint engine: the current title
              // and complete authored opening paragraph need room together.
              const stage = "isolated-07d-initial-reading-context";
              const paths = [":scope > article.presentation-deck-reader-content > h3", ":scope > article.presentation-deck-reader-content > p"];
              for (const path of paths) await expect(reading.locator(path)).toHaveCount(1);
              await expect(reading.locator(paths[0])).toHaveText(baseline.authoredItems[0].title);
              await expect(reading.locator(paths[1])).toHaveText(baseline.authoredItems[0].body);
              await custody(stage + "-before");
              const contextIdentity = await reading.evaluateHandle(reader => {
                const article = reader.querySelector(":scope > article.presentation-deck-reader-content");
                return { reader, article, deck: reader.closest("forma-presentation-deck"), root: reader.closest("section.presentation-deck"),
                  dialog: reader.closest("dialog:modal"),
                  nodes: [article.querySelector(":scope > h3"), article.querySelector(":scope > p")] };
              });
              const readContext = retained => {
                const { reader, article, deck, root, dialog, nodes } = retained, doc = reader.ownerDocument, win = doc.defaultView;
                const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top,
                  right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
                return {
                  current: reader.isConnected && reader.querySelector(":scope > article.presentation-deck-reader-content") === article
                    && reader.closest("forma-presentation-deck") === deck && deck.querySelectorAll(".presentation-deck-reading").length === 1
                    && root.parentElement === deck && reader.closest("section.presentation-deck") === root
                    && deck.querySelectorAll(":scope > section.presentation-deck").length === 1
                    && root.querySelector(":scope > .presentation-deck-stage > .presentation-deck-viewport > .presentation-deck-reading") === reader
                    && deck.querySelector(".presentation-deck-reading") === reader && dialog.contains(deck)
                    && article.firstElementChild === nodes[0] && nodes[0].nextElementSibling === nodes[1]
                    && nodes.every(node => node.isConnected && node.parentElement === article),
                  active: doc.activeElement === reader, focusVisible: reader.matches(":focus-visible"),
                  nativeModal: dialog instanceof win.HTMLDialogElement && dialog.matches(":modal"),
                  normal: dialog.getAttribute("data-output-focus") === "false",
                  closedTools: root.querySelector(":scope > .presentation-deck-toolbar")?.getAttribute("data-tools-open") === "false",
                  readingPosture: root.querySelector(":scope > .presentation-deck-stage")?.getAttribute("data-slide-posture") === "reading",
                  text: reader.textContent, raw: box(reader), scrollTop: reader.scrollTop, scrollLeft: reader.scrollLeft,
                  copies: nodes.map(node => {
                    const style = win.getComputedStyle(node), range = doc.createRange(); range.selectNodeContents(node);
                    return { tag: node.tagName, className: node.getAttribute("class"), text: node.textContent,
                      childElements: node.children.length, raw: box(node),
                      styles: { display: style.display, whiteSpace: style.whiteSpace, overflowX: style.overflowX,
                        overflowY: style.overflowY, webkitLineClamp: style.webkitLineClamp, fontSize: style.fontSize, lineHeight: style.lineHeight },
                      rawRanges: [...range.getClientRects()].map(r => ({ left: r.left, top: r.top, right: r.right,
                        bottom: r.bottom, width: r.width, height: r.height })) };
                  }),
                };
              };
              try {
                const before = await page.evaluate(readContext, contextIdentity);
                await attachJSON(testInfo, stage + "-before", before);
                expect({ current: before.current, active: before.active, focusVisible: before.focusVisible,
                  nativeModal: before.nativeModal, normal: before.normal, closedTools: before.closedTools, readingPosture: before.readingPosture })
                  .toEqual({ current: true, active: true, focusVisible: true, nativeModal: true, normal: true, closedTools: true, readingPosture: true });
                expect(before.scrollTop, "Initial context must fit at the native top, without scrolling or Focus mode").toBe(0);
                const readerPath = selectors.owner + " " + selectors.dialog + ":modal .presentation-deck-reading";
                const regionSelectors = paths.map(path => readerPath + path.slice(":scope".length));
                for (const path of regionSelectors) await expect(page.locator(path)).toHaveCount(1);
                const overlaySelectors = [...defaults, ...(selectors.obstacles ?? []).map(path =>
                  selectors.owner + " " + selectors.dialog + ":modal " + path), ...regionSelectors];
                let observation, measurementError;
                try { observation = await verifyFocus(page, reading, testInfo, stage, { regionSelectors, overlaySelectors }); }
                catch (error) { measurementError = error; }
                const after = await page.evaluate(readContext, contextIdentity);
                await attachJSON(testInfo, stage + "-after", after);
                await custody(stage + "-after");
                if (measurementError) throw measurementError;
                expect(after, "Exact initial reader, title, paragraph, focus and raw layout must remain unchanged").toEqual(before);
                expect(observation.regions).toHaveLength(2);
                for (const [index, copy] of after.copies.entries()) {
                  expect(copy.tag).toBe(index === 0 ? "H3" : "P");
                  expect(copy.text).toBe(index === 0 ? baseline.authoredItems[0].title : baseline.authoredItems[0].body);
                  expect(copy.text.trim().length).toBeGreaterThan(0); expect(copy.childElements).toBe(0);
                  expect(copy.styles).toMatchObject({ display: "block", whiteSpace: "normal", overflowX: "visible", overflowY: "visible", webkitLineClamp: "none" });
                  const region = observation.regions[index];
                  expect(region.element).toMatchObject({ tag: copy.tag, className: copy.className });
                  expect(region.paintedBox).toBe(true); expect(region.unknown).toEqual([]); expect(region.collisions).toEqual([]);
                  expect(region.raw).toEqual(copy.raw);
                  expect(copy.raw.width).toBeGreaterThan(0); expect(copy.raw.height).toBeGreaterThan(0);
                  expect(region.visible, copy.tag + ": complete initial context block must fit within calibrated reader/ancestor clips").toEqual(copy.raw);
                  expect(copy.raw.left).toBeGreaterThanOrEqual(observation.focus.raw.left);
                  expect(copy.raw.right).toBeLessThanOrEqual(observation.focus.raw.right);
                  expect(copy.raw.top).toBeGreaterThanOrEqual(observation.focus.raw.top);
                  expect(copy.raw.bottom).toBeLessThanOrEqual(observation.focus.raw.bottom);
                }
                await attachJSON(testInfo, stage + "-result", { disposition: "INITIAL_ORDINARY_BLOCK_CONTEXT_PASSED", copyCount: 2,
                  nativeTop: true, focusUnchanged: true, toolsStillClosed: true, normalMode: true,
                  limit: "Current plain-text heading and complete authored first-paragraph block allocation under existing typography, not glyph ink or universal reading-fit proof. Raw Range fragments are diagnostic only; unchanged native End/Home follows." });
              } finally { await contextIdentity.dispose(); }
            }
            await nativeReadingScroll(reading, "isolated-07d-reading-scroll");
            await attachJSON(testInfo, "isolated-07d-deck-reading-state", await reading.evaluate(readingLayout));
            await tabTo(page, readingToggle);
            await expect(readingToggle).toHaveAccessibleName(expected.visual);
            await strict(readingToggle, "isolated-07e-deck-slide-view-toggle");
            await page.keyboard.press("Enter");
            await expect(readingToggle).toHaveAttribute("aria-pressed", "false");
            await expect(deck.locator(".presentation-deck-stage")).toHaveAttribute("data-slide-posture", "visual");
            await expect(deck.locator(".presentation-deck-position")).toHaveText("1 / 2");
            await expect(toolbar).toHaveAttribute("data-tools-open", "false");
            await expect(tools).toHaveAttribute("aria-expanded", "false");
            expect(await panel.evaluate(node => node.matches(":popover-open"))).toBe(false);
            await strict(readingToggle, "isolated-07f-deck-visual-return");
          }
        }
        await go(focus, "isolated-08-focus-entry");
        await page.keyboard.press("Enter");
        await expect(dialog).toHaveAttribute("data-output-focus", "true");
        await expect(focus).toHaveAccessibleName(expected.exit);
        await strict(focus, "isolated-09-focused-toggle");
        await go(close, "isolated-10-focused-close");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveAttribute("data-output-focus", "false");
        await expect(focus).toHaveAccessibleName(expected.focus);
        await strict(focus, "isolated-11-exit-focus");
        await go(close, "isolated-12-close-before-enter");
        await page.keyboard.press("Enter");
        await expect(owner.locator(selectors.dialog + ":modal")).toHaveCount(0);
        await entry("isolated-13-close-return");
        await open("isolated-14-reopen");
        await go(close, "isolated-15-unfocused-escape-entry");
        await page.keyboard.press("Escape");
        await expect(owner.locator(selectors.dialog + ":modal")).toHaveCount(0);
        await entry("isolated-16-escape-return");
        expect(boundaryFocusFindings, "Post-navigation focus loss is a failure; later native Tab must not turn it into a green workflow").toEqual([]);
      } finally {
        await attachJSON(testInfo, "isolated-renderer-boundary", {
          scope: "synthetic renderer only", surface, fixture: await fixtureSnapshot(page).catch(() => null),
          apiBypasses, pageErrors, downloads, layouts, boundaryFocusFindings,
          entryLimit: surface === "canvas" ? "Native owner/return identity observed; transformed board entry geometry UNASSESSED" : null,
          excluded: ["original 51-case suite (11 calibration + 40 app-flow cases)", "real session/share authorization", "populated workflows", "guest Shell", "AT", "production"],
        });
        await fields?.dispose(); await openerIdentity?.dispose(); await ownerIdentity?.dispose();
        expect(apiBypasses, "Every API bypass must be blocked and fail the isolated case").toEqual([]);
        expect(pageErrors, "Unexpected renderer exceptions are not geometry acceptance").toEqual([]);
        expect(downloads, "No export/download action belongs to this fixture journey").toEqual([]);
        const final = await fixtureSnapshot(page).catch(() => null);
        if (final) expect(final.forbidden, "No undeclared fixture fetch may be accepted").toEqual([]);
      }
    });
  });
}
