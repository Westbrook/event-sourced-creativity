// Synthetic Responses wire envelopes shared with E/L. No private incident text,
// attached moderation policy, caller authority, or live provider dependency.
export const plannerUsage = { input_tokens: 10, output_tokens: 4, total_tokens: 14 };
export const plannerEnvelope = (change = {}) => ({ id: 'synthetic-planner', model: 'gpt-5.6-terra', status: 'completed', output_text: '{"synthetic":true}', usage: plannerUsage, ...change });
export const stoppedPlannerEnvelopes = [
  ['refusal', { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Synthetic refusal' }] }] }, 'refused'],
  ['legacy output refusal', { output: [{ type: 'refusal', refusal: 'Synthetic refusal' }] }, 'refused'],
  ['filtered partial', { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'refused'],
  ['filtered completed anomaly', { incomplete_details: { reason: 'content_filter' } }, 'refused'],
  ['token limit partial', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'incomplete'],
  ['unknown incomplete reason', { status: 'incomplete', incomplete_details: { reason: 'future_reason' } }, 'incomplete'],
  ['incomplete message', { status: 'incomplete' }, 'incomplete'],
  ['failed response', { status: 'failed', error: { code: 'server_error', message: 'rejected' } }, 'failed'],
  ['queued response', { status: 'queued' }, 'incomplete'],
];
