/**
 * 비교 레인 중단·재연결(2026-10-29) — 실제 useCompareLane 훅을 가짜 WebSocket·가짜 시간으로 돌린다.
 *  - Stop 은 그 레인의 그 생성에만 — 끊겨 있어도 기억했다가, 재연결 뒤 정확 이어받기(resume{exact})가
 *    같은 스트림의 stream_resume 을 돌려준 다음에만 abort 를 보낸다. 끊긴 동안 Stop UI 는 남고 전송은 막힌다.
 *  - 생성 식별자는 클라이언트가 정한다(chat.streamId) — 첫 이벤트 전에 끊겨도 그 생성을 지정한다.
 *  - 서버가 exactResume 을 알리지 않으면(구 서버·init 전) resume/abort 를 보내지 않고 이어받지 못했다고 표시한다.
 *  - reset·새 요청 뒤 지난 생성의 늦은 이벤트는 새 화면에 닿지 않는다.
 *  - 재연결 한도가 소진되면 UI 를 풀고, online·탭 복귀로 다시 연결해 남은 중단을 마무리한다.
 * 이 파일은 pong 을 보내지 않는다 — pong 을 받는 테스트(생존 확인·종료 응답 대기)는 페이지 공유 "앱 ping 지원" 값이
 * 뒤 테스트로 새지 않게 compare-lane-abort-pong.test.tsx 로 나눴다. 공통 장치는 compare-lane-harness.tsx.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import ko from '../../apps/web/messages/ko.json';
import { chatOf, connected, expectLane, lastAssistant, NEW_SERVER_INIT, OLD_SERVER_INIT, reconnect } from './compare-lane-harness';

test('Stop 은 그 레인에만 — 다른 레인의 생성은 계속된다', async () => {
  const h = await connected();
  await h.run(() => { h.a().send('질문', 'm-a'); h.b().send('질문', 'm-b'); });
  const idA = chatOf(h.last('a')).streamId as string;
  const idB = chatOf(h.last('b')).streamId as string;
  assert.match(idA, /^[0-9a-f-]{36}$/);
  assert.notEqual(idA, idB);
  await h.run(() => h.a().abort());
  assert.deepEqual(h.last('a').out.map((m) => m.type), ['chat', 'abort']);
  assert.deepEqual(h.last('b').out.map((m) => m.type), ['chat']);
  await h.run(() => h.last('a').emit({ type: 'aborted', streamId: idA }));
  assert.equal(h.a().streaming, false);
  assert.equal(h.b().streaming, true);
  await h.done();
});

test('첫 이벤트 전에 끊겨도 Stop UI 가 남고, 재연결 뒤 exact resume → 같은 stream_resume → abort 순서로 중단한다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const id = chatOf(h.last('a')).streamId as string;
  expectLane(h, 'a');
  await h.run(() => h.last('a').close());
  assert.equal(h.a().streaming, true, '끊긴 동안 생성 중 표시가 남는다');
  assert.equal(h.a().connected, false);
  await h.run(() => h.a().abort()); // 끊긴 동안 누른 Stop
  await h.run(() => h.a().send('다른 질문', 'm-a')); // 전송은 막힌다
  const ws = await reconnect(h, 'a');
  assert.deepEqual(ws.out, [{ type: 'resume', anonSessionId: ws.out[0].anonSessionId, lane: 'a', streamId: id, afterSeq: 0, exact: true }]);
  await h.run(() => ws.emit({ type: 'stream_resume', streamId: id, content: '부분', finished: false }));
  assert.deepEqual(ws.out.map((m) => m.type), ['resume', 'abort']);
  assert.equal(h.a().streaming, true, 'terminal 까지 유지');
  await h.run(() => ws.emit({ type: 'aborted', streamId: id }));
  assert.equal(h.a().streaming, false);
  assert.ok(!lastAssistant(h.a())?.error);
  assert.equal(h.a().messages.filter((m) => m.role === 'user').length, 1);
  await h.done();
});

test('재연결 소켓이 stream_resume 전에 또 끊겨도 다음 소켓에서 다시 resume → abort 한다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const id = chatOf(h.last('a')).streamId as string;
  await h.run(() => h.last('a').emit({ type: 'session_created', sessionId: 's1', streamId: id, seq: 1 }));
  await h.run(() => h.a().abort());
  const second = await reconnect(h, 'a');
  assert.deepEqual(second.out.map((m) => m.type), ['resume']);
  const third = await reconnect(h, 'a');
  assert.deepEqual(third.out[0], { type: 'resume', anonSessionId: third.out[0].anonSessionId, lane: 'a', streamId: id, afterSeq: 1, exact: true });
  await h.run(() => third.emit({ type: 'stream_resume', streamId: id, content: '', finished: false }));
  assert.deepEqual(third.out.map((m) => m.type), ['resume', 'abort']);
  await h.run(() => third.emit({ type: 'aborted', streamId: id }));
  assert.equal(h.a().streaming, false);
  await h.done();
});

test('다른 탭의 스트림(streamId 불일치)·resume_none 이면 abort 를 보내지 않고 이어받지 못했다고 표시한다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const id = chatOf(h.last('a')).streamId as string;
  const ws = await reconnect(h, 'a');
  await h.run(() => ws.emit({ type: 'stream_resume', streamId: '11111111-2222-4333-8444-555555555555', content: '남의 답', finished: false }));
  await h.run(() => ws.emit({ type: 'token', token: '남의 토큰', streamId: '11111111-2222-4333-8444-555555555555', seq: 9 }));
  assert.equal(lastAssistant(h.a())?.content, '', '다른 생성의 본문은 그리지 않는다');
  await h.run(() => ws.emit({ type: 'resume_none', streamId: id }));
  assert.deepEqual(ws.out.map((m) => m.type), ['resume']);
  assert.equal(h.a().streaming, false);
  assert.equal(lastAssistant(h.a())?.error, true);
  assert.equal(lastAssistant(h.a())?.content, ko.compare.resumeLost);
  await h.done();
});

test('Stop 뒤 resume_none 은 정상 중단으로 끝난다(오류 표시 없음)', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const id = chatOf(h.last('a')).streamId as string;
  await h.run(() => h.last('a').emit({ type: 'token', token: '부분', streamId: id, seq: 1 }));
  await h.run(() => h.a().abort());
  const ws = await reconnect(h, 'a');
  await h.run(() => ws.emit({ type: 'resume_none', streamId: id }));
  assert.equal(h.a().streaming, false);
  assert.ok(!lastAssistant(h.a())?.error);
  assert.equal(lastAssistant(h.a())?.content, '부분');
  await h.done();
});

test('구 서버(init 에 exactResume 없음)에는 resume·abort 를 보내지 않고 생성 상태를 정리한다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  await h.run(() => h.a().abort());
  const ws = await reconnect(h, 'a', OLD_SERVER_INIT);
  assert.deepEqual(ws.out, []);
  assert.equal(h.a().streaming, false);
  assert.equal(lastAssistant(h.a())?.streaming, false);
  // 구 서버 연결에서도 새 질문은 보낼 수 있다
  await h.run(() => h.a().send('다시', 'm-a'));
  assert.deepEqual(ws.out.map((m) => m.type), ['chat']);
  await h.done();
});

test('reset 뒤 새 요청 — 지난 생성의 늦은 aborted·토큰은 새 화면에 닿지 않는다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('첫 질문', 'm-a'));
  const ws = h.last('a');
  const old = chatOf(ws).streamId as string;
  await h.run(() => h.a().reset());
  assert.deepEqual(ws.out.map((m) => m.type), ['chat', 'abort'], 'reset 은 진행 중 생성을 멈춘다');
  assert.deepEqual(h.a().messages, []);
  assert.equal(h.a().streaming, false);
  await h.run(() => h.a().send('새 질문', 'm-a'));
  const fresh = ws.out.filter((m) => m.type === 'chat')[1].streamId as string;
  assert.notEqual(fresh, old);
  await h.run(() => {
    ws.emit({ type: 'token', token: '옛 토큰', streamId: old, seq: 2 });
    ws.emit({ type: 'aborted', streamId: old });
  });
  assert.equal(h.a().streaming, true, '새 생성은 계속된다');
  assert.equal(lastAssistant(h.a())?.content, '');
  await h.run(() => ws.emit({ type: 'token', token: '새 토큰', streamId: fresh, seq: 1 }));
  assert.equal(lastAssistant(h.a())?.content, '새 토큰');
  await h.run(() => ws.emit({ type: 'done', streamId: fresh, seq: 2 }));
  assert.equal(h.a().streaming, false);
  await h.done();
});

test('끊긴 동안 reset 해도 재연결 뒤 지난 생성의 중단을 마무리하고 화면에는 그리지 않는다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const id = chatOf(h.last('a')).streamId as string;
  expectLane(h, 'a');
  await h.run(() => h.last('a').close());
  await h.run(() => h.a().reset());
  assert.equal(h.a().streaming, false);
  const ws = await reconnect(h, 'a');
  assert.deepEqual(ws.out.map((m) => m.type), ['resume']);
  await h.run(() => ws.emit({ type: 'stream_resume', streamId: id, content: '옛 본문', finished: false }));
  assert.deepEqual(ws.out.map((m) => m.type), ['resume', 'abort']);
  await h.run(() => ws.emit({ type: 'aborted', streamId: id }));
  assert.deepEqual(h.a().messages, []);
  assert.equal(h.a().streaming, false);
  await h.done();
});

test('재연결 한도가 소진되면 UI 를 풀고, online 이면 다시 연결해 남은 중단을 보낸다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const id = chatOf(h.last('a')).streamId as string;
  await h.run(() => h.a().abort());
  expectLane(h, 'a');
  let made = h.sockets('a').length;
  await h.run(() => h.last('a').close());
  for (let i = 0; i < 20; i++) {
    await h.advance(10_000);
    if (h.sockets('a').length === made) break; // 더 이상 재연결하지 않는다
    made = h.sockets('a').length;
    await h.run(() => h.last('a').close()); // 연결 실패
  }
  assert.equal(h.sockets('a').length, 11, '첫 소켓 + 재연결 10번(한도) 뒤 멈춘다');
  assert.equal(h.a().streaming, false, '한도 소진 뒤 Stop·입력이 멈춰 있지 않다');
  await h.run(() => window.dispatchEvent(new window.Event('online')));
  const ws = h.last('a');
  assert.equal(h.sockets('a').length, 12);
  await h.run(() => { ws.open(); ws.emit(NEW_SERVER_INIT); });
  assert.deepEqual(ws.out[0], { type: 'resume', anonSessionId: ws.out[0].anonSessionId, lane: 'a', streamId: id, afterSeq: 0, exact: true });
  await h.run(() => ws.emit({ type: 'stream_resume', streamId: id, content: '', finished: false }));
  assert.deepEqual(ws.out.map((m) => m.type), ['resume', 'abort']);
  await h.done();
});

test('한도 소진 뒤 탭 복귀(visible)도 다시 연결한다', async () => {
  const h = await connected();
  expectLane(h, 'b');
  let made = h.sockets('b').length;
  await h.run(() => h.last('b').close());
  for (let i = 0; i < 20; i++) {
    await h.advance(10_000);
    if (h.sockets('b').length === made) break;
    made = h.sockets('b').length;
    await h.run(() => h.last('b').close());
  }
  const exhausted = h.sockets('b').length;
  await h.run(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); // 탭 복귀
    document.dispatchEvent(new window.Event('visibilitychange'));
  });
  assert.equal(h.sockets('b').length, exhausted + 1);
  await h.done();
});

test('서버 등록 전에 닿은 Stop(응답 없음) — 그 생성의 첫 이벤트로 등록을 확인하면 한 번 더 보낸다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const ws = h.last('a');
  const id = chatOf(ws).streamId as string;
  await h.run(() => h.a().abort()); // 서버는 아직 등록 전이라 이 abort 에 답하지 않는다
  assert.deepEqual(ws.out.map((m) => m.type), ['chat', 'abort']);
  await h.run(() => ws.emit({ type: 'token', token: '이', streamId: '11111111-2222-4333-8444-555555555555', seq: 1 })); // 다른 생성은 무시
  assert.deepEqual(ws.out.map((m) => m.type), ['chat', 'abort']);
  await h.run(() => ws.emit({ type: 'session_created', sessionId: 's1', streamId: id, seq: 1 }));
  assert.deepEqual(ws.out.map((m) => m.type), ['chat', 'abort', 'abort']);
  await h.run(() => ws.emit({ type: 'token', token: '가', streamId: id, seq: 2 }));
  assert.deepEqual(ws.out.map((m) => m.type), ['chat', 'abort', 'abort'], '한 번만 다시 보낸다');
  await h.run(() => ws.emit({ type: 'aborted', streamId: id }));
  assert.equal(h.a().streaming, false);
  await h.done();
});

test('등록을 확인한 뒤 누른 Stop 은 다시 보내지 않는다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const ws = h.last('a');
  const id = chatOf(ws).streamId as string;
  await h.run(() => ws.emit({ type: 'session_created', sessionId: 's1', streamId: id, seq: 1 }));
  await h.run(() => h.a().abort());
  await h.run(() => ws.emit({ type: 'token', token: '가', streamId: id, seq: 2 }));
  assert.deepEqual(ws.out.map((m) => m.type), ['chat', 'abort']);
  await h.done();
});

test('stream_resume{finished} 뒤 재생된 done 이 오면 바로 그 결과로 끝낸다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const id = chatOf(h.last('a')).streamId as string;
  const ws = await reconnect(h, 'a');
  await h.run(() => {
    ws.emit({ type: 'stream_resume', streamId: id, content: '원문<x>', finished: true, lastSeq: 3 });
    ws.emit({ type: 'done', streamId: id, seq: 3, cleanedContent: '원문', metrics: { tokensPerSec: '1.0', tokenCount: 2 } });
  });
  assert.equal(h.a().streaming, false);
  assert.equal(lastAssistant(h.a())?.content, '원문');
  assert.deepEqual(lastAssistant(h.a())?.metrics, { tokensPerSec: '1.0', tokenCount: 2 });
  await h.done();
});

test('stream_resume{finished} 뒤 done 전에 소켓이 끊기면 오류 없이 스냅샷으로 정상 종료한다(서버는 끝난 스트림을 이미 폐기했다)', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const id = chatOf(h.last('a')).streamId as string;
  const ws = await reconnect(h, 'a');
  await h.run(() => ws.emit({ type: 'stream_resume', streamId: id, content: '완성된 답', finished: true, lastSeq: 5 }));
  const next = await reconnect(h, 'a');
  await h.run(() => next.emit({ type: 'resume_none', streamId: id })); // 물었다면 서버의 답
  assert.equal(h.a().streaming, false);
  assert.equal(lastAssistant(h.a())?.streaming, false);
  assert.ok(!lastAssistant(h.a())?.error, '완성된 답을 오류로 표시하지 않는다');
  assert.equal(lastAssistant(h.a())?.content, '완성된 답');
  assert.deepEqual(next.out, [], '끝난 생성은 다시 이어받지 않는다');
  await h.done();
});

test('stream_resume{finished} 뒤 끊긴 채 재연결 한도가 소진돼도 오류 없이 스냅샷으로 끝난다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const id = chatOf(h.last('a')).streamId as string;
  const ws = await reconnect(h, 'a');
  await h.run(() => ws.emit({ type: 'stream_resume', streamId: id, content: '완성된 답', finished: true, lastSeq: 5 }));
  expectLane(h, 'a');
  let made = h.sockets('a').length;
  await h.run(() => h.last('a').close());
  for (let i = 0; i < 20; i++) {
    await h.advance(10_000);
    if (h.sockets('a').length === made) break;
    made = h.sockets('a').length;
    await h.run(() => h.last('a').close()); // 연결 실패
  }
  assert.equal(h.a().streaming, false);
  assert.ok(!lastAssistant(h.a())?.error);
  assert.equal(lastAssistant(h.a())?.content, '완성된 답');
  await h.done();
});

test('online 때 소켓이 열려 있으면 새로 열지 않고 생존 확인만 한다', async () => {
  const h = await connected();
  const ws = h.last('a');
  const before = h.sockets('a').length;
  const pings = ws.sent.filter((m) => m.type === 'ping').length;
  await h.run(() => window.dispatchEvent(new window.Event('online')));
  assert.equal(h.sockets('a').length, before);
  assert.equal(ws.sent.filter((m) => m.type === 'ping').length, pings + 1);
  await h.done();
});
