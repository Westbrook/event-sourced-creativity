import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerOutputSourceImports, outputTestDatabase } from "../output-server-test-helpers.mjs";
const hook = registerOutputSourceImports();
const { ensureSchema, makeEvent, appendEvents } = await import("../../worker/runtime.ts");
const { handleOutputRequirements } = await import("../../worker/output-requirements-api.ts");
const { png } = await import("../output-asset-fixtures.mjs");
hook.deregister();
globalThis.fetch = async () => { throw new Error("network_provider_sentinel"); };
const directory = process.env.FORMA_OUTPUT_CUSTODY_TEST_DIR;
if (!directory) throw new Error("isolated_fixture_directory_required");
const state = outputTestDatabase(resolve(directory, "state.sqlite"));
await ensureSchema(state.env);
const owner = "dev-local-creative", now = new Date().toISOString(), document = "crash-document", project = "crash-project";
state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)").run(owner, "creative@local.forma", "Local fixture", now, now, now);
await appendEvents(state.env, [
  makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "seed", "ProjectCreated", { project_id: project, name: "Crash custody fixture" }),
  makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "seed", "DocumentCreated", { project_id: project, document_id: document, title: "Upload crash fixture" }),
  makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "seed", "BlockCreated", { project_id: project, document_id: document, block_id: "source", type: "direction", scope: "document", properties: { text: "Private fixture instructions.", authority: "authored" } }),
]);
const base = "/api/output-requirements", context = { waitUntil() { throw new Error("unexpected_background_work"); } };
const snapshotResponse = await handleOutputRequirements(new Request(`http://localhost${base}?documentId=${document}`), state.env, base, context);
if (snapshotResponse.status !== 200) throw new Error(await snapshotResponse.text());
const snapshot = await snapshotResponse.json();
state.env.MEDIA.put = async (key, value, options) => {
  const receipt = state.sqlite.prepare("SELECT * FROM output_asset_storage_writes WHERE storage_key=?").get(key);
  if (!receipt || receipt.status !== "writing" || receipt.write_acknowledged !== 0) process.exit(99);
  writeFileSync(resolve(directory, "private-object.bin"), new Uint8Array(value));
  writeFileSync(resolve(directory, "private-object.json"), JSON.stringify({ key, metadata: options.customMetadata, contentType: options.httpMetadata.contentType }));
  // Exit the actual worker process after durable bytes, before acknowledgement or
  // any finally block. The parent can inspect the committed SQLite receipt.
  process.exit(23);
};
const request = new Request(`http://localhost${base}/assets?documentId=${document}`, { method: "POST", headers: {
  "content-type": "image/png", "x-output-filename": "private-fixture.png", "x-output-rights-confirmed": "true",
  "x-output-expected-revision": snapshot.revision, "x-output-client-mutation-id": "crashed-upload",
}, body: png({ width: 2, height: 2 }) });
await handleOutputRequirements(request, state.env, `${base}/assets`, context);
throw new Error("fixture_failed_to_crash");
