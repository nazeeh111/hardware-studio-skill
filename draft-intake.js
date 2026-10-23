export const REQUEST_KEY = 'hardware-studio-pending-request-v1';

export function requestRecord(idea, answers) {
  if (typeof idea !== 'string' || idea.length > 2000 || !answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('Invalid saved request.');
  const entries = Object.entries(answers).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length > 12 || entries.some(([key, value]) => !/^[a-z][a-z0-9-]{0,39}$/.test(key) || ['constructor', 'prototype'].includes(key) || typeof value !== 'string' || value.length > 240)) throw new Error('Invalid saved answers.');
  return { schema: 'hardware-studio-request-v1', idea, answers: Object.fromEntries(entries) };
}

export function parseRequest(raw) {
  if (typeof raw !== 'string' || raw.length > 18000) throw new Error('Saved request is too large.');
  const value = JSON.parse(raw);
  if (!value || value.schema !== 'hardware-studio-request-v1' || Object.keys(value).some(key => !['schema', 'idea', 'answers'].includes(key))) throw new Error('Invalid saved request.');
  return requestRecord(value.idea, value.answers);
}

// Capture values, rather than references to mutable form state.
export function requestSignature(idea, answers, reference) {
  return JSON.stringify({ request: requestRecord(idea, answers), reference: reference || null });
}

export async function boundedModelJson(response, limit = 250000) {
  if (!response.body) throw new Error('Local model returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, result = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error('Local model response exceeded the size limit.'); }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return JSON.parse(result);
  } finally { reader.releaseLock(); }
}
