import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const wrangler = require.resolve("wrangler");
const miniflare = require.resolve("miniflare/package.json", { paths: [dirname(wrangler)] });
const sharp = require(require.resolve("sharp", { paths: [dirname(miniflare)] }));
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = resolve(root, "public/assets/marketing");
const [, , prefix, landscape, portrait, detail, twilight] = process.argv;

if (!prefix || !landscape || !portrait || !detail || !twilight) {
  throw new Error("Expected a project prefix followed by four original image study paths.");
}

await mkdir(destination, { recursive: true });
const studies = { landscape, portrait, detail, twilight };
const widths = {
  landscape: [480, 768, 1200],
  portrait: [480, 768, 1024],
  detail: [320, 512, 768],
  twilight: [480, 768, 1200],
};
const hashes = {};

for (const [family, input] of Object.entries(studies)) {
  hashes[family] = { avif: [], webp: [] };
  for (const width of widths[family]) {
    for (const format of ["avif", "webp"]) {
      let quality = format === "avif" ? 43 : 74;
      let output;
      do {
        const image = sharp(input).rotate().resize({ width, withoutEnlargement: true });
        output = format === "avif"
          ? await image.avif({ quality, effort: 4 }).toBuffer()
          : await image.webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
        if (output.length < 90_000) break;
        quality -= 6;
      } while (quality >= 28);
      if (output.length >= 90_000) throw new Error(`${prefix} ${family} ${width}px ${format} exceeded the transfer budget.`);

      const hash = createHash("sha256").update(output).digest("hex").slice(0, 12);
      await writeFile(resolve(destination, `${prefix}-${family}-${width}.${hash}.${format}`), output);
      hashes[family][format].push(hash);
    }
  }
}

process.stdout.write(JSON.stringify({ prefix, hashes }));
