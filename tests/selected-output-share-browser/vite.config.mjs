import { fileURLToPath } from "node:url";
import nativeConfig from "../model3d-native/vite.config.mjs";

// Reuse the reviewed static Vite transport boundary. No Sites, Cloudflare,
// Worker, Store, D1, R2 or provider backend is installed by this fixture.
export default {
  ...nativeConfig,
  publicDir: false,
  cacheDir: "/private/tmp/forma-selected-output-share-vite-cache-20260917",
  plugins: [...nativeConfig.plugins, {
    name: "forma-selected-output-share-fixture-routes",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url, "http://localhost");
        if (url.pathname === "/" || /^\/share\/output\/[A-Za-z0-9_-]{32}\/?$/u.test(url.pathname))
          request.url = "/tests/selected-output-share-browser/index.html" + url.search;
        next();
      });
    },
  }],
  server: { ...nativeConfig.server, port: 5189 },
  preview: { ...nativeConfig.preview, port: 5189 },
  build: {
    outDir: "/private/tmp/forma-selected-output-share-browser-build-20260917",
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./index.html", import.meta.url)) },
  },
};
