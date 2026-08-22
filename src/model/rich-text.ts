export const RICH_TEXT_FORMATS = ["bold", "italic", "heading", "bullets", "numbered", "quote", "link"] as const;

export type RichTextFormat = typeof RICH_TEXT_FORMATS[number];

export type RichTextSelection = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

/** Keep formatting deterministic, portable, and independent of a browser editor. */
export function applyRichTextFormat(value: string, selectionStart: number, selectionEnd: number, format: RichTextFormat): RichTextSelection {
  const start = Math.max(0, Math.min(value.length, selectionStart));
  const end = Math.max(start, Math.min(value.length, selectionEnd));
  const selected = value.slice(start, end);

  if (format === "bold" || format === "italic" || format === "link") {
    const before = format === "bold" ? "**" : format === "italic" ? "*" : "[";
    const after = format === "bold" ? "**" : format === "italic" ? "*" : "](https://)";
    const inserted = `${before}${selected}${after}`;
    return {
      value: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
      selectionStart: start + before.length,
      selectionEnd: start + before.length + selected.length,
    };
  }

  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak < 0 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const decorated = lines.map((line, index) => {
    const prefix = format === "heading" ? "## " : format === "bullets" ? "- " : format === "numbered" ? `${index + 1}. ` : "> ";
    return `${prefix}${line}`;
  }).join("\n");

  return {
    value: `${value.slice(0, lineStart)}${decorated}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + decorated.length,
  };
}
