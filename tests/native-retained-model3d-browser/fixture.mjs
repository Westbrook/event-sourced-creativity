import { MODEL_PATH, syntheticMedia } from "../model3d-native/assets.mjs";
const media = syntheticMedia(), reads = [], forbidden = [];
globalThis.fetch = async (input, init) => {
  const request = new Request(new URL(typeof input === "string" ? input : input.url, location.href), init);
  request.signal.throwIfAborted();
  const url = new URL(request.url), asset = media.get(url.pathname);
  if (request.method === "GET" && url.origin === location.origin && !url.search && asset) {
    reads.push(url.pathname); document.querySelector("#reads").textContent = reads.length + " model reads";
    return new Response(new Uint8Array(asset.bytes), { headers: { "content-type": asset.mime, "content-length": String(asset.bytes.length) } });
  }
  forbidden.push({ path: url.pathname, method: request.method }); document.querySelector("#forbidden").textContent = forbidden.length + " forbidden requests";
  throw Error("Fixture transport unavailable");
};
const { NativeRetainedModel3d } = await import("../../src/components/native-retained-model3d.ts");
const asset = media.get(MODEL_PATH);
const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", asset.bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
const result = () => ({ schemaVersion: 1, kind: "native-retained-output", output: "model3d",
  selection: { documentId: "fixture-document", artifactId: "fixture-model", revision: 0, contentSha256: "a".repeat(64) },
  title: "Local triangle · مثلث", expiresAt: "2099-01-01T00:00:00.000Z", content: { availability: "mesh-reference",
    files: [{ url: MODEL_PATH, mimeType: "model/gltf-binary", fileName: "local-triangle.glb", fileSize: asset.bytes.length, format: "glb", role: "mesh", sha256 }] } });
const leaf = new NativeRetainedModel3d(); leaf.result = result(); document.querySelector("#root").append(leaf); await leaf.updateComplete;
window.retainedModelFixture = {
  reads, forbidden, leaf,
  async replace() { leaf.result = { ...result(), title: "Replacement triangle", selection: { ...result().selection, artifactId: "fixture-replacement" } }; await leaf.updateComplete; },
  retire() { leaf.remove(); },
  async expire() { leaf.result = { ...result(), expiresAt: "2000-01-01T00:00:00.000Z" }; await leaf.updateComplete; },
};

leaf.dataset.fixtureSha256 = sha256; leaf.dataset.fixtureSource = MODEL_PATH;
const status = value => { document.querySelector("#fixture-status").textContent = value; };
document.querySelector("#replace").addEventListener("click", async () => { await window.retainedModelFixture.replace(); status("Result replaced"); });
document.querySelector("#arm-replace").addEventListener("click", () => { status("Replacement armed"); setTimeout(async () => { await window.retainedModelFixture.replace(); status("Result replaced"); }, 3000); });
document.querySelector("#arm-reconnect").addEventListener("click", () => { status("Reconnect armed"); setTimeout(() => { leaf.remove(); status("Detached"); setTimeout(async () => { document.querySelector("#root").append(leaf); await leaf.updateComplete; status("Reconnected; inspection closed"); }, 100); }, 3000); });
document.querySelector("#expire").addEventListener("click", async () => { await window.retainedModelFixture.expire(); status("Result expired"); });
document.querySelector("#arabic").addEventListener("click", () => { document.documentElement.lang = "ar"; document.documentElement.dir = "rtl"; status("Arabic RTL"); });
