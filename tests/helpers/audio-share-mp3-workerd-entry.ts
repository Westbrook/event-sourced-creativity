import { projectSelectedOutputShareMp3, copySelectedOutputShareMp3Bytes } from "../../worker/selected-output-share-mp3-projection.ts";
const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), x => x.toString(16).padStart(2, "0")).join("");
export default { async fetch(request: Request) {
  const source = new Uint8Array(await request.arrayBuffer()), expected = { sha256: request.headers.get("x-sha256")!, byteLength: source.length, mimeType: "audio/mpeg", recipe: "forma.audio.instrumental-20@1" };
  const action = new URL(request.url).pathname.slice(1), controller = new AbortController();
  if (action === "preabort") controller.abort();
  if (action === "wrong-hash") expected.sha256 = "0".repeat(64);
  if (action === "during-abort") setTimeout(() => controller.abort(), 0);
  if (action === "bad-facts") Object.defineProperty(expected, "sha256", { get() { throw new Error("getter_called"); } });
  if (action === "extra-fact") Object.assign(expected, { approved: true });
  if (action === "shadow-getter") Object.defineProperty(source, "byteLength", { get() { throw new Error("byte_getter_called"); } });
  if (action === "detached") structuredClone(source.buffer, { transfer: [source.buffer] });
  const input = action === "subclass" ? new (class extends Uint8Array {})(source)
    : action === "impostor" ? Object.create(Uint8Array.prototype) : source;
  const nativeTimer = globalThis.setTimeout; let yields = 0;
  if (action === "deadline" || action === "after-yield-abort") globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    if (delay === 0) {
      yields++;
      if (action === "deadline") return nativeTimer(() => {}, 6000);
      return nativeTimer(() => { controller.abort(); callback(); }, 0);
    }
    return nativeTimer(callback, delay);
  }) as typeof setTimeout;
  const pending = projectSelectedOutputShareMp3(input, expected, action === "fake-signal" ? {} as AbortSignal : controller.signal);
  if (action === "mutation") source.fill(0);
  let simultaneous;
  if (action === "concurrent") simultaneous = await projectSelectedOutputShareMp3(source, expected, new AbortController().signal);
  let result;
  try { result = await pending; } finally { globalThis.setTimeout = nativeTimer; }
  let afterTimeout;
  if (action === "deadline" || action === "after-yield-abort") afterTimeout = await projectSelectedOutputShareMp3(source, expected, new AbortController().signal);
  const bytes = copySelectedOutputShareMp3Bytes(result);
  const forged = copySelectedOutputShareMp3Bytes(JSON.parse(JSON.stringify(result)));
  const bytesHash = bytes ? await digest(bytes) : null;
  let copiedIndependently = true;
  if (bytes) { bytes.fill(0); const second = copySelectedOutputShareMp3Bytes(result); copiedIndependently = !!second && await digest(second) === bytesHash; second?.fill(0); }
  return Response.json({ result, simultaneous, afterTimeout, yields, bytesHash, forged: forged !== null, copiedIndependently });
} };
