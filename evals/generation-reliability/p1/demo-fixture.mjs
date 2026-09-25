// New agent-written study draft. No original N4 text, identities, receipts or pixels.
export const brief = 'A small black-and-white dog runs freely off leash across a grassy park, with a red ball on the ground to its right. Show the entire dog, all four paws and the whole ball with a clear gap between them. Use a low side view, soft morning light and a pale blue sky. Do not include any leash, tether, collar, harness, people, text, signs, logos or additional animals.';
export const snapshot = {
  document: { title: 'Free run — agent-proposed study draft' },
  facts: [{ block_id: 'p1-demo-only', type: 'direction', role: 'direction', intent: 'include', effect: 'include',
    properties: { text: brief, weight: 1, spatial_scope: { kind: 'document', falloff: 'hard', feather: 0 } } }],
  standing_constraints: [], references: [], relationships: [], combined_contexts: [], pins: [], tail: [],
};
export const direction = {
  title: 'Free run', rationale: 'A separate dog and ball read clearly in a quiet park.',
  scene: 'A small black-and-white dog runs freely off leash on grass; the red ball is to its right. Both are fully visible and separated.',
  palette: ['grass green', 'pale blue', 'red'], next_moves: ['Keep every paw visible', 'Preserve the gap'],
};
// Plumbing-only change, not a final candidate, semantic repair or live-study recommendation.
export const demoInstruction = 'Demonstration-only composition emphasis: keep the entire dog inside the frame.';
export const config = { model: 'gpt-image-2.5-sunburst', endpoint: '/v1/images/generations', quality: 'high', size: '1536x1024', outputFormat: 'png', references: [], stream: false, moderation: null, planner: { mode: 'frozen' }, checker: { mode: 'off' } };
