import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import { extractPublicControls, publicControls, publicControlsId, publicControlsSources, readPublicControls } from "../build/public-controls.ts";

const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const root = new URL("../", import.meta.url).pathname;
const sources = await Promise.all(publicControlsSources.map(source => readFile(join(root, source.path), "utf8")));
const css = await readPublicControls(root);
const sheet = postcss.parse(css);
const ruleRecords = root => {
  const records = [];
  root.walkRules(rule => {
    const parents = [];
    for (let parent = rule.parent; parent?.type === "atrule"; parent = parent.parent) parents.unshift([parent.name, parent.params]);
    records.push({ selector: rule.selector, parents, declarations: rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value, !!node.important]) });
  });
  return records;
};

test("public CSS retains canonical selected rule/declaration order and complete conditions", () => {
  const expected = [];
  for (const source of sources) {
    const parsed = postcss.parse(source);
    // Use original source offsets as an independent oracle, not the extractor's node serialization.
    const ranges = [...source.matchAll(/\/\* forma-public:start ([a-z-]+) \*\/([\s\S]*?)\/\* forma-public:end \1 \*\//gu)]
      .map(match => [match.index, match.index + match[0].length]);
    parsed.nodes = parsed.nodes.filter(node => ranges.some(([start, end]) => node.source.start.offset > start && node.source.end.offset < end));
    expected.push(...ruleRecords(parsed));
  }
  assert.deepEqual(ruleRecords(sheet), expected);
  assert.equal(sheet.first.type, "rule");
  assert.equal(sheet.first.selector, ":root");
  assert.equal(sheet.nodes.filter(node => node.type === "atrule" && node.name === "import").length, 0);
  assert.doesNotMatch(css, /fonts\.googleapis\.com|fonts\.gstatic\.com/u);
  assert.ok(Buffer.byteLength(css) < 24_000);
  assert.ok(gzipSync(css).length < 6_000);
});

test("public CSS carries script, native field, focus, reflow and preference rules", () => {
  const rules = ruleRecords(sheet);
  for (const selector of [":root", ".sr-only", ".button", ".button.compact", ".ui-directional-icon:dir(rtl)", ".ui-field", ".ui-field > span", ".ui-field > .ui-field-error", ".ui-field--invalid > :is(input,textarea,select)", ".ui-field > :is(input,textarea,select)", ":where(input, textarea)::placeholder", "forma-ui-button .button", ".forma-icon > svg"]) {
    assert.ok(rules.some(rule => rule.selector === selector), selector);
  }
  assert.ok(rules.some(rule => rule.selector.includes(":root:lang(ar)")));
  assert.ok(rules.some(rule => rule.selector.includes(":root:lang(ja)")));
  assert.ok(rules.some(rule => rule.selector.includes(":is(button,input,textarea,select,summary,a):focus-visible")));
  for (const preference of ["(forced-colors: active)", "(prefers-contrast: more)", "(prefers-reduced-motion: reduce)"]) {
    assert.ok(rules.some(rule => rule.parents.some(([name, value]) => name === "media" && value === preference)), preference);
  }
  assert.ok(rules.some(rule => rule.selector === ".ui-spinner-mark" && rule.parents.some(([, value]) => value === "(forced-colors: active)")));
  assert.doesNotMatch(css, /\.studio-mode-nav|\.document-artifact-view|\.topbar\s*\{/u);
});

test("malformed, missing, repeated, reordered and nested publication fragments fail closed", () => {
  const valid = "/* forma-public:start a */.a {color: red}/* forma-public:end a */";
  assert.match(extractPublicControls(valid, "fixture", ["a"]), /color: red/u);
  for (const malformed of ["", valid + valid, valid.replace(".a {color: red}", ""), valid.replace("end a", "end b"), valid.replace("end a", "start b"), valid.replace("end a", "end a!") , ".x {" + valid + "}", valid + ".x {/* forma-public:start hidden */}", valid + "/* forma-public:unknown a */", valid.replace(".a {color: red}", ".a {color: red")]) {
    assert.throws(() => extractPublicControls(malformed, "fixture", ["a"]));
  }
  assert.throws(() => extractPublicControls(valid, "fixture", ["b", "a"]));
});

test("the real Vite hook watches both sources and reloads their exact current declarations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forma-public-css-"));
  try {
    for (const [index, source] of publicControlsSources.entries()) {
      const path = join(directory, source.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, sources[index]);
    }
    const plugin = publicControls();
    plugin.configResolved({ root: directory });
    const id = plugin.resolveId(publicControlsId), watched = [];
    assert.match(id, /public-controls\.virtual\.css$/u);
    assert.equal(plugin.resolveId("other.css"), undefined);
    assert.equal(await plugin.load.call({ addWatchFile: path => watched.push(path) }, id), css);
    assert.deepEqual(watched, publicControlsSources.map(source => join(directory, source.path)));
    const shared = {}, main = {};
    const context = { file: watched[0], modules: [main], server: { moduleGraph: { getModuleById: candidate => candidate === id ? shared : undefined } } };
    assert.deepEqual(plugin.handleHotUpdate(context), [main, shared]);
    assert.equal(plugin.handleHotUpdate({ ...context, file: "unrelated.css" }), undefined);
    await writeFile(watched[0], sources[0].replace("--space-1: .25rem;", "--space-1: .375rem;"));
    const updated = await plugin.load.call({ addWatchFile() {} }, id);
    assert.match(updated, /--space-1: \.375rem;/u);
    assert.doesNotMatch(updated, /--space-1: \.25rem;/u);
    assert.equal(await plugin.load.call({ addWatchFile() {} }, "other.css"), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("entry loads shared public controls before experience styles without full application sheets", async () => {
  const entry = await readFile(join(root, "src/experiences/entry.ts"), "utf8");
  const publicImport = entry.indexOf('import "forma:public-controls.css"'), experienceImport = entry.indexOf('import "./style.css"');
  assert.ok(publicImport >= 0 && experienceImport >= 0, "both experience style imports exist");
  assert.ok(publicImport < experienceImport);
  assert.doesNotMatch(entry, /import ["']\.\.\/(?:styles|design-system)\.css/u);
  const main = await readFile(join(root, "src/main.ts"), "utf8");
  const tokensImport = main.indexOf('import "./styles.css"'), systemImport = main.indexOf('import "./design-system.css"');
  assert.ok(tokensImport >= 0 && systemImport >= 0, "both application style imports exist");
  assert.ok(tokensImport < systemImport);
});

test("built experience dependency closure stays bounded and excludes full application CSS", async t => {
  const manifest = JSON.parse(await readFile(join(root, "dist/client/.vite/manifest.json"), "utf8"));
  const seen = new Set(), assets = new Set();
  const visit = key => {
    if (seen.has(key)) return;
    seen.add(key); const chunk = manifest[key]; assert.ok(chunk, key);
    if (chunk.file) assets.add(chunk.file);
    for (const path of chunk.css ?? []) assets.add(path);
    for (const child of chunk.imports ?? []) visit(child);
  };
  visit("experiences.html");
  let cssBytes = 0, jsBytes = 0, cssGzip = 0, jsGzip = 0;
  for (const path of assets) {
    const body = await readFile(join(root, "dist/client", path));
    if (path.endsWith(".css")) { cssBytes += body.length; cssGzip += gzipSync(body).length; assert.doesNotMatch(body.toString(), /\.studio-mode-nav|\.document-artifact-view/u); }
    if (path.endsWith(".js")) { jsBytes += body.length; jsGzip += gzipSync(body).length; }
  }
  // The existing budgets apply to the eager static graph. Separately measure the
  // two source-bound modules awaited before common setup UI can become ready.
  const eagerKeys = [...seen], eagerDynamic = new Set(eagerKeys.flatMap(key => manifest[key].dynamicImports ?? []));
  // The bundler may expose this side-effect-only source through a transparent facade
  // while its manifest dynamic edge names the facade's shared implementation.
  const transparentLocaleFacade = (source, key, body, chunks = manifest, dynamic = eagerDynamic) => {
    assert.equal(source, "src/components/design-system/locale-bootstrap.ts", "only the locale bootstrap may use a facade");
    const facade = chunks[key];
    assert.equal(facade?.src, source, "facade retains the exact source association");
    assert.equal(facade.isDynamicEntry, true);
    assert.ok(Array.isArray(facade.imports));
    assert.equal(facade.imports.length, 1, "facade has one immediate static dependency");
    for (const field of ["dynamicImports", "css", "assets"]) assert.deepEqual(facade[field] ?? [], [], `facade has no ${field}`);
    const [target] = facade.imports, implementation = chunks[target];
    assert.ok(dynamic.has(target), "facade implementation is an immediate eager dynamic target");
    assert.ok(implementation, "facade implementation exists in the manifest");
    for (const chunk of [facade, implementation]) {
      assert.equal(typeof chunk.file, "string");
      assert.ok(chunk.file.endsWith(".js"));
      assert.equal(Object.values(chunks).filter(candidate => candidate.file === chunk.file).length, 1, "unique emitted file association");
    }
    assert.notEqual(facade.file, implementation.file);
    const imported = body.match(/^\s*import\s*(["'])(\.{1,2}\/[^"'\\\r\n]+)\1\s*;\s*$/u);
    assert.ok(imported, "the entire facade is one literal side-effect import, without other executable code");
    const emittedRoot = "https://forma-build.invalid/";
    const importedURL = new URL(imported[2], new URL(facade.file, emittedRoot));
    assert.equal(importedURL.search, "", "facade import has no query");
    assert.equal(importedURL.hash, "", "facade import has no fragment");
    assert.equal(importedURL.href, new URL(implementation.file, emittedRoot).href, "facade import resolves to its exact manifest dependency");
    return target;
  };
  const awaitedBindings = await Promise.all(["src/components/design-system/locale-bootstrap.ts", "src/experiences/view.ts"].map(async source => {
    const matches = Object.entries(manifest).filter(([key, chunk]) => key === source || chunk.src === source);
    assert.equal(matches.length, 1, `unique awaited manifest source: ${source}`);
    const [key, chunk] = matches[0];
    if (eagerDynamic.has(key)) return { source, key, target: key, via: "direct" };
    const body = await readFile(join(root, "dist/client", chunk.file), "utf8");
    const target = transparentLocaleFacade(source, key, body);
    // These focused fixture mutations must not turn an unrelated or executable
    // wrapper into authority for the source-bound awaited graph.
    const withFacade = patch => ({ ...manifest, [key]: { ...chunk, ...patch } });
    const refusals = [
      ["different source", () => transparentLocaleFacade("src/experiences/view.ts", key, body)],
      ["only indirect reachability", () => transparentLocaleFacade(source, key, body, manifest, new Set((manifest[target].imports ?? [])))],
      ["multiple dependencies", () => transparentLocaleFacade(source, key, body, withFacade({ imports: [target, target] }))],
      ["different import destination", () => transparentLocaleFacade(source, key, 'import "./not-the-manifest-dependency.js";')],
      ["query path masquerade", () => transparentLocaleFacade(source, key, 'import "./unrelated.js?x/../' + manifest[target].file.split("/").pop() + '";')],
      ["fragment path masquerade", () => transparentLocaleFacade(source, key, 'import "./unrelated.js#x/../' + manifest[target].file.split("/").pop() + '";')],
      ["additional executable code", () => transparentLocaleFacade(source, key, body + '\nthrow new Error("not transparent");')],
      ["ambiguous emitted file", () => transparentLocaleFacade(source, key, body, { ...manifest, "fixture-duplicate-file": { file: chunk.file } })],
      ["additional facade CSS", () => transparentLocaleFacade(source, key, body, withFacade({ css: ["fixture.css"] }))],
    ];
    for (const [reason, refuse] of refusals) assert.throws(refuse, undefined, reason);
    return { source, key, target, via: "transparent-locale-facade" };
  }));
  const awaitedKeys = awaitedBindings.map(({ key }) => key);
  for (const key of awaitedKeys) visit(key);
  const common = { chunks: seen.size, jsFiles: 0, cssFiles: 0, jsBytes: 0, cssBytes: 0, jsGzip: 0, cssGzip: 0 };
  for (const path of assets) {
    if (!path.endsWith(".js") && !path.endsWith(".css")) continue;
    const body = await readFile(join(root, "dist/client", path)), kind = path.endsWith(".js") ? "js" : "css";
    common[kind + "Files"]++; common[kind + "Bytes"] += body.length; common[kind + "Gzip"] += gzipSync(body).length;
  }
  const conditionalDynamicImports = [...seen].sort().flatMap(from => (manifest[from].dynamicImports ?? []).filter(target => !seen.has(target)).map(target => {
    assert.ok(manifest[target], `remaining dynamic import: ${target}`);
    return { from, target, source: manifest[target].src ?? null };
  }));
  t.diagnostic(JSON.stringify({ scope: "source-wrapper-inclusive common-before-ready static union, not selected-locale transfer or network/paint performance", awaitedKeys, awaitedBindings, ...common, conditionalDynamicImports }));
  // Remaining dynamic edges include conditional locale catalogs. No additional
  // threshold is assigned to this diagnostic; the original eager bounds remain.
  assert.ok(cssBytes > 10_000 && cssBytes < 32_000, `CSS bytes: ${cssBytes}`);
  assert.ok(cssGzip < 8_000, `CSS gzip: ${cssGzip}`);
  assert.ok(jsBytes < 100_000 && jsGzip < 36_000, `JS bytes: ${jsBytes}; gzip: ${jsGzip}`);
  seen.clear(); assets.clear(); visit("index.html");
  const mainCss = (await Promise.all([...assets].filter(path => path.endsWith(".css")).map(path => readFile(join(root, "dist/client", path), "utf8")))).join("\n");
  assert.ok(Buffer.byteLength(mainCss) > 500_000, "main retains full application styles");
  assert.match(mainCss, /\.studio-mode-nav/u);
  assert.match(mainCss, /\.document-artifact-view/u);
});

// Declaration correspondence only; actual focus, zoom, RTL paint and computed
// geometry still require the real built-entry browser qualification.
test("setup styles share safe gutters and preserve physical preview coordinates", async () => {
  const source = await readFile(join(root, "src/experiences/style.css"), "utf8");
  const rules = ruleRecords(postcss.parse(source));
  const declaration = (selector, property) => {
    const found = rules.filter(rule => rule.selector === selector).flatMap(rule => rule.declarations.filter(([name]) => name === property));
    assert.equal(found.length, 1, `${selector}: ${property}`);
    return found[0][1];
  };
  assert.equal(declaration("html.forma-experience-page", "scroll-behavior"), "auto");
  const gutter = declaration("html.forma-experience-page", "--experience-gutter");
  assert.match(gutter, /safe-area-inset-left/u); assert.match(gutter, /safe-area-inset-right/u);
  assert.equal(declaration(".experience-navigation", "padding-inline"), "var(--experience-gutter)");
  assert.equal(declaration(".experience, .experience-chooser, .experience-host-status", "padding-inline"), "var(--experience-gutter)");
  assert.equal(declaration(".experience input:not([type=range])", "font-size"), "max(1rem, 16px)");
  assert.equal(declaration(".experience-actions, .experience-result-actions", "align-items"), "stretch");
  assert.equal(declaration(".experience-spatial", "direction"), "ltr");
  assert.equal(declaration(".experience-anchor-labels", "direction"), "ltr");
  assert.equal(declaration(".experience-anchor-labels > *", "direction"), "var(--experience-direction)");
  assert.equal(declaration("html.forma-experience-page:dir(rtl)", "--experience-direction"), "rtl");
  assert.match(declaration(".experience h1", "letter-spacing"), /--forma-script-letter-spacing/u);
  assert.match(declaration(".experience h1", "line-height"), /--forma-script-heading-line-height/u);
});
