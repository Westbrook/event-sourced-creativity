import assert from "node:assert/strict";

/** Test-only accepted memory-boundary port. It exercises privacy composition,
 * never claims a new native memory publication or retention qualification. */
export async function prepareLiveMemoryErasureBarrier(env) {
  const state = env.selectedSharePrivacyMemoryPort;
  assert.ok(state, "pending integration must explicitly install the synthetic memory port");
  state.prepared++;
  const statements = [
    env.DB.prepare("UPDATE selected_share_privacy_memory_fixture SET withdrawn=1 WHERE id='pending'"),
    env.DB.prepare("SELECT CASE WHEN (SELECT withdrawn FROM selected_share_privacy_memory_fixture WHERE id='pending')=1 THEN 1 ELSE json('synthetic memory barrier incomplete') END AS verified"),
  ];
  let consumed = false;
  return {
    statements, assertionIndexes: [1], pendingOrigins: 1, initializedOrigins: 0, bookkeepingWrites: 1,
    acknowledge(receipts) {
      state.acknowledged++;
      if (consumed) return false;
      consumed = true;
      return receipts.length === 2 && receipts[0].success === true && receipts[0].results.length === 0
        && receipts[0].meta.changes === 1 && receipts[1].success === true
        && receipts[1].results.length === 1 && receipts[1].results[0].verified === 1;
    },
  };
}

export async function prepareLiveMemoryErasureStatements() {
  throw new Error("pending integration must not enter final memory erasure");
}
