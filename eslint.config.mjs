import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import evalScope from "./scripts/lib/lint-eval-scope.mjs";

export default defineConfig([
  // Unpatched upstream build output is checked by exact provenance in scripts/lint.mjs.
  globalIgnores([".next/**", ".wrangler/**", "dist/**", "out/**", "src/still/vendor/**", "cloudflare.d.ts", "outputs/**", "test-results/**", "playwright-report/**", "coverage/**", "work/**"]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
  },
  { files: ['tests/**/*.{mjs,ts}'], plugins: { harness: { rules: { 'eval-scope': evalScope } } }, rules: { 'harness/eval-scope': 'error' } },
]);
