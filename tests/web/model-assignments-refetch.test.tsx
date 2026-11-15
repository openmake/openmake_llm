/**
 * 모델 배정 구획 — 키를 켜고 끈 뒤 `["models"]` 무효화를 따라 목록·배정·effective 를 다시 읽는다(2026-11-16 라이브:
 * 새로고침 전까지 "(목록에 없음)"·"키가 꺼져 있습니다" 경고가 남았다). 다시 읽어도 사용자가 고친 params 초안은 남는다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';

import messages from '../../apps/web/messages/ko.json';
import { ModelAssignmentsSection } from '../../apps/web/components/settings/model-assignments-section';

const k = messages.modelAssignments;
const KEY_OFF = "'hasa' API 키가 꺼져 있습니다";
const slots = [
  { id: 'code', group: 'quality', kind: 'text', roles: ['review'], capabilities: ['text.code'], paramKeys: [], available: true },
  { id: 'text.embed', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['text.embed'], paramKeys: ['dimensions'], available: true },
];
const local = { modelId: 'local-llm:fixture-chat', name: 'fixture-chat', provider: 'local-llm' };
const ext = { modelId: 'hasa:ext-model', name: 'ext-model', provider: 'hasa' };

async function mount(server: { keyOn: boolean }) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/settings' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  let gets = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/models') return Response.json({ success: true, data: { defaultModel: '', models: server.keyOn ? [local, ext] : [local] } });
    if (url.pathname === '/api/users/me/model-assignments' && (!init?.method || init.method === 'GET')) {
      gets++;
      return Response.json({ success: true, data: {
        slots,
        assignments: [
          { slot: 'code', fullId: ext.modelId, params: {}, updatedAt: '2026-11-16T00:00:00.000Z' },
          { slot: 'text.embed', fullId: 'local-llm:fixture-chat', params: { dimensions: '256' }, updatedAt: '2026-11-16T00:00:00.000Z' },
        ],
        effective: [
          server.keyOn ? { slot: 'code', fullId: ext.modelId, source: 'user' } : { slot: 'code', fullId: null, source: 'none', error: KEY_OFF },
          { slot: 'text.embed', fullId: 'local-llm:fixture-chat', source: 'user' },
        ],
      } });
    }
    return Response.json({ success: true, data: {} });
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.getElementById('root')!);
  const flush = async () => { for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><ModelAssignmentsSection scope="user" /></NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  await flush();
  return {
    dom, queryClient, flush, gets: () => gets,
    select: (title: string) => document.querySelector(`select[aria-label="${title}"]`) as HTMLSelectElement,
    input: (label: string) => document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement,
    cleanup: async () => {
      await act(async () => root.unmount());
      queryClient.clear();
      globalThis.fetch = originalFetch;
      dom.window.close();
    },
  };
}

test('["models"] 무효화 뒤 목록·effective 를 다시 읽는다 — 새로고침 없이 경고·"(목록에 없음)" 이 사라진다', async () => {
  const server = { keyOn: false };
  const m = await mount(server);
  try {
    assert.ok(document.body.textContent!.includes(KEY_OFF));
    assert.ok(m.select(k.slots.code.title).textContent!.includes(k.notInList));

    server.keyOn = true;
    const before = m.gets();
    await act(async () => { await m.queryClient.invalidateQueries({ queryKey: ['models'] }); });
    await m.flush();

    assert.ok(m.gets() > before, '배정을 다시 읽는다');
    assert.ok(!document.body.textContent!.includes(KEY_OFF), '경고가 사라진다');
    const code = m.select(k.slots.code.title);
    assert.equal(code.value, ext.modelId);
    assert.ok(!code.textContent!.includes(k.notInList), '"(목록에 없음)" 이 사라진다');
  } finally {
    await m.cleanup();
  }
});

test('다시 읽어도 사용자가 고친 params 초안은 남는다', async () => {
  const m = await mount({ keyOn: true });
  try {
    const label = `${k.slots.text_embed.title} dimensions`;
    assert.equal(m.input(label).value, '256');
    await act(async () => {
      const el = m.input(label);
      Object.getOwnPropertyDescriptor(m.dom.window.HTMLInputElement.prototype, 'value')!.set!.call(el, '512');
      el.dispatchEvent(new m.dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(m.input(label).value, '512');

    const before = m.gets();
    await act(async () => { await m.queryClient.invalidateQueries({ queryKey: ['models'] }); });
    await m.flush();

    assert.ok(m.gets() > before);
    assert.equal(m.input(label).value, '512', '배경 다시 읽기가 입력을 날리지 않는다');
  } finally {
    await m.cleanup();
  }
});
