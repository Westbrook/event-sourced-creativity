import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { applicationIdFromRoute, routeRequiredCapabilities, SITE_ROUTE_ENTRIES } from "../src/platform/applications";

export { SITE_ROUTE_ENTRIES } from "../src/platform/applications";

type ViteManifestEntry = { file: string; src?: string; css?: string[] };

function routeDataPrefetch(path: string): string | null {
  if(path==="/product/evaluation/actual"||path==="/admin/events/replay")return "/api/replay-sessions";
  if(path==="/product/evaluation/replay"||path==="/laboratory/replay")return null;
  if (path === "/operations" || path === "/system") return "/api/portfolio/operations/overview";
  if (path === "/operations/providers") return "/api/portfolio/operations/providers";
  if (path === "/product" || path === "/product/insights" || path === "/operations/analytics") return "/api/portfolio/product/insights";
  if (path === "/product/delivery") return "/api/portfolio/product/delivery";
  if (path === "/product/evaluation" || path === "/product/evaluation/adapters" || path === "/laboratory" || path === "/laboratory/replay" || path === "/laboratory/image-adapters" || path === "/admin/events/replay") return "/api/portfolio/product/evaluation";
  if (path === "/engineering" || path === "/engineering/jobs") return `/api/portfolio/engineering/${path.endsWith("/jobs") ? "jobs" : "health"}`;
  if (applicationIdFromRoute(path) === "engineering") return `/api/portfolio/engineering/${path.endsWith("/sync") ? "sync" : "events"}`;
  if (path === "/operations/canvas") return "/api/canvas-governance";
  return null;
}

