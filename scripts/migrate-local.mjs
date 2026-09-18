import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { migrateLocalDatabase, readLocalMigrations } from "./lib/local-migrations.mjs";

const help = `Usage: node scripts/migrate-local.mjs --database PATH [--migrations DIR] [--apply]

Verify and apply additive migrations to an explicitly selected local SQLite file.
Without --apply, run inside a transaction and roll it back. A missing database
is simulated in memory during a dry run. No hosted database is contacted.
`;

function options(args) {
  const result = { migrations: fileURLToPath(new URL("../drizzle", import.meta.url)), apply: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--apply") { result.apply = true; continue; }
    if (["--database", "--migrations"].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`migration_cli_invalid: ${argument} requires a path`);
      result[argument.slice(2)] = value; continue;
    }
    throw new Error(`migration_cli_invalid: unknown option ${argument}`);
  }
  if (!result.database) throw new Error("migration_cli_invalid: --database PATH is required");
  if (result.database === ":memory:" || /^[a-z][a-z0-9+.-]*:/iu.test(result.database)) throw new Error("migration_cli_invalid: --database must be a local filesystem path");
  return result;
}

let database;
try {
  const settings = options(process.argv.slice(2));
  if (settings.help) process.stdout.write(help);
  else {
    const migrations = readLocalMigrations(settings.migrations);
    // Validate every source statement before opening/creating a target file.
    const sourceCheck = new DatabaseSync(":memory:");
    try { migrateLocalDatabase(sourceCheck, { migrations, dryRun: true }); }
    finally { sourceCheck.close(); }
    const path = resolve(settings.database);
    database = new DatabaseSync(!settings.apply && !existsSync(path) ? ":memory:" : path);
    const report = migrateLocalDatabase(database, { migrations, dryRun: !settings.apply });
    process.stdout.write(JSON.stringify(report) + "\n");
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.message }) + "\n");
  process.exitCode = 1;
} finally { database?.close(); }
