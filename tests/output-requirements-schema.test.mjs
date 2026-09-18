import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { coldProductionDatabase, outputSchema, outputMigration } from "./output-schema-test-helpers.mjs";

test("checked-in schema snapshot prevents an accidental duplicate next Output migration", async () => {
  const localRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const sourceRoot = process.env.FORMA_SOURCE_ROOT ?? localRoot;
  const baselinePath = resolve(sourceRoot, "db/schema.ts");
  const proposalPath = resolve(localRoot, "db/full-schema-proposal.ts");
  const schemaPath = existsSync(proposalPath) ? proposalPath : baselinePath;
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === pathToFileURL(schemaPath).href) return nextResolve(specifier, { ...context, parentURL: pathToFileURL(baselinePath).href });
    return nextResolve(specifier, context);
  } });
  const schema = await import(pathToFileURL(schemaPath).href);
  hook.deregister();
  const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import(pathToFileURL(resolve(sourceRoot, "node_modules/drizzle-kit/api.mjs")).href);
  // Journal index 23 widens the existing Output checks; retain the deployed
  // Output snapshot as its predecessor rather than rewriting that history.
  const stored = JSON.parse(readFileSync(resolve(localRoot, "drizzle/meta/0023_snapshot.json"), "utf8"));
  const previous = JSON.parse(readFileSync(resolve(localRoot, "drizzle/meta/0022_snapshot.json"), "utf8"));
  assert.equal(stored.prevId, previous.id);
  assert.equal(stored.version, "6");
  assert.ok(stored.tables.output_native_storage_writes.columns.publication_event_id);
  const generated = await generateSQLiteDrizzleJson(schema, stored.id);
  assert.deepEqual(await generateSQLiteMigration(stored, generated), []);
  // Independently execute the SQL derived from the canonical Drizzle declaration.
  // Comparing two snapshots alone cannot detect parser loss shared by both.
  const declared = coldProductionDatabase(), deployed = coldProductionDatabase();
  const beforeOutput = JSON.parse(readFileSync(resolve(sourceRoot, "drizzle/meta/0021_snapshot.json"), "utf8"));
  const declarationMigration = await generateSQLiteMigration(beforeOutput, generated);
  for (const statement of declarationMigration) declared.sqlite.exec(statement);
  deployed.sqlite.exec(outputMigration);
  assert.deepEqual(outputSchema(declared.sqlite), outputSchema(deployed.sqlite));
});
