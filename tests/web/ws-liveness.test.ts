/**
 * 채팅 WebSocket 생존 확인(2026-10-29) — half-open 소켓은 브라우저에 onclose 가 1~2분 늦게 온다.
 * 마지막 수신 뒤 intervalMs 가 지나면 앱 ping 을 보내고 timeoutMs 안에 아무것도 오지 않으면 onDead 를 한 번 부른다.
 * 재연결 뒤 중단 다시 보내기(pending abort) 규칙도 여기서 함께 본다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWsLiveness, type WsLivenessTimers } from '../../apps/web/lib/ws-liveness';
import { clearsPendingAbort, messagesOnReopen } from '../../apps/web/lib/ws-pending-abort';

/** 가짜 시계 — advance(ms) 로 그 사이 만기된 타이머를 시각 순서대로 실행한다. */
function fakeTimers(): WsLivenessTimers & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const e of timers) if (e[1].at <= end && (!due || e[1].at < due[1].at)) due = e;
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

function setup() {
  const timers = fakeTimers();
  const pings: number[] = [];
  let dead = 0;
  const live = createWsLiveness({
    intervalMs: 15_000,
    timeoutMs: 10_000,
    sendPing: () => pings.push(timers.now()),
    onDead: () => { dead += 1; },
    timers,
  });
  return { timers, pings, live, dead: () => dead };
}

test('계속 수신이 있으면 ping 을 보내지 않는다', () => {
  const { timers, pings, live, dead } = setup();
  live.start();
  for (let i = 0; i < 10; i++) { timers.advance(5_000); live.noteInbound(); }
  assert.deepEqual(pings, []);
  assert.equal(dead(), 0);
});

test('마지막 수신 뒤 intervalMs 가 지나면 ping 을 보내고, 응답이 오면 살아 있다', () => {
  const { timers, pings, live, dead } = setup();
  live.start();
  timers.advance(4_000);
  live.noteInbound(); // t=4s 수신
  timers.advance(15_000); // t=19s — 마지막 수신 뒤 정확히 15초
  assert.deepEqual(pings, [19_000]);
  timers.advance(200);
  live.noteInbound(); // pong
  timers.advance(10_000);
  assert.equal(dead(), 0);
});

test('ping 에 timeoutMs 안 응답이 없으면 onDead 를 한 번만 부르고 그 뒤로 조용하다', () => {
  const { timers, pings, live, dead } = setup();
  live.start();
  timers.advance(15_000);
  assert.equal(pings.length, 1);
  timers.advance(9_999);
  assert.equal(dead(), 0);
  timers.advance(1);
  assert.equal(dead(), 1);
  timers.advance(120_000);
  live.probe();
  timers.advance(60_000);
  assert.equal(dead(), 1);
  assert.equal(pings.length, 1);
  assert.equal(timers.pending(), 0);
});

test('probe 는 즉시 ping 하고, 응답이 없으면 timeoutMs 뒤 onDead', () => {
  const { timers, pings, live, dead } = setup();
  live.start();
  timers.advance(1_000);
  live.probe();
  assert.deepEqual(pings, [1_000]);
  live.probe(); // 응답 대기 중 중복 probe 는 ping 을 더 보내지 않는다
  assert.equal(pings.length, 1);
  timers.advance(10_000);
  assert.equal(dead(), 1);
});

test('probe 뒤 응답이 오면 onDead 는 없다', () => {
  const { timers, live, dead } = setup();
  live.start();
  live.probe();
  timers.advance(3_000);
  live.noteInbound(); // t=3s pong
  timers.advance(14_000); // t=17s — 조용한 지 14초, 아직 ping 전
  assert.equal(dead(), 0);
  live.noteInbound();
  timers.advance(5_000);
  assert.equal(dead(), 0);
});

test('stop 뒤에는 ping 도 onDead 도 없다(응답 대기 중 stop 포함)', () => {
  const { timers, pings, live, dead } = setup();
  live.start();
  timers.advance(15_000);
  assert.equal(pings.length, 1);
  live.stop();
  timers.advance(120_000);
  live.probe();
  timers.advance(60_000);
  assert.equal(dead(), 0);
  assert.equal(pings.length, 1);
  assert.equal(timers.pending(), 0);
});

test('start 전에는 probe 가 아무것도 하지 않는다', () => {
  const { timers, pings, live, dead } = setup();
  live.probe();
  timers.advance(60_000);
  assert.deepEqual(pings, []);
  assert.equal(dead(), 0);
});

test('sendPing 이 던져도(닫히는 소켓) 응답 없음으로 보고 onDead', () => {
  const timers = fakeTimers();
  let dead = 0;
  const live = createWsLiveness({
    intervalMs: 15_000, timeoutMs: 10_000, timers,
    sendPing: () => { throw new Error('InvalidStateError'); },
    onDead: () => { dead += 1; },
  });
  live.start();
  timers.advance(25_000);
  assert.equal(dead, 1);
});

// ─── 재연결 뒤 중단 다시 보내기 ───

const RESUME = { type: 'resume', anonSessionId: 'anon-1', streamId: 's1', afterSeq: 7 };

test('재연결: resume 을 보내고, 중단 대기 중이면 그 뒤에 abort 를 보낸다', () => {
  assert.deepEqual(messagesOnReopen(RESUME, true), { messages: [RESUME, { type: 'abort' }], pendingAbort: true });
});

test('재연결: 중단 대기가 없으면 resume 만', () => {
  assert.deepEqual(messagesOnReopen(RESUME, false), { messages: [RESUME], pendingAbort: false });
});

test('재연결: 이어받을 스트림이 없으면(resume 안 보냄) abort 도 보내지 않고 대기를 푼다', () => {
  assert.deepEqual(messagesOnReopen(null, true), { messages: [], pendingAbort: false });
  assert.deepEqual(messagesOnReopen(null, false), { messages: [], pendingAbort: false });
});

test('중단 대기는 aborted·done·error·resume_none 에서만 풀린다', () => {
  for (const type of ['aborted', 'done', 'error', 'resume_none']) assert.equal(clearsPendingAbort(type), true, type);
  for (const type of ['token', 'stream_resume', 'pong', 'thinking', 'session_created']) assert.equal(clearsPendingAbort(type), false, type);
});
