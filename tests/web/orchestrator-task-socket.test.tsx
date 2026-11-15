/** 소켓 orchestrator_task 실패 이벤트의 reason·provider(문자열일 때만) → 저장소 OrchestratorTaskInfo */
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
  useAppStore.getState().setOrchestratorProgress(null);
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

const task = (metadata: Record<string, unknown>) => ({ type: 'system_event', payload: { type: 'orchestrator_task', metadata } });

test('실패 이벤트의 reason·provider 를 저장소에 싣는다', async () => {
  const h = await mountSocket();
  try {
    await h.send({ type: 'system_event', payload: { type: 'orchestrator_plan', metadata: { complexity: 'multi', tasks: [{ id: 'g', capability: 'image.generate' }, { id: 'w', capability: 'web.search' }] } } });
    await h.send(task({ id: 'g', capability: 'image.generate', status: 'failed', summary: 'The operation was aborted due to timeout', reason: 'timeout', provider: 'ext' }));
    await h.send(task({ id: 'w', capability: 'web.search', status: 'failed', summary: 'x', reason: 42, provider: null }));
    const tasks = useAppStore.getState().orchestratorProgress!.tasks;
    const g = tasks.find((t) => t.id === 'g')!;
    assert.deepEqual([g.status, g.reason, g.provider, g.summary], ['failed', 'timeout', 'ext', 'The operation was aborted due to timeout']);
    const w = tasks.find((t) => t.id === 'w')!;
    assert.equal('reason' in w, false, '문자열이 아닌 reason 은 버린다');
    assert.equal('provider' in w, false, '문자열이 아닌 provider 는 버린다');
  } finally {
    await h.done();
  }
});
