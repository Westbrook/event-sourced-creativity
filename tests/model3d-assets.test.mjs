import assert from "node:assert/strict";
import test from "node:test";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as modelView from "../src/model/model3d-view.ts";
import { model3dArtifactFiles, model3dPreviewFile } from "../src/components/model3d-output.ts";
import {
  MAX_MODEL3D_UPLOAD_BYTES,
  model3dMimeType,
  validateModel3dAsset,
} from "../src/model/model3d-assets.ts";

const GLB_MIME = "model/gltf-binary";
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const EMBEDDED_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=";

function triangleJson() {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{
      bufferView: 0,
      byteOffset: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [0, 0, 0],
      max: [1, 1, 0],
    }],
  };
}

function triangleBinary() {
  const binary = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => binary.writeFloatLE(value, index * 4));
  return binary;
}

function chunk(type, bytes) {
  const paddedLength = Math.ceil(bytes.byteLength / 4) * 4;
  const result = Buffer.alloc(8 + paddedLength, type === JSON_CHUNK ? 0x20 : 0);
  result.writeUInt32LE(paddedLength, 0);
  result.writeUInt32LE(type, 4);
  Buffer.from(bytes).copy(result, 8);
  return result;
}

function glbFromChunks(chunks) {
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + chunks.reduce((sum, bytes) => sum + bytes.byteLength, 0), 8);
  return Buffer.concat([header, ...chunks]);
}

function glb(json = triangleJson(), binary = triangleBinary()) {
  return glbFromChunks([
    chunk(JSON_CHUNK, Buffer.from(JSON.stringify(json))),
    chunk(BIN_CHUNK, binary),
  ]);
}

test("an embedded triangle is accepted as a GLB and retains its validated document", () => {
  const json = triangleJson();
  const bytes = glb(json);
  for (const input of [bytes, new Uint8Array(bytes).buffer]) {
    const result = validateModel3dAsset(input, GLB_MIME);
    assert.equal(result.mimeType, GLB_MIME);
    assert.equal(result.format, "glb");
    assert.equal(result.byteLength, bytes.byteLength);
    assert.deepEqual(result.json, json);
  }

  const padded = new Uint8Array(bytes.byteLength + 11);
  padded.set(bytes, 7);
  assert.deepEqual(validateModel3dAsset(padded.subarray(7, 7 + bytes.byteLength)).json, json,
    "validation uses the uploaded view's byte offset and length, not the whole backing buffer");
});

test("GLB upload detection accepts browser MIME fallbacks without overriding a conflicting MIME", () => {
  for (const file of [
    { name: "sculpture.glb", type: GLB_MIME },
    { name: "opaque-upload", type: GLB_MIME },
    { name: "sculpture.glb", type: "" },
    { name: "SCULPTURE.GLB", type: "application/octet-stream" },
  ]) assert.equal(model3dMimeType(file), GLB_MIME, JSON.stringify(file));

  for (const file of [
    { name: "sculpture.glb", type: "image/png" },
    { name: "sculpture.glb", type: "text/html" },
    { name: "sculpture.gltf", type: "model/gltf+json" },
    { name: "sculpture.obj", type: "application/octet-stream" },
    { name: "sculpture.glb.exe", type: "" },
    { name: "opaque-upload", type: "application/octet-stream" },
  ]) assert.ok(!model3dMimeType(file), JSON.stringify(file));
});

test("the model upload limit is enforced before parsing an oversized payload", () => {
  assert.equal(MAX_MODEL3D_UPLOAD_BYTES, 64 * 1024 * 1024);
  const oversized = new Uint8Array(MAX_MODEL3D_UPLOAD_BYTES + 1);
  assert.throws(() => validateModel3dAsset(oversized, GLB_MIME), /64|large|size|limit/i);
});

