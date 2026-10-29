/**
 * 첫 pong 전 조기 재연결 배선(2026-10-29) — ws-liveness 의 earlyRetry 예산이 실제 훅(메인 채팅·비교 레인)에
 * 연결됐는지 본다(helper 만 검증하면 배선 누락을 놓친다).
 *  - 열린 뒤 아무것도(init 조차) 받지 못한 소켓은 예산(기본 1회) 안에서 버리고 다시 연다.
 *  - 예산을 쓴 뒤의 무응답 소켓은 버리지 않는다(구 서버에서 재연결 루프 없음).
 * 이 파일은 pong 을 보내지 않는다 — 페이지 공유 "앱 ping 지원" 값이 false 인 상태(첫 pong 전)를 재현하려고
 * 다른 테스트와 파일을 나눴다(파일마다 프로세스가 따로 돈다).
 */
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ko from '../../apps/web/messages/ko.json';
import { useChatSocket } from '../../apps/web/lib/use-chat-socket';
import { useCompareLane } from '../../apps/web/lib/use-compare-lane';

class FakeWebSocket {
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
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.all.push(this);
  }
  send() {
    if (this.readyState !== 1) throw new Error('InvalidStateError');
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

async function mountHook(useHook: () => unknown): Promise<{ advance: (ms: number) => Promise<void>; run: (fn: () => void) => Promise<void>; done: () => Promise<void> }> {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  FakeWebSocket.all = [];
  Object.assign(globalThis, {
    window: dom.window, self: dom.window, document: dom.window.document, location: dom.window.location,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, WebSocket: FakeWebSocket, IS_REACT_ACT_ENVIRONMENT: true,
  });
  function Probe() {
    useHook();
    return null;
  }
  const root: Root = createRoot(document.getElementById('root')!);
  const queryClient = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="ko" messages={ko} timeZone="Asia/Seoul"><Probe /></NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  return {
    advance: async (ms) => { await act(async () => { mock.timers.tick(ms); }); },
    run: async (fn) => { await act(async () => { fn(); }); },
    done: async () => {
      await act(async () => root.unmount());
      dom.window.close();
      mock.timers.reset();
    },
  };
}

/** 첫 소켓을 열고 아무것도 보내지 않는다 → 버리고 한 번 다시 연다 → 두 번째 무응답 소켓은 그대로 둔다 */
async function expectOneEarlyRetry(h: Awaited<ReturnType<typeof mountHook>>) {
  assert.equal(FakeWebSocket.all.length, 1);
  const first = FakeWebSocket.all[0];
  await h.run(() => first.open());
  await h.advance(10_000); // 생존 확인 시간 안에 아무 수신도 없음
  assert.equal(first.readyState, 3, '아무것도 받지 못한 첫 소켓은 버린다');
  await h.advance(1_000); // 재연결 지연(기본 1초)
  assert.equal(FakeWebSocket.all.length, 2, '다시 연다');
  const second = FakeWebSocket.all[1];
  await h.run(() => second.open());
  await h.advance(60_000);
  assert.equal(second.readyState, 1, '예산을 쓴 뒤에는 버리지 않는다(구 서버 재연결 루프 없음)');
  assert.equal(FakeWebSocket.all.length, 2);
}

test('메인 채팅 — 첫 pong 전 무응답 소켓은 한 번만 다시 연다', async () => {
  const h = await mountHook(() => useChatSocket());
  try {
    await expectOneEarlyRetry(h);
  } finally {
    await h.done();
  }
});

test('비교 레인 — 첫 pong 전 무응답 소켓은 한 번만 다시 연다', async () => {
  const h = await mountHook(() => useCompareLane('a'));
  try {
    await expectOneEarlyRetry(h);
  } finally {
    await h.done();
  }
});
