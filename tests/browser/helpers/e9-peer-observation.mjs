// Read-only E9 row diagnostics reused from E7's complete Latin/Arabic Range
// observer and E6's actual-row vertical-overlap/gap criterion. No fixture,
// network, focus, scrolling or styles are changed. Native paint/hit/clipping
// remain the unchanged verifyFocus/forma-dom-focus-visibility contract.
// Expected labels are separately retained from the initial actual native row;
// this checks retention and geometry, not translation correctness or glyph ink.
export function controlRow(element, selector) {
  const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const ownerBox = box(element), style = getComputedStyle(element), root = getComputedStyle(document.documentElement);
  const rootSize = parseFloat(root.fontSize), length = value => value.endsWith("rem") ? parseFloat(value) * rootSize : value.endsWith("px") ? parseFloat(value) : NaN;
  const floor = length(root.getPropertyValue("--forma-control-min-size").trim());
  const supporting = length(root.getPropertyValue("--forma-font-size-supporting").trim());
  const controls = [...element.querySelectorAll(selector)].map(control => {
    const s = getComputedStyle(control), raw = box(control), fragments = [], words = [], text = control.tagName === "BUTTON" ? control.textContent : null;
    if (text !== null) {
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim() || node.parentElement.closest("[aria-hidden='true'],svg,.forma-icon")) continue;
        const parentStyle = getComputedStyle(node.parentElement), range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) fragments.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom,
          visible: node.parentElement.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          overflowX: parentStyle.overflowX, overflowY: parentStyle.overflowY, textOverflow: parentStyle.textOverflow, lineClamp: parentStyle.webkitLineClamp });
        range.detach();
        // Latin/Arabic ordinary words are indivisible; Japanese line breaking
        // does not use this whitespace-delimited word criterion.
        for (const match of node.textContent.matchAll(/[\p{Script=Latin}\p{M}]+|[\p{Script=Arabic}\p{M}]+/gu)) {
          const word = document.createRange(); word.setStart(node, match.index); word.setEnd(node, match.index + match[0].length);
          const rects = [...word.getClientRects()].filter(r => r.width > 0 && r.height > 0);
          words.push({ text: match[0], lineTops: [...new Set(rects.map(r => r.top))] }); word.detach();
        }
      }
    }
    return { tag: control.tagName, type: control.type, raw, text, value: control.value,
      disabled: control.matches(":disabled"), accessibleNameAttribute: control.getAttribute("aria-label"),
      computedMinimum: { inline: s.minInlineSize, block: s.minBlockSize, width: s.minWidth, height: s.minHeight },
      clientWidth: control.clientWidth, scrollWidth: control.scrollWidth, fragments, words,
      fontSize: parseFloat(s.fontSize), lineHeight: parseFloat(s.lineHeight), display: s.display,
      visibility: s.visibility, opacity: s.opacity, overflowX: s.overflowX, overflowY: s.overflowY,
      textOverflow: s.textOverflow, lineClamp: s.webkitLineClamp };
  });
  return { owner: ownerBox, direction: style.direction, flexWrap: style.flexWrap, gap: parseFloat(style.columnGap), floor, supporting,
    pointerCoarse: matchMedia("(pointer: coarse)").matches, hoverNone: matchMedia("(hover: none)").matches, controls };
}
export function rowVerdict(row, expectedLabels, peers) {
  const failures = [], epsilon = 1 / 64;
  if (!(row.floor >= 44)) failures.push("missing-current-target-token");
  const buttons = row.controls.filter(control => control.tag === "BUTTON");
  if (JSON.stringify(buttons.map(control => control.text.trim())) !== JSON.stringify(expectedLabels)) failures.push("incomplete-or-replaced-native-labels");
  for (const control of row.controls) {
    if (control.raw.width + epsilon < row.floor || control.raw.height + epsilon < row.floor) failures.push("native-body-below-current-floor");
    if (control.raw.left < row.owner.left - epsilon || control.raw.right > row.owner.right + epsilon) failures.push("native-control-outside-owner-inline-box");
    if (control.tag !== "BUTTON") continue;
    if (!control.fragments.length || control.display === "none" || control.visibility !== "visible" || Number(control.opacity) !== 1
      || ["hidden", "clip"].includes(control.overflowX) || ["hidden", "clip"].includes(control.overflowY)
      || control.textOverflow === "ellipsis" || control.lineClamp !== "none") failures.push("hidden-or-truncated-native-label");
    for (const r of control.fragments) if (!r.visible || ["hidden", "clip"].includes(r.overflowX) || ["hidden", "clip"].includes(r.overflowY)
      || r.textOverflow === "ellipsis" || r.lineClamp !== "none" || r.left < control.raw.left - epsilon || r.right > control.raw.right + epsilon
      || r.top < control.raw.top - epsilon || r.bottom > control.raw.bottom + epsilon) failures.push("label-fragment-not-wholly-in-native-body");
    for (const word of control.words) if (word.lineTops.length !== 1) failures.push("ordinary-short-word-split");
  }
  if (peers) for (let first = 0; first < row.controls.length; first += 1) for (let second = first + 1; second < row.controls.length; second += 1) {
    const a = row.controls[first].raw, b = row.controls[second].raw;
    // The E6 actual-row rule also catches center-aligned unequal-height peers.
    // Wrapped independent lines do not overlap vertically and stay separate.
    if (a.top >= b.bottom || b.top >= a.bottom) continue;
    if (Math.abs(a.height - b.height) > 1) failures.push("same-row-native-peers-have-different-heights");
    const gap = Math.max(a.left, b.left) - Math.min(a.right, b.right);
    if (Number.isFinite(row.gap) && gap < row.gap - 1) failures.push("same-row-peer-gap-lost");
  }
  return failures;
}
