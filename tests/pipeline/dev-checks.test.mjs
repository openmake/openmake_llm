import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedDatabase, fixtureResponse, assertChat } from '../../scripts/ci/dev-checks-fixture.mjs';
test('disposable DB requires explicit local _test URL, never DATABASE_URL fallback', () => {
  for (const url of [undefined, 'postgresql://u:p@db.example/a_test', 'postgresql://u:p@localhost/production']) assert.throws(() => isolatedDatabase(url), /TEST_DATABASE_URL/);
  assert.equal(isolatedDatabase('postgresql://u:p@127.0.0.1:5433/pipeline_test').pathname, '/pipeline_test');
});
test('fixture supports both SDK JSON and SSE without model service', () => {
  assert.equal(fixtureResponse(false).choices[0].message.content, 'PIPELINE_CHAT_OK');
  assert.match(fixtureResponse(true), /data: \[DONE\]/);
});
test('chat must contain fixture marker, completion, and no SSE error', () => {
  assert.doesNotThrow(() => assertChat('data: {"token":"PIPELINE_CHAT_OK"}\n\ndata: {"done":true}\n'));
  for (const body of ['data: {"token":"PIPELINE_CHAT_OK"}', 'data: {"done":true}', 'data: {"error":"bad","done":true,"token":"PIPELINE_CHAT_OK"}']) assert.throws(() => assertChat(body));
});

test('model fixture serves actual HTTP model catalog and SDK stream', async () => {
  const { startModelFixture, MODEL } = await import('../../scripts/ci/dev-checks-fixture.mjs');
  const fixture = await startModelFixture();
  try {
    const catalog = await (await fetch(`${fixture.url}/models`)).json();
    assert.equal(catalog.data[0].id, MODEL);
    const response = await fetch(`${fixture.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, stream: true, messages: [{ role: 'user', content: 'hello' }] }) });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(await response.text(), /PIPELINE_CHAT_OK/);
    assert.equal(fixture.calls(), 1);
    assert.equal((await fetch(`${fixture.url}/unknown`)).status, 404);
  } finally { fixture.server.closeAllConnections(); await new Promise(resolve => fixture.server.close(resolve)); }
});

test('invalid fixture JSON is rejected without killing HTTP fixture', async () => {
  const { startModelFixture } = await import('../../scripts/ci/dev-checks-fixture.mjs');
  const fixture = await startModelFixture();
  try {
    const response = await fetch(`${fixture.url}/chat/completions`, { method: 'POST', body: '{bad' });
    assert.equal(response.status, 400);
    assert.equal((await fetch(`${fixture.url}/models`)).status, 200);
  } finally { fixture.server.closeAllConnections(); await new Promise(resolve => fixture.server.close(resolve)); }
});
