import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerOutputSourceImports, outputTestDatabase } from "./output-server-test-helpers.mjs";
const hook = registerOutputSourceImports();
const { reconcileOutputAssetStorage } = await import("../worker/output-asset-storage-control.ts");
hook.deregister();

test("an actual worker process exit after byte persistence leaves a durable private upload cleanup obligation", async () => {
  const directory = mkdtempSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.custody-crash-"));
  let state;
  try {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./fixtures/output-asset-crash-worker.mjs", import.meta.url))], { env: { ...process.env, FORMA_OUTPUT_CUSTODY_TEST_DIR: directory }, encoding: "utf8", timeout: 15_000 });
    assert.equal(child.status, 23, child.stderr || child.stdout);
    state = outputTestDatabase(resolve(directory, "state.sqlite"));
    const receipt = state.sqlite.prepare("SELECT * FROM output_asset_storage_writes").get();
    assert.ok(receipt);
    assert.equal(receipt.status, "writing");
    assert.equal(receipt.write_acknowledged, 0);
    assert.equal(receipt.publication_event_id, null);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_assets").get().count, 0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands").get().count, 0);
    const stored = JSON.parse(readFileSync(resolve(directory, "private-object.json"), "utf8"));
    assert.equal(stored.key, receipt.storage_key);
    const bytes = new Uint8Array(readFileSync(resolve(directory, "private-object.bin")));
    assert.equal(bytes.byteLength, receipt.byte_length);
    state.media.set(stored.key, { bytes, metadata: stored.metadata, contentType: stored.contentType });
    state.sqlite.prepare("UPDATE output_asset_storage_writes SET updated_at='2000-01-01T00:00:00.000Z'").run();
    const result = await reconcileOutputAssetStorage(state.env, { ownerUserId: "dev-local-creative", personalOnly: true });
    assert.deepEqual(result, { scanned: 1, deleted: 0, pending: 1 });
    assert.equal(state.media.size, 0);
    assert.equal(state.sqlite.prepare("SELECT status FROM output_asset_storage_writes").get().status, "cleanup_pending", "absence cannot settle an unacknowledged in-flight write");
  } finally { state?.sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
});
