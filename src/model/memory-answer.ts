/** Only this bounded presentation metadata crosses the assistant response.
 * Durable origin identities, dependencies and SQL certificates stay server-side.
 */
export type MemoryAnswerPresentation = ({
  version: "native-memory-answer-v1";
  method: "extractive-not-semantic";
} | {
  version: "native-memory-answer-v2";
  method: "structured-not-semantic";
}) & {
  checkedAt: string;
  validUntil: string;
};

export function parseMemoryAnswerPresentation(value: unknown, now = Date.now()): MemoryAnswerPresentation | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isFinite(now)) return null;
    // Read only own JSON data once; accessors and invisible provenance are not presentation metadata.
    const fields = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(fields);
    if (keys.length !== 4 || keys.some(key => typeof key !== "string")
      || keys.sort().join(",") !== "checkedAt,method,validUntil,version"
      || keys.some(key => !fields[key as string].enumerable
        || !Object.prototype.hasOwnProperty.call(fields[key as string], "value"))) return null;
    const { version: { value: version }, method: { value: method },
      checkedAt: { value: checkedAt }, validUntil: { value: validUntil } } = fields;
    if (!((version === "native-memory-answer-v1" && method === "extractive-not-semantic")
      || (version === "native-memory-answer-v2" && method === "structured-not-semantic"))
      || typeof checkedAt !== "string" || typeof validUntil !== "string") return null;
    const checked = Date.parse(checkedAt), until = Date.parse(validUntil);
    if (!Number.isFinite(checked) || !Number.isFinite(until) || new Date(checked).toISOString() !== checkedAt
      || new Date(until).toISOString() !== validUntil || checked > now || until <= now
      || until <= checked || until - checked > 60_000) return null;
    return version === "native-memory-answer-v1"
      ? { version, method: "extractive-not-semantic", checkedAt, validUntil }
      : { version, method: "structured-not-semantic", checkedAt, validUntil };
  } catch {
    return null;
  }
}
