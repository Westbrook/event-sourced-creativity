export function planValidation(mode, groups, workers) {
  const steps = [];
  if (['check', 'test', 'fast'].includes(mode)) steps.push({ id: 'types', command: 'pnpm', args: ['typecheck'] }, { id: 'lint', command: 'pnpm', args: ['lint'] });
  if (mode === 'build') return [{ id: 'build' }];
  if (mode === 'fast') return steps;
  for (const group of groups) {
    if (group.lane === 'artifact') steps.push({ id: mode === 'node' ? 'require-build' : 'build' });
    steps.push({ id: group.lane, command: process.execPath, args: ['--import', 'tsx', '--test', `--test-concurrency=${workers}`, `--test-timeout=${group.lane === 'source' ? 60000 : 180000}`, '--test-reporter=tap', ...group.files] });
  }
  return steps;
}

/** No later stage starts after an earlier negative result. */
export async function runStages(steps, execute) {
  for (const step of steps) await execute(step);
}
