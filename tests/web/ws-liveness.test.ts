/**
 * 채팅 WebSocket 생존 확인(2026-10-29) — half-open 소켓은 브라우저에 onclose 가 1~2분 늦게 온다.
 * 마지막 수신 뒤 intervalMs 가 지나면 앱 ping 을 보내고 timeoutMs 안에 아무것도 오지 않으면 onDead 를 한 번 부른다.
 * 재연결 뒤 중단 다시 보내기(pending abort) 규칙도 여기서 함께 본다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWsLiveness, type AppPingCapability, type EarlyRetryBudget, type WsLivenessTimers } from '../../apps/web/lib/ws-liveness';
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

/** 기본은 "이 페이지가 pong 을 한 번 받아 본" 상태 — 서버가 앱 ping 을 지원한다고 안다. */
function setup(capability: AppPingCapability = { supported: true }, earlyRetry?: EarlyRetryBudget, timers = fakeTimers()) {
  const pings: number[] = [];
  let dead = 0;
  const live = createWsLiveness({
    intervalMs: 15_000,
    timeoutMs: 10_000,
    sendPing: () => pings.push(timers.now()),
    onDead: () => { dead += 1; },
    timers,
    capability,
    earlyRetry,
  });
  return { timers, pings, live, dead: () => dead, capability };
}

/** 소켓을 열고 서버의 연결 직후 메시지(init 등)를 받은 상태 — 열린 직후 확인은 그 수신으로 풀린다 */
function opened(live: ReturnType<typeof setup>['live']) {
  live.start();
  live.noteInbound();
}

test('열린 직후 바로 ping 을 한 번 보낸다(첫 pong 전 공백을 줄인다)', () => {
  const { pings, live } = setup({ supported: false });
  live.start();
  assert.deepEqual(pings, [0]);
});

test('열린 직후 확인 뒤로는, 계속 수신이 있으면 ping 을 더 보내지 않는다', () => {
  const { timers, pings, live, dead } = setup();
  opened(live);
  for (let i = 0; i < 10; i++) { timers.advance(5_000); live.noteInbound(); }
  assert.deepEqual(pings, [0]);
  assert.equal(dead(), 0);
});

test('마지막 수신 뒤 intervalMs 가 지나면 ping 을 보내고, 응답이 오면 살아 있다', () => {
  const { timers, pings, live, dead } = setup();
  opened(live);
  timers.advance(4_000);
  live.noteInbound(); // t=4s 수신
  timers.advance(15_000); // t=19s — 마지막 수신 뒤 정확히 15초
  assert.deepEqual(pings, [0, 19_000]);
  timers.advance(200);
  live.noteInbound(); // pong
  timers.advance(10_000);
  assert.equal(dead(), 0);
});

test('ping 에 timeoutMs 안 응답이 없으면 onDead 를 한 번만 부르고 그 뒤로 조용하다', () => {
  const { timers, pings, live, dead } = setup();
  opened(live);
  timers.advance(15_000);
  assert.equal(pings.length, 2);
  timers.advance(9_999);
  assert.equal(dead(), 0);
  timers.advance(1);
  assert.equal(dead(), 1);
  timers.advance(120_000);
  live.probe();
  timers.advance(60_000);
  assert.equal(dead(), 1);
  assert.equal(pings.length, 2);
  assert.equal(timers.pending(), 0);
});

test('probe 는 즉시 ping 하고, 응답이 없으면 timeoutMs 뒤 onDead', () => {
  const { timers, pings, live, dead } = setup();
  opened(live);
  timers.advance(1_000);
  live.probe();
  assert.deepEqual(pings, [0, 1_000]);
  live.probe(); // 응답 대기 중 중복 probe 는 ping 을 더 보내지 않는다
  assert.equal(pings.length, 2);
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
  opened(live);
  timers.advance(15_000);
  assert.equal(pings.length, 2);
  live.stop();
  timers.advance(120_000);
  live.probe();
  timers.advance(60_000);
  assert.equal(dead(), 0);
  assert.equal(pings.length, 2);
  assert.equal(timers.pending(), 0);
});

test('열린 직후 확인의 응답을 기다리는 중에 stop 해도 타이머가 남지 않는다', () => {
  const { timers, live, dead } = setup({ supported: false }, { remaining: 1 });
  live.start();
  live.stop();
  assert.equal(timers.pending(), 0);
  timers.advance(60_000);
  assert.equal(dead(), 0);
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
    capability: { supported: true },
  });
  live.start();
  timers.advance(25_000);
  assert.equal(dead, 1);
});

// ─── 서버 지원 확인 전에는 죽었다고 판정하지 않는다(구 서버·배포 중 혼재) ───

