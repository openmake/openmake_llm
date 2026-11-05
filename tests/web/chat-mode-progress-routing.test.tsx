/**
 * 채팅 모드 진행 이벤트 라우팅(PR-H1-2) — 웹은 중립 이벤트 chat_mode_progress 의 modeId 로 add-on 을 찾는다.
 * 구 이벤트 이름(discussion_progress·research_progress)은 웹이 모른다(무시).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ko from '../../apps/web/messages/ko.json';
import { useChatSocket } from '../../apps/web/lib/use-chat-socket';
import { useAppStore } from '../../apps/web/lib/store';

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
  send() {}
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

async function mountSocket() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  FakeWebSocket.all = [];
  Object.assign(globalThis, {
    window: dom.window, self: dom.window, document: dom.window.document, location: dom.window.location,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, WebSocket: FakeWebSocket, IS_REACT_ACT_ENVIRONMENT: true,
  });
  useAppStore.getState().setModeProgress(null);
  function Probe() {
    useChatSocket();
    return null;
  }
  const root: Root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="ko" messages={ko} timeZone="Asia/Seoul"><Probe /></NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  const ws = FakeWebSocket.all[0];
  await act(async () => ws.open());
  return {
    send: async (ev: Record<string, unknown>) => {
      await act(async () => ws.onmessage?.({ data: JSON.stringify(ev) }));
    },
    done: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

const discussionProgress = { message: 'm', progress: 150, roundNumber: 1, totalRounds: 3 };

test('chat_mode_progress(modeId=discussion) — 그 add-on 의 toProgress 를 거쳐 modeProgress 에 실린다', async () => {
  const h = await mountSocket();
  try {
    await h.send({ type: 'chat_mode_progress', modeId: 'discussion', progress: discussionProgress });
    const mp = useAppStore.getState().modeProgress;
    assert.equal(mp?.modeId, 'discussion');
    assert.equal((mp?.progress as { progress: number }).progress, 100, 'toProgress 가 범위를 보정한다');
  } finally {
    await h.done();
  }
});

test('chat_mode_progress(modeId=deep-research) — deep-research 모드로 간다', async () => {
  const h = await mountSocket();
  try {
    await h.send({ type: 'chat_mode_progress', modeId: 'deep-research', progress: { currentStep: 's', progress: 10, message: 'r' } });
    assert.equal(useAppStore.getState().modeProgress?.modeId, 'deep-research');
  } finally {
    await h.done();
  }
});

test('구 이벤트 discussion_progress 만 오면 무시한다', async () => {
  const h = await mountSocket();
  try {
    await h.send({ type: 'discussion_progress', progress: discussionProgress });
    assert.equal(useAppStore.getState().modeProgress, null);
  } finally {
    await h.done();
  }
});

test('레지스트리에 없는 modeId 는 예외 없이 무시한다', async () => {
  const h = await mountSocket();
  try {
    await h.send({ type: 'chat_mode_progress', modeId: 'no-such-addon', progress: discussionProgress });
    assert.equal(useAppStore.getState().modeProgress, null);
  } finally {
    await h.done();
  }
});

test('done 을 받으면 modeProgress 를 비운다', async () => {
  const h = await mountSocket();
  try {
    await h.send({ type: 'chat_mode_progress', modeId: 'discussion', progress: discussionProgress });
    assert.notEqual(useAppStore.getState().modeProgress, null);
    await h.send({ type: 'done' });
    assert.equal(useAppStore.getState().modeProgress, null);
  } finally {
    await h.done();
  }
});
