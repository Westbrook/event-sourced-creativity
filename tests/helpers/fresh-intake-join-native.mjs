import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isBuiltin, registerHooks } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Native source qualification, not the historical finite extraction or an OS
// sandbox. Repository bytes are pinned to HEAD plus an explicit reviewed overlay.
// Installed dependency bytes are recorded and checked for stability, not claimed
// to have a pre-approved package hash allowlist.
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function throwFailures(errors, message) {
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, message);
}
const contained = (root, file) => {
  const local = relative(root, file);
  return local !== '' && local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local);
};
const networkBuiltins = /^(?:https?|http2|net|tls|dns|dgram|child_process|cluster|worker_threads)(?:\/|$)/u;
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 });
const splitPaths = bytes => bytes.toString().split('\0').filter(Boolean);

export function verifyNativeFreshIntakeInput(input) {
  assert.equal(input.version, 1);
  assert.equal(input.kind, 'fresh-intake-join-native');
  assert.equal(typeof input.sourceRoot, 'string');
  const root = realpathSync(input.sourceRoot);
  assert.equal(root, resolve(input.sourceRoot), 'Canonical explicit source root required');
  assert.match(input.head, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
  assert.equal(git(root, 'rev-parse', 'HEAD').toString().trim(), input.head, 'Pinned native HEAD mismatch');
  const objectFormat = git(root, 'rev-parse', '--show-object-format').toString().trim();
  assert.ok(['sha1', 'sha256'].includes(objectFormat));
  const tree = new Map();
  for (const entry of splitPaths(git(root, 'ls-tree', '-rz', '--full-tree', 'HEAD'))) {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/u.exec(entry);
    assert.ok(match);
    if (match[2] === 'blob') tree.set(match[4], { mode: match[1], oid: match[3] });
  }
  assert.ok(input.overlays && typeof input.overlays === 'object' && !Array.isArray(input.overlays));
  const overlays = new Map(Object.entries(input.overlays));
  const changed = new Set([
    ...splitPaths(git(root, 'diff', '--name-only', '-z', 'HEAD')),
    ...splitPaths(git(root, 'ls-files', '--others', '--exclude-standard', '-z')),
  ]);
  assert.deepEqual([...changed].sort(), [...overlays.keys()].sort(), 'Every dirty/untracked path must be explicitly pinned');
  for (const [name, expected] of overlays) {
    const file = resolve(root, name);
    assert.ok(contained(root, file) && realpathSync(file) === file, 'Overlay path cannot escape or alias');
    assert.match(expected, /^[a-f0-9]{64}$/u);
    assert.equal(sha256(readFileSync(file)), expected, `Pinned overlay mismatch: ${name}`);
  }
  for (const [name, expected] of [['package.json', input.packageJsonSha256], ['pnpm-lock.yaml', input.lockSha256]]) {
    assert.match(expected, /^[a-f0-9]{64}$/u);
    assert.equal(sha256(readFileSync(resolve(root, name))), expected, `Pinned native package metadata mismatch: ${name}`);
  }
  const dependencyRoot = realpathSync(resolve(root, 'node_modules'));
  assert.equal(dependencyRoot, input.dependencyRoot, 'Exact installed dependency root required');
  const ownFile = realpathSync(fileURLToPath(import.meta.url));
  assert.equal(typeof input.recordPath, 'string');
  assert.ok(isAbsolute(input.recordPath) && resolve(input.recordPath) === input.recordPath);
  const recordDirectory = dirname(input.recordPath);
  assert.equal(realpathSync(recordDirectory), recordDirectory, 'Record directory must be canonical without aliases');
  assert.ok(recordDirectory !== root && !contained(root, recordDirectory)
    && recordDirectory !== dependencyRoot && !contained(dependencyRoot, recordDirectory)
    && !contained(recordDirectory, ownFile), 'Record directory must be separate from source, dependencies and harness');
  assert.equal(existsSync(input.recordPath), false, 'Record target must be new; historical evidence is never overwritten');
  assert.equal(sha256(readFileSync(ownFile)), input.helperSha256, 'Native helper source pin mismatch');
  return { root, dependencyRoot, tree, overlays, objectFormat, ownFile };
}

export async function installNativeFreshIntakeLoader(input, { injectSetupFailure } = {}) {
  const pinned = verifyNativeFreshIntakeInput(input);
  const { root, dependencyRoot, tree, overlays, objectFormat, ownFile } = pinned;
  const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const hadSourceRoot = Object.hasOwn(process.env, 'FORMA_SOURCE_ROOT');
  const originalSourceRoot = process.env.FORMA_SOURCE_ROOT;
  const initialExitListeners = process.listeners('exit');
  const loaded = new Map(), resolved = new Set(), builtinImports = new Set(), refused = [];
  let guard, nativeResolver, guardActive = false, nativeActive = false, fetchActive = false, closed = false;
  let forbiddenFetchAttempts = 0;
  const deny = (kind, value) => {
    refused.push({ kind, value });
    throw new Error(`Native fresh-intake ${kind} refused: ${value}`);
  };
  function builtin(specifier) {
    if (!isBuiltin(specifier)) return false;
    const name = specifier.replace(/^node:/u, '');
    if (networkBuiltins.test(name)) deny('network-builtin', specifier);
    builtinImports.add('node:' + name);
    return true;
  }
  function exactFile(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return deny('module-url', url); }
    if (parsed.protocol !== 'file:' || parsed.search || parsed.hash) return deny('module-url', url);
    const requested = fileURLToPath(parsed), file = realpathSync(requested);
    if (requested !== file || pathToFileURL(file).href !== url) return deny('module-alias', url);
    if (contained(dependencyRoot, file)) return { file, kind: 'dependency', path: relative(dependencyRoot, file) };
    if (contained(root, file)) return { file, kind: 'repository', path: relative(root, file) };
    return deny('module-root', url);
  }
  function checkBytes(entry, bytes) {
    const hash = sha256(bytes);
    if (entry.kind === 'repository') {
      if (overlays.has(entry.path)) {
        if (hash !== overlays.get(entry.path)) return deny('overlay-bytes', entry.path);
      } else {
        const source = tree.get(entry.path);
        if (!source || !['100644', '100755'].includes(source.mode)) return deny('unpinned-source', entry.path);
        const oid = createHash(objectFormat).update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
        if (oid !== source.oid) return deny('committed-bytes', entry.path);
      }
    }
    const previous = loaded.get(entry.file);
    if (previous && previous.sha256 !== hash) return deny('changed-loaded-bytes', entry.file);
    return { ...entry, sha256: hash, bytes: bytes.byteLength,
      ...(entry.kind === 'repository' ? { gitBlob: tree.get(entry.path)?.oid ?? null, overlay: overlays.has(entry.path) } : {}) };
  }
  function cleanup(errors = []) {
    if (closed) return errors;
    closed = true;
    for (const action of [
      () => { if (nativeActive) { nativeResolver.deregister(); nativeActive = false; } },
      () => { if (guardActive) { guard.deregister(); guardActive = false; } },
      () => {
        if (fetchActive) {
          if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
          else delete globalThis.fetch;
          fetchActive = false;
        }
      },
      () => { if (hadSourceRoot) process.env.FORMA_SOURCE_ROOT = originalSourceRoot; else delete process.env.FORMA_SOURCE_ROOT; },
      () => { process.removeListener('exit', exitCleanup); },
    ]) {
      try { action(); } catch (error) { errors.push(error); }
    }
    return errors;
  }
  function assertCleanup() {
    assert.equal(nativeActive, false); assert.equal(guardActive, false); assert.equal(fetchActive, false);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'fetch'), originalFetchDescriptor);
    assert.equal(Object.hasOwn(process.env, 'FORMA_SOURCE_ROOT'), hadSourceRoot);
    assert.equal(process.env.FORMA_SOURCE_ROOT, originalSourceRoot);
    assert.deepEqual(process.listeners('exit'), initialExitListeners);
  }
  function record(errors) {
    const bytes = JSON.stringify({
      kind: 'Native fresh-intake actual loaded graph; not finite extraction or OS confinement',
      sourceRoot: root, head: input.head, dependencyRoot, overlays: Object.fromEntries(overlays),
      packageJsonSha256: input.packageJsonSha256, lockSha256: input.lockSha256,
      loaded: [...loaded.values()].sort((a, b) => a.file.localeCompare(b.file)),
      resolved: [...resolved].sort(), builtinImports: [...builtinImports].sort(),
      forbiddenFetchAttempts, refused, cleanup: { closed, nativeActive, guardActive, fetchActive },
      errors: errors.map(error => error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
    }, null, 2) + '\n';
    // Exclusive creation also refuses a symlink/hard-link target introduced
    // after validation, without following it into source or old evidence.
    const fd = openSync(input.recordPath, 'wx', 0o600);
    try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
  }
  function finish() {
    const errors = [];
    try {
      assert.equal(forbiddenFetchAttempts, 0, 'Caught forbidden fetch attempts still fail qualification');
      assert.deepEqual(refused, [], 'Caught forbidden imports still fail qualification');
      verifyNativeFreshIntakeInput(input);
      for (const entry of loaded.values()) {
        assert.equal(sha256(readFileSync(entry.file)), entry.sha256, `Loaded file changed before cleanup: ${entry.file}`);
      }
    } catch (error) { errors.push(error); }
    cleanup(errors);
    try { assertCleanup(); } catch (error) { errors.push(error); }
    try { record(errors); } catch (error) { errors.push(error); }
    throwFailures(errors, 'Native fresh-intake verification and cleanup failed');
  }
  function exitCleanup() {
    const errors = cleanup();
    try { record(errors); } catch (error) { errors.push(error); }
    throwFailures(errors, 'Native fresh-intake exit cleanup failed');
  }
  try {
    process.once('exit', exitCleanup);
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
      enumerable: originalFetchDescriptor?.enumerable ?? true,
      value() { forbiddenFetchAttempts++; throw new Error('Network forbidden in native fresh-intake qualification'); },
    });
    fetchActive = true;
    process.env.FORMA_SOURCE_ROOT = root;
    guard = registerHooks({
      resolve(specifier, context, nextResolve) {
        if (builtin(specifier)) return nextResolve(specifier, context);
        if (context.parentURL && context.parentURL !== pathToFileURL(ownFile).href) exactFile(context.parentURL);
        const result = nextResolve(specifier, context);
        if (!builtin(result.url)) {
          const entry = exactFile(result.url);
          checkBytes(entry, readFileSync(entry.file));
          resolved.add(result.url);
        }
        return result;
      },
      load(url, context, nextLoad) {
        if (builtin(url)) return nextLoad(url, context);
        const entry = exactFile(url), result = nextLoad(url, context), source = result.source;
        assert.ok(source !== undefined && source !== null, `Actual loaded bytes required: ${url}`);
        const bytes = typeof source === 'string' ? Buffer.from(source)
          : ArrayBuffer.isView(source) ? Buffer.from(source.buffer, source.byteOffset, source.byteLength) : Buffer.from(source);
        const checked = checkBytes(entry, bytes);
        assert.equal(sha256(readFileSync(entry.file)), checked.sha256, 'Returned module bytes must match pinned local bytes');
        loaded.set(entry.file, checked);
        return result;
      },
    });
    guardActive = true;
    // The actual repository resolver supplies its normal extensionless behavior.
    // Its resolved outputs and every load remain subject to the outer pin guard.
    const { registerOutputSourceImports } = await import(pathToFileURL(resolve(root, 'tests/output-execution-test-helpers.mjs')).href);
    nativeResolver = registerOutputSourceImports(); nativeActive = true;
    if (injectSetupFailure !== undefined) throw injectSetupFailure;
    return { load: name => import(name.startsWith('node:') || name.startsWith('file:') ? name : pathToFileURL(resolve(root, name)).href),
      finish, sourceRoot: root, loaded };
  } catch (error) {
    const errors = cleanup([error]);
    try { assertCleanup(); } catch (cleanupError) { errors.push(cleanupError); }
    try { record(errors); } catch (recordError) { errors.push(recordError); }
    throwFailures(errors, 'Native fresh-intake setup and cleanup failed');
  }
}