test("malformed GLB headers and truncated chunks fail with an actionable file error", () => {
  const invalidMagic = glb();
  invalidMagic.writeUInt32LE(0, 0);
  const invalidVersion = glb();
  invalidVersion.writeUInt32LE(1, 4);
  const incorrectLength = glb();
  incorrectLength.writeUInt32LE(incorrectLength.byteLength + 4, 8);
  const truncatedJson = glb().subarray(0, 28);
  truncatedJson.writeUInt32LE(truncatedJson.byteLength, 8);
  const unalignedJson = glb();
  unalignedJson.writeUInt32LE(unalignedJson.readUInt32LE(12) - 1, 12);

  for (const [description, bytes] of [
    ["short header", new Uint8Array(8)],
    ["wrong magic", invalidMagic],
    ["unsupported GLB version", invalidVersion],
    ["declared length differs from upload", incorrectLength],
    ["JSON chunk extends beyond upload", truncatedJson],
    ["JSON chunk has no four-byte alignment", unalignedJson],
    ["BIN chunk appears before JSON", glbFromChunks([
      chunk(BIN_CHUNK, triangleBinary()),
      chunk(JSON_CHUNK, Buffer.from(JSON.stringify(triangleJson()))),
    ])],
  ]) assert.throws(() => validateModel3dAsset(bytes, GLB_MIME), /glb|gltf|file|chunk|header|version|length|align/i, description);
});

test("invalid JSON and unsupported glTF versions are rejected before a viewer receives them", () => {
  const brokenJson = glbFromChunks([
    chunk(JSON_CHUNK, Buffer.from('{"asset":{"version":"2.0"},')),
    chunk(BIN_CHUNK, triangleBinary()),
  ]);
  assert.throws(() => validateModel3dAsset(brokenJson), /json|glb|gltf|file/i);
  assert.throws(() => validateModel3dAsset(glb([])), /json|document|object|asset|gltf|glb/i);

  const oldVersion = triangleJson();
  oldVersion.asset.version = "1.0";
  assert.throws(() => validateModel3dAsset(glb(oldVersion)), /version|2\.0|gltf|glb/i);
});

test("JSON size and nesting limits bound the work required to inspect an upload", () => {
  const oversizedJson = triangleJson();
  oversizedJson.extras = { description: "x".repeat(2 * 1024 * 1024) };
  assert.throws(() => validateModel3dAsset(glb(oversizedJson)), /json|large|size|limit/i);

  const deepJson = triangleJson();
  let current = {};
  deepJson.extras = current;
  for (let index = 0; index < 70; index += 1) {
    current.child = {};
    current = current.child;
  }
  assert.throws(() => validateModel3dAsset(glb(deepJson)), /depth|nest|complex|limit/i);
});

test("embedded image resources can be used without contacting another origin", () => {
  const json = triangleJson();
  json.images = [{ uri: EMBEDDED_PNG }];
  const result = validateModel3dAsset(glb(json));
  assert.deepEqual(result.json.images, json.images);
});

test("external image resources cannot turn a model preview into a network or local file request", () => {
  for (const uri of [
    "https://untrusted.example/track.png",
    "http://127.0.0.1/private.png",
    "//untrusted.example/track.png",
    "/api/private/image",
    "textures/albedo.png",
    "file:///etc/passwd",
    "blob:https://untrusted.example/opaque",
  ]) {
    const json = triangleJson();
    json.images = [{ uri }];
    assert.throws(() => validateModel3dAsset(glb(json)), /embed|self.contain|external|resource|uri|texture/i, uri);
  }
});

test("unsafe or malformed data URIs are rejected while safe base64 images remain supported", () => {
  for (const uri of [
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=",
    "data:image/png,not-base64",
    "data:image/png;base64,%%%",
  ]) {
    const json = triangleJson();
    json.images = [{ uri }];
    assert.throws(() => validateModel3dAsset(glb(json)), /embed|base64|image|resource|uri|texture|supported/i, uri);
  }
});

test("external buffers and missing embedded buffer bytes are rejected", () => {
  const externalBuffer = triangleJson();
  externalBuffer.buffers[0].uri = "https://untrusted.example/geometry.bin";
  assert.throws(() => validateModel3dAsset(glb(externalBuffer)), /embed|external|buffer|resource|uri/i);

  const extraBuffer = triangleJson();
  extraBuffer.buffers.push({ byteLength: 4, uri: "data:application/octet-stream;base64,AAAAAA==" });
  assert.throws(() => validateModel3dAsset(glb(extraBuffer)), /single|one|buffer|embed|complex/i);

  const missingBytes = triangleJson();
  missingBytes.buffers[0].byteLength = 40;
  assert.throws(() => validateModel3dAsset(glb(missingBytes)), /glb|buffer|bin|length|range|bounds/i);

  const missingBin = glbFromChunks([chunk(JSON_CHUNK, Buffer.from(JSON.stringify(triangleJson())))]);
  assert.throws(() => validateModel3dAsset(missingBin), /glb|buffer|bin|embed|chunk/i);
});

