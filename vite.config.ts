import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const protectedSurfaceModules = new Map([
  ["/src/components/forma-system.ts", "operations"],
  ["/src/components/forma-analytics.ts", "operations"],
  ["/src/components/forma-admin-events.ts", "operations"],
  ["/src/components/forma-image-adapter-lab.ts", "operations"],
  ["/src/components/forma-focal-point-lab.ts", "knowledge/components"],
  ["/src/components/forma-design-system-lab.ts", "knowledge"],
  ["/src/components/design-system/component-catalog.ts", "knowledge/components"],
  ["/src/components/forma-platform-shell.ts", "internal"],
  ["/src/components/forma-role-dashboard.ts", "internal"],
]);

function applicationChunkName(chunk: { facadeModuleId?: string | null; moduleIds?: readonly string[] }) {
  const path = chunk.facadeModuleId?.replaceAll("\\", "/") ?? "";
  if (path.includes("virtual:cloudflare/worker-entry")) return "index.js";
  const app = ["operations", "product", "knowledge", "engineering"].find((candidate) => path.includes(`/src/apps/${candidate}/`));
  const productFile=path.match(/\/([^/]+)\.ts$/)?.[1]??"";
  const task=app==="product"&&["insights","delivery","evaluation","actual-replay","synthetic-replay","adapter-preview"].includes(productFile)?({"actual-replay":"actual","synthetic-replay":"replay","adapter-preview":"adapters"} as Record<string,string>)[productFile]??productFile
    :app==="operations"&&/\/(?:access-management|canvas-governance|providers|overview)\.ts$/.test(path)?({"access-management":"access","canvas-governance":"release",providers:"providers",overview:"overview"} as Record<string,string>)[path.match(/\/([^/]+)\.ts$/)?.[1]??""]
    :"";
  const explicit = [...protectedSurfaceModules].find(([module]) => path.endsWith(module))?.[1];
  const inherited = [...new Set((chunk.moduleIds ?? []).flatMap((module) => {
    const normalized = module.replaceAll("\\", "/");
    const explicitOwner=[...protectedSurfaceModules].find(([protectedModule])=>normalized.endsWith(protectedModule))?.[1];
    const owner = explicitOwner??["operations", "product", "knowledge", "engineering"].find((candidate) => normalized.includes(`/src/apps/${candidate}/`));
    return owner ? [owner] : [];
  }))];
  const owner = app?`${app}${task?`/${task}`:""}`:explicit ?? (inherited.length === 1 ? inherited[0] : inherited.length > 1 ? "internal" : "");
  return `${owner ? `protected-assets/${owner}` : "assets"}/[name]-[hash].js`;
}

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_date: "2026-05-22",
  compatibility_flags: ["nodejs_compat"],
  assets: {
    binding: "ASSETS",
    not_found_handling: "single-page-application" as const,
    // Every navigation is classified by the Worker before an asset or SPA
    // fallback is considered. This keeps refreshes and copied deep links on the
    // same application entry point as client-side navigation.
    // Keep navigation/API routing in the Worker while immutable bundles stay
    // at the visitor's nearest edge instead of paying a Worker invocation.
    run_worker_first: ["/*", "!/assets/*"],
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    build: { manifest: true, rollupOptions: { output: { entryFileNames: applicationChunkName, chunkFileNames: applicationChunkName } } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      sites(),
      cloudflare({ viteEnvironment: { name: "server" }, config: localBindingConfig, inspectorPort: false }),
    ],
  };
});
