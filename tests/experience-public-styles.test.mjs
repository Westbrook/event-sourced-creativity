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
  assert.equal(sheet.first.name, "import");
  assert.match(sheet.first.params, /fonts\.googleapis\.com/u);
  assert.equal(sheet.nodes.filter(node => node.type === "atrule" && node.name === "import").length, 1);
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
  assert.ok(entry.indexOf('import "forma:public-controls.css"') < entry.indexOf('import "./style.css"'));
  assert.doesNotMatch(entry, /import ["']\.\.\/(?:styles|design-system)\.css/u);
  const main = await readFile(join(root, "src/main.ts"), "utf8");
  assert.ok(main.indexOf('import "./styles.css"') < main.indexOf('import "./design-system.css"'));
});

test("built experience dependency closure stays bounded and excludes full application CSS", async () => {
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
  assert.ok(cssBytes > 10_000 && cssBytes < 32_000, `CSS bytes: ${cssBytes}`);
  assert.ok(cssGzip < 8_000, `CSS gzip: ${cssGzip}`);
  assert.ok(jsBytes < 100_000 && jsGzip < 36_000, `JS bytes: ${jsBytes}; gzip: ${jsGzip}`);
  seen.clear(); assets.clear(); visit("index.html");
  const mainCss = (await Promise.all([...assets].filter(path => path.endsWith(".css")).map(path => readFile(join(root, "dist/client", path), "utf8")))).join("\n");
  assert.ok(Buffer.byteLength(mainCss) > 500_000, "main retains full application styles");
  assert.match(mainCss, /\.studio-mode-nav/u);
  assert.match(mainCss, /\.document-artifact-view/u);
});
