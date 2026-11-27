import './dom-before-react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import messages from '../../apps/web/messages/ko.json';
import AdminExtensionsPage from '../../apps/web/app/(workspace)/admin/extensions/page';
import { useAppStore } from '../../apps/web/lib/store';
import { inventoryQueryString, shortCommit } from '../../apps/web/lib/extension-admin-inventory';

const ITEM = {
  id: 'e1', name: 'pack', version: '1.0.0', status: 'active',
  owner: { id: 'u1', username: 'alice', email: 'a@x' },
  source: { url: 'https://github.com/openmake/pack', ref: 'abc', trackingRef: null, path: '', commit: 'a'.repeat(40) },
  visibility: 'private', orgId: null, permissionState: 'reviewed', installState: 'enabled',
  components: { skills: [{ id: 's1', name: 'sk', status: 'draft' }], agents: [], mcpServers: [{ id: 'm1', name: 'srv', status: 'active', transport: 'sse', negotiation: { authMethod: 'none', protocolEra: 'legacy', protocolVersion: '2025-11-25', sdkGeneration: 'v1-compatible', observedAt: '2026-11-27T00:00:00Z' } }] },
  approval: { draft: 1, active: 1, archived: 0, other: 0 },
  createdAt: '2026-11-27T00:00:00Z', updatedAt: '2026-11-27T00:00:00Z',
};

async function mount(enabled: boolean) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/admin/extensions' });
  Object.assign(globalThis, { window: dom.window, self: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  useAppStore.setState({ authResolved: true, auth: { currentUser: { id: 'admin', role: 'admin' } as never, isGuestMode: false } });
  const urls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    urls.push(url);
    if (url.pathname === '/api/admin/extensions/status') return Response.json({ success: true, data: { enabled } });
    if (!enabled) return Response.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
    if (url.pathname === '/api/admin/extensions/inventory') {
      return Response.json({ success: true, data: { items: [ITEM], nextCursor: null, sources: [{ sourceUrl: ITEM.source.url, installs: 1, users: 1, lastInstalledAt: ITEM.createdAt }] } });
    }
    return Response.json({ success: true, data: {} });
  };
  const root = createRoot(document.getElementById('root')!);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><AdminExtensionsPage /></NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return { root, urls, queryClient };
}

test('flag ON: inventory renders owner, commit, negotiation; tab appears', async () => {
  const originalFetch = globalThis.fetch;
  const { root, urls, queryClient } = await mount(true);
  try {
    const text = document.body.textContent ?? '';
    assert.match(text, /alice/);
    assert.match(text, /aaaaaaaaaaaa/);
    assert.ok(!text.includes('a'.repeat(13)), 'commit must be shortened');
    assert.match(text, /srv: sse · none · 2025-11-25/);
    assert.match(text, /승인 대기 1/);
    assert.ok(document.querySelector('a[href="/admin/extensions"]'), 'admin tab shows when flag on');
    assert.equal(urls.find((u) => u.pathname === '/api/admin/extensions/inventory')!.searchParams.get('status'), 'active');
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    globalThis.fetch = originalFetch;
  }
});

test('flag OFF: disabled notice and tab hidden', async () => {
  const originalFetch = globalThis.fetch;
  const { root, queryClient } = await mount(false);
  try {
    assert.match(document.body.textContent ?? '', /확장 현황이 꺼져 있습니다/);
    assert.equal(document.querySelector('a[href="/admin/extensions"]'), null);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    globalThis.fetch = originalFetch;
  }
});

test('query string omits empty filters and keeps cursor', () => {
  assert.equal(inventoryQueryString({ q: ' ', userId: '', source: 'gh', status: '' }, 'c1', 10), 'source=gh&cursor=c1&limit=10');
  assert.equal(shortCommit('main'), 'main');
});
