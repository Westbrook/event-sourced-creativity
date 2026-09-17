import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireRoot = createRequire(join(root, "package.json"));
const requireWrangler = createRequire(requireRoot.resolve("wrangler"));
const { Miniflare, Log, LogLevel } = requireWrangler("miniflare");
const execute = promisify(execFile);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const decoderHash = "f0e9e8848367320ccb757e4092f0d6809668cfe38f43139d47b447151d7dff6b";
const sourcePaths = ["worker/selected-output-share-mp3-projection.ts", "worker/audio-share-mp3-envelope.ts",
  "worker/vendor/mpg123/loader.ts", "worker/vendor/mpg123/decoder.wasm", "src/model/selected-output-share-audio.ts",
  "src/model/output-asset-inspection.ts", "src/model/model3d-assets.ts",
  "tests/helpers/audio-share-mp3-workerd-entry.ts", "tests/audio-share-mp3-vite.test.mjs",
  "tests/audio-share-mp3-vite/vite.config.mjs", "tests/audio-share-mp3-vite/wrangler.json",
  "tests/audio-share-mp3-vite/entry.ts", "tests/audio-share-mp3-vite/index.html", "tests/audio-share-mp3-vite/client.js",
  "tests/fixtures/audio-share-mp3/mono-20.mp3", "tests/fixtures/audio-share-mp3/stereo-20.mp3"];
const sourceHashes = () => Promise.all(sourcePaths.map(async path => [path, sha256(await readFile(join(root, path)))]))
  .then(entries => Object.fromEntries(entries));
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(join(directory, entry.name)) : join(directory, entry.name)))).flat();
}

