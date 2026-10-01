// Historical campaigns are immutable. Fail before importing provider code,
// reading credentials, creating output directories, or spawning candidate runs.
console.error("image_adapter_cycle_retired: legacy campaign flags cannot authorize new trials. Use pnpm eval:image-adapters:preflight for inspection or scripts/run-image-adapter-eval.mjs --reuse-only=true for retained evidence; new trials require the manifest workflow in evals/generation-reliability/README.md.");
process.exitCode = 1;
