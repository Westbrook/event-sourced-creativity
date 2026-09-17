// Offline extraction only. Does not evaluate the upstream generated JavaScript.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// This offline Node CLI is not imported by the Worker. Keep the exact upstream
// extraction dependency as non-executable source in the repo, verify it, then
// load an owned temporary copy. Never evaluate the generated decoder wrapper.
const decodePinnedYenc = async (literal) => {
  const source = await readFile(new URL('./extraction/simple-yenc.source.txt', import.meta.url));
  const sha256 = createHash('sha256').update(source).digest('hex');
  if (source.length !== 7627 || sha256 !== '363cbcc23d55beed7b89398d1213a67722128ba958f6d1eb1964f8797375af4a') {
    throw new Error('extraction dependency identity mismatch');
  }
  const directory = await mkdtemp(join(tmpdir(), 'forma-mpg123-yenc-'));
  try {
    const modulePath = join(directory, 'simple-yenc.mjs');
    await writeFile(modulePath, source, { flag: 'wx', mode: 0o600 });
    const { decode } = await import(pathToFileURL(modulePath).href);
    return decode(literal);
  } finally {
    await rm(directory, { recursive: true });
  }
};

const [sourcePath, outputPath, mode] = process.argv.slice(2);
if (!sourcePath || !outputPath || (mode !== undefined && mode !== '--rebuilt')) {
  throw new Error('usage: node extract-wasm.mjs SOURCE_JS NEW_OUTPUT_WASM [--rebuilt]');
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expected = 'f0e9e8848367320ccb757e4092f0d6809668cfe38f43139d47b447151d7dff6b';
const source = await readFile(sourcePath);
if (source.length > 1_000_000) throw new Error('source limit exceeded');
const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
let wasm;
if (mode === '--rebuilt') {
  const matches = [...text.matchAll(/Module\["wasm"\] = base64Decode\("([A-Za-z0-9+/=]+)"\)/g)];
  if (matches.length !== 1) throw new Error('expected one rebuilt base64 payload');
  wasm = Buffer.from(matches[0][1], 'base64');
} else {
  // Compare to the pinned Git blob before parsing its compressed literal.
  const blob = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
  if (blob !== '6b517aba7819cd061ec1b4ddfdaf3df4854695a0') throw new Error('source identity mismatch');
  const matches = [...text.matchAll(/get: \(\) => String\.raw`([\s\S]*?)`\}\);/g)];
  if (matches.length !== 1) throw new Error('expected one pinned yEnc payload');
  wasm = inflateRawSync(await decodePinnedYenc(matches[0][1]), { maxOutputLength: 1_000_000 });
}
if (wasm.length > 1_000_000 || !WebAssembly.validate(wasm)) throw new Error('invalid bounded WASM');
const sha256 = digest(wasm);
if (mode !== '--rebuilt' && sha256 !== expected) throw new Error('WASM identity mismatch');
// Rebuilds are candidates: report comparison and never overwrite a shipped file.
await writeFile(outputPath, wasm, { flag: 'wx' });
console.log(JSON.stringify({ bytes: wasm.length, sha256, matchesShippedBinary: sha256 === expected,
  extractionMode: mode === '--rebuilt' ? 'rebuilt-candidate-base64' : 'published-pinned-yenc',
  sourceBuildReproduced: false, generatedWrapperJavaScriptEvaluated: false,
  verifiedYencDependencyExecuted: mode !== '--rebuilt', packageLifecycleScriptsExecuted: 0,
  networkRequests: 0 }));
