/**
 * 설정 → 모델 탭의 기본 모델 — 저장 전 편집값은 화면 지역 상태다(2026-11-18 설계 §3.3, D2).
 * 종전엔 선택 상자를 바꾸기만 해도 store `selectedModel`(채팅이 보내는 값)이 바뀌고 localStorage 에 남았다.
 */
import './dom-before-react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

import messages from '../../apps/web/messages/ko.json';
import SettingsPage from '../../apps/web/app/(workspace)/settings/page';
import { useAppStore } from '../../apps/web/lib/store';

const GEMINI = 'gemini:gemini-2.5-flash';
const local = { modelId: 'local-llm:qwen-test', name: 'qwen-test', provider: 'local-llm' };
const st = messages.settings;

interface Server {
  status: string;
  puts: Array<Record<string, unknown>>;
  modelsGets: number;
}

async function mount(server: Server) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/settings?tab=model' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/models') {
      server.modelsGets++;
      return Response.json({ success: true, data: {
        defaultModel: local.modelId, models: [local], imageModel: null,
        defaultModelSelection: { saved: GEMINI, effective: server.status === 'ok' ? GEMINI : 'default', status: server.status },
      } });
    }
    if (url.pathname === '/api/users/me/preferences' && init?.method === 'PUT') {
      server.puts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Response.json({ success: true, data: { saved: true, preferences: {} } });
    }
    if (url.pathname === '/api/users/me/preferences') return Response.json({ success: true, data: { preferences: { defaultModel: GEMINI } } });
    if (url.pathname === '/api/users/me/custom-instructions') return Response.json({ success: true, data: { customInstructions: null } });
    if (url.pathname === '/api/external-keys') return Response.json({ success: true, data: { providers: [] } });
    if (url.pathname === '/api/users/me/model-assignments') return Response.json({ success: true, data: { slots: [], assignments: [], effective: [] } });
    if (url.pathname === '/api/users/me/consent') return Response.json({ success: true, data: { consents: [] } });
    return Response.json({ success: true, data: {} });
  };
  useAppStore.setState({
    selectedModel: GEMINI,
    authResolved: true,
    auth: { currentUser: { id: '7', email: 'a@test', name: 'a', role: 'user' }, isGuestMode: false },
  });
  const router = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.getElementById('root')!);
  const flush = async () => { for (let i = 0; i < 30; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => {
    root.render(
      <AppRouterContext.Provider value={router as never}>
        <SearchParamsContext.Provider value={new URLSearchParams('tab=model') as never}>
          <QueryClientProvider client={queryClient}>
            <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><SettingsPage /></NextIntlClientProvider>
          </QueryClientProvider>
        </SearchParamsContext.Provider>
      </AppRouterContext.Provider>,
    );
  });
  await flush();
  return {
    dom, flush,
    providerSelect: () => document.querySelector(`select[aria-label="${st.modelPicker.providerAria}"]`) as HTMLSelectElement,
    choose: async (el: HTMLSelectElement, value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      });
    },
    clickSave: async () => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(st.saveButton)) as HTMLButtonElement;
      assert.ok(btn, '저장 버튼');
      await act(async () => btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      queryClient.clear();
      globalThis.fetch = originalFetch;
      dom.window.close();
    },
  };
}

test('D2: 선택 상자를 바꾸고 저장하지 않으면 store selectedModel 은 그대로', async () => {
  const m = await mount({ status: 'ok', puts: [], modelsGets: 0 });
  try {
    const sel = m.providerSelect();
    assert.ok(sel, '제공자 선택 상자');
    await m.choose(sel, 'local-llm');
    await m.flush();
    assert.equal(m.providerSelect().value, 'local-llm', '화면에는 고른 값');
    assert.equal(useAppStore.getState().selectedModel, GEMINI, '채팅이 보내는 값은 저장 전엔 바뀌지 않는다');
  } finally {
    await m.cleanup();
  }
});

test('저장 성공 → PUT preferences 1회(고른 값) + ["models"] 재조회', async () => {
  const server: Server = { status: 'ok', puts: [], modelsGets: 0 };
  const m = await mount(server);
  try {
    await m.choose(m.providerSelect(), 'local-llm');
    await m.flush();
    const before = server.modelsGets;
    await m.clickSave();
    await m.flush();
    const prefsPuts = server.puts.filter((b) => 'defaultModel' in b);
    assert.equal(prefsPuts.length, 1);
    assert.equal(prefsPuts[0].defaultModel, local.modelId);
    assert.ok(server.modelsGets > before, '모델 목록(판정)을 다시 읽는다');
  } finally {
    await m.cleanup();
  }
});

test("status: 'key_disabled' 면 안내 문구가 보이고, 'ok' 면 없다", async () => {
  const off = await mount({ status: 'key_disabled', puts: [], modelsGets: 0 });
  try {
    assert.ok(document.body.textContent!.includes(st.defaultModel.status.key_disabled));
  } finally {
    await off.cleanup();
  }
  const on = await mount({ status: 'ok', puts: [], modelsGets: 0 });
  try {
    assert.ok(!document.body.textContent!.includes(st.defaultModel.status.key_disabled));
  } finally {
    await on.cleanup();
  }
});