test("required unknown extensions and unavailable geometry or texture decoders fail before rendering", () => {
  const requiredUnknown = triangleJson();
  requiredUnknown.extensionsUsed = ["VENDOR_unavailable_extension"];
  requiredUnknown.extensionsRequired = ["VENDOR_unavailable_extension"];
  assert.throws(() => validateModel3dAsset(glb(requiredUnknown)), /extension|support/i);

  for (const extension of ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"]) {
    const json = triangleJson();
    json.extensionsUsed = [extension];
    json.extensionsRequired = [extension];
    assert.throws(() => validateModel3dAsset(glb(json)), /extension|compress|decoder|draco|meshopt|ktx|basis|support/i, extension);
  }
});

test("buffer views cannot read outside the embedded buffer", () => {
  for (const [description, view] of [
    ["oversized view", { buffer: 0, byteOffset: 0, byteLength: 40 }],
    ["view extends beyond the buffer", { buffer: 0, byteOffset: 4, byteLength: 36 }],
    ["missing buffer", { buffer: 1, byteOffset: 0, byteLength: 36 }],
    ["negative offset", { buffer: 0, byteOffset: -4, byteLength: 36 }],
  ]) {
    const json = triangleJson();
    json.bufferViews[0] = view;
    assert.throws(() => validateModel3dAsset(glb(json)), /glb|buffer|view|offset|length|range|bounds|invalid/i, description);
  }
});

test("accessor counts and offsets cannot read beyond their own buffer view", () => {
  for (const [description, update] of [
    ["too many vertices", { count: 4 }],
    ["offset leaves too few bytes", { byteOffset: 4 }],
    ["missing buffer view", { bufferView: 1 }],
    ["negative accessor offset", { byteOffset: -4 }],
  ]) {
    const json = triangleJson();
    Object.assign(json.accessors[0], update);
    assert.throws(() => validateModel3dAsset(glb(json)), /glb|accessor|buffer|view|offset|range|bounds|invalid/i, description);
  }

  const shortView = triangleJson();
  shortView.bufferViews[0].byteLength = 24;
  assert.throws(() => validateModel3dAsset(glb(shortView)), /glb|accessor|view|range|bounds|length/i,
    "a valid backing buffer cannot hide an accessor extending beyond its declared view");
});

