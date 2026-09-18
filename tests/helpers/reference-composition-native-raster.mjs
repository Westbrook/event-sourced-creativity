import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import ts from "typescript";
import { chromium } from "@playwright/test";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const origin = "https://forma-reference-raster.invalid";

// Select original declarations, including their complete native function bodies.
// Type erasure does not replace imageBytes, compositionPng or the geometry rule.
async function rasterSource(sourceRoot) {
  const compositorPath = join(sourceRoot, "src/components/reference-compositor.ts");
  const modelPath = join(sourceRoot, "src/model/reference-composition.ts");
  const compositor = await readFile(compositorPath, "utf8"), model = await readFile(modelPath, "utf8");
  const tree = (path, text) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const componentTree = tree(compositorPath, compositor), modelTree = tree(modelPath, model);
  assert.equal(componentTree.parseDiagnostics.length, 0); assert.equal(modelTree.parseDiagnostics.length, 0);
  const imports = componentTree.statements.filter(node => ts.isImportDeclaration(node)
    && node.moduleSpecifier.text === "../model/reference-composition.ts");
  assert.equal(imports.length, 1, "One actual model supplier import");
  assert.equal(imports[0].importClause?.isTypeOnly, false);
  const imported = imports[0].importClause?.namedBindings;
  assert.ok(imported && ts.isNamedImports(imported));
  for (const name of ["REFERENCE_COMPOSITION_MAX_SOURCE_BYTES", "referenceCompositionMediaUrl", "referenceCompositionLayerRect"]) {
    const matches = imported.elements.filter(node => node.name.text === name);
    assert.equal(matches.length, 1, "Exact original value binding: " + name);
    assert.equal(matches[0].propertyName, undefined, "No renamed supplier: " + name);
    assert.equal(matches[0].isTypeOnly, false);
  }
  const declarations = [];
  const select = (source, ast, name, kind, parameterCount) => {
    const matches = ast.statements.filter(node => kind(node) && node.name?.text === name);
    assert.equal(matches.length, 1, "Exactly one original declaration: " + name);
    const node = matches[0];
    if (parameterCount !== undefined) assert.equal(node.parameters.length, parameterCount);
    const start = node.getStart(ast), end = node.end, text = source.slice(start, end);
    assert.equal(node.getText(ast), text, "Source-text boundaries: " + name);
    assert.ok(end > start && text.includes(name));
    declarations.push({ name, path: ast.fileName, start, end, bytes: Buffer.byteLength(text), sha256: digest(text) });
    return text;
  };
  const constants = modelTree.statements.filter(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(modelTree) === "REFERENCE_COMPOSITION_MAX_SOURCE_BYTES"));
  assert.equal(constants.length, 1); assert.equal(constants[0].declarationList.declarations.length, 1);
  const constant = constants[0].getText(modelTree);
  assert.equal(constant, model.slice(constants[0].getStart(modelTree), constants[0].end));
  declarations.push({ name: "REFERENCE_COMPOSITION_MAX_SOURCE_BYTES", path: modelPath,
    start: constants[0].getStart(modelTree), end: constants[0].end, bytes: Buffer.byteLength(constant), sha256: digest(constant) });
  const exact = [constant,
    select(model, modelTree, "referenceCompositionMediaUrl", ts.isFunctionDeclaration, 1),
    select(model, modelTree, "referenceCompositionLayerRect", ts.isFunctionDeclaration, 4),
    select(compositor, componentTree, "CompositionImageError", ts.isClassDeclaration),
    select(compositor, componentTree, "imageBytes", ts.isFunctionDeclaration, 2),
    select(compositor, componentTree, "compositionPng", ts.isFunctionDeclaration, 4),
  ].join("\n\n");
  const compiled = ts.transpileModule(exact, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  assert.equal((compiled.diagnostics ?? []).filter(value => value.category === ts.DiagnosticCategory.Error).length, 0);
  return { code: compiled.outputText, pins: {
    compositor: { path: compositorPath, bytes: Buffer.byteLength(compositor), sha256: digest(compositor) },
    model: { path: modelPath, bytes: Buffer.byteLength(model), sha256: digest(model) },
    originalImport: { text: imports[0].getText(componentTree), sha256: digest(imports[0].getText(componentTree)) },
    declarations, typeErasure: { typescript: ts.version, target: "ES2022", module: "ESNext", bytes: Buffer.byteLength(compiled.outputText), sha256: digest(compiled.outputText) },
  } };
}

/** Real browser raster only. Store/Worker HTTP is a finite test-owned RAM bridge;
 * no compositor UI, event dispatch, focus or production timeout claim is made. */