export async function loadNativeFreshIntake(input) {
  const loader = await installNativeFreshIntakeLoader(input);
  try {
    const load = loader.load;
    const principal = await load('worker/principal-request-core.ts');
    const intakeRead = await load('worker/experience-intake-read.ts');
    const intake = await load('src/experiences/intake.ts');
    const compiler = await load('src/experiences/compiler.ts');
    const atomic = await load('worker/project-intake.ts');
    const authority = await load('worker/intake-authority.ts');
    const storage = await load('worker/private-content-storage.ts');
    const policy = await load('worker/policy-version.ts');
    const primitives = await load('worker/event-write-primitives.ts');
    const fixture = await load('tests/fixtures/fresh-intake-join-sqlite.mjs');
    return { loader, readPrincipal: principal.readExistingPrincipalRequest,
      continueExperienceAuthorization: intakeRead.continueExperienceAuthorization, readDraft: intakeRead.readDraft,
      retainedGuard: intakeRead.retainedGuard, join: intakeRead.join,
      registeredExperience: intake.registeredExperience, initialValues: intake.initialValues,
      validateIntakeRequest: intake.validateIntakeRequest, buildExperiencePlan: intake.buildExperiencePlan,
      receiptPrefix: intake.receiptPrefix, experienceDocumentRoute: intake.experienceDocumentRoute,
      canonicalJson: compiler.canonicalJson, commitAtomicIntake: atomic.commitAtomicIntake,
      projectIntakeAuthority: authority.projectIntakeAuthority, storePrivateContent: storage.storePrivateContent,
      POLICY_VERSION: policy.POLICY_VERSION, primitives, createFreshIntakeJoinSqlite: fixture.createFreshIntakeJoinSqlite };
  } catch (error) {
    const errors = [error];
    try { loader.finish(); } catch (cleanupError) { errors.push(cleanupError); }
    throwFailures(errors, 'Native fresh-intake application import and cleanup failed');
  }
}
