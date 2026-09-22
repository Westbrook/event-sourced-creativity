import { open, constants } from 'node:fs/promises';
import { HIST, hash } from './core.mjs';

/** Caller must resolve authorization from existing private evidence access. No path or text exports. */
export async function verifyPrivateIncident(path, access, now = Date.now()) {
  if (!access || access.authorized !== true || access.purpose !== 'offline-incident-verification' || !access.ownerScope || !access.retentionExpiresAt
    || !Number.isFinite(Date.parse(access.retentionExpiresAt)) || now >= Math.min(Date.parse(access.retentionExpiresAt), Date.parse(HIST.retentionExpiresAt))) throw new Error('private_fixture_access_or_retention_denied');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== HIST.promptBytes) throw new Error('incident_bytes_mismatch');
    const bytes = await file.readFile();
    if (hash(bytes) !== HIST.promptHash || [...bytes.toString('utf8')].length !== HIST.promptCharacters) throw new Error('incident_hash_mismatch');
    return { baselineId: HIST.id, promptHash: HIST.promptHash, verified: true, copied: false, providerCalls: 0 };
  } finally { await file.close(); }
}
