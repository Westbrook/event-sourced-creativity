import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [sourceArgument, revision, ...extra] = process.argv.slice(2);
if (!sourceArgument || !/^[a-f0-9]{40}$/.test(revision ?? '') || extra.length) {
  throw new Error('Use: node scripts/vendor-still-primitives.mjs <clean-built-design-system> <40-character-revision>. Partial refreshes are no longer supported.');
}
const source = path.resolve(sourceArgument);
const target = path.resolve('src/still/vendor');
const modules = new Map();
const imports = /(?:from\s*|import\s*\(?\s*)(['"])([^'"\n]+)\1/g;
const relativePath = file => path.relative(path.join(source, 'packages'), file).replace(/^([^/]+)\/dist\//, '$1/');
function visit(file) {
  if (modules.has(file)) return;
  const original = fs.readFileSync(file, 'utf8');
  modules.set(file, { original });
  for (const match of original.matchAll(imports)) {
    const spec = match[2], pkg = /^@en-reve\/([^/]+)\/(.+)$/.exec(spec);
    const dependency = spec.startsWith('.') ? path.resolve(path.dirname(file), spec)
      : pkg ? path.join(source, 'packages', pkg[1], 'dist', pkg[2]) : null;
    if (dependency) visit(dependency);
  }
  const code = original.replace(/(['"])@en-reve\/([^/'"]+)\/([^'"]+)\1/g, (_, quote, pkg, subpath) => {
    let relative = path.relative(path.dirname(relativePath(file)), path.join(pkg, subpath));
    if (!relative.startsWith('.')) relative = './' + relative;
    return quote + relative + quote;
  }).replace(/^\/\/# sourceMappingURL=.*$/gm, '');
  modules.set(file, { original, code });
  if (file.endsWith('.js')) {
    const types = file.replace(/\.js$/, '.d.ts');
    if (fs.existsSync(types)) visit(types);
  }
}
for (const name of ['button', 'toolbar', 'textarea', 'drawer', 'dialog', 'icon', 'badge', 'select', 'checkbox', 'search-input', 'number-field', 'text-field', 'tooltip', 'switch', 'menu', 'menu-item', 'toast', 'toast-region', 'skeleton', 'rich-text-editor']) {
  visit(path.join(source, `packages/elements/dist/define/${name}.js`));
}
for (const name of ['rich-document', 'editor-command-matcher']) visit(path.join(source, `packages/elements/dist/${name}.js`));
for (const layer of ['state', 'interactions', 'templates']) visit(path.join(source, `packages/primitives/dist/${layer}/virtual-collection.js`));

// Resolve the entire closure before writing. Every implementation comes from the source build;
// the only transformations are package-relative imports and removal of source-map comments.
const tokenCSS = fs.readFileSync(path.join(source, 'packages/tokens/dist/default.css'));
const license = fs.readFileSync(path.join(source, 'LICENSE'));
const sourceHash = createHash('sha256'), outputHash = createHash('sha256');
for (const [file, { original, code }] of [...modules].sort(([a], [b]) => a.localeCompare(b))) {
  const relative = relativePath(file), destination = path.join(target, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, code);
  sourceHash.update(path.relative(source, file)).update(original);
  outputHash.update(relative).update(code);
}
fs.mkdirSync(path.join(target, 'tokens'), { recursive: true });
fs.writeFileSync(path.join(target, 'tokens/default.css'), tokenCSS);
fs.writeFileSync(path.join(target, 'LICENSE'), license);
sourceHash.update(tokenCSS);
outputHash.update('tokens/default.css').update(tokenCSS);
fs.writeFileSync(path.join(target, 'README.md'), '# En Reve components for Still\n\nUnpatched built module closure from design-system main. Exact source revision, module inventory and build/output hashes are recorded in provenance.json. Build tokens, styles, primitives and elements in an isolated checkout of that revision, then run `node scripts/vendor-still-primitives.mjs <built-checkout> <revision>` from the Still repository. Do not use a dirty checkout’s dist as evidence of main.\n\nAll editor, clipboard, command, portable-document and document-scrolling capabilities now come from upstream. No preserved extension files or implementation patches are applied. Partial refresh modes are retired to avoid mixing library versions. Only internal package imports and source-map comments are transformed.\n\nRuntime dependencies include Lit, Signals, Lit Context and ProseMirror. MIT license included. Customize through Still’s theme and public APIs; application reference/authorization policy belongs in Still.\n');
fs.writeFileSync(path.join(target, 'provenance.json'), JSON.stringify({
  source: 'design-system',
  version: JSON.parse(fs.readFileSync(path.join(source, 'packages/elements/package.json'), 'utf8')).version,
  revision,
  builtClosureSha256: sourceHash.digest('hex'),
  outputClosureSha256: outputHash.digest('hex'),
  preservedExtensions: [],
  extensionAdoptions: [],
  modules: modules.size,
  modulePaths: [...modules.keys()].map(relativePath).sort(),
}, null, 2) + '\n');
console.log(`Copied ${modules.size} upstream modules and token CSS; no local library patches.`);
