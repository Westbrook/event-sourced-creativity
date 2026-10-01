#!/usr/bin/env node
/** Local code observation only. No provider check, module execution, or baseline inference. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = ["src/model/model3d.ts", "src/model/model3d-prompt-adapter.ts", "src/experiences/results/registry.ts"];
const limit = 256 * 1024;
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  : value === undefined ? fail("observation_missing") : JSON.stringify(value);
const fail = code => { throw new Error(code); };
const sameFile = (left, right) => ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"].every(key => left[key] === right[key]);

async function source(path) {
  let current = sep;
  // The checkout itself and every selected path component must be real, not a symlink.
  for (const part of root.split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) fail("source_symlink");
  }
  current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) fail("source_symlink");
    if (current !== join(root, path) && !stat.isDirectory()) fail("source_directory");
  }
  const before = await lstat(current, { bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(limit)) fail("source_limit");
  const handle = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(opened, before)) fail("source_changed");
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const named = await lstat(current, { bigint: true });
    if (length > limit || BigInt(length) !== opened.size || !sameFile(after, opened) || !named.isFile() || !sameFile(named, opened)) fail("source_changed");
    const captured = bytes.subarray(0, length);
    return { descriptor: { path, bytes: length, hash: hash(captured) }, identity: opened, text: new TextDecoder("utf-8", { fatal: true }).decode(captured) };
  } finally { await handle.close(); }
}

/** Syntax only: never evaluate JavaScript, call a getter, resolve an identifier, or follow imports. */
function declarations(text, path) {
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (tree.parseDiagnostics.length) fail("source_syntax");
  const exported = new Map();
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const item of statement.declarationList.declarations) {
      if (!ts.isIdentifier(item.name)) continue;
      if (exported.has(item.name.text)) fail("source_duplicate_export");
      exported.set(item.name.text, { node: item.initializer, constant: Boolean(statement.declarationList.flags & ts.NodeFlags.Const) });
    }
  }
  return name => {
    const declaration = exported.get(name);
    if (!declaration?.node || !declaration.constant) fail("source_export");
    let nodes = 0;
    const literal = (node, depth = 0) => {
      if (++nodes > 2048 || depth > 12) fail("literal_limit");
      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression, depth + 1);
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { if (node.text.length > 4096) fail("literal_limit"); return node.text; }
      if (ts.isNumericLiteral(node)) { const number = Number(node.text); if (!Number.isFinite(number)) fail("literal_number"); return number; }
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (node.kind === ts.SyntaxKind.NullKeyword) return null;
      if (ts.isArrayLiteralExpression(node)) { if (node.elements.length > 64) fail("literal_limit"); return node.elements.map(item => literal(item, depth + 1)); }
      if (ts.isObjectLiteralExpression(node)) {
        if (node.properties.length > 64) fail("literal_limit");
        const object = Object.create(null);
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) fail("literal_property");
          const key = property.name.text;
          if (["__proto__", "prototype", "constructor"].includes(key) || Object.hasOwn(object, key)) fail("literal_key");
          object[key] = literal(property.initializer, depth + 1);
        }
        return object;
      }
      // Object.freeze is recognized as a wrapper, not called (even if shadowed in the source).
      if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Object" && node.expression.name.text === "freeze") return literal(node.arguments[0], depth + 1);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
        const left = literal(node.left, depth + 1), right = literal(node.right, depth + 1);
        if (typeof left !== "number" || typeof right !== "number" || !Number.isSafeInteger(left * right)) fail("literal_number");
        return left * right;
      }
      fail("literal_expression");
    };
    return literal(declaration.node);
  };
}

