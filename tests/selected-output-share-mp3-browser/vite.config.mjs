import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import selectedShareConfig from "../selected-output-share-browser/vite.config.mjs";

const bytes = readFileSync(new URL("./stereo-20-prepared.wav", import.meta.url));
if (bytes.length !== 3528044 || createHash("sha256").update(bytes).digest("hex") !== "eae13159a5b9273dee41f064db6cd44bb6e93ecf8138ebf424fbca2deb08b1a7")
  throw new Error("Expected accepted synthetic WAV fixture");

// Static Vite only, including its already reviewed disabled tooling transport.
// Embed the saved WAV as test data: browser code never imports a decoder or MP3.
export default {
  ...selectedShareConfig,
  publicDir: false,
  cacheDir: "/private/tmp/forma-selected-share-mp3-browser-vite-cache-20260917",
  plugins: [{ name: "forma-mp3-publisher-fixture", enforce: "pre",
    resolveId(id) { if (id === "virtual:forma-mp3-publisher-wav") return "\0" + id; },
    load(id) { if (id === "\0virtual:forma-mp3-publisher-wav") return `export default ${JSON.stringify(bytes.toString("base64"))};`; },
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (new URL(request.url, "http://localhost").pathname === "/") request.url = "/tests/selected-output-share-mp3-browser/index.html";
        next();
      });
    },
  }, ...selectedShareConfig.plugins],
  server: { ...selectedShareConfig.server, port: 5197 },
  preview: { ...selectedShareConfig.preview, port: 5197 },
  build: { outDir: "/private/tmp/forma-selected-share-mp3-browser-build-20260917", emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./index.html", import.meta.url)) } },
};
