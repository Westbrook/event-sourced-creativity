// Node's reporter stream supplies actual runtime case names, including generated
// variants. Keep all records; consumers count leaves rather than suite totals.
export default async function* report(events) {
  const parents = new Set();
  for await (const event of events) {
    const d = event.data;
    if (event.type === 'test:start' && d.nesting > 0) parents.add(d.nesting - 1);
    if (!['test:pass', 'test:fail'].includes(event.type)) continue;
    const parent = parents.delete(d.nesting) || d.details?.type === 'suite';
    yield JSON.stringify({ event: event.type, file: d.file ?? null, line: d.line ?? null, column: d.column ?? null,
      name: d.name, nesting: d.nesting, parent, skip: d.skip ?? false, todo: d.todo ?? false,
      durationMs: d.details?.duration_ms ?? null, at: new Date().toISOString(),
      failure: event.type === 'test:fail' ? String(d.details?.error?.message ?? 'test failed') : null }) + '\n';
  }
}
