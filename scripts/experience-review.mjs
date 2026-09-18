import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { describeExperienceMaintenance, reviewExperienceMaintenance, EXPERIENCE_MAINTENANCE_MAX_BYTES } from '../src/experiences/maintenance-review.ts';

// Local input and stdout only. No source edits, HTTP, model calls, registry writes or publishing.
function readProposal(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > EXPERIENCE_MAINTENANCE_MAX_BYTES) throw Error('proposal_file_invalid_or_oversized');
    const buffer = Buffer.alloc(EXPERIENCE_MAINTENANCE_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > EXPERIENCE_MAINTENANCE_MAX_BYTES) throw Error('proposal_limit');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { closeSync(fd); }
}

try {
  const [command, input, ...extra] = process.argv.slice(2);
  if (!input || extra.length || !['describe', 'review'].includes(command)) throw Error('usage: experience-review.mjs describe <experience-id> | review <proposal.json>');
  if (command === 'describe') {
    const description = await describeExperienceMaintenance(input);
    if (!description) throw Error('experience_unavailable');
    process.stdout.write(JSON.stringify(description, null, 2) + '\n');
  } else {
    const result = await reviewExperienceMaintenance(readProposal(input));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'experience_review_failed') + '\n');
  process.exitCode = 1;
}