test("Vite/Cloudflare emits unchanged static Worker WASM, excludes it from client, and the built Worker decodes synthetic audio", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "forma-mp3-vite-"));
  let runtime, outbound = 0;
  try {
    const sources = await sourceHashes();
    // Do not inherit application secrets or provider settings into the build.
    const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "SYSTEMROOT"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
    Object.assign(environment, { CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" });
    const output = join(temporary, "build");
    const built = await execute(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build", "--config", "tests/audio-share-mp3-vite/vite.config.mjs", "--outDir", output],
      { cwd: root, env: environment, timeout: 30_000, maxBuffer: 1_000_000 });
    assert.match(built.stdout, /building server environment for production/u);
    assert.match(built.stdout, /building client environment for production/u);
    const server = join(output, "server"), client = join(output, "client");
    const serverFiles = await files(server), clientFiles = await files(client);
    const workerFiles = serverFiles.map(path => relative(server, path).replaceAll("\\", "/")).sort();
    const browserFiles = clientFiles.map(path => relative(client, path).replaceAll("\\", "/")).sort();
    assert.deepEqual(workerFiles, [".vite/manifest.json", "assets/decoder-DJRs-hL5.wasm", "index.js", "wrangler.json"]);
    assert.equal(browserFiles.length, 4);
    assert.deepEqual(browserFiles.filter(path => !/^assets\/index-[\w-]+\.js$/u.test(path)), [".assetsignore", ".vite/manifest.json", "index.html"]);
    assert.deepEqual(JSON.parse(await readFile(join(root, "tests/audio-share-mp3-vite/wrangler.json"), "utf8")), {
      name: "forma-audio-share-mp3-packaging-fixture", main: "entry.ts", compatibility_date: "2026-05-22", compatibility_flags: ["nodejs_compat"],
    });
    const wasmFiles = serverFiles.filter(path => path.endsWith(".wasm"));
    assert.equal(wasmFiles.length, 1);
    const sourceWasm = await readFile(join(root, "worker/vendor/mpg123/decoder.wasm"));
    const builtWasm = await readFile(wasmFiles[0]);
    assert.equal(sha256(sourceWasm), decoderHash);
    assert.deepEqual(builtWasm, sourceWasm);
    const worker = await readFile(join(server, "index.js"), "utf8");
    const importPath = "./" + relative(server, wasmFiles[0]).replaceAll("\\", "/");
    assert.ok(worker.includes(`import compiledDecoder from ${JSON.stringify(importPath)}`));
    assert.match(worker, /new WebAssembly\.Instance\(compiledDecoder/u);
    assert.doesNotMatch(worker, /WebAssembly\.(?:compile|compileStreaming|instantiate|instantiateStreaming)\s*\(/u);
    assert.doesNotMatch(worker, /fetch\s*\([^)]*\.wasm/u);
    for (const path of clientFiles) {
      assert.ok(!path.endsWith(".wasm"));
      assert.doesNotMatch(await readFile(path, "utf8"), /decoder|mpg123|WebAssembly|f0e9e8848367320c/u);
    }
    const config = JSON.parse(await readFile(join(server, "wrangler.json"), "utf8"));
    assert.equal(config.main, "index.js");
    assert.equal(config.no_bundle, true);
    assert.equal(config.compatibility_date, "2026-05-22");
    assert.deepEqual(config.vars, {});
    for (const field of ["r2_buckets", "d1_databases", "services", "kv_namespaces", "send_email", "secrets_store_secrets"])
      assert.deepEqual(config[field], []);
    assert.deepEqual(config.durable_objects.bindings, []);
    assert.equal(config.assets.binding, undefined);
    runtime = new Miniflare({
      modulesRoot: server,
      modules: [{ type: "ESModule", path: join(server, "index.js"), contents: worker },
        { type: "CompiledWasm", path: wasmFiles[0], contents: builtWasm }],
      compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
      log: new Log(LogLevel.NONE),
      outboundService() { outbound++; throw new Error("network_forbidden"); },
    });
    const runtimeResults = [];
    for (const [name, rate, channels, samples, expectedHash] of [
      ["mono-20", 48000, 1, 960000, "180b22be505817b50993a89b1a008ea6670375dbc68f1219f813cf84f5cf0e73"],
      ["stereo-20", 44100, 2, 882000, "eae13159a5b9273dee41f064db6cd44bb6e93ecf8138ebf424fbca2deb08b1a7"],
    ]) {
      const bytes = await readFile(join(root, "tests/fixtures/audio-share-mp3", name + ".mp3"));
      const response = await runtime.dispatchFetch("https://synthetic.invalid/project", { method: "POST", body: bytes, headers: { "x-sha256": sha256(bytes) } });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.result.status, "projected", JSON.stringify(body));
      assert.equal(body.result.decoderSha256, decoderHash);
      assert.equal(body.result.sourceSha256, sha256(bytes));
      assert.equal(body.result.sha256, expectedHash);
      assert.equal(body.result.sampleRate, rate);
      assert.equal(body.result.channels, channels);
      assert.equal(body.result.sampleCount, samples);
      assert.equal(body.bytesHash, expectedHash);
      assert.equal(body.forged, false);
      assert.equal(body.copiedIndependently, true);
      runtimeResults.push({ fixture: name, ...body });
    }
    assert.equal(outbound, 0);
    assert.deepEqual(await sourceHashes(), sources, "Qualified source and fixture bytes must stay unchanged through build and runtime");
    // Optional explicit qualification output retains only this already-inspected
    // zero-binding synthetic build; normal test runs remove their temporary files.
    if (process.env.FORMA_MP3_VITE_EVIDENCE_DIR) {
      const destination = process.env.FORMA_MP3_VITE_EVIDENCE_DIR;
      await cp(output, join(destination, "built-artifacts"), { recursive: true, errorOnExist: true, force: false });
      const artifacts = Object.fromEntries(await Promise.all([...serverFiles, ...clientFiles].map(async path =>
        [relative(output, path).replaceAll("\\", "/"), sha256(await readFile(path))])));
      await writeFile(join(destination, "build.log"), built.stdout + built.stderr);
      await writeFile(join(destination, "qualification.json"), JSON.stringify({ version: 1, status: "passed", sources, artifacts,
        runtimeResults, outboundRequests: outbound, decoderHash, staticWorkerModule: true, clientDecoderAbsent: true,
        applicationBindings: false, sourceModuleEdited: false, mainAppBuildOrDeployment: false }, null, 2) + "\n");
    }
  } finally {
    await runtime?.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});
