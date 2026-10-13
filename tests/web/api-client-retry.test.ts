/**
 * ApiClient — 네트워크 계층 실패(fetch 가 TypeError 를 던짐)의 멱등 GET 1회 재시도.
 *
 * 배경(2026-10-13 운영 chat.openmake.cc): Chrome↔Cloudflare edge 의 HTTP/3 세션이 닫히는 순간
 * 30초 폴링 5건이 함께 `ERR_CONNECTION_CLOSED` 로 실패했고, 같은 순간 새 세션에 실린 1건은 성공했다.
 * 서버 홉(Node·Caddy·edge TCP)은 유휴 125초 뒤에도 재사용이 됐으므로 저장소에서 할 일은 재시도다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../../packages/api-client/src/index';

function stubFetch(plan: Array<'fail' | 'abort' | 'ok'>) {
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // mutating 요청 앞의 CSRF 토큰 조회는 시험 대상이 아니다 — 계획을 소비하지 않고 바로 응답
    if (String(input).includes('/csrf')) return Response.json({});
    calls.push({ url: String(input), method: (init?.method || 'GET').toUpperCase() });
    const step = plan.shift();
    if (step === 'fail') throw new TypeError('Failed to fetch');
    if (step === 'abort') throw new DOMException('The user aborted a request.', 'AbortError');
    return Response.json({ success: true, data: { pending: [] } });
  }) as typeof fetch;
  return calls;
}

test('GET 이 네트워크 오류로 끊기면 한 번 다시 보내고 그 결과를 돌려준다', async () => {
  const original = globalThis.fetch;
  try {
    const calls = stubFetch(['fail', 'ok']);
    const r = await ApiClient.get<{ data: { pending: unknown[] } }>('/api/agent-tasks/approvals/pending');
    assert.deepEqual(r.data, { pending: [] });
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.method === 'GET' && c.url === '/api/agent-tasks/approvals/pending'));
  } finally {
    globalThis.fetch = original;
  }
});

test('두 번 연속 끊기면 두 번째 오류를 그대로 올린다(무한 재시도 없음)', async () => {
  const original = globalThis.fetch;
  try {
    const calls = stubFetch(['fail', 'fail', 'ok']);
    await assert.rejects(ApiClient.get('/api/agent-tasks'), TypeError);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('POST 는 네트워크 오류를 재시도하지 않는다(멱등이 아니다)', async () => {
  const original = globalThis.fetch;
  try {
    const calls = stubFetch(['fail', 'ok']);
    await assert.rejects(ApiClient.post('/api/chat/sessions', { title: 'x' }), TypeError);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('호출자가 취소한(AbortError) GET 은 재시도하지 않는다', async () => {
  const original = globalThis.fetch;
  try {
    const calls = stubFetch(['abort', 'ok']);
    await assert.rejects(ApiClient.get('/api/agent-tasks'), (e: unknown) => e instanceof DOMException && e.name === 'AbortError');
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
