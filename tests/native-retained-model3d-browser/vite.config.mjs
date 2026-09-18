import nativeConfig from "../model3d-native/vite.config.mjs";
// Same reviewed static-module transport boundary; no application server plugins.
export default { ...nativeConfig, cacheDir: "/private/tmp/forma-retained-model3d-vite-cache-20260917",
  server: { ...nativeConfig.server, port: 4196 }, preview: { ...nativeConfig.preview, port: 4196 } };
