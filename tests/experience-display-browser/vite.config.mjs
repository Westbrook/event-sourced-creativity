import nativeConfig from "../model3d-native/vite.config.mjs";

// Static source only; use actual experience routes without a server backend.
export default {
  ...nativeConfig,
  cacheDir: "/private/tmp/forma-display-vite-cache-20260917",
  plugins: [...nativeConfig.plugins, {
    name: "forma-display-fixture-routes",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url, "http://localhost");
        if (/^\/experiences\/(image|slides|short-story|scene|model3d|storyboard|audio|video)\/?$/.test(url.pathname))
          request.url = "/tests/experience-display-browser/index.html" + url.search;
        next();
      });
    },
  }],
  server: { ...nativeConfig.server, port: 4197 },
  preview: { ...nativeConfig.preview, port: 4197 },
};