// Exercise the actual byte reader and viewer class without loading Three or WebGL,
// using the same declaration-extraction control as model3d-settings-editor tests.
const viewerSource = ts.createSourceFile("model3d-viewer.ts", readFileSync(new URL("../src/components/model3d-viewer.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const viewerNames = new Set(["ModelPreviewError", "disposeModelResources", "readModelBytes", "FormaModel3dViewer"]);
const viewerDeclarations = viewerSource.statements.filter(node => (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) && viewerNames.has(node.name?.text));
assert.equal(viewerDeclarations.length, viewerNames.size, "load the actual viewer and byte-reader declarations");
const compiledViewer = ts.transpileModule(viewerDeclarations.map(node => node.getText(viewerSource).replace(/^export /u, "")).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: false },
}).outputText.replace(/\bimport\(/gu, "importPreview(");
const makeViewer = new Function("ports", `
  const { html, nothing, FormaPresentationalElement, MAX_MODEL3D_UPLOAD_BYTES, validateModel3dAsset,
    isModel3dMediaSource, MODEL3D_CAPTURE_SIZE, MODEL3D_MAX_DISTANCE, MODEL3D_MIN_DISTANCE,
    model3dPresetView, normalizeModel3dView, crypto, fetch, importPreview } = ports;
  ${compiledViewer}
  return { readModelBytes, FormaModel3dViewer };
`);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function previewFixture(fetch, crypto = webcrypto) {
  const imports = [];
  class ElementPort {
    isConnected = true;
    updateComplete = Promise.resolve();
    i18n = { t: (_key, fallback) => fallback, number: String };
    requestUpdate() {}
    connectedCallback() {}
    disconnectedCallback() {}
  }
  const api = makeViewer({ ...modelView, MAX_MODEL3D_UPLOAD_BYTES, validateModel3dAsset,
    html: (strings, ...values) => ({ strings, values }), nothing: null, FormaPresentationalElement: ElementPort,
    crypto, fetch,
    importPreview: specifier => { imports.push(specifier); return Promise.reject(new Error("Three intentionally not loaded by byte-reader tests")); },
  });
  return { ...api, imports };
}
const modelResponse = bytes => new Response(bytes, { headers: { "content-type": GLB_MIME } });

test("the viewer checks exact GLB bytes while preserving callers without an expected hash", async () => {
  const bytes = glb(), expected = sha256(bytes); let reads = 0;
  const f = previewFixture(async () => { reads++; return modelResponse(bytes); });
  for (const hash of [undefined, "", expected]) {
    const actual = await f.readModelBytes("/api/media/model.glb", new AbortController().signal, hash);
    assert.deepEqual(Buffer.from(actual), bytes);
  }
  assert.equal(reads, 3);
  const changed = glb({ ...triangleJson(), extras: { changed: true } });
  const mismatch = previewFixture(async () => modelResponse(changed));
  await assert.rejects(mismatch.readModelBytes("/api/media/model.glb", new AbortController().signal, expected), error => error.kind === "source");
});

test("the viewer refuses malformed nonempty expected hashes before fetching", async () => {
  let reads = 0;
  const f = previewFixture(async () => { reads++; return modelResponse(glb()); });
  for (const value of [null, false, 64, {}, "A".repeat(64), "a".repeat(63), "a".repeat(65), " " + "a".repeat(64), "g".repeat(64)])
    await assert.rejects(f.readModelBytes("/api/media/model.glb", new AbortController().signal, value), error => error.kind === "source");
  assert.equal(reads, 0);
});

test("a hash mismatch never reaches Three, and changing hash or source synchronously aborts earlier work", async () => {
  const bytes = glb(), expected = sha256(bytes);
  const pending = []; let digests = 0;
  const f = previewFixture((_source, options) => new Promise(resolve => pending.push({ signal: options.signal, resolve })), {
    randomUUID: () => webcrypto.randomUUID(),
    subtle: { digest: async (algorithm, input) => {
      assert.equal(algorithm, "SHA-256"); digests++;
      return Uint8Array.from(createHash("sha256").update(input).digest()).buffer;
    } },
  });
  const viewer = new f.FormaModel3dViewer();
  assert.equal(viewer.expectedSha256, "", "existing callers have no digest requirement");
  viewer.src = "/api/media/model.glb"; viewer.expectedSha256 = expected;
  viewer.updated(new Map([["src", ""], ["expectedSha256", ""]]));
  assert.equal(pending.length, 1);
  viewer.expectedSha256 = "0".repeat(64); viewer.expectedSha256 = expected;
  assert.equal(pending[0].signal.aborted, true, "A to B to A retires the earlier load before an update");
  // A transport that ignores abort may still return bytes; it cannot reach parsing.
  pending[0].resolve(modelResponse(bytes));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(digests, 1, "the stale returned bytes finished the actual reader and digest");
  assert.deepEqual(f.imports, []);
  viewer.updated(new Map([["expectedSha256", "0".repeat(64)]]));
  assert.equal(pending.length, 2);
  viewer.src = "/api/media/other.glb";
  assert.equal(pending[1].signal.aborted, true);
  pending[1].resolve(modelResponse(bytes));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(digests, 2);
  assert.deepEqual(f.imports, []);
  viewer.expectedSha256 = "0".repeat(64);
  viewer.updated(new Map([["src", "/api/media/model.glb"], ["expectedSha256", expected]]));
  assert.equal(pending.length, 3);
  pending[2].resolve(modelResponse(bytes));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(digests, 3);
  assert.deepEqual(f.imports, [], "different valid GLB bytes cannot load Three");
  assert.match(JSON.stringify(viewer.render()), /This model is not available as private Forma media/u);
});

// Reuse the actual-render/actual-reader controls for the Document inspector's
// selected retained mesh. No Document component or application is registered.
const documentSource = ts.createSourceFile("document-artifacts.ts", readFileSync(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const documentClass = documentSource.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(documentSource) === "#model3dOutput"));
const documentMethods = documentClass?.members.filter(member => member.name?.getText(documentSource) === "#model3dOutput") ?? [];
assert.equal(documentMethods.length, 1, "use the actual Document model preview rendering method");
const compiledDocumentPreview = ts.transpileModule(`class DocumentPreview {
  i18n={t:(_key,fallback)=>fallback,number:String};
  #downloadModel3dFile(){throw Error("downloads are outside preview controls");}
  render(artifact){return this.#model3dOutput(artifact,false,"No release");}
  ${documentMethods[0].getText(documentSource)}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const DocumentPreview = new Function("ports", `
  const {html,nothing,icon,model3dArtifactFiles,model3dPreviewFile,model3dArtifactContextReadiness}=ports;
  ${compiledDocumentPreview}
  return DocumentPreview;
`)({html:(strings,...values)=>({strings,values}),nothing:null,icon:()=>null,
  model3dArtifactFiles,model3dPreviewFile,model3dArtifactContextReadiness:()=>({supported:true})});
function previewProperties(artifact) {
  const visit=value=>Array.isArray(value)?value.flatMap(visit):value?.strings?[value,...value.values.flatMap(visit)]:[];
  const templates=visit(new DocumentPreview().render(artifact));
  const previews=templates.filter(value=>value.strings[0].includes("<forma-model3d-viewer "));
  assert.equal(previews.length,1);
  const properties={};
  previews[0].strings.forEach((part,index)=>{const property=part.match(/\.([A-Za-z][A-Za-z0-9]*)=$/u)?.[1];if(property)properties[property]=previews[0].values[index];});
  return properties;
}
const previewArtifact=hash=>({id:"artifact-a",kind:"model3d",title:"Retained model",settings:{model3d_files:[
  {url:"/api/media/original-obj",mimeType:"model/obj",format:"obj",role:"mesh",sha256:"b".repeat(64)},
  {url:"/api/media/original-glb",mimeType:GLB_MIME,format:"glb",role:"mesh",sha256:hash},
]}});

test("Document preview passes the selected retained mesh hash into the actual byte reader", async () => {
  const bytes=glb(),expected=sha256(bytes),artifact=previewArtifact(expected),before=structuredClone(artifact);
  const properties=previewProperties(artifact);
  assert.deepEqual(properties,{src:"/api/media/original-glb",expectedSha256:expected,readonly:true});
  assert.deepEqual(artifact,before,"rendering cannot replace retained metadata");
  const calls=[],f=previewFixture(async (source,options)=>{calls.push({source,options});return modelResponse(bytes);});
  const controller=new AbortController();
  assert.deepEqual(Buffer.from(await f.readModelBytes(properties.src,controller.signal,properties.expectedSha256)),bytes);
  assert.equal(calls.length,1);assert.equal(calls[0].source,properties.src);assert.equal(calls[0].options.signal,controller.signal);
});

test("Document preview refuses different valid GLB bytes before Three using the retained hash", async () => {
  const original=glb(),changed=glb({...triangleJson(),extras:{substitution:true}});
  const properties=previewProperties(previewArtifact(sha256(original)));let reads=0;
  const f=previewFixture(async ()=>{reads++;return modelResponse(changed);},{
    randomUUID:()=>webcrypto.randomUUID(),
    subtle:{digest:async (algorithm,input)=>{assert.equal(algorithm,"SHA-256");return Uint8Array.from(createHash("sha256").update(input).digest()).buffer;}},
  }),viewer=new f.FormaModel3dViewer();
  Object.assign(viewer,properties);viewer.updated(new Map([["src",""],["expectedSha256",""]]));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,1);assert.deepEqual(f.imports,[]);
  assert.match(JSON.stringify(viewer.render()),/This model is not available as private Forma media/u);
});

test("Document preview passes malformed retained hashes to the existing prefetch refusal", async () => {
  for(const hash of ["A".repeat(64),"short"," "+"a".repeat(64)]){
    const properties=previewProperties(previewArtifact(hash));let reads=0;
    assert.equal(properties.expectedSha256,hash,"a malformed recorded hash must not become optional");
    const f=previewFixture(async ()=>{reads++;return modelResponse(glb());});
    await assert.rejects(f.readModelBytes(properties.src,new AbortController().signal,properties.expectedSha256),error=>error.kind==="source");
    assert.equal(reads,0);
  }
});

test("legacy Document preview does not manufacture a hash absent from retained metadata", () => {
  const properties=previewProperties({id:"legacy",kind:"model3d",title:"Legacy",settings:{},mediaUrl:"/api/media/legacy-glb",mediaType:GLB_MIME});
  assert.deepEqual(properties,{src:"/api/media/legacy-glb",expectedSha256:"",readonly:true});
});