test('pong 을 한 번도 받지 못한 페이지에서는 ping 은 보내되 onDead 는 부르지 않는다', () => {
  const { timers, pings, live, dead } = setup({ supported: false });
  live.start();
  timers.advance(120_000);
  live.probe();
  timers.advance(60_000);
  assert.ok(pings.length >= 2, '지원 여부를 배우려고 ping 은 계속 보낸다');
  assert.equal(dead(), 0);
});

test('notePong 은 지원을 기록하고 수신으로 친다 — 그 뒤로는 무응답이면 onDead', () => {
  const { timers, live, dead, capability } = setup({ supported: false });
  live.start();
  timers.advance(15_000); // ping
  live.notePong();
  assert.equal(capability.supported, true);
  timers.advance(9_000);
  assert.equal(dead(), 0); // 응답으로 대기가 풀렸다
  timers.advance(16_000 + 10_000); // 다음 ping 에 무응답
  assert.equal(dead(), 1);
});

test('지원 여부는 연결끼리 공유된다 — 이전 소켓에서 받은 pong 이면 새 소켓도 판정한다', () => {
  const shared: AppPingCapability = { supported: false };
  const first = setup(shared);
  first.live.start();
  first.live.notePong();
  first.live.stop();
  const second = setup(shared);
  second.live.start();
  second.live.probe(); // 중단 버튼 등 — 즉시 확인
  second.timers.advance(10_000);
  assert.equal(second.dead(), 1);
});

// ─── 첫 pong 전 무응답: 소켓 세대를 넘는 제한 예산으로만 재연결(2026-10-29) ───

test('지원 확인 전, 열린 뒤 아무것도 받지 못한 소켓은 예산 안에서만 죽었다고 판정한다(세대를 넘어 공유)', () => {
  const budget: EarlyRetryBudget = { remaining: 1 };
  const capability: AppPingCapability = { supported: false };
  const first = setup(capability, budget);
  first.live.start();
  first.timers.advance(9_999);
  assert.equal(first.dead(), 0);
  first.timers.advance(1);
  assert.equal(first.dead(), 1);
  assert.equal(budget.remaining, 0);
  // 재연결한 소켓도 아무것도 못 받는다 — 예산이 없으니 구 서버 호환 동작(onclose 를 기다림)으로 돌아가 루프를 만들지 않는다
  const second = setup(capability, budget);
  second.live.start();
  second.timers.advance(120_000);
  assert.equal(second.dead(), 0);
  assert.ok(second.pings.length >= 2, 'ping 은 계속 보내 지원 여부를 배운다');
});

test('지원 확인 전이라도 무엇이든 받은 소켓은 무응답으로 끊지 않고 예산도 쓰지 않는다(구 서버)', () => {
  const budget: EarlyRetryBudget = { remaining: 1 };
  const { timers, live, dead } = setup({ supported: false }, budget);
  opened(live); // 구 서버도 init 은 보낸다
  timers.advance(120_000);
  live.probe();
  timers.advance(60_000);
  assert.equal(dead(), 0);
  assert.equal(budget.remaining, 1);
});

test('예산이 없으면(기본) 지원 확인 전 무응답은 종전처럼 죽음으로 보지 않는다', () => {
  const { timers, live, dead } = setup({ supported: false });
  live.start();
  timers.advance(120_000);
  assert.equal(dead(), 0);
});

test('지원이 확인되면 예산과 무관하게 일반 timeout 으로 판정한다', () => {
  const budget: EarlyRetryBudget = { remaining: 0 };
  const { timers, live, dead } = setup({ supported: true }, budget);
  live.start();
  timers.advance(10_000);
  assert.equal(dead(), 1);
  assert.equal(budget.remaining, 0);
});

test('예산은 흐름마다 따로 — 한 레인의 첫 실패가 다른 레인의 첫 실패 감지를 막지 않는다', () => {
  const capability: AppPingCapability = { supported: false }; // 페이지 공유
  const timers = fakeTimers();
  const laneA = setup(capability, { remaining: 1 }, timers);
  const laneB = setup(capability, { remaining: 1 }, timers);
  laneA.live.start();
  laneB.live.start();
  timers.advance(10_000);
  assert.equal(laneA.dead(), 1);
  assert.equal(laneB.dead(), 1);
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

test('notePong 은 떼어 낸 메서드로 불러도 동작한다', () => {
  const { timers, live, dead, capability } = setup({ supported: false });
  const { notePong } = live;
  live.start();
  timers.advance(15_000); // ping
  notePong();
  assert.equal(capability.supported, true);
  timers.advance(9_000);
  assert.equal(dead(), 0);
});
