/**
 * 설정 '확장' 탭은 큐레이션 add-on(extension-curation)의 `settingsTabs` 다(§8-2) — 종전 Base 탭과 같은 id·같은 자리.
 *  - 켜짐(또는 add-on 목록 조회 전·실패 — fail-open): 메모리(50)·커넥터(65) 사이 60 자리, `?tab=extensions` 딥링크가 확장 화면을 연다
 *  - 꺼짐: 탭이 없고 `?tab=extensions` 는 일반 탭으로 열린다. 나머지 Base 탭의 순서(개인정보·보안이 끝)는 그대로다
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

const tabs = messages.settings.tabs;

async function mount(addons: { id: string; enabled: boolean }[]) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/settings?tab=extensions' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/addons') return Response.json({ success: true, data: { addons } });
    if (url.pathname === '/api/users/me/extensions') return Response.json({ success: true, data: { extensions: [] } });
    if (url.pathname === '/api/users/me/extensions/gallery') return Response.json({ success: true, data: { extensions: [], catalog: [] } });
    if (url.pathname === '/api/marketplace/publish/candidates') return Response.json({ success: true, data: { skills: [], agents: [], mcpServers: [] } });
    if (url.pathname === '/api/models') return Response.json({ success: true, data: { defaultModel: 'default', models: [], imageModel: null } });
    if (url.pathname === '/api/users/me/preferences') return Response.json({ success: true, data: { preferences: {} } });
    return Response.json({ success: true, data: {} });
  };
  useAppStore.setState({
    authResolved: true,
    auth: { currentUser: { id: '7', email: 'a@test', name: 'a', role: 'user' }, isGuestMode: false },
  });
  const router = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(
      <AppRouterContext.Provider value={router as never}>
        <SearchParamsContext.Provider value={new URLSearchParams('tab=extensions') as never}>
          <QueryClientProvider client={queryClient}>
            <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><SettingsPage /></NextIntlClientProvider>
          </QueryClientProvider>
        </SearchParamsContext.Provider>
      </AppRouterContext.Provider>,
    );
  });
  for (let i = 0; i < 30; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const labels = () => [...document.querySelectorAll('nav button')].map((b) => b.textContent?.trim());
  const cleanup = async () => {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  };
  return { labels, cleanup, text: () => document.body.textContent ?? '' };
}

test('켜짐: 확장 탭이 종전 자리(메모리 뒤·커넥터 앞)에 있고 딥링크가 확장 화면을 연다', async () => {
  const v = await mount([{ id: 'extension-curation', enabled: true }, { id: 'mcp-runtime', enabled: true }]);
  try {
    assert.deepEqual(v.labels(), [tabs.general, tabs.model, tabs.interface, tabs.notifications, tabs.memory, tabs.extensions, tabs.connectors, tabs.privacy, tabs.security]);
    assert.ok(v.text().includes(messages.extensions.title), '확장 화면이 열린다');
  } finally { await v.cleanup(); }
});

test('꺼짐: 확장 탭이 없고 딥링크는 일반 탭 — Base 탭 순서 그대로', async () => {
  const v = await mount([{ id: 'extension-curation', enabled: false }, { id: 'mcp-runtime', enabled: true }]);
  try {
    assert.deepEqual(v.labels(), [tabs.general, tabs.model, tabs.interface, tabs.notifications, tabs.memory, tabs.connectors, tabs.privacy, tabs.security]);
    assert.ok(!v.text().includes(messages.extensions.title), '확장 화면을 그리지 않는다');
  } finally { await v.cleanup(); }
});
