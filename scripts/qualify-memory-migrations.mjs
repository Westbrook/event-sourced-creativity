import { qualifyMemoryMigrationCandidates } from './lib/memory-migration-candidates.mjs';
const args = process.argv.slice(2);
try {
  if (args.length === 1 && ['--help','-h'].includes(args[0])) {
    process.stdout.write('Usage: node scripts/qualify-memory-migrations.mjs\n\nQualify the three pinned pending Memory candidates in disposable in-memory SQLite.\nNo target database, apply mode, credentials or hosted qualification.\n');
  } else {
    if (args.length) throw new Error('memory_candidate_cli_invalid: this command accepts no target or apply options');
    process.stdout.write(JSON.stringify(qualifyMemoryMigrationCandidates()) + '\n');
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
  process.exitCode = 1;
}