export async function captureExperienceContractObservation() {
  const captures = [];
  for (const path of paths) captures.push(await source(path));
  const native = declarations(captures[0].text, paths[0]);
  const adapter = declarations(captures[1].text, paths[1]);
  const viewers = declarations(captures[2].text, paths[2]);
  const viewerRegistry = viewers("experienceResultViewers");
  if (!viewerRegistry || !Object.hasOwn(viewerRegistry, "model3d")) fail("source_viewer");
  const body = {
    version: 1, scope: "main-app-code-declarations", output: "model3d", generationAvailable: false,
    sources: captures.map(item => item.descriptor),
    observed: {
      adapterVersion: native("RODIN_ADAPTER_VERSION"), promptAdapterVersion: adapter("MODEL3D_PROMPT_ADAPTER_VERSION"),
      textModel: native("RODIN_TEXT_MODEL"), imageModel: native("RODIN_IMAGE_MODEL"),
      promptMaxChars: native("RODIN_PROMPT_MAX_CHARS"), maxImageReferences: native("RODIN_MAX_IMAGE_REFERENCES"),
      privateTransferMaxBytes: native("MODEL3D_PRIVATE_TRANSFER_MAX_BYTES"), formats: native("MODEL3D_FORMATS"),
      formatMimeTypes: native("MODEL3D_FORMAT_MIME_TYPES"), tiers: native("RODIN_TIERS"), materials: native("RODIN_MATERIALS"),
      qualityMeshOptions: native("RODIN_QUALITY_MESH_OPTIONS"), textureModes: native("RODIN_TEXTURE_MODES"),
      imageMimeTypes: native("RODIN_IMAGE_MIME_TYPES"), settingsDefaults: native("DEFAULT_MODEL3D_SETTINGS"),
      viewer: viewerRegistry.model3d,
    },
  };
  const encoded = canonical(body);
  if (Buffer.byteLength(encoded) > 32768) fail("observation_limit");
  // Bookend the entire capture, not only each individual read. This is a local
  // observation of retained bytes, not a filesystem lock or post-return custody guarantee.
  for (let index = 0; index < paths.length; index += 1) {
    const final = await source(paths[index]);
    if (!sameFile(captures[index].identity, final.identity) || captures[index].descriptor.hash !== final.descriptor.hash) fail("source_changed");
  }
  return { ...body, observationHash: hash(encoded) };
}


