// Authored synthetic fixtures only; no captured source, real reference pixels or live transport.
import assert from 'node:assert/strict';
import { generateCreativeVideo } from '../../worker/openai-adapter.ts';

export const provenanceFixtures = [
  { id: 'historical-generated', subjects: ['Ada Lovelace is the real historical person, depicted at age 28.'], provider: 'fixture-generator', storyboard: true },
  { id: 'mixed-ages', subjects: ['Mara is an adult aged 35.', 'Leo is a child aged 8.'], storyboard: true },
  { id: 'unknown-identity', subjects: ['The traveler has unspecified identity and age.'], provider: 'fixture-generator', audience: 'The intended audience is adult museum visitors.' },
  { id: 'fictional-adult', subjects: ['Ivo is an explicitly fictional adult aged 40.'], storyboard: true },
];
export function fixtureInput(fixture) {
  const prompt = '0–2s: The first subject turns toward the window. 2–4s: The second view holds the doorway.';
  const snapshot = { facts: [
    ...fixture.subjects.map((subject, index) => ({ block_id: `subject-${index}`, type: 'subject', locked: true, properties: { text: subject } })),
    { block_id: 'inactive', type: 'subject', active: false, properties: { text: 'INACTIVE_IDENTITY_MUST_NOT_APPEAR' } },
    { block_id: 'excluded', type: 'exclusion', properties: { text: 'Do not add any extra people or change the authored ages.' } },
    ...(fixture.audience ? [{ block_id: 'audience', type: 'audience', properties: { text: fixture.audience } }] : []),
  ] };
  const references = [1, 2].map((sequence) => ({
    bytes: Uint8Array.from([137, 80, 78, 71, sequence]), mimeType: 'image/png',
    blockId: `reference-block-${sequence}`, referenceId: `reference-${sequence}`, label: `View ${sequence}`,
    mode: sequence === 1 ? 'preserve_subject' : 'preserve_composition', sequence,
    shotDirection: sequence === 1 ? 'The first subject turns toward the window.' : 'The second view holds the doorway.',
    cameraDirection: 'Static camera.', framePrompt: 'A quiet interior.',
    sourceArtifactId: fixture.storyboard ? 'storyboard-fixture' : null,
    sourceArtifactItemId: fixture.storyboard ? `frame-${sequence}` : null,
    sourceArtifactKind: fixture.storyboard ? 'storyboard' : null,
    storyboardTitle: fixture.storyboard ? 'Two views' : '',
    ...(fixture.provider ? { provider: fixture.provider } : {}),
    contextGroups: [{ id: 'cast-fixture', name: 'Subject continuity', target: 'First subject', role: 'character', application: 'isolate', relativity: 1 }],
  }));
  return { prompt, options: { seconds: 4, size: '1280x720', resolution: '480p', audioMode: 'silent', snapshot, references } };
}

// The existing generateCreativeVideo -> fetch interception path. Every unexpected URL fails closed.
export async function captureVideo(fixture, overrides = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [], prepared = [], submissions = [];
  let upload = 0;
  const queue = 'https://queue.fal.run/bytedance/seedance-2.0';
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input), method = init.method ?? 'GET';
    const body = init.body instanceof Blob ? [...new Uint8Array(await init.body.arrayBuffer())] : init.body instanceof ArrayBuffer ? [...new Uint8Array(init.body)] : init.body;
    calls.push({ url, method, ...(body === undefined ? {} : { body }) });
    if (url.includes('/storage/upload/initiate') && method === 'POST') {
      const index = ++upload;
      return Response.json({ upload_url: `https://upload.fal.media/fixture-${index}`, file_url: `https://v3b.fal.media/files/fixture-${index}.png` });
    }
    if (/^https:\/\/upload.fal.media\/fixture-[12]$/.test(url) && method === 'PUT') return new Response('');
    if (url === `${queue}/reference-to-video` && method === 'POST') return Response.json({ request_id: 'fixture-original', status: 'IN_QUEUE', status_url: `${queue}/requests/fixture-original/status`, response_url: `${queue}/requests/fixture-original`, cancel_url: `${queue}/requests/fixture-original/cancel` });
    if (url === `${queue}/requests/fixture-original/status?logs=1` && method === 'GET') return Response.json({ request_id: 'fixture-original', status: 'COMPLETED' });
    if (url === `${queue}/requests/fixture-original` && method === 'GET') return Response.json({ video: { url: 'https://v3b.fal.media/files/fixture-result.mp4', content_type: 'video/mp4' } });
    if (url === 'https://v3b.fal.media/files/fixture-result.mp4' && method === 'GET') return new Response(Uint8Array.from([0, 1, 2, 3]), { headers: { 'content-type': 'video/mp4' } });
    assert.fail(`Unexpected offline transport: ${method} ${url}`);
  };
  try {
    const { prompt, options } = fixtureInput(fixture);
    const result = await generateCreativeVideo({ FAL_KEY: 'synthetic-test-only', FORMA_VIDEO_PROVIDER: 'fal' }, prompt, { ...options, ...overrides, onPrepared: receipt => prepared.push(receipt), onProviderSubmission: receipt => submissions.push(receipt) });
    return { calls, prepared, submissions, result };
  } finally { globalThis.fetch = originalFetch; }
}
