import { createServer } from 'node:http';
export const MODEL = 'pipeline-fixture';
export function isolatedDatabase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Explicit TEST_DATABASE_URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname)) throw new Error('TEST_DATABASE_URL must name a local isolated _test database');
  return url;
}
export function fixtureResponse(stream) {
  const common = { id: 'pipeline-fixture', model: MODEL, created: 1 };
  if (!stream) return { ...common, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'PIPELINE_CHAT_OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  return [{ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'PIPELINE_CHAT_OK' }, finish_reason: null }] }, { ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }, '[DONE]'].map(value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`).join('');
}
export function assertChat(body) {
  const events = body.split('\n').filter(line => line.startsWith('data:')).map(line => { try { return JSON.parse(line.slice(5)); } catch { return {}; } });
  if (events.some(event => event.error || event.type === 'error') || !events.some(event => event.done === true) || !events.map(event => event.token || '').join('').includes('PIPELINE_CHAT_OK')) throw new Error(`Chat fixture transport failed: ${body.slice(0, 2000)}`);
}
export async function startModelFixture() {
  let calls = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && /\/models$/.test(req.url)) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'pipeline', context_length: 32768 }] }));
    }
    if (req.method !== 'POST' || !/\/chat\/completions$/.test(req.url)) { res.writeHead(404); return res.end(); }
    let request;
    try {
      let input = '';
      for await (const chunk of req) {
        input += chunk;
        if (input.length > 2_000_000) throw new Error('Fixture request too large');
      }
      request = JSON.parse(input);
      if (!request || typeof request !== 'object') throw new Error('Expected object');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid fixture request JSON' }));
    }
    calls++;
    res.setHeader('Content-Type', request.stream ? 'text/event-stream' : 'application/json');
    const response = fixtureResponse(request.stream);
    res.end(typeof response === 'string' ? response : JSON.stringify(response));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/v1`, calls: () => calls };
}

export function assertHealthIdentity(health, sha, expectedHash) {
  const hash = health?.data?.build?.gitHash;
  if (health?.success !== true || health?.data?.status !== 'healthy' || typeof hash !== 'string' || !/^[0-9a-f]{7,40}$/.test(hash) || hash !== expectedHash || !sha.startsWith(hash)) throw new Error('Running API health build identity differs from tested build');
}
