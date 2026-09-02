import { defineConfig, normalizePath, version } from "vite";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Vite 8.0.13's public server.ws:false stops only the server transport.
// Its client is still required by CSS updateStyle and unconditionally calls
// transport.connect even with hmr:false. Keep that actual CSS runtime; remove
// only its tooling connection at the documented plugin transform boundary.
// A version or byte change fails closed and requires a fresh source review.
const clientFile = normalizePath(realpathSync(fileURLToPath(new URL("../../node_modules/vite/dist/client/client.mjs", import.meta.url))));
const clientSha256 = "1ba6825f4c5bd47372448d6cbec11b8241b75a17794ad70d768650e8cf94e91d";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const connect = "transport.connect(createHMRHandler(handleMessage));";
if (version !== "8.0.13" || sha256(readFileSync(clientFile)) !== clientSha256)
  throw new Error("The native3D tooling client needs review for this Vite version");
const noToolingConnection = {
  name: "forma-native3d-no-tooling-connection",
  enforce: "pre",
  apply: "serve",
  transform(code, id) {
    if (normalizePath(id.split("?", 1)[0]) !== clientFile) return null;
    if (sha256(code) !== clientSha256 || code.split(connect).length !== 2)
      this.error("Unexpected Vite client transformation; native3D network isolation cannot be established");
    return { code: code.replace(connect, "/* Native3D fixture: no tooling transport connection. */"), map: null };
  },
};

// Pure source server: intentionally excludes the application's Sites and
// Cloudflare plugins. No Worker, D1, R2, provider or application backend starts.
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  cacheDir: "node_modules/.vite-model3d-native",
  plugins: [noToolingConnection],
  server: { host: "127.0.0.1", port: 4181, strictPort: true, hmr: false, ws: false, forwardConsole: false, cors: false },
  preview: { host: "127.0.0.1", port: 4181, strictPort: true },
});
