import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { walk } from './validation-inventory.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export function atomicJSON(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  renameSync(temp, path);
}
export function fingerprint(root, { tests = false, output = false } = {}) {
  const directories = output ? ['dist'] : ['src', 'worker', 'workers', 'db', 'drizzle', 'build', 'public', 'scripts', 'evals', ...(tests ? ['tests'] : [])];
  const files = directories.flatMap(d => walk(root, d));
  if (!output) files.push(...readdirSync(root).filter(p => /\.(?:json|html|css|ts|mjs|yaml)$/u.test(p) || p.startsWith('.env')), '.openai/hosting.json');
  const digest = createHash('sha256');
  for (const file of [...new Set(files)].sort()) if (existsSync(resolve(root, file))) {
    digest.update(file + '\0'); digest.update(readFileSync(resolve(root, file))); digest.update('\0');
  }
  if (!output) digest.update(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    // Environment may affect Vite and test configuration. Hash, never log values.
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(?:VITE_|FORMA_|STILL_|NODE_OPTIONS|CI$)/u.test(k) && !['FORMA_BROWSER_CONFIGS', 'FORMA_SQLITE_CACHE_DIR', 'FORMA_VALIDATION_BROWSER_OUTPUT'].includes(k)).sort(([a], [b]) => a.localeCompare(b))) }));
  return digest.digest('hex');
}

export async function withLock(directory, fn) {
  mkdirSync(dirname(directory), { recursive: true });
  try { mkdirSync(directory); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`Validation resource in use: ${directory}. Preserve its owner; retry after it completes.`);
  }
  writeFileSync(resolve(directory, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try { return await fn(); } finally { rmSync(directory, { recursive: true, force: true }); }
}

export async function runProcess(command, args, { cwd, log, env = {}, timeoutMs = 0, onFailure = () => {} } = {}) {
  mkdirSync(dirname(log), { recursive: true });
  const output = createWriteStream(log), started = performance.now();
  let tail = '', failureAnnounced = false, firstNegativeMs = null;
  const grouped = process.platform !== 'win32';
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
  const consume = data => {
    output.write(data); tail = (tail + data.toString()).slice(-16000);
    // TAP comments can contain deliberately injected compiler failures. Only an
    // actual TAP failure or an unquoted compiler diagnostic is a negative.
    if (!failureAnnounced && /(?:^|\n)(?:not ok |(?!#)[^\n]*error TS\d+:)/u.test(tail)) { failureAnnounced = true; firstNegativeMs = Math.round(performance.now() - started); onFailure(log); }
  };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  let terminated = false;
  let killTimer;
  const signal = value => {
    try { if (grouped && child.pid) process.kill(-child.pid, value); else child.kill(value); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const stop = () => { terminated = true; signal('SIGTERM'); killTimer ??= setTimeout(() => signal('SIGKILL'), 5000); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const timer = timeoutMs ? setTimeout(stop, timeoutMs) : null;
  try {
    const result = await new Promise((resolveResult, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolveResult({ code: terminated ? 1 : code ?? 1, signal, terminated, firstNegativeMs, elapsedMs: Math.round(performance.now() - started) }));
    });
    if (result.code) process.stderr.write(tail.slice(-6000));
    return result;
  } finally {
    clearTimeout(timer); clearTimeout(killTimer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await new Promise(resolveEnd => output.end(resolveEnd));
  }
}
