import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import typescript from "typescript";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relative) => readFile(resolve(projectRoot, relative), "utf8");
const featurePacks = ["authoring", "canvas", "formatting", "history", "media", "navigation"];
const iconFiles = ["src/components/icons.ts", ...featurePacks.map((name) => `src/components/icons-${name}.ts`)];
const sourceCache = new Map();

const sourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  }));
  return nested.flat();
};

const sourceFor = (path) => {
  if (!sourceCache.has(path)) sourceCache.set(path, readFile(path, "utf8"));
  return sourceCache.get(path);
};

const runtimeImports = (path, source) => {
  const file = typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true);
  return file.statements.flatMap((statement) => {
    if (typescript.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) return [];
      if (
        clause?.namedBindings && typescript.isNamedImports(clause.namedBindings)
        && !clause.name && clause.namedBindings.elements.every((element) => element.isTypeOnly)
      ) return [];
      return typescript.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : [];
    }
    if (typescript.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier) {
      return typescript.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : [];
    }
    return [];
  });
};

const resolveRuntimeImport = (owner, specifier) => {
  if (!specifier.startsWith(".")) return undefined;
  const path = resolve(dirname(owner), specifier);
  if (extname(path) && !path.endsWith(".ts") && !path.endsWith(".tsx")) return undefined;
  return [path, `${path}.ts`, `${path}.tsx`, resolve(path, "index.ts")]
    .find((candidate) => existsSync(candidate) && !candidate.endsWith(".d.ts"));
};

const staticClosure = async (entry) => {
  const visited = new Set();
  const queue = [resolve(projectRoot, entry)];
  while (queue.length) {
    const path = queue.pop();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    for (const specifier of runtimeImports(path, await sourceFor(path))) {
      const imported = resolveRuntimeImport(path, specifier);
      if (imported && !visited.has(imported)) queue.push(imported);
    }
  }
  return new Set(featurePacks.filter((pack) => visited.has(resolve(projectRoot, `src/components/icons-${pack}.ts`))));
};

