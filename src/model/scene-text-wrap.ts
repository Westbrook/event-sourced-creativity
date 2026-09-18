/** Soft wraps never trim or normalize. Explicit LF is represented by a line
 * boundary, including empty/trailing lines. A long word may break only at a
 * grapheme boundary. This is measured typography, not a word-count estimate. */
export function wrapSceneText(text: string, width: number, measure: (text: string) => number): readonly string[] | null {
  if (!Number.isFinite(width) || width <= 0 || text.length > 65_536) return null;
  const lines: string[] = [], segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
  for (const paragraph of text.split("\n")) {
    if (!paragraph) { lines.push(""); continue; }
    const graphemes = [...segmenter.segment(paragraph)].map(item => item.segment);
    let start = 0;
    while (start < graphemes.length) {
      let lo = start + 1, hi = graphemes.length, end = start;
      while (lo <= hi) {
        const middle = Math.floor((lo + hi) / 2), measured = measure(graphemes.slice(start, middle).join(""));
        if (!Number.isFinite(measured) || measured < 0) return null;
        if (measured <= width) { end = middle; lo = middle + 1; } else hi = middle - 1;
      }
      if (end === start) return null;
      // Prefer an ordinary-space boundary, retaining that space verbatim.
      // NBSP and authored joiners are not treated as optional word boundaries.
      if (end < graphemes.length) {
        for (let cursor = end; cursor > start; cursor--) {
          if (graphemes[cursor - 1] === " ") { end = cursor; break; }
        }
      }
      lines.push(graphemes.slice(start, end).join("")); start = end;
    }
  }
  return Object.freeze(lines);
}

