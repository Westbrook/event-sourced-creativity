import { rm } from "node:fs/promises";
import { resolve } from "node:path";

// Build artifacts are reproducible. Cleaning the exact output directory keeps
// an earlier framework's server bundle from entering a later Sites package.
await rm(resolve(process.cwd(), "dist"), { recursive: true, force: true });