test("icons use explicit, trusted Phosphor Regular SVGs rather than a package-wide registry", async () => {
  const sources = await Promise.all(iconFiles.map(read));
  const imports = sources.flatMap((source) => [...source.matchAll(/from\s+["'](@phosphor-icons\/core\/regular\/[^"']+\.svg\?raw)["']/g)]);
  const coreImports = [...sources[0].matchAll(/@phosphor-icons\/core\/regular\/[^"']+\.svg\?raw/g)];

  assert.ok(imports.length >= 50, "the system covers the complete audited application vocabulary");
  assert.ok(coreImports.length <= 20, "the eager shell contains only its focused icon vocabulary");
  assert.equal(new Set(imports.map((match) => match[1])).size, imports.length - 2, "only deliberate grid/storyboard and edit/draw artwork aliases are shared");
  assert.match(sources[0], /unsafeHTML\(source\)/);
  assert.match(sources[0], /aria-hidden="true" focusable="false" width="20" height="20"/);
  assert.match(sources[0], /definitions\.get\("info"\)/);

  for (const source of sources) {
    assert.doesNotMatch(source, /from\s+["']@phosphor-icons\/core["']/);
    assert.doesNotMatch(source, /import\.meta\.glob|\bfetch\(|new\s+URL\(|import\s*\(/);
  }
});

test("icon feature packs remain synchronous, route-local, and absent from focused shell pages", async () => {
  assert.deepEqual(await staticClosure("src/main.ts"), new Set(), "the shell must not load a feature pack");
  assert.deepEqual(await staticClosure("src/components/forma-analytics.ts"), new Set(), "Analytics only needs core actions");

  const projects = await staticClosure("src/components/forma-projects.ts");
  assert.ok(!projects.has("authoring") && !projects.has("canvas") && !projects.has("formatting") && !projects.has("navigation"));

  const canvas = await staticClosure("src/canvas/canvas-application.ts");
  for (const pack of ["authoring", "canvas", "media", "navigation"]) {
    assert.ok(canvas.has(pack), `Canvas synchronously registers ${pack} icons with its existing route`);
  }

  assert.deepEqual(await staticClosure("src/components/forma-design-system-lab.ts"), new Set(featurePacks));
});

test("production chunks contain only the synchronous SVG artwork needed by each route", async () => {
  const manifest = JSON.parse(await read("dist/client/.vite/manifest.json"));
  const closure = async (...roots) => {
    const visited = new Set();
    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      assert.ok(manifest[id], `${id} exists in the production manifest`);
      for (const dependency of manifest[id].imports ?? []) visit(dependency);
    };
    roots.forEach(visit);
    return (await Promise.all([...visited].map((id) => read(`dist/client/${manifest[id].file}`)))).join("\n");
  };
  const markerFiles = {
    authoring: "eye-slash",
    canvas: "cursor",
    formatting: "text-b",
    history: "arrows-clockwise",
    media: "book-open-text",
    navigation: "folder-simple",
  };
  const markers = Object.fromEntries(await Promise.all(Object.entries(markerFiles).map(async ([pack, name]) => {
    const svg = await read(`node_modules/@phosphor-icons/core/assets/regular/${name}.svg`);
    const marker = svg.match(/<path d="([^"]+)"/)?.[1];
    assert.ok(marker, `${pack} has an unmistakable Phosphor SVG path`);
    return [pack, marker];
  })));
  const check = (source, included, excluded) => {
    for (const pack of included) assert.ok(source.includes(markers[pack]), `production route includes ${pack} artwork`);
    for (const pack of excluded) assert.ok(!source.includes(markers[pack]), `production route excludes ${pack} artwork`);
  };

  check(
    await closure("index.html", "src/apps/product/entry.ts", "src/apps/product/insights.ts"),
    [], featurePacks,
  );
  check(
    await closure("index.html", "src/apps/creative/entry.ts", "src/components/forma-projects.ts"),
    ["history", "media"], ["authoring", "canvas", "formatting", "navigation"],
  );
  check(
    await closure("index.html", "src/apps/canvas/entry.ts", "src/canvas/canvas-application.ts"),
    featurePacks, [],
  );
  check(
    await closure("index.html", "src/apps/knowledge/entry.ts", "src/components/forma-design-system-lab.ts"),
    featurePacks, [],
  );
  for (const entry of Object.values(manifest)) {
    assert.ok(!(entry.dynamicImports ?? []).some((id) => id.includes("icons-")), "icons never require separate lazy-loading requests");
    assert.doesNotMatch(entry.file, /\.(?:svg|woff2?|ttf)$/i, "icon artwork never becomes a standalone font or network asset");
  }
});

test("icons reserve stable, matching geometry in light DOM and design-system shadow roots", async () => {
  const [global, shadow, canvas] = await Promise.all([
    read("src/design-system.css"),
    read("src/components/design-system/slotted-element.ts"),
    read("src/canvas/canvas.css"),
  ]);
  assert.match(global, /\.forma-icon\s*\{[^}]*inline-size:\s*var\(--forma-icon-size,\s*1\.25rem\)[^}]*block-size:\s*var\(--forma-icon-size,\s*1\.25rem\)/);
  assert.match(shadow, /\.forma-icon\s*\{[^}]*inline-size:\s*var\(--forma-icon-size,\s*1\.25rem\)[^}]*block-size:\s*var\(--forma-icon-size,\s*1\.25rem\)/);
  assert.match(global, /\.ui-icon--small\s*\{\s*--forma-icon-size:\s*1rem/);
  assert.match(global, /\.ui-icon--medium\s*\{\s*--forma-icon-size:\s*1\.25rem/);
  assert.match(global, /\.ui-icon--large\s*\{\s*--forma-icon-size:\s*1\.5rem/);
  assert.match(global, /\.asset-preview\.large\s*>\s*span\s*\{\s*--forma-icon-size:\s*2rem/);
  assert.match(canvas, /\.canvas-output-navigation\.previous\s*\{\s*inset-inline-start:\s*1rem/);
  assert.match(canvas, /\.canvas-output-navigation\.next\s*\{\s*inset-inline-end:\s*1rem/);
});

test("application components never reintroduce legacy pictographic glyphs or stringify an SVG result", async () => {
  const files = (await Promise.all([
    sourceFiles(resolve(projectRoot, "src/components")),
    sourceFiles(resolve(projectRoot, "src/canvas")),
  ])).flat();
  const legacyGlyph = /[⌂⌁⌕⠿↶↷⧉▰▱▦▧▤◌○◐◆✦✎↙↗↔‹›❝⌗Ⅱ▶▷◫⌖⌬◉⌫☰◷△½•]/u;

  for (const path of files) {
    const source = await sourceFor(path);
    assert.doesNotMatch(source, legacyGlyph, `${path} contains a legacy text-glyph icon`);

    const file = typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (typescript.isTemplateExpression(node) && !typescript.isTaggedTemplateExpression(node.parent)) {
        const inspectExpression = (expression) => {
          if (typescript.isTaggedTemplateExpression(expression)) return;
          if (
            typescript.isCallExpression(expression)
            && typescript.isIdentifier(expression.expression)
            && expression.expression.text === "icon"
          ) {
            assert.fail(`${path}:${file.getLineAndCharacterOfPosition(expression.getStart()).line + 1} stringifies an icon TemplateResult`);
          }
          typescript.forEachChild(expression, inspectExpression);
        };
        for (const span of node.templateSpans) inspectExpression(span.expression);
      }
      typescript.forEachChild(node, visit);
    };
    visit(file);
  }

  const semanticSurfaces = [
    "studio-navigation", "forma-library", "forma-workspace", "output-card", "context-block",
    "forma-creative-editor", "forma-studio-editor-alternatives",
  ];
  for (const name of semanticSurfaces) {
    assert.doesNotMatch(
      await read(`src/components/${name}.ts`),
      /(?:block\.type|option\.label|axis|reality\.label|FRIENDLY_LABELS\[[^\]]+\])\.slice\(0,\s*2\)/,
      `${name} substitutes letters for a semantic product icon`,
    );
  }
});

test("the complete living icon gallery remains translated, accessible, and RTL-aware", async () => {
  const lab = await read("src/components/forma-design-system-lab.ts");
  const viewer = await read("src/canvas/canvas-application.ts");
  const families = ["navigation", "authoring", "formatting", "media", "canvas", "states", "operations"];
  const names = [
    "home", "folder", "grid", "back", "spark", "edit", "undo", "redo", "bold", "italic",
    "bullets", "link", "image", "story", "slides", "video", "select", "marquee", "scope",
    "focal-point", "check", "warning", "lock", "unlock", "clock", "replay", "branch", "flask",
  ];
  for (const [locale, messages] of [["French", frenchMessages], ["Arabic", arabicMessages]]) {
    for (const key of [
      "lab.iconHeading", "lab.iconDescription", "lab.iconSizes",
      ...families.map((family) => `lab.iconFamily.${family}`),
      ...names.map((name) => `lab.icon.${name}`),
    ]) assert.ok(messages[key], `${locale} translation missing for ${key}`);
  }
  assert.match(lab, /class="design-icon-sizes"\s+role="group"/);
  assert.match(lab, /small:\s*this\.i18n\.number\(16\)/);
  assert.match(lab, /medium:\s*this\.i18n\.number\(20\)/);
  assert.match(lab, /large:\s*this\.i18n\.number\(24\)/);
  assert.match(viewer, /rtl=this\.matches\(":dir\(rtl\)"\)/);
  assert.match(viewer, /aria-keyshortcuts=\$\{rtl\?"ArrowRight":"ArrowLeft"\}/);
  assert.match(viewer, /icon\(rtl\?"next":"previous"\)/);
  assert.match(viewer,/aria-label=\$\{this\.i18n\.t\("canvas\.backToProjectBoards","Back to project boards"\)\}><span class="ui-directional-icon">\$\{icon\("back"\)\}<\/span><\/a>/);
  const canvasStyles=await read("src/canvas/canvas.css");
  assert.doesNotMatch(canvasStyles,/\.canvas-board-identity>a\s*\{[^}]*transform:\s*rotate\(180deg\)/);
});
