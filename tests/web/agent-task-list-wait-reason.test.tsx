import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import messages from '../../apps/web/messages/ko.json';
import AgentTasksPage from '../../apps/web/app/(workspace)/agent-tasks/page';

const task = (id: string, status: string, waitReason?: string) => ({
  id, goal: `${id} goal`, status, created_at: '2026-11-21T00:00:00Z', ...(waitReason ? { waitReason } : {}),
});

test('a device-wait paused task shows its own badge in the list, not the running one', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/agent-tasks' });
  Object.assign(globalThis, {
    window: dom.window, self: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const { pathname } = new URL(String(input), 'http://localhost');
    const ok = (data: unknown) => Response.json({ success: true, data });
    if (pathname === '/api/agent-tasks') {
      return ok({ tasks: [task('dw', 'paused', 'device_wait'), task('ap', 'paused'), task('run', 'running')] });
    }
    return ok({});
  };
  const router = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} };
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(
        <AppRouterContext.Provider value={router}>
          <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><AgentTasksPage /></NextIntlClientProvider>
        </AppRouterContext.Provider>,
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const card = (goal: string) => [...document.querySelectorAll<HTMLElement>('.p-5')].find((el) => el.textContent?.includes(goal))!;
    const waiting = messages.agentTasks.status.waitingDevice;
    const running = messages.agentTasks.status.running;
    assert.ok(card('dw goal').textContent!.includes(waiting), 'device-wait card shows the waiting badge');
    assert.ok(!card('dw goal').textContent!.includes(running), 'device-wait card is not labelled running');
    assert.equal(card('dw goal').querySelector('.animate-spin'), null, 'device-wait card has no spinner');
    // 그 밖의 paused(승인 대기 등)와 running 은 종전대로 진행중
    assert.ok(card('ap goal').textContent!.includes(running));
    assert.ok(card('run goal').textContent!.includes(running));
    assert.ok(card('run goal').querySelector('.animate-spin'));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
