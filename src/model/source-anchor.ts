type SourceAnchorValues = Record<string, string | number>;

/** Localize only exact extractor-owned display anchors; canonical evidence stays unchanged. */
export function localizedSourceAnchor(
  anchor: string,
  translate: (source: string, values?: SourceAnchorValues) => string = (source) => source,
  number: (value: number) => string = String,
): string {
  if (anchor === "Source text") return translate(anchor);

  const indexed = /^(Paragraph|Slide|Page) (\d+)$/u.exec(anchor);
  const lines = /^Lines (\d+)–(\d+)$/u.exec(anchor);
  const sheet = /^Sheet (\d+) · ([A-Z]+\d+)$/u.exec(anchor);
  const unverified = /^Document section (\d+) · page not verified$/u.exec(anchor);
  const formatNumber = (raw: string) => Number.isSafeInteger(Number(raw)) ? number(Number(raw)) : raw;
  let source = "";
  let values: Record<string, string>;

  if (indexed) {
    source = `${indexed[1]} {number}`;
    values = { number: formatNumber(indexed[2]!) };
  } else if (lines) {
    source = "Lines {start}–{end}";
    values = { start: formatNumber(lines[1]!), end: formatNumber(lines[2]!) };
  } else if (sheet) {
    source = "Sheet {number} · {address}";
    values = { number: formatNumber(sheet[1]!), address: sheet[2]! };
  } else if (unverified) {
    source = "Document section {number} · page not verified";
    values = { number: formatNumber(unverified[1]!) };
  } else return anchor;

  const placeholders = Object.fromEntries(Object.keys(values).map((key) => [key, `{${key}}`]));
  return translate(source, placeholders).replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}
