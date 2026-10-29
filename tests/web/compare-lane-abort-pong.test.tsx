/**
 * 비교 레인 중단·재연결(2026-10-29) 중 서버의 pong 을 받는 테스트 — 생존 확인(half-open 판정)과 종료 응답 대기.
 * pong 을 받으면 ws-liveness 의 페이지 공유 "앱 ping 지원" 값이 true 로 바뀌어 같은 프로세스의 뒤 테스트로 샌다
 * (pong 을 받지 않은 레인이 침묵 25초 뒤 버려진다). 그래서 pong 을 쓰지 않는 compare-lane-abort.test.tsx 와
 * 파일을 나눴다(파일마다 프로세스가 따로 돈다). 이 파일의 테스트는 지원 값이 true 인 것을 전제로 한다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chatOf, connected, expectLane, lastAssistant, NEW_SERVER_INIT, reconnect } from './compare-lane-harness';

test('half-open 소켓의 Stop — abort 와 함께 생존 확인을 보내고, 무응답이면 버린 뒤 재연결해서 다시 중단한다', async () => {
  const h = await connected();
  await h.run(() => h.last('a').emit({ type: 'pong' })); // 이 페이지는 서버의 앱 ping 지원을 안다
  await h.run(() => h.a().send('질문', 'm-a'));
  const ws = h.last('a');
  const id = chatOf(ws).streamId as string;
  const pingsBefore = ws.sent.filter((m) => m.type === 'ping').length;
  await h.run(() => h.a().abort());
  assert.equal(ws.sent.filter((m) => m.type === 'ping').length, pingsBefore + 1, 'Stop 은 바로 생존 확인을 한다');
  expectLane(h, 'a');
  await h.advance(10_000); // 응답 없음 → 버림 → 재연결 대기
  await h.advance(10_000);
  const next = h.last('a');
  assert.notEqual(next, ws);
  await h.run(() => { next.open(); next.emit(NEW_SERVER_INIT); });
  await h.run(() => next.emit({ type: 'stream_resume', streamId: id, content: '', finished: false }));
  assert.deepEqual(next.out.map((m) => m.type), ['resume', 'abort']);
  await h.done();
});

// ── 종료 응답 대기(2026-10-29 리뷰 I1·M2) — 서버 응답이 없어도 UI 가 영구 정지하지 않는다 ──

test('다른 탭이 생성을 대체해 Stop 에 답이 없으면, 소켓이 살아 있어도 대기 시간 뒤 중단을 한 번 더 보내고 정상 중단으로 정리한다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const ws = h.last('a');
  const id = chatOf(ws).streamId as string;
  await h.run(() => ws.emit({ type: 'token', token: '부분', streamId: id, seq: 1 }));
  await h.run(() => h.a().abort()); // 서버: 이 소켓의 컨트롤러는 다른 탭의 새 요청이 이미 치웠다 → 응답 없음
  await h.run(() => ws.emit({ type: 'pong' })); // 소켓은 살아 있다
  assert.equal(h.a().streaming, true);
  await h.advance(14_000);
  assert.equal(h.a().streaming, true, '대기 시간 전에는 기다린다');
  await h.advance(1_000);
  assert.equal(h.a().streaming, false, 'Stop·입력이 멈춰 있지 않다');
  assert.ok(!lastAssistant(h.a())?.error, '사용자가 누른 중단이라 오류 표시는 없다');
  assert.equal(lastAssistant(h.a())?.content, '부분');
  assert.deepEqual(ws.out.map((m) => m.type), ['chat', 'abort', 'abort'], '잊기 전에 한 번 더 보낸다(늦게 등록된 생성 대비)');
  await h.run(() => ws.emit({ type: 'token', token: '늦은', streamId: id, seq: 2 }));
  assert.equal(lastAssistant(h.a())?.content, '부분', '정리한 생성의 늦은 이벤트는 그리지 않는다');
  await h.run(() => h.a().send('다음', 'm-a'));
  assert.equal(ws.out.filter((m) => m.type === 'chat').length, 2, '새 질문을 보낼 수 있다');
  await h.done();
});

test('Stop 에 aborted 가 제때 오면 대기 타이머는 아무것도 하지 않는다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const ws = h.last('a');
  const id = chatOf(ws).streamId as string;
  await h.run(() => ws.emit({ type: 'token', token: '부분', streamId: id, seq: 1 }));
  await h.run(() => h.a().abort());
  await h.run(() => ws.emit({ type: 'aborted', streamId: id }));
  await h.run(() => h.a().send('다음', 'm-a'));
  const next = ws.out.filter((m) => m.type === 'chat')[1].streamId as string;
  await h.run(() => ws.emit({ type: 'pong' }));
  await h.advance(15_000);
  assert.equal(h.a().streaming, true, '지난 생성의 타이머가 새 생성을 끝내지 않는다');
  assert.deepEqual(ws.out.map((m) => m.type), ['chat', 'abort', 'chat']);
  await h.run(() => ws.emit({ type: 'done', streamId: next, seq: 1 }));
  assert.equal(h.a().streaming, false);
  await h.done();
});

test('stream_resume{finished} 뒤 done 이 재생되지 않으면(링 비활성) 대기 뒤 스냅샷으로 정상 종료한다', async () => {
  const h = await connected();
  await h.run(() => h.a().send('질문', 'm-a'));
  const id = chatOf(h.last('a')).streamId as string;
  const ws = await reconnect(h, 'a');
  await h.run(() => ws.emit({ type: 'stream_resume', streamId: id, content: '완성된 답', finished: true, lastSeq: 5 }));
  await h.run(() => ws.emit({ type: 'pong' }));
  await h.run(() => h.last('b').emit({ type: 'pong' })); // b 의 마지막 수신을 옮겨 생존 판정 만료(25초)와 겹치지 않게 한다
  assert.equal(h.a().streaming, true);
  await h.advance(15_000);
  assert.equal(h.a().streaming, false);
  assert.equal(lastAssistant(h.a())?.content, '완성된 답');
  assert.ok(!lastAssistant(h.a())?.error);
  assert.deepEqual(ws.out.map((m) => m.type), ['resume'], '끝난 생성에는 중단을 보내지 않는다');
  await h.done();
});
