import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { SITE_ROUTE_ENTRIES } from "../src/platform/applications";

export { SITE_ROUTE_ENTRIES } from "../src/platform/applications";

type ViteManifestEntry = { file: string; src?: string };

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
    const relativePath = entry.path.slice(1);
    const sessionPrefetchTag = entry.path === "/share" ? ""
      : '<script id="forma-static-session-prefetch">if(!/^\\/share(?:\\/|$)/.test(location.pathname)){const started=performance.now(),pending=fetch("/api/session");pending.catch(()=>{});window.__formaInitialSession=pending;document.documentElement.dataset.formaSessionPrefetchStartedMs=String(Math.round(started*10)/10)}</script>';
    const routeModuleTag = `<script type="module" crossorigin src="/${escapeAttribute(routeModule.file)}" data-forma-route-module="${escapeAttribute(entry.path)}" data-forma-application="${entry.application}"></script>`;
    const entryHtml = source
      .replace(/(<meta charset="[^"]+"\s*\/?>)/i, `$1${sessionPrefetchTag ? `\n    ${sessionPrefetchTag}` : ""}`)
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttribute(entry.title)}</title>`)
      .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeAttribute(entry.description)}" />`)
      .replace("</head>", `    <meta name="forma-entry" content="${escapeAttribute(entry.path)}" />\n    ${routeModuleTag}\n  </head>`);
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