// v2 is explicitly selected. The legacy declarations parser and zero-argument
// capture above remain unchanged; no target module is ever imported or evaluated.
function declarationGraph(text, path, budget, provenance, sourceBytes) {
  // The retained fatal UTF-8 reader may strip a leading BOM. Restore its three
  // source bytes in span offsets without changing the legacy reader or text.
  const byteOffset = sourceBytes - Buffer.byteLength(text);
  if (byteOffset !== 0 && byteOffset !== 3) fail("source_encoding");
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) fail("source_syntax");
  const bindings = new Map();
  const add = (name, binding) => bindings.set(name, bindings.has(name) ? null : binding);
  const names = name => ts.isIdentifier(name) ? [name.text] : name.elements.flatMap(item => ts.isOmittedExpression(item) ? [] : names(item.name));
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      const constant = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      const exported = statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword) === true;
      for (const item of statement.declarationList.declarations)
        for (const name of names(item.name)) add(name, { node: item, constant: constant && ts.isIdentifier(item.name), exported });
    } else if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;
      if (clause.name) add(clause.name.text, null);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) add(clause.namedBindings.name.text, null);
        else for (const item of clause.namedBindings.elements) add(item.name.text, null);
      }
    } else if (ts.isImportEqualsDeclaration(statement)) add(statement.name.text, null);
    else if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) add(statement.name.text, null);
    else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) add(statement.name.text, null);
  }
  // var bindings in nested module statements are hoisted, even in unreachable
  // branches. Lexical block declarations and nested execution scopes are not.
  const pendingBindings = [file];
  while (pendingBindings.length) {
    const node = pendingBindings.pop();
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
      || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
      || ts.isConstructorDeclaration(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)
      || ts.isClassStaticBlockDeclaration(node) || ts.isModuleDeclaration(node)) continue;
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0)
      for (const item of node.declarations) for (const name of names(item.name)) {
        // Direct mutable/ambiguous bindings are already unavailable; never add
        // the same binding twice. A hoisted collision also blocks a const root.
        if (!bindings.has(name) || bindings.get(name)?.constant) bindings.set(name, null);
      }
    ts.forEachChild(node, child => { pendingBindings.push(child); });
  }
  const active = new Set();
  const resolveDeclaration = (name, depth) => {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,255}$/.test(name)) fail("literal_reference");
    const item = bindings.get(name);
    if (!item?.constant || !item.node.initializer) fail("literal_reference");
    if (active.has(name)) fail("literal_cycle");
    const key = `${path}:${name}`;
    let saved = provenance.get(key);
    if (!saved) {
      if (provenance.size >= 128) fail("literal_limit");
      const start = item.node.getStart(file), end = item.node.getEnd();
      saved = { path, symbol: name, exported: item.exported,
        start: byteOffset + Buffer.byteLength(text.slice(0, start)), end: byteOffset + Buffer.byteLength(text.slice(0, end)),
        hash: hash(text.slice(start, end)), dependencies: new Set() };
      provenance.set(key, saved);
    }
    active.add(name);
    try { return literal(item.node.initializer, depth, saved.dependencies); }
    finally { active.delete(name); }
  };
  const literal = (node, depth, dependencies) => {
    if (++budget.nodes > 2048 || depth > 12) fail("literal_limit");
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression, depth + 1, dependencies);
    if (ts.isIdentifier(node)) { dependencies.add(node.text); return resolveDeclaration(node.text, depth + 1); }
    if (ts.isPropertyAccessExpression(node) && !node.questionDotToken && ts.isIdentifier(node.expression) && ts.isIdentifier(node.name)) {
      const key = node.name.text;
      if (["__proto__", "prototype", "constructor"].includes(key)) fail("literal_key");
      dependencies.add(node.expression.text);
      const value = resolveDeclaration(node.expression.text, depth + 1);
      if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, key)) fail("literal_member");
      return value[key];
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (node.text.length > 4096) fail("literal_limit");
      return node.text;
    }
    if (ts.isNumericLiteral(node)) { const value = Number(node.text); if (!Number.isFinite(value)) fail("literal_number"); return value; }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isArrayLiteralExpression(node)) {
      if (node.elements.length > 64) fail("literal_limit");
      const result = [];
      for (const item of node.elements) {
        if (ts.isSpreadElement(item)) {
          const value = literal(item.expression, depth + 1, dependencies);
          if (!Array.isArray(value)) fail("literal_spread");
          if (result.length + value.length > 64) fail("literal_limit");
          result.push(...value);
        } else { if (result.length >= 64) fail("literal_limit"); result.push(literal(item, depth + 1, dependencies)); }
      }
      return result;
    }
    if (ts.isObjectLiteralExpression(node)) {
      if (node.properties.length > 64) fail("literal_limit");
      const result = Object.create(null);
      const put = (key, value) => {
        if (["__proto__", "prototype", "constructor"].includes(key) || Object.hasOwn(result, key)) fail("literal_key");
        if (Object.keys(result).length >= 64) fail("literal_limit");
        result[key] = value;
      };
      for (const item of node.properties) {
        if (ts.isSpreadAssignment(item)) {
          const value = literal(item.expression, depth + 1, dependencies);
          if (value === null || typeof value !== "object" || Array.isArray(value)) fail("literal_spread");
          for (const key of Object.keys(value)) put(key, value[key]);
        } else if (ts.isShorthandPropertyAssignment(item) && !item.objectAssignmentInitializer) {
          dependencies.add(item.name.text); put(item.name.text, resolveDeclaration(item.name.text, depth + 1));
        } else if (ts.isPropertyAssignment(item) && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name))) {
          put(item.name.text, literal(item.initializer, depth + 1, dependencies));
        } else fail("literal_property");
      }
      return result;
    }
    // Recognize a closed syntax wrapper, not a call to the selected module.
    if (ts.isCallExpression(node) && !node.questionDotToken && !bindings.has("Object") && ts.isPropertyAccessExpression(node.expression) && !node.expression.questionDotToken
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Object"
      && node.expression.name.text === "freeze" && node.arguments.length === 1) return literal(node.arguments[0], depth + 1, dependencies);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
      const left = literal(node.left, depth + 1, dependencies), right = literal(node.right, depth + 1, dependencies);
      if (typeof left !== "number" || typeof right !== "number" || !Number.isSafeInteger(left * right)) fail("literal_number");
      return left * right;
    }
    fail("literal_expression");
  };
  return name => resolveDeclaration(name, 0);
}

