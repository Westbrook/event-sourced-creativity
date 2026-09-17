/** Internal transport for existing server-owned intake read predicates only.
 * Packing changes parameter transport, never source authority or query meaning.
 * Callers retain their original predicates for the final native recheck, and
 * select stable column names or explicit aliases (never expression labels). */
export class SponsorIntakeReadQueryError extends Error {
  readonly code: string;
  constructor(code: "sponsor_intake_read_query_invalid" | "sponsor_intake_read_query_too_large") {
    super(code); this.name = "SponsorIntakeReadQueryError"; this.code = code;
  }
}
type Packed = { sql: string; bindings: readonly [string] | readonly [] };
type Token = { start: number; end: number; word?: string; parameter?: true; semicolon?: true };
const fail = (): never => { throw new SponsorIntakeReadQueryError("sponsor_intake_read_query_invalid"); };
const tooLarge = (): never => { throw new SponsorIntakeReadQueryError("sponsor_intake_read_query_too_large"); };
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const wordStart = (value: string) => /[A-Za-z_\u0080-\uFFFF]/u.test(value);
const wordPart = (value: string) => /[A-Za-z0-9_$\u0080-\uFFFF]/u.test(value);

/** SQLite token boundaries, including doubled quote escapes. This is deliberately
 * not a SQL parser: accepted statements remain trusted, native SQL. Unsupported
 * parameter styles, unterminated tokens and multiple statements fail closed. */
function tokens(sql: string): Token[] {
  const result: Token[] = [];
  let at = 0;
  while (at < sql.length) {
    const start = at, ch = sql[at]!;
    if (/\s/u.test(ch)) { at++; continue; }
    if (ch === "-" && sql[at + 1] === "-") {
      const end = sql.indexOf("\n", at + 2); at = end < 0 ? sql.length : end + 1; continue;
    }
    if (ch === "/" && sql[at + 1] === "*") {
      const end = sql.indexOf("*/", at + 2); if (end < 0) return fail(); at = end + 2; continue;
    }
    if (["'", '"', "`", "["].includes(ch)) {
      const endQuote = ch === "[" ? "]" : ch;
      let closed = false; at++;
      while (at < sql.length) {
        if (sql[at++] !== endQuote) continue;
        if (ch !== "[" && sql[at] === endQuote) { at++; continue; }
        closed = true; break;
      }
      if (!closed) return fail();
      result.push({ start, end: at }); continue;
    }
    if (ch === "?") {
      if (/[0-9]/u.test(sql[at + 1] ?? "")) return fail();
      result.push({ start, end: ++at, parameter: true }); continue;
    }
    if (ch === ":" || ch === "@" || ch === "$") return fail();
    if (wordStart(ch)) {
      while (++at < sql.length && wordPart(sql[at]!)) { /* Consume one identifier or keyword. */ }
      result.push({ start, end: at, word: sql.slice(start, at).toUpperCase() }); continue;
    }
    result.push({ start, end: ++at, ...(ch === ";" ? { semicolon: true } : {}) });
  }
  if (result.some((token, index) => token.semicolon && index !== result.length - 1)) return fail();
  return result;
}

/** One bound JSON array avoids D1's variable-count limit. Numbers are explicitly
 * REAL, matching native JavaScript Number bindings; unary + removes expression
 * affinity so comparisons still behave like parameters. Column affinity keeps
 * its ordinary conversion. Encode -0 as -0.0 so SQLite preserves its sign too.
 * No bool/object/blob coercion, ordered/named bind syntax, clocks or SQL input
 * from a client is supported. The packed SQL and JSON each have hard byte caps. */
export function packSponsorIntakeReadQuery(sql: string, bindings: readonly unknown[]): Packed {
  if (typeof sql !== "string" || !Array.isArray(bindings) || sql.includes("\0")) return fail();
  if (bytes(sql) > 100_000 || bindings.length > 100_000) return tooLarge();
  const scanned = tokens(sql), parameters = scanned.filter(token => token.parameter);
  if (!scanned.length || parameters.length !== bindings.length) return fail();
  const captured: (string | number | null)[] = [];
  for (let index = 0; index < bindings.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(bindings, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return fail();
    const value: unknown = descriptor.value;
    if (value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) return fail();
    captured.push(value as string | number | null);
  }
  if (!parameters.length) return { sql, bindings: [] };
  const first = scanned[0]!;
  if (!first.word || !["SELECT", "WITH", "INSERT", "UPDATE", "DELETE", "REPLACE", "VALUES"].includes(first.word)) return fail();
  const json = `[${captured.map(value => typeof value === "number" && Object.is(value, -0) ? "-0.0" : JSON.stringify(value)).join(",")}]`;
  if (bytes(json) > 1_900_000) return tooLarge();
  // Avoid shadowing any original identifier, including quoted names. This is a
  // lexical check over trusted SQL; binding contents never choose SQL text.
  const lowered = sql.toLowerCase(); let name = "sponsor_intake_parameters", suffix = 0;
  while (lowered.includes(name)) name = `sponsor_intake_parameters_${++suffix}`;
  const cte = `${name} AS (SELECT ? AS json)`;
  const withEnd = first.word === "WITH" ? (scanned[1]?.word === "RECURSIVE" ? scanned[1].end : first.end) : first.start;
  let packed = sql.slice(0, withEnd) + (first.word === "WITH" ? ` ${cte},` : `WITH ${cte} `), from = withEnd;
  for (const [index, parameter] of parameters.entries()) {
    if (parameter.start < from) return fail();
    const value = `json_extract((SELECT json FROM ${name}),'$[${index}]')`;
    const expression = typeof captured[index] === "number" ? `+CAST(${value} AS REAL)` : value;
    packed += sql.slice(from, parameter.start) + `(${expression})`; from = parameter.end;
  }
  packed += sql.slice(from);
  if (bytes(packed) > 100_000) return tooLarge();
  return { sql: packed, bindings: [json] };
}