function routeSurfaceModule(path: string): string | null {
  if (["/creative", "/projects", "/canvas/projects"].includes(path)) return "src/components/forma-projects.ts";
  if (["/", "/creative/create", "/document"].includes(path)) return "src/components/forma-workspace.ts";
  if (path === "/studio/project") return "src/components/forma-project-contents.ts";
  if (["/studio/board", "/studio/guided"].includes(path)) return "src/components/forma-studio-alternatives.ts";
  if (["/studio/layers", "/studio/adaptive"].includes(path)) return "src/components/forma-studio-editor-alternatives.ts";
  if (path === "/studio/editor") return "src/components/forma-creative-editor.ts";
  if (path === "/studio/chat") return "src/components/forma-chat-studio.ts";
  if (["/library", "/sessions", "/scout", "/memory", "/activity", "/deliver"].includes(path)) return `src/components/forma-${path.slice(1)}.ts`;
  if (path === "/canvas/library") return "src/components/forma-library.ts";
  if (path === "/settings") return "src/components/forma-account-settings.ts";
  if (path === "/share") return "src/components/forma-shared-view.ts";
  if (path === "/canvas" || path === "/canvas/proposals") return "src/canvas/canvas-application.ts";
  if (path === "/operations/access") return "src/apps/operations/access-management.ts";
  if (path === "/operations" || path === "/system") return "src/apps/operations/overview.ts";
  if (path === "/operations/providers") return "src/apps/operations/providers.ts";
  if (path === "/operations/canvas") return "src/apps/operations/canvas-governance.ts";
  const application = applicationIdFromRoute(path);
  if (application === "product") {
    if(path==="/product/evaluation/actual"||path==="/admin/events/replay")return "src/apps/product/actual-replay.ts";
    if(path==="/product/evaluation/replay"||path==="/laboratory/replay")return "src/apps/product/synthetic-replay.ts";
    if(path==="/product/evaluation/adapters"||path==="/laboratory/image-adapters")return "src/apps/product/adapter-preview.ts";
    if (path === "/product/delivery") return "src/apps/product/delivery.ts";
    if (path === "/product" || path === "/product/insights" || path === "/operations/analytics") return "src/apps/product/insights.ts";
    return "src/apps/product/evaluation.ts";
  }
  if (application === "knowledge") {
    if (path === "/knowledge/landing-pages") return "src/apps/knowledge/landing-pages.ts";
    return path.endsWith("/focal-points") ? "src/components/forma-focal-point-lab.ts" : "src/components/forma-design-system-lab.ts";
  }
  if (application === "engineering") return "src/apps/engineering/diagnostics.ts";
  throw new Error(`No isolated production surface was declared for ${path}.`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function writeRouteEntries(root: string) {
  const clientDirectory = resolve(root, "dist", "client");
  const sourcePath = resolve(clientDirectory, "index.html");
  if (!(await exists(sourcePath))) return;
  const source = await readFile(sourcePath, "utf8");
  const manifest = JSON.parse(await readFile(resolve(clientDirectory, ".vite", "manifest.json"), "utf8")) as Record<string, ViteManifestEntry>;
  for (const entry of SITE_ROUTE_ENTRIES) {
    const entryModule=entry.path==="/share"?"src/apps/public-share/entry.ts":entry.module;
    const routeModule = manifest[entryModule] ?? Object.values(manifest).find((candidate) => candidate.src === entryModule);
    if (!routeModule) throw new Error(`No production chunk was generated for ${entry.path} (${entry.module}).`);
    const surfaceModule = routeSurfaceModule(entry.path);
    const surfaceChunk = surfaceModule ? manifest[surfaceModule] ?? Object.values(manifest).find((candidate) => candidate.src === surfaceModule) : undefined;
    if (surfaceModule && !surfaceChunk) throw new Error(`No production surface was generated for ${entry.path} (${surfaceModule}).`);
    const relativePath = entry.path.slice(1);
    const sessionEndpoint=["operations","product","knowledge","engineering"].includes(entry.application)?`/api/session?audience=${entry.application}`:"/api/session";
    const sessionPrefetchTag = entry.path === "/share" ? ""
      : `<script id="forma-static-session-prefetch">if(!/^\\/share(?:\\/|$)/.test(location.pathname)){const started=performance.now(),pending=fetch(${JSON.stringify(sessionEndpoint)});pending.catch(()=>{});window.__formaInitialSession=pending;document.documentElement.dataset.formaSessionPrefetchStartedMs=String(Math.round(started*10)/10)}</script>`;
    const endpoint = routeDataPrefetch(entry.path);
    const prefetchCapabilities=entry.path==="/operations"?["platform.policy.manage","platform.incident.manage"]:entry.path==="/product"?["product.analytics.read"]:entry.path==="/engineering"?["engineering.diagnostics.read"]:routeRequiredCapabilities(entry.path);
    const routePrefetchTag = endpoint
      ? `<script id="forma-static-route-prefetch">{const path=${JSON.stringify(entry.path)},url=${JSON.stringify(endpoint)},required=${JSON.stringify(prefetchCapabilities)},session=window.__formaInitialSession,pending=session&&typeof session.then==="function"?session.then(response=>response.clone().json()).then(user=>{if(user?.impersonation||required.length&&!required.some(capability=>user?.capabilities?.includes(capability))||url==="/api/replay-sessions"&&user?.user?.role!=="admin")return null;document.documentElement.dataset.formaRoutePrefetchStartedMs=String(Math.round(performance.now()*10)/10);return fetch(url)}).catch(()=>null):Promise.resolve(null);window.__formaInitialRouteData={path,url,pending}}</script>`
      : "";
    const routeModuleTag = `<script type="module" crossorigin src="/${escapeAttribute(routeModule.file)}" data-forma-route-module="${escapeAttribute(entry.path)}" data-forma-application="${entry.application}"></script>`;
    const surfaceTags = surfaceChunk
      ? [`<link rel="modulepreload" crossorigin href="/${escapeAttribute(surfaceChunk.file)}" data-forma-route-leaf="${escapeAttribute(entry.path)}" />`, ...(surfaceChunk.css ?? []).map((stylesheet) => `<link rel="stylesheet" crossorigin href="/${escapeAttribute(stylesheet)}" data-forma-route-styles="${escapeAttribute(entry.path)}" />`)]
      : [];
    const entryHtml = source
      .replace("<forma-shell></forma-shell>", entry.path === "/share" ? "<forma-public-share></forma-public-share>" : ["operations", "product", "knowledge", "engineering"].includes(entry.application) ? "<forma-platform-shell></forma-platform-shell>" : "<forma-shell></forma-shell>")
      .replace(/(<meta charset="[^"]+"\s*\/?>)/i, `$1${sessionPrefetchTag ? `\n    ${sessionPrefetchTag}` : ""}${routePrefetchTag ? `\n    ${routePrefetchTag}` : ""}`)
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttribute(entry.title)}</title>`)
      .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeAttribute(entry.description)}" />`)
      .replace("</head>", `    <meta name="forma-entry" content="${escapeAttribute(entry.path)}" />\n    ${surfaceTags.map((tag) => `${tag}\n    `).join("")}${routeModuleTag}\n  </head>`);
    if (entry.path === "/") {
      await writeFile(sourcePath, entryHtml);
      continue;
    }
    const directoryPath = resolve(clientDirectory, relativePath);
    await mkdir(directoryPath, { recursive: true });
    await writeFile(resolve(directoryPath, "index.html"), entryHtml);
    await writeFile(resolve(clientDirectory, `${relativePath}.html`), entryHtml);
  }
}

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      }
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }
      await writeRouteEntries(root);
    },
  };
}
