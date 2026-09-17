import fs from 'node:fs';
import path from 'node:path';
const source = path.resolve(process.argv[2] || '../design-system');
const target = path.resolve('src/still/vendor');
const visited = new Set();
const imports = /(?:from\s*|import\s*)(['"])([^'"\n]+)\1/g;
const destination = file => path.join(target, path.relative(path.join(source, 'packages'), file).replace(/^([^/]+)\/dist\//, '$1/'));
function visit(file) {
  if (visited.has(file)) return;
  visited.add(file);
  let code = fs.readFileSync(file, 'utf8');
  for (const match of code.matchAll(imports)) {
    const spec = match[2], pkg = /^@en-reve\/([^/]+)\/(.+)$/.exec(spec);
    const dep = spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : pkg ? path.join(source, 'packages', pkg[1], 'dist', pkg[2]) : null;
    if (dep) visit(dep);
  }
  code = code.replace(/(['"])@en-reve\/([^/'"]+)\/([^'"]+)\1/g, (_, quote, pkg, subpath) => {
    let relative = path.relative(path.dirname(destination(file)), path.join(target, pkg, subpath));
    if (!relative.startsWith('.')) relative = './' + relative;
    return quote + relative + quote;
  }).replace(/^\/\/# sourceMappingURL=.*$/gm, '');
  fs.mkdirSync(path.dirname(destination(file)), { recursive: true });
  fs.writeFileSync(destination(file), code);
}
for (const name of ['button', 'toolbar', 'textarea', 'drawer', 'badge', 'select', 'checkbox', 'search-input', 'number-field', 'text-field', 'tooltip', 'switch', 'menu', 'menu-item', 'toast', 'toast-region']) visit(path.join(source, `packages/elements/dist/define/${name}.js`));
fs.mkdirSync(path.join(target, 'tokens'), { recursive: true });
fs.copyFileSync(path.join(source, 'packages/tokens/dist/default.css'), path.join(target, 'tokens/default.css'));
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));
fs.writeFileSync(path.join(target, 'README.md'), '# Design-system primitives\n\nSelective built module closure from the sibling `/design-system` repository. MIT license included. Regenerate using `node scripts/vendor-still-primitives.mjs ../design-system`. Internal imports are made relative; runtime dependencies remain the existing Lit and Signal packages. No Forma UI dependencies.\n');
console.log(`Copied ${visited.size} primitive modules and token CSS.`);
