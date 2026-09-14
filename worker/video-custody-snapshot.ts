/** In-request mutation witness. Retain primitive values by reference instead of
 * serializing several copies of the complete private event history. This is not
 * a database freshness proof; all existing SQL and media checks remain required.
 * Server-owned plain data only: accessors and exotic objects fail closed.
 */
export function captureVideoCustodySnapshot(root: object) {
  type Node = { value: object; prototype: object | null; keys: string[]; values: unknown[]; enumerable: boolean[] };
  const nodes: Node[] = [], seen = new WeakSet<object>();
  let fields = 0;
  const pending: Array<{ value: object; depth: number }> = [{ value: root, depth: 0 }];
  const fail = (snapshotReason: string): never => { throw Object.assign(new Error("video_reference_snapshot_unavailable"), { snapshotReason }); };
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (seen.has(value)) continue;
    if (depth > 96) fail("depth");
    if (nodes.length >= 100_000) fail("nodes");
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) fail("prototype");
    const keys = Object.getOwnPropertyNames(value), values: unknown[] = [], enumerable: boolean[] = [];
    fields += keys.length;
    if (fields > 500_000) fail("fields");
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return fail("accessor");
      const item: unknown = descriptor.value;
      if (typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") fail("primitive");
      values.push(item);
      enumerable.push(descriptor.enumerable === true);
      if (item !== null && typeof item === "object") pending.push({ value: item, depth: depth + 1 });
    }
    nodes.push({ value, prototype, keys, values, enumerable });
  }
  const matches = (node: Node, value: object) => {
    if (Object.getPrototypeOf(value) !== node.prototype) return false;
    const keys = Object.getOwnPropertyNames(value);
    if (keys.length !== node.keys.length) return false;
    return keys.every((key, index) => {
      if (key !== node.keys[index]) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor && Object.hasOwn(descriptor, "value") && Object.is(descriptor.value, node.values[index])
        && (descriptor.enumerable === true) === node.enumerable[index];
    });
  };
  // The outer selection object is recreated by the caller. Nested identities
  // and every captured field must remain unchanged through each awaited step.
  return (current: object) => matches(nodes[0]!, current) && nodes.every((node, index) => index === 0 || matches(node, node.value));
}
