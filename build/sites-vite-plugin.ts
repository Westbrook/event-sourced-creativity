import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { SITE_ROUTE_ENTRIES } from "../src/platform/applications";

export { SITE_ROUTE_ENTRIES } from "../src/platform/applications";

type ViteManifestEntry = { file: string; src?: string; css?: string[] };

function routeDataPrefetch(path: string): string | null {
  if (path === "/operations/analytics") return "/api/analytics?days=30&includeSynthetic=false";
  if (path === "/operations/canvas") return "/api/canvas-governance";
  if (["/operations/events", "/operations/events/stream", "/admin/events", "/admin/events/stream"].includes(path)) return "/api/events?audit=1&limit=150";
  if (path === "/laboratory/image-adapters") return "/api/image-adapters";
  return null;
}

function routeSurfaceModule(path: string): string | null {
  if (path === "/") return null;
  if (["/creative", "/projects"].includes(path)) return "src/components/forma-projects.ts";
  if (["/creative/create", "/document"].includes(path)) return "src/components/forma-workspace.ts";
  if (path === "/studio/project") return "src/components/forma-project-contents.ts";
  if (["/studio/board", "/studio/guided"].includes(path)) return "src/components/forma-studio-alternatives.ts";
  if (["/studio/layers", "/studio/adaptive"].includes(path)) return "src/components/forma-studio-editor-alternatives.ts";
  if (path === "/studio/editor") return "src/components/forma-creative-editor.ts";
  if (path === "/studio/chat") return "src/components/forma-chat-studio.ts";
  if (["/library", "/sessions", "/scout", "/memory"].includes(path)) return `src/components/forma-${path.slice(1)}.ts`;
  if (path === "/share") return "src/components/forma-shared-view.ts";
  if (path === "/canvas" || path === "/canvas/proposals") return "src/canvas/canvas-application.ts";
  if (path === "/operations" || path === "/system") return "src/components/forma-system.ts";
  if (path === "/operations/analytics") return "src/components/forma-analytics.ts";
  if (path === "/operations/canvas") return "src/apps/operations/canvas-governance.ts";
  if (["/operations/events/sync", "/admin/events/sync"].includes(path)) return "src/apps/operations/canvas-sync-inspector.ts";
  if (path === "/laboratory/image-adapters") return "src/components/forma-image-adapter-lab.ts";
  if (["/laboratory/focal-points", "/system/focal-points"].includes(path)) return "src/components/forma-focal-point-lab.ts";
  if (path === "/laboratory/design-system") return "src/components/forma-design-system-lab.ts";
  if (path.startsWith("/operations/events") || path.startsWith("/admin/events") || path === "/laboratory" || path === "/laboratory/replay") return "src/components/forma-admin-events.ts";
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
    const routeModule = manifest[entry.module] ?? Object.values(manifest).find((candidate) => candidate.src === entry.module);
    if (!routeModule) throw new Error(`No production chunk was generated for ${entry.path} (${entry.module}).`);
    const surfaceModule = routeSurfaceModule(entry.path);
    const surfaceChunk = surfaceModule ? manifest[surfaceModule] ?? Object.values(manifest).find((candidate) => candidate.src === surfaceModule) : undefined;
    if (surfaceModule && !surfaceChunk) throw new Error(`No production surface was generated for ${entry.path} (${surfaceModule}).`);
    const relativePath = entry.path.slice(1);
    const sessionPrefetchTag = entry.path === "/share" ? ""
      : '<script id="forma-static-session-prefetch">if(!/^\\/share(?:\\/|$)/.test(location.pathname)){const started=performance.now(),pending=fetch("/api/session");pending.catch(()=>{});window.__formaInitialSession=pending;document.documentElement.dataset.formaSessionPrefetchStartedMs=String(Math.round(started*10)/10)}</script>';
    const endpoint = routeDataPrefetch(entry.path);
    const routePrefetchTag = endpoint
      ? `<script id="forma-static-route-prefetch">{const path=${JSON.stringify(entry.path)},url=${JSON.stringify(endpoint)},session=window.__formaInitialSession,pending=session&&typeof session.then==="function"?session.then(response=>response.clone().json()).then(user=>{if(user?.user?.role!=="admin"||user.impersonation)return null;document.documentElement.dataset.formaRoutePrefetchStartedMs=String(Math.round(performance.now()*10)/10);return fetch(url)}).catch(()=>null):Promise.resolve(null);window.__formaInitialRouteData={path,url,pending}}</script>`
      : "";
    const routeModuleTag = `<script type="module" crossorigin src="/${escapeAttribute(routeModule.file)}" data-forma-route-module="${escapeAttribute(entry.path)}" data-forma-application="${entry.application}"></script>`;
    const surfaceTags = surfaceChunk
      ? [`<link rel="modulepreload" crossorigin href="/${escapeAttribute(surfaceChunk.file)}" data-forma-route-leaf="${escapeAttribute(entry.path)}" />`, ...(surfaceChunk.css ?? []).map((stylesheet) => `<link rel="stylesheet" crossorigin href="/${escapeAttribute(stylesheet)}" data-forma-route-styles="${escapeAttribute(entry.path)}" />`)]
      : [];
    const entryHtml = source
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
