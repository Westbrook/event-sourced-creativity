import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

export function classificationFingerprint(root) {
  const digest = createHash('sha256');
  for (const file of [...walk(root, 'tests'), ...walk(root, 'scripts')].filter(p => /\.(?:mjs|js|ts)$/u.test(p))) {
    digest.update(file + '\0'); digest.update(readFileSync(resolve(root, file))); digest.update('\0');
  }
  return digest.digest('hex');
}

export function walk(root, directory) {
  if (!existsSync(resolve(root, directory))) return [];
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const name = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(root, name) : entry.isFile() ? [name] : [];
  }).sort();
}

// Conservative static dependency discovery. Unknown/dynamic fixtures remain
// selectable explicitly; this is scheduling metadata, never coverage evidence.
export function dependencies(root, file, seen = new Set()) {
  if (seen.has(file) || !existsSync(resolve(root, file))) return seen;
  seen.add(file);
  const text = readFileSync(resolve(root, file), 'utf8');
  for (const match of text.matchAll(/["'`]((?:\.{1,2}\/|\/?(?:src|worker|tests|scripts|db|build)\/)[^"'`\s${}]+)["'`]/gu)) {
    const name = match[1].split('?')[0];
    const base = name.startsWith('.') ? resolve(root, dirname(file), name) : resolve(root, name.replace(/^\//u, ""));
    if (!base.startsWith(root + '/')) continue;
    const target = [base, ...(!extname(base) ? ['.ts', '.mjs', '.js'].map(s => base + s) : [])].find(p => existsSync(p) && /\.(?:ts|mjs|js)$/u.test(p));
    if (target) {
      const name = relative(root, target);
      if (name.startsWith('tests/') || name.startsWith('scripts/')) dependencies(root, name, seen);
      else seen.add(name);
    }
  }
  return seen;
}

export function classify(root, file) {
  if (file.includes('/browser/') || file.endsWith('.spec.mjs') || file.includes('/model3d-native/')) return 'browser';
  const sources = [...dependencies(root, file)].filter(p => p.startsWith('tests/') || p.startsWith('scripts/')).map(p => readFileSync(resolve(root, p), 'utf8')).join('\n');
  if (/dist[/'"`]/u.test(sources)) return 'artifact';
  // Bundling a private Worker fixture does not require the main application build.
  if (/vite\s+build|\bbuild\s*\(|buildSync\s*\(|miniflare|workerd|node:sqlite|node:child_process|outputTestDatabase|enforceD1ExpressionDepth/u.test(sources)) return 'runtime';
  return 'source';
}

export function census(root) {
  const files = walk(root, 'tests').filter(p => /\.(?:test|spec)\.(?:mjs|ts)$/u.test(p));
  const configs = readdirSync(root).filter(p => /^playwright.*\.config\.mjs$/u.test(p)).sort();
  const commands = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;
  const entrypoints = [...walk(root, 'scripts'), ...walk(root, 'evals'), ...walk(root, 'build')].filter(p => /^scripts\/[^/]+\.(?:mjs|py)$/u.test(p) || /\/(?:check-|verify-|run-|test-|evaluate-|generate-|migrate-)[^/]+\.mjs$/u.test(p) || p.startsWith('build/'));
  return { files, configs, commands, entrypoints };
}

export function testImports(root) {
  return walk(root, 'tests').filter(p => /\.(?:mjs|ts)$/u.test(p)).flatMap(file => {
    const source = readFileSync(resolve(root, file), 'utf8');
    if (!/\.test\.(?:mjs|ts)/u.test(source)) return [];
    const imports = [], tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = node => {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        specifier = node.arguments[0];
        if (specifier && ts.isNewExpression(specifier) && specifier.expression.getText(tree) === 'URL') specifier = specifier.arguments?.[0];
      }
      if (specifier && ts.isStringLiteralLike(specifier) && /\.test\.(?:mjs|ts)(?:\?|$)/u.test(specifier.text)) imports.push(`${file} -> ${specifier.text}`);
      ts.forEachChild(node, visit);
    };
    visit(tree); return imports;
  }).sort();
}

export function verifyInventory(root, registry) {
  const current = census(root), errors = [];
  if (registry.classificationInput && classificationFingerprint(root) !== registry.classificationInput) errors.push('Test/helper/tool inputs changed; refresh and review lane classification.');
  for (const item of testImports(root)) if (!registry.testImportExceptions?.[item]) errors.push(`Test module imported as a fixture: ${item}. Extract a registration-free helper or record the inspected registration guard.`);
  for (const [key, actual, recorded] of [
    ['test', current.files, Object.keys(registry.tests)],
    ['config', current.configs, registry.browserConfigs],
    ['entrypoint', current.entrypoints, registry.entrypoints],
  ]) {
    for (const file of actual) if (!recorded.includes(file)) errors.push(`Unregistered ${key}: ${file}`);
    for (const file of recorded) if (!actual.includes(file)) errors.push(`Removed ${key} still registered: ${file}`);
  }
  for (const [name, command] of Object.entries(current.commands)) if (registry.commands[name] !== command) errors.push(`Command changed/unregistered: ${name}`);
  for (const name of Object.keys(registry.commands)) if (!current.commands[name]) errors.push(`Removed command: ${name}`);
  for (const file of current.files) {
    if (!registry.execution?.[file]?.owner || !registry.execution[file].command) errors.push(`Missing execution owner/command: ${file}`);
    for (const config of registry.execution?.[file]?.configs ?? []) if (!current.configs.includes(config)) errors.push(`Missing browser config: ${config}`);
  }
  for (const [file, lane] of Object.entries(registry.tests)) if (!['source', 'runtime', 'artifact', 'browser'].includes(lane)) errors.push(`Invalid lane: ${file}`);
  return errors;
}
