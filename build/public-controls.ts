import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Plugin } from "vite";

// Use Vite's existing CSS parser, just as the repository's stylesheet tests do.
// This module runs only at build/dev time; no parser enters the public bundle.
type CssNode = { type: string; text?: string; parent?: { type: string }; source: { start: { offset: number }; end: { offset: number } } };
const postcss = createRequire(import.meta.resolve("vite"))("postcss") as {
  parse(css: string, options: { from: string }): { nodes: CssNode[]; walkComments(callback: (node: CssNode) => void): void };
};

export const publicControlsId = "forma:public-controls.css";
export const publicControlsSources = [
  { path: "src/styles.css", fragments: ["tokens-base", "directional-icon", "legacy-buttons", "legacy-button-type", "legacy-motion"] },
  { path: "src/design-system.css", fragments: ["globals", "buttons", "button-variants", "fields", "motion", "input-colors", "reflow", "primitives", "forced-colors", "contrast", "control-focus", "icons", "spinner", "field-label", "field-border", "button-radius", "spinner-accessibility"] },
] as const;

/** Exact whole-rule fragments, in their original cascade order. Never dedupe or hoist. */
export function extractPublicControls(css: string, path: string, expected: readonly string[]): string {
  const root = postcss.parse(css, { from: path });
  root.walkComments(node => {
    if (!node.text?.startsWith("forma-public:")) return;
    if (node.parent?.type !== "root" || !/^forma-public:(start|end) [a-z-]+$/u.test(node.text)) throw new Error(`public_styles_marker:${path}`);
  });
  let current: string | undefined, groupNodes = 0;
  const found: string[] = [], output: string[] = [];
  for (const node of root.nodes) {
    const marker = node.type === "comment" ? node.text?.match(/^forma-public:(start|end) ([a-z-]+)$/u) : null;
    if (marker) {
      const [, action, name] = marker;
      if (action === "start") {
        if (current || found.includes(name)) throw new Error(`public_styles_duplicate:${path}:${name}`);
        current = name; groupNodes = 0; found.push(name);
      } else {
        if (current !== name || !groupNodes) throw new Error(`public_styles_unbalanced:${path}:${name}`);
        current = undefined;
      }
    } else if (current) {
      if (node.type !== "comment") groupNodes++;
      // AST boundaries preserve complete rules, including the semicolon of @import.
      // Serializing an isolated at-rule can omit that semicolon and swallow the next rule.
      output.push(css.slice(node.source.start.offset, node.source.end.offset));
    }
  }
  if (current || found.join("|") !== expected.join("|")) throw new Error(`public_styles_contract:${path}`);
  const result = output.join("\n");
  // A marker nested inside a rule cannot silently publish an incomplete group.
  if (/forma-public:/u.test(result)) throw new Error(`public_styles_nested:${path}`);
  postcss.parse(result, { from: path });
  return result;
}

export async function readPublicControls(root: string): Promise<string> {
  const fragments = await Promise.all(publicControlsSources.map(async source =>
    extractPublicControls(await readFile(resolve(root, source.path), "utf8"), source.path, source.fragments)));
  return fragments.join("\n");
}

/** Shared source, separate payload: main keeps its original CSS and import order. */
export function publicControls(): Plugin {
  let root = "", moduleId = "";
  let sources: string[] = [];
  return {
    name: "forma-public-controls",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
      moduleId = resolve(root, "src/components/design-system/public-controls.virtual.css");
      sources = publicControlsSources.map(source => resolve(root, source.path));
    },
    resolveId(id) { if (id === publicControlsId) return moduleId; },
    async load(id) {
      if (id !== moduleId) return;
      for (const path of sources) this.addWatchFile(path);
      return readPublicControls(root);
    },
    handleHotUpdate(context) {
      if (!sources.includes(context.file)) return;
      const shared = context.server.moduleGraph.getModuleById(moduleId);
      if (shared) return [...new Set([...context.modules, shared])];
    },
  };
}
