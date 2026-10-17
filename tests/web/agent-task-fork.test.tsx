import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import messages from '../../apps/web/messages/ko.json';
import AgentTasksPage from '../../apps/web/app/(workspace)/agent-tasks/page';

const task = (id: string, status: string) => ({ id, goal: `${id} goal`, status, created_at: '2026-10-17T00:00:00Z' });

test('forking from a checkpoint opens the new task without the parent task files or checkpoint pick', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/agent-tasks?task=parent' });
  Object.assign(globalThis, {
    window: dom.window, self: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const alerts: string[] = [];
  Object.assign(globalThis, { alert: (m: string) => { alerts.push(m); } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const { pathname } = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const ok = (data: unknown) => Response.json({ success: true, data });
    if (method === 'POST' && pathname === '/api/agent-tasks/parent/fork') return ok({ taskId: 'child' });
    if (method === 'POST') return ok({});
    if (pathname === '/api/agent-tasks') return ok({ tasks: [task('parent', 'completed'), task('child', 'failed')] });
    if (pathname === '/api/agent-tasks/parent') return ok({ task: task('parent', 'completed'), steps: [] });
    if (pathname === '/api/agent-tasks/child') return ok({ task: task('child', 'failed'), steps: [] });
    if (pathname === '/api/agent-tasks/parent/files') return ok({ files: ['parent-only.txt'] });
    if (pathname.endsWith('/checkpoints')) return ok({ checkpoints: [{ turn: 0, messages: 2 }] });
    if (pathname.endsWith('/subagents')) return ok({ traces: [] });
    return ok({});
  };
  const pushed: string[] = [];
  const router = {
    push: (href: string) => { pushed.push(href); }, replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: () => {},
  };
  const root = createRoot(document.getElementById('root')!);
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  try {
    await act(async () => {
      root.render(
        <AppRouterContext.Provider value={router}>
          <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><AgentTasksPage /></NextIntlClientProvider>
        </AppRouterContext.Provider>,
      );
    });
    await flush();
    assert.match(document.body.textContent!, /parent-only\.txt/, 'parent detail must show its files first');
    const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${messages.agentTasks.fork.pick}"]`)!;
    assert.ok(select, 'checkpoint picker');
    await act(async () => {
      select.value = '0';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    const go = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === messages.agentTasks.fork.go)!;
    assert.equal(go.disabled, false);
    await act(async () => go.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await flush();
    assert.deepEqual(alerts, []);
    assert.deepEqual(pushed, ['/agent-tasks?task=child']);
    assert.match(document.body.textContent!, /child goal/, 'new task detail must be open');
    assert.doesNotMatch(document.body.textContent!, /parent-only\.txt/, 'parent files must not carry over to the new task');
    const childSelect = document.querySelector<HTMLSelectElement>(`select[aria-label="${messages.agentTasks.fork.pick}"]`)!;
    assert.equal(childSelect.value, '', 'checkpoint pick must reset for the new task');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
