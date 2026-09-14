import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, stripTypeScriptTypes } from "node:module";
import test from "node:test";

const { Miniflare, Log, LogLevel } = createRequire(import.meta.resolve("wrangler"))("miniflare");

test("local Worker fingerprints 40,000 event envelopes with resident private-image-sized bytes", { timeout: 60_000 }, async t => {
  const helper = stripTypeScriptTypes(await readFile(new URL("../worker/video-custody-snapshot.ts", import.meta.url), "utf8"));
  const mf = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", compatibilityFlags: ["nodejs_compat"],
    host: "127.0.0.1", port: 0, log: new Log(LogLevel.NONE),
    outboundService() { throw new Error("Synthetic qualification forbids external fetch"); },
    script: helper + `
      export default { fetch() {
        const image = new Uint8Array(8 * 1024 * 1024); image.fill(137);
        const events = Array.from({length: 40_000}, (_, i) => {
          const bytes = new Uint8Array(1_259); bytes.fill(120);
          bytes.set(new TextEncoder().encode(String(i)));
          return { type: "SyntheticHistory", payload: {text: new TextDecoder().decode(bytes)},
            eventId: "event-"+i, sequence:i+1, streamId:"synthetic", actor:"synthetic", occurredAt:"synthetic",
            correlationId:"synthetic", recordedAt:"synthetic", clientId:"synthetic", causationId:null,
            compensatesEventId:null,schemaVersion:1 };
        });
        const same = captureVideoCustodySnapshot({events});
        const first = same({events}), second = same({events});
        events[39_999].payload.text += "changed";
        return Response.json({first,second,changed:same({events}),imageBytes:image.byteLength,lastByte:image.at(-1)});
      }};
    `,
  });
  t.after(() => mf.dispose());
  const response = await mf.dispatchFetch("https://qualification.invalid/");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {first:true,second:true,changed:false,imageBytes:8*1024*1024,lastByte:137});
  t.diagnostic("Actual local workerd helper execution, not the whole hosted route, SQL or a production memory-limit guarantee.");
});
