import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

export const SITE_ROUTE_ENTRIES = [
  { path: "/", module: "src/components/forma-workspace.ts", title: "Forma — An event-sourced creative studio", description: "Forma is an event-sourced creative studio with replayable context, provenance, and human-governed agents." },
  { path: "/document", module: "src/components/forma-workspace.ts", title: "Document — Forma", description: "Open a durable creative document in Forma." },
  { path: "/projects", module: "src/components/forma-projects.ts", title: "Projects — Forma", description: "Open and manage the creative projects in Forma." },
  { path: "/studio/project", module: "src/components/forma-project-contents.ts", title: "Project overview — Forma", description: "Review every collection and document in the current Forma project." },
  { path: "/studio/board", module: "src/components/forma-studio-alternatives.ts", title: "Context board — Forma", description: "Arrange replayable creative context as a spatial working board." },
  { path: "/studio/guided", module: "src/components/forma-studio-alternatives.ts", title: "Guided brief — Forma", description: "Turn a guided creative interview into structured, replayable context." },
  { path: "/studio/layers", module: "src/components/forma-studio-editor-alternatives.ts", title: "Reality layers — Forma", description: "Compose and edit creative context as independently controlled reality layers." },
  { path: "/studio/adaptive", module: "src/components/forma-studio-editor-alternatives.ts", title: "Adaptive path — Forma", description: "Build creative context through an interface that responds to intent and prior decisions." },
  { path: "/studio/editor", module: "src/components/forma-creative-editor.ts", title: "Creative editor — Forma", description: "Shape a complete creative document through a focused editor that keeps system machinery out of the way." },
  { path: "/studio/chat", module: "src/components/forma-chat-studio.ts", title: "Chat — Forma", description: "Shape a complete creative document through a conversation with Forma and generate visual results." },
  { path: "/library", module: "src/components/forma-library.ts", title: "Project library — Forma", description: "Review reusable context, recent outputs, and aesthetic families in the current project." },
  { path: "/sessions", module: "src/components/forma-sessions.ts", title: "Re-entry — Forma", description: "Resume witnessed work through event-derived sessions and re-entry briefs." },
  { path: "/scout", module: "src/components/forma-scout.ts", title: "Scout — Forma", description: "Run bounded creative research and inspect its evidence." },
  { path: "/memory", module: "src/components/forma-memory.ts", title: "Taste & time — Forma", description: "Review reversible preferences, taste evidence, and time-based memory." },
  { path: "/system", module: "src/components/forma-system.ts", title: "System & governance — Forma", description: "Review governance, evaluation gates, privacy, and system health." },
  { path: "/system/focal-points", module: "src/components/forma-focal-point-lab.ts", title: "Focal-point laboratory — Forma", description: "Compare focal-point coordinate interpretation and image containment across generated and uploaded images." },
  { path: "/admin/events", module: "src/components/forma-admin-events.ts", title: "Event administration — Forma", description: "Inspect and replay the durable creative event stream." },
  { path: "/admin/events/stream", module: "src/components/forma-admin-events.ts", title: "Durable stream — Forma", description: "Inspect the immutable envelopes and payloads in Forma’s durable creative stream." },
  { path: "/admin/events/replay", module: "src/components/forma-admin-events.ts", title: "Replay laboratory — Forma", description: "Build and replay theoretical long-running creative event streams." },
  { path: "/admin/events/permissions", module: "src/components/forma-admin-events.ts", title: "Producer permissions — Forma", description: "Review event producer permissions, authority boundaries, and concurrency behavior." },
  { path: "/share", module: "src/components/forma-shared-view.ts", title: "Shared creative context — Forma", description: "Open an expiring, read-only creative context handoff." },
] as const;

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
    const routeModuleTag = `<script type="module" crossorigin src="/${escapeAttribute(routeModule.file)}" data-forma-route-module="${escapeAttribute(entry.path)}"></script>`;
    const entryHtml = source
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
