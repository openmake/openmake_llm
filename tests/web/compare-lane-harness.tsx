/**
 * 비교 레인 테스트 공통 장치 — 실제 useCompareLane 훅 두 개(a, b)를 가짜 WebSocket·가짜 시간으로 돌린다.
 * compare-lane-abort*.test.tsx 가 함께 쓴다(이 파일은 .test 가 아니라 단독으로 돌지 않는다).
 */
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import ko from '../../apps/web/messages/ko.json';
import { useCompareLane, type CompareLane } from '../../apps/web/lib/use-compare-lane';

export type Msg = Record<string, unknown>;

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static all: FakeWebSocket[] = [];
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  sent: Msg[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.all.push(this);
  }
  send(raw: string) {
    if (this.readyState !== 1) throw new Error('InvalidStateError');
    this.sent.push(JSON.parse(raw));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  /** 서버 측 — 연결 수립 */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  /** 서버 측 — 메시지 */
  emit(m: Msg) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  /** 보낸 것 중 ping 을 뺀 것 */
  get out(): Msg[] {
    return this.sent.filter((m) => m.type !== 'ping');
  }
}

export const NEW_SERVER_INIT = { type: 'init', data: {}, capabilities: { exactResume: true } };
export const OLD_SERVER_INIT = { type: 'init', data: {} };

export interface Harness {
  a: () => CompareLane;
  b: () => CompareLane;
  sockets: (lane: 'a' | 'b') => FakeWebSocket[];
  last: (lane: 'a' | 'b') => FakeWebSocket;
  advance: (ms: number) => Promise<void>;
  run: (fn: () => void) => Promise<void>;
  done: () => Promise<void>;
}

let active: Harness | null = null;
test.afterEach(async () => {
  if (active) await active.done(); // 실패한 테스트도 렌더·가짜 시간을 정리한다
});

async function mount(): Promise<Harness> {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  FakeWebSocket.all = [];
  Object.assign(globalThis, {
    window: dom.window, self: dom.window, document: dom.window.document, location: dom.window.location,
    localStorage: dom.window.localStorage, WebSocket: FakeWebSocket, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const lanes: { a?: CompareLane; b?: CompareLane } = {};
  function Probe() {
    lanes.a = useCompareLane('a');
    lanes.b = useCompareLane('b');
    return null;
  }
  const root: Root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(<NextIntlClientProvider locale="ko" messages={ko} timeZone="Asia/Seoul"><Probe /></NextIntlClientProvider>);
  });
  // 훅 순서대로 a, b 의 첫 소켓이 만들어진다 — 이후 소켓은 레인별 url 이 같아 순서로 구분한다
  const byLane = new Map<FakeWebSocket, 'a' | 'b'>([[FakeWebSocket.all[0], 'a'], [FakeWebSocket.all[1], 'b']]);
  let known = 2;
  const classify = () => {
    // 새 소켓은 직전에 닫힌(또는 버려진) 레인 것 — 테스트는 한 번에 한 레인만 재연결시킨다
    for (; known < FakeWebSocket.all.length; known++) byLane.set(FakeWebSocket.all[known], pendingLane);
  };
  let pendingLane: 'a' | 'b' = 'a';
  const sockets = (lane: 'a' | 'b') => { classify(); return FakeWebSocket.all.filter((s) => byLane.get(s) === lane); };
  const run = async (fn: () => void) => { await act(async () => { fn(); }); classify(); };
  const harness: Harness = {
    a: () => lanes.a!,
    b: () => lanes.b!,
    sockets,
    last: (lane) => { const list = sockets(lane); return list[list.length - 1]; },
    advance: async (ms) => { await act(async () => { mock.timers.tick(ms); }); classify(); },
    run,
    done: async () => {
      if (active !== harness) return;
      active = null;
      await act(async () => root.unmount());
      dom.window.close();
      mock.timers.reset();
    },
  };
  active = harness;
  // 재연결을 일으키기 전에 어느 레인인지 지정한다
  (harness as Harness & { expect: (l: 'a' | 'b') => void }).expect = (l) => { pendingLane = l; };
  return harness;
}
export const expectLane = (h: Harness, l: 'a' | 'b') => (h as Harness & { expect: (l: 'a' | 'b') => void }).expect(l);

/** 두 레인 소켓을 열고 새 서버 init 을 받는다 */
export async function connected(): Promise<Harness> {
  const h = await mount();
  await h.run(() => {
    for (const l of ['a', 'b'] as const) {
      h.last(l).open();
      h.last(l).emit(NEW_SERVER_INIT);
    }
  });
  return h;
}

export const chatOf = (ws: FakeWebSocket) => ws.out.find((m) => m.type === 'chat')!;
export const lastAssistant = (lane: CompareLane) => [...lane.messages].reverse().find((m) => m.role === 'assistant');

/** 소켓을 끊고 재연결 소켓을 열어 init 을 받는다 */
export async function reconnect(h: Harness, lane: 'a' | 'b', init: Msg = NEW_SERVER_INIT): Promise<FakeWebSocket> {
  expectLane(h, lane);
  const before = h.sockets(lane).length;
  await h.run(() => h.last(lane).close());
  await h.advance(10_000);
  const ws = h.last(lane);
  assert.equal(h.sockets(lane).length, before + 1, '재연결 소켓이 만들어진다');
  await h.run(() => ws.open());
  assert.deepEqual(ws.out, [], 'init 전에는 resume·abort 를 보내지 않는다');
  await h.run(() => ws.emit(init));
  return ws;
}
