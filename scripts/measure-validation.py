"""Bounded, provider-free Node/D1 benchmark on macOS/Linux; no global cache reset."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

root = Path(__file__).resolve().parent.parent
output = root / 'outputs' / 'validation' / ('benchmark-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
output.mkdir(parents=True)
files = ['tests/d1-query-limits.test.mjs', 'tests/d1-expression-depth-transport.test.mjs', 'tests/experience-host-route.test.ts']
node = shutil.which('node')
identity = subprocess.check_output([node, '--input-type=module', '-e', "import {fingerprint} from './scripts/lib/validation-process.mjs'; console.log(fingerprint(process.cwd(),{tests:true}));"], cwd=root, text=True).strip()
report = {'input': identity, 'node': subprocess.check_output([node, '--version'], text=True).strip(), 'platform': platform.platform(), 'files': files, 'trials': [], 'scope': 'Synthetic logic and real SQLite limit proof only; wait4 RSS is an OS-reported child high-water mark, not aggregate simultaneous tree memory. Cold means a fresh compile cache, not a reboot or package reinstall.'}
for workers in [1, 2, 4]:
    for repeat in range(2):
        cache = output / f'cache-{workers}-{repeat}'
        for mode in ['cold', 'warm']:
            label = f'{workers}-{repeat}-{mode}'
            cases = output / (label + '.cases.jsonl')
            env = dict(os.environ, FORMA_SQLITE_CACHE_DIR=str(cache))
            command = [node, '--import', 'tsx', '--test', f'--test-concurrency={workers}', '--test-reporter=tap', '--test-reporter-destination=stdout', f'--test-reporter={root / "scripts/lib/validation-reporter.mjs"}', f'--test-reporter-destination={cases}', *files]
            started = time.monotonic()
            with (output / (label + '.log')).open('w') as log:
                process = subprocess.Popen(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
                _, status, usage = os.wait4(process.pid, 0)
                process.returncode = os.waitstatus_to_exitcode(status)
            rows = [json.loads(line) for line in cases.read_text().splitlines() if line] if cases.exists() else []
            leaves = [r for r in rows if not r['parent']]
            membership = sorted(json.dumps([Path(r['file']).relative_to(root).as_posix() if r['file'] else None, r['line'], r['name'], r['event'], r['skip'], r['todo']]) for r in leaves)
            trial = {'workers': workers, 'repeat': repeat, 'mode': mode, 'elapsedMs': round((time.monotonic()-started)*1000), 'peakRssBytes': usage.ru_maxrss * (1 if sys.platform == 'darwin' else 1024), 'cpuSeconds': usage.ru_utime+usage.ru_stime, 'exitCode': process.returncode, 'leaves': len(leaves), 'membershipSha256': hashlib.sha256('\n'.join(membership).encode()).hexdigest(), 'cases': str(cases)}
            report['trials'].append(trial)
            (output / 'receipt.json').write_text(json.dumps(report, indent=2)+'\n')
            print(json.dumps(trial), flush=True)
            if process.returncode:
                raise SystemExit('Benchmark failed; retained diagnostics, no retry.')
if len({t['membershipSha256'] for t in report['trials']}) != 1:
    raise SystemExit('Cold/warm/concurrency case outcomes differ; do not adopt.')
final_identity = subprocess.check_output([node, '--input-type=module', '-e', "import {fingerprint} from './scripts/lib/validation-process.mjs'; console.log(fingerprint(process.cwd(),{tests:true}));"], cwd=root, text=True).strip()
report['finalInput'] = final_identity
report['status'] = 'passed' if final_identity == identity else 'inputs-changed'
(output / 'receipt.json').write_text(json.dumps(report, indent=2)+'\n')
if final_identity != identity:
    raise SystemExit('Inputs changed during measurement; diagnostic samples only, no qualification.')
print(str(output / 'receipt.json'))