// Code-owned fixed projections. Unsupported entries name omitted behavior, not failed executions.
const v2Projections = {
  image: {
    paths: ["src/model/image-format.ts", "worker/fal-image-adapter.ts", "worker/output-image-budget.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["formatPresets", "src/model/image-format.ts", "IMAGE_FORMAT_PRESETS", null],
      ["sizeConstraints", "src/model/image-format.ts", "PROVIDER_IMAGE_SIZE_CONSTRAINTS", null],
      ["adapterId", "worker/fal-image-adapter.ts", "FAL_IDEOGRAM_ADAPTER_ID", null],
      ["adapterVersion", "worker/fal-image-adapter.ts", "FAL_IDEOGRAM_ADAPTER_VERSION", null],
      ["referenceStrengths", "worker/fal-image-adapter.ts", "FAL_IDEOGRAM_REFERENCE_STRENGTHS", null],
      ["promptMaxBytes", "worker/output-image-budget.ts", "OUTPUT_IMAGE_MAX_PROMPT_BYTES", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "image"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-routing-and-budget"],
  },
  short_story: {
    paths: ["src/model/native-short-story-generation.ts", "src/model/retained-short-story.ts", "src/model/document-artifacts.ts", "worker/openai-adapter.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["completionMaxBytes", "src/model/native-short-story-generation.ts", "NATIVE_STORY_COMPLETION_MAX_BYTES", null],
      ["retainedJsonMaxBytes", "src/model/retained-short-story.ts", "RETAINED_STORY_JSON_MAX_BYTES", null],
      ["retainedMarkdownMaxBytes", "src/model/retained-short-story.ts", "RETAINED_STORY_MARKDOWN_MAX_BYTES", null],
      ["retainedTitleMaxBytes", "src/model/retained-short-story.ts", "RETAINED_STORY_TITLE_MAX_BYTES", null],
      ["retainedRoute", "src/model/retained-short-story.ts", "RETAINED_STORY_ROUTE", null],
      ["artifactKinds", "src/model/document-artifacts.ts", "DOCUMENT_ARTIFACT_KINDS", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "short_story"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-story-dto", "function-produced-documentArtifactSchema"],
  },
  scene: {
    paths: ["src/model/scene-configuration.ts", "src/model/document-artifacts.ts", "worker/openai-adapter.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["media", "src/model/scene-configuration.ts", "SCENE_MEDIA", null],
      ["artifactKinds", "src/model/document-artifacts.ts", "DOCUMENT_ARTIFACT_KINDS", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "scene"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-scene-configuration", "function-produced-documentArtifactSchema"],
  },
  slides: {
    paths: ["src/model/document-artifacts.ts", "src/model/presentation-count-policy.ts", "src/model/managed-production.ts", "worker/presentation-model-routing.ts", "worker/openai-adapter.ts", "src/model/presentation-source.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["layouts", "src/model/document-artifacts.ts", "SLIDE_LAYOUTS", null],
      ["visualKinds", "src/model/document-artifacts.ts", "SLIDE_VISUAL_KINDS", null],
      ["maxVisualDataPoints", "src/model/document-artifacts.ts", "MAX_SLIDE_VISUAL_DATA_POINTS", null],
      ["stylePresetIds", "src/model/document-artifacts.ts", "SLIDE_STYLE_PRESET_IDS", null],
      ["stylePresets", "src/model/document-artifacts.ts", "SLIDE_STYLE_PRESETS", null],
      ["manualSlideLimit", "src/model/presentation-count-policy.ts", "MAX_MANUAL_PRESENTATION_SLIDES", null],
      ["managedSlideLimit", "src/model/managed-production.ts", "MAX_MANAGED_PRESENTATION_SLIDES", null],
      ["managedBatchSize", "src/model/managed-production.ts", "MANAGED_PRODUCTION_BATCH_SIZE", null],
      ["routingVersion", "worker/presentation-model-routing.ts", "PRESENTATION_MODEL_ROUTING_VERSION", null],
      ["textModels", "worker/presentation-model-routing.ts", "PRESENTATION_TEXT_MODELS", null],
      ["reasoningEfforts", "worker/presentation-model-routing.ts", "PRESENTATION_REASONING_EFFORTS", null],
      ["adapterVersion", "worker/openai-adapter.ts", "PRESENTATION_ADAPTER_VERSION", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "slides"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-documentArtifactSchema", "function-produced-presentation-source-contract", "managed-flexible-count"],
  },
  storyboard: {
    paths: ["src/model/document-artifacts.ts", "src/model/managed-production.ts", "worker/managed-production.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["artifactKinds", "src/model/document-artifacts.ts", "DOCUMENT_ARTIFACT_KINDS", null],
      ["productionBatchSize", "src/model/managed-production.ts", "MANAGED_PRODUCTION_BATCH_SIZE", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "storyboard"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-managed-storyboard-stages", "function-produced-shared-artifact-and-frame-receipts"],
  },
  video: {
    paths: ["src/model/video-adapter.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["adapterContract", "src/model/video-adapter.ts", "VIDEO_ADAPTER_CONTRACT", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "video"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-video-normalization"],
  },
  audio: {
    paths: ["src/model/audio.ts", "src/model/audio-provider-contracts.ts", "worker/audio-selection.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["generationGoals", "src/model/audio.ts", "AUDIO_GENERATION_GOALS", null],
      ["destinations", "src/model/audio.ts", "AUDIO_DESTINATIONS", null],
      ["commonAdapter", "src/model/audio.ts", "commonAudioAdapter", null],
      ["videoReferenceContract", "src/model/audio.ts", "VIDEO_AUDIO_REFERENCE_CONTRACT", null],
      ["providerInputContracts", "src/model/audio-provider-contracts.ts", "AUDIO_PROVIDER_INPUT_CONTRACTS", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "audio"],
    ],
    unsupported: ["runtime-provider-selection", "imported-full-audio-adapter-registry", "function-produced-audio-selection-and-pricing"],
  },
  model3d: {
    paths: ["src/model/model3d.ts", "src/model/model3d-prompt-adapter.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["adapterVersion", "src/model/model3d.ts", "RODIN_ADAPTER_VERSION", null],
      ["textModel", "src/model/model3d.ts", "RODIN_TEXT_MODEL", null],
      ["imageModel", "src/model/model3d.ts", "RODIN_IMAGE_MODEL", null],
      ["promptMaxChars", "src/model/model3d.ts", "RODIN_PROMPT_MAX_CHARS", null],
      ["maxImageReferences", "src/model/model3d.ts", "RODIN_MAX_IMAGE_REFERENCES", null],
      ["privateTransferMaxBytes", "src/model/model3d.ts", "MODEL3D_PRIVATE_TRANSFER_MAX_BYTES", null],
      ["formats", "src/model/model3d.ts", "MODEL3D_FORMATS", null],
      ["formatMimeTypes", "src/model/model3d.ts", "MODEL3D_FORMAT_MIME_TYPES", null],
      ["tiers", "src/model/model3d.ts", "RODIN_TIERS", null],
      ["materials", "src/model/model3d.ts", "RODIN_MATERIALS", null],
      ["qualityMeshOptions", "src/model/model3d.ts", "RODIN_QUALITY_MESH_OPTIONS", null],
      ["textureModes", "src/model/model3d.ts", "RODIN_TEXTURE_MODES", null],
      ["imageMimeTypes", "src/model/model3d.ts", "RODIN_IMAGE_MIME_TYPES", null],
      ["settingsDefaults", "src/model/model3d.ts", "DEFAULT_MODEL3D_SETTINGS", null],
      ["promptAdapterVersion", "src/model/model3d-prompt-adapter.ts", "MODEL3D_PROMPT_ADAPTER_VERSION", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "model3d"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-prompt-adaptation"],
  },
};

export async function captureExperienceContractObservationV2(output) {
  if (arguments.length !== 1 || typeof output !== "string" || !Object.hasOwn(v2Projections, output)) fail("arguments_unavailable");
  const projection = v2Projections[output];
  const captures = [];
  for (const path of projection.paths) captures.push(await source(path));
  const budget = { nodes: 0 }, provenance = new Map();
  const readers = new Map(captures.map(item => [item.descriptor.path, declarationGraph(item.text, item.descriptor.path, budget, provenance, item.descriptor.bytes)]));
  const observed = Object.create(null);
  for (const [field, path, symbol, member] of projection.roots) {
    const value = readers.get(path)(symbol);
    if (member !== null && (value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, member))) fail("source_viewer");
    observed[field] = member === null ? value : value[member];
  }
  const viewer = observed.viewer;
  if (!viewer || typeof viewer !== "object" || Array.isArray(viewer)
    || Object.keys(viewer).sort().join(",") !== "activation,contractRevision,dtoVersion,id,output,qualification"
    || viewer.id !== `${output}.read-only@1` || viewer.output !== output || viewer.dtoVersion !== 1 || viewer.contractRevision !== 1
    || viewer.activation !== (["video", "audio", "model3d"].includes(output) ? "explicit-user" : "ready-result") || viewer.qualification !== "fixture-only") fail("source_viewer");
  const declarations = [...provenance.values()].map(item => ({ ...item, dependencies: [...item.dependencies].sort() }))
    .sort((a, b) => projection.paths.indexOf(a.path) - projection.paths.indexOf(b.path) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  const body = { version: 2, scope: "main-app-code-declarations", output, profileRef: `${output}.code-declarations@2`,
    generationAvailable: false, canPublish: false, runtimeConfiguration: "unobserved",
    sources: captures.map(item => item.descriptor), observed, declarations, unsupported: [...projection.unsupported] };
  const serialized = canonical(body);
  const observation = { ...body, observationHash: hash(serialized) };
  if (Buffer.byteLength(canonical(observation)) > 32768) fail("observation_limit");
  for (const capture of captures) {
    const final = await source(capture.descriptor.path);
    if (!sameFile(capture.identity, final.identity) || capture.descriptor.hash !== final.descriptor.hash) fail("source_changed");
  }
  return observation;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const observation = process.argv.length === 2 ? await captureExperienceContractObservation()
      : process.argv.length === 4 && process.argv[2] === "--output" ? await captureExperienceContractObservationV2(process.argv[3])
      : fail("arguments_unavailable");
    process.stdout.write(`${JSON.stringify(observation)}\n`);
  } catch (error) {
    // A coded failure is not a report of all parser/runtime diagnostics. No partial observation is emitted.
    process.stderr.write(`${JSON.stringify({ ok: false, code: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "capture_failed" })}\n`);
    process.exitCode = 1;
  }
}
