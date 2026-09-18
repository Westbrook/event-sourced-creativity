import { createHash } from "node:crypto";

/** Synchronous, in-request mutation witness. Hash bounded UTF-16 chunks, never
 * materialize another full-history JSON string or retain copies of field arrays.
 * Node crypto is supplied by the Worker's existing nodejs_compat configuration.
 * This is not a database freshness proof: all SQL/media checks remain required.
 */
export function captureVideoCustodySnapshot(root: object) {
  const identities = new WeakMap<object, number>(); let nextIdentity = 0;
  const fail = (snapshotReason: string): never => { throw Object.assign(new Error("video_reference_snapshot_unavailable"), { snapshotReason }); };
  const fingerprint = (current: object, capture: boolean) => {
    const hash = createHash("sha256"), seen = new WeakSet<object>();
    let pending = "";
    const flush = () => { if (pending) { hash.update(pending, "utf16le"); pending = ""; } };
    const write = (text: string) => {
      // Preserve every UTF-16 code unit, including lone/split surrogates.
      for (let offset = 0; offset < text.length; offset += 8192) {
        pending += text.slice(offset, offset + 8192);
        if (pending.length >= 8192) flush();
      }
    };
    const visit = (value: unknown, depth: number) => {
      if (depth > 96) fail("depth");
      if (value === null) { write("null;"); return; }
      if (typeof value === "string") { write("s" + value.length + ":"); write(value); return; }
      if (typeof value === "number") { write("n" + (Object.is(value, -0) ? "-0" : String(value)) + ";"); return; }
      if (typeof value === "boolean" || value === undefined) { write(typeof value + ":" + String(value) + ";"); return; }
      if (typeof value !== "object") return fail("primitive");
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) fail("prototype");
      // Only the outer selection may be recreated. Every nested identity must
      // still be the same server-owned object on each recheck.
      let identity = depth === 0 ? 0 : identities.get(value);
      if (identity === undefined) {
        if (!capture) fail("identity");
        identity = ++nextIdentity; identities.set(value, identity);
      }
      write("r" + identity + ";");
      if (seen.has(value)) return;
      seen.add(value);
      // This graph is already hydrated by the authorized source reader. A
      // separate account-history cardinality cap here rejects valid sources.
      // Walk it once per pass; cycles terminate and strings stay chunked.
      const keys = Object.getOwnPropertyNames(value);
      write((prototype === null ? "z" : prototype === Array.prototype ? "a" : "o") + (Array.isArray(value) ? "a" : "o") + keys.length + "{");
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) return fail("accessor");
        write("k" + key.length + ":"); write(key); write(descriptor.enumerable ? "e" : "h");
        visit(descriptor.value, depth + 1);
      }
      write("}");
    };
    visit(current, 0); flush(); return hash.digest("hex");
  };
  const original = fingerprint(root, true);
  return (current: object) => {
    try { return fingerprint(current, false) === original; }
    catch { return false; }
  };
}