export async function createReferenceRaster(t, { sourceRoot, request }) {
  assert.ok(isAbsolute(sourceRoot)); assert.equal(typeof request, "function");
  const artifacts = process.env.FORMA_RASTER_ARTIFACT_DIR;
  assert.ok(artifacts && isAbsolute(artifacts), "Caller supplies a fresh owned artifact directory");
  assert.ok((await stat(artifacts)).isDirectory());
  const executable = process.env.FORMA_RASTER_CHROMIUM ?? chromium.executablePath();
  assert.ok(isAbsolute(executable) && (await stat(executable)).isFile(), "Existing installed Chromium only; no download fallback");
  const source = await rasterSource(sourceRoot), requests = [], blocked = [], errors = [];
  const browser = await chromium.launch({ executablePath: executable, headless: true, timeout: 15_000,
    args: ["--disable-background-networking", "--disable-component-update", "--disable-sync"] });
  let context, page, closed = false, captures = 0, allowedMedia = new Set();
  const close = async () => { if (closed) return; closed = true; await browser.close(); };
  const aborted = () => { void close().catch(() => undefined); };
  t.signal.addEventListener("abort", aborted, { once: true });
  t.after(async () => { t.signal.removeEventListener("abort", aborted); await close();
    assert.deepEqual(blocked, [], "No request outside finite origin/media routes"); assert.deepEqual(errors, [], "No bridge/page errors"); });
  try {
    context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    await context.route("**/*", async route => {
      const incoming = route.request(), url = new URL(incoming.url());
      try {
        if (incoming.method() !== "GET" || url.origin !== origin || url.search || url.hash) {
          blocked.push({ method: incoming.method(), url: incoming.url() }); await route.abort("blockedbyclient"); return;
        }
        if (url.pathname === "/") {
          await route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Finite native reference raster</title>' }); return;
        }
        if (!allowedMedia.has(url.pathname)) {
          blocked.push({ method: incoming.method(), url: incoming.url() }); await route.abort("blockedbyclient"); return;
        }
        const response = await request(url.pathname, { method: "GET" });
        const bytes = new Uint8Array(await response.arrayBuffer());
        requests.push({ method: "GET", path: url.pathname, status: response.status, bytes: bytes.byteLength, sha256: digest(bytes) });
        assert.ok(bytes.byteLength <= 24 * 1024 * 1024, "Finite local source response");
        await route.fulfill({ status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream",
          "content-length": String(bytes.byteLength) }, body: Buffer.from(bytes) });
      } catch (error) { errors.push(String(error)); await route.abort("failed").catch(() => undefined); }
    });
    page = await context.newPage(); page.on("pageerror", error => errors.push(String(error)));
    await page.goto(origin + "/", { waitUntil: "load", timeout: 10_000 });
    const native = await page.evaluate(() => ({ secure: isSecureContext, subtle: Boolean(crypto.subtle),
      bitmap: Function.prototype.toString.call(createImageBitmap).includes("[native code]"),
      context: Function.prototype.toString.call(HTMLCanvasElement.prototype.getContext).includes("[native code]"),
      drawImage: Function.prototype.toString.call(CanvasRenderingContext2D.prototype.drawImage).includes("[native code]"),
      toBlob: Function.prototype.toString.call(HTMLCanvasElement.prototype.toBlob).includes("[native code]") }));
    assert.ok(Object.values(native).every(Boolean), "Actual secure native browser raster APIs");
    await page.addScriptTag({ type: "module", content: source.code + '\nglobalThis.__formaNativeCompositionPng = compositionPng;\n' });
    assert.equal(await page.evaluate(() => typeof globalThis.__formaNativeCompositionPng), "function");
    const bounded = async operation => {
      let timer;
      const expiry = new Promise((_, reject) => { timer = setTimeout(() => { void close().catch(() => undefined); reject(new Error("Native raster test deadline")); }, 20_000); });
      try { return await Promise.race([operation, expiry]); }
      finally { clearTimeout(timer); }
    };
    const inspect = async (bytes, samplePoints) => {
      assert.ok(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= 24 * 1024 * 1024);
      return bounded(page.evaluate(async ({ data, points }) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: "image/png" }));
        const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
        try {
          const context = canvas.getContext("2d"); if (!context) throw new Error("Native decode canvas unavailable");
          context.drawImage(bitmap, 0, 0);
          const pixels = points.map(({ x, y }) => {
            if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) throw new Error("Invalid independent pixel point");
            return { x, y, rgba: Array.from(context.getImageData(x, y, 1, 1).data) };
          });
          return { width: bitmap.width, height: bitmap.height, pixels };
        } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
      }, { data: Array.from(bytes), points: samplePoints }));
    };
    return { requests, sourcePins: source.pins, native, executable, browserVersion: browser.version(), close, inspect,
      async render(recipe, samplePoints) {
        assert.ok(!closed && Array.isArray(recipe.sources));
        allowedMedia = new Set(recipe.sources.map(value => value.mediaUrl));
        assert.ok([...allowedMedia].every(value => typeof value === "string" && value.startsWith("/api/media/") && !/[?#\\\s]/u.test(value)));
        const capture = await bounded(page.evaluate(async recipe => {
          const controller = new AbortController();
          const blob = await globalThis.__formaNativeCompositionPng(recipe, document, controller.signal, () => true);
          return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
        }, recipe));
        assert.equal(capture.type, "image/png"); const bytes = new Uint8Array(capture.bytes);
        const decoded = await inspect(bytes, samplePoints);
        assert.equal(decoded.width, recipe.width); assert.equal(decoded.height, recipe.height);
        const file = join(artifacts, `native-composition-${++captures}.png`);
        await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
        const reopened = new Uint8Array(await readFile(file)); assert.deepEqual(reopened, bytes);
        return { blob: new Blob([bytes], { type: "image/png" }), bytes, ...decoded, sourcePins: source.pins,
          file: { path: file, bytes: bytes.byteLength, sha256: digest(bytes) } };
      },
    };
  } catch (error) { await close(); throw error; }
}
