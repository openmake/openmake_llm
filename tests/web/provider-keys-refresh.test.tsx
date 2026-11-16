/**
 * 외부 키 구획 — 토글 뒤 조용한 다시 읽기(N1)와 늦게 온 옛 응답(N2).
 * N1: 다시 읽기가 실패해도 목록을 비우지 않고, PATCH 응답 `{ provider_id, enabled }` 로 그 행만 갱신한다.
 * N2: 마지막 요청의 응답만 반영한다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';

import messages from '../../apps/web/messages/ko.json';
import { ProviderKeysSection } from '../../apps/web/components/settings/provider-keys-section';

function provider(enabled: boolean) {
  return {
    provider_id: 'hasa', display_name: 'Hasa', sdk_type: 'openai-compatible', default_base_url: null,
    user_key: { display_name: 'my key', key_prefix: 'sk-', base_url: null, last_validation_ok: true, last_used_at: null, created_at: '2026-11-16T00:00:00.000Z', enabled },
  };
}

type Handler = (url: URL, init?: RequestInit) => Promise<Response> | Response;

async function mount(handler: Handler) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/settings' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.alert = () => {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/external-keys/usage/summary') return Response.json({ success: true, data: { days: 30, totals_by_provider: [] } });
    return handler(url, init);
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.getElementById('root')!);
  const flush = async () => { for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><ProviderKeysSection /></NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  await flush();
  return {
    dom, flush,
    toggle: () => document.querySelector('button[role="switch"]') as HTMLButtonElement | null,
    cleanup: async () => {
      await act(async () => root.unmount());
      queryClient.clear();
      globalThis.fetch = originalFetch;
      dom.window.close();
    },
  };
}

test('N1: 토글 뒤 다시 읽기가 실패해도 목록을 유지하고 PATCH 응답으로 그 행을 갱신한다', async () => {
  let listCalls = 0;
  const m = await mount((url, init) => {
    if (url.pathname === '/api/external-keys' && (!init?.method || init.method === 'GET')) {
      listCalls++;
      return listCalls === 1 ? Response.json({ success: true, data: { providers: [provider(true)] } }) : Response.json({ success: false, error: { message: 'boom' } }, { status: 500 });
    }
    if (url.pathname === '/api/external-keys/hasa' && init?.method === 'PATCH') return Response.json({ success: true, data: { provider_id: 'hasa', enabled: false } });
    return Response.json({ success: true, data: {} });
  });
  try {
    assert.equal(m.toggle()?.getAttribute('aria-checked'), 'true');
    await act(async () => m.toggle()!.dispatchEvent(new m.dom.window.MouseEvent('click', { bubbles: true })));
    await m.flush();
    assert.ok(listCalls >= 2, '조용한 다시 읽기를 시도한다');
    const sw = m.toggle();
    assert.ok(sw, '목록이 비지 않는다');
    assert.equal(sw.getAttribute('aria-checked'), 'false', 'PATCH 응답으로 그 행이 꺼짐이 된다');
  } finally {
    await m.cleanup();
  }
});

test('N2: 늦게 온 옛 목록 응답은 무시하고 마지막 요청의 응답만 반영한다', async () => {
  let listCalls = 0;
  let deleted = false;
  let releaseStale: (() => void) | undefined;
  const m = await mount(async (url, init) => {
    if (url.pathname === '/api/external-keys' && (!init?.method || init.method === 'GET')) {
      listCalls++;
      if (listCalls === 2) {
        // 토글 뒤 조용한 다시 읽기 — 붙잡아 두었다가 삭제 뒤 읽기보다 늦게 옛 값(키 있음)으로 돌아온다
        await new Promise<void>((r) => { releaseStale = r; });
        return Response.json({ success: true, data: { providers: [provider(true)] } });
      }
      return Response.json({ success: true, data: { providers: [deleted ? { ...provider(true), user_key: null } : provider(true)] } });
    }
    if (url.pathname === '/api/external-keys/hasa' && init?.method === 'PATCH') return Response.json({ success: true, data: { provider_id: 'hasa', enabled: true } });
    if (url.pathname === '/api/external-keys/hasa' && init?.method === 'DELETE') { deleted = true; return Response.json({ success: true, data: {} }); }
    return Response.json({ success: true, data: {} });
  });
  m.dom.window.confirm = () => true;
  try {
    await act(async () => m.toggle()!.dispatchEvent(new m.dom.window.MouseEvent('click', { bubbles: true })));
    await m.flush();
    assert.equal(listCalls, 2, '조용한 다시 읽기가 걸려 있다');
    const del = document.querySelector(`button[aria-label="${messages.apiKeys.deleteAria}"]`) as HTMLButtonElement;
    await act(async () => del.dispatchEvent(new m.dom.window.MouseEvent('click', { bubbles: true })));
    await m.flush();
    assert.equal(listCalls, 3);
    assert.ok(!document.body.textContent!.includes('my key'), '삭제 뒤 읽기로 키 행이 사라진다');

    releaseStale!();
    await m.flush();
    assert.ok(!document.body.textContent!.includes('my key'), '늦게 온 옛 응답이 삭제된 키 행을 되살리지 않는다');
  } finally {
    releaseStale?.();
    await m.cleanup();
  }
});
