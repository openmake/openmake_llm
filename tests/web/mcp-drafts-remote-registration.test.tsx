import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';

import messages from '../../apps/web/messages/ko.json';
import { McpDrafts } from '../../apps/web/addons/mcp-runtime/components/mcp-drafts';

// 확장 번들 원격 MCP 관리 등록(EXTENSION_REMOTE_MCP_ENABLED) — 승인 카드가 고정 URL·OAuth 안내를 보이고,
// 승인 응답의 oauthRequired 를 보고 OAuth 시작으로 잇는다(인가가 필요 없으면 바로 연결). 플래그 OFF 면 응답에 그 필드가 없어 종전 흐름.
const remoteDraft = {
  id: 'd-1', name: 'ext-cloud', status: 'draft', transport_type: 'streamable-http', url: 'https://mcp.example.com/mcp',
  manifest_meta: { extensionName: 'ext', remoteRegistration: { declaredUrl: 'https://mcp.example.com/mcp', urlLocked: true, auth: 'oauth' } },
};
const legacyDraft = { id: 'd-2', name: 'ext-local', status: 'draft', transport_type: 'stdio', manifest_meta: { extensionName: 'ext' } };

type Call = { method: string; path: string };
async function withDrafts(
  approveBody: Record<string, unknown>,
  startBody: Record<string, unknown>,
  run: (p: { text: () => string; calls: Call[]; click: (label: string, index?: number) => Promise<void> }) => Promise<void>,
) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/approvals', virtualConsole: new VirtualConsole() });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push({ method: init?.method ?? 'GET', path: url.pathname });
    if (url.pathname === '/api/mcp/servers/drafts') return Response.json({ success: true, data: [remoteDraft, legacyDraft] });
    if (url.pathname.endsWith('/approve')) return Response.json({ success: true, data: { id: 'd-1' }, ...approveBody });
    if (url.pathname.endsWith('/oauth/start')) return Response.json({ success: true, data: startBody });
    return Response.json({ success: true, data: {} });
  };
  const root = createRoot(document.getElementById('root')!);
  const buttons = (label: string) => [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label) as HTMLButtonElement[];
  try {
    await act(async () => {
      root.render(<NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><McpDrafts /></NextIntlClientProvider>);
    });
    await run({
      text: () => document.body.textContent!,
      calls,
      click: async (label, index = 0) => {
        const b = buttons(label)[index];
        assert.ok(b, `button missing: ${label}`);
        await act(async () => b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      },
    });
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
}

const a = messages.approvals as Record<string, string> & { mcp: Record<string, string> };

test('remote draft shows the locked URL and the OAuth note; stdio draft does not', async () => {
  await withDrafts({}, {}, async ({ text }) => {
    assert.ok(text().includes('https://mcp.example.com/mcp'));
    assert.equal(text().split(a.mcp.remoteOauthNote).length - 1, 1, 'OAuth 안내는 원격 관리 등록 카드에만');
  });
});

test('approve without oauthRequired (flag OFF) keeps the old flow — no OAuth start', async () => {
  await withDrafts({ spawned: true }, {}, async ({ calls, click }) => {
    await click(a.approve, 0);
    assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/api/mcp/servers/d-1/approve'));
    assert.ok(!calls.some((c) => c.path.endsWith('/oauth/start')));
    assert.ok(!calls.some((c) => c.path.endsWith('/connect')));
  });
});

test('approve with oauthRequired starts OAuth; an already-authorized server connects directly', async () => {
  await withDrafts({ spawned: false, oauthRequired: true }, { authorized: true, authorizationUrl: null }, async ({ calls, click }) => {
    await click(a.approve, 0);
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.path);
    assert.deepEqual(posts, ['/api/mcp/servers/d-1/approve', '/api/mcp/servers/d-1/oauth/start', '/api/mcp/servers/d-1/connect']);
  });
});

test('approve with oauthRequired and an authorization URL does not connect before sign-in', async () => {
  await withDrafts({ spawned: false, oauthRequired: true }, { authorized: false, authorizationUrl: 'https://auth.example.com/authorize' }, async ({ calls, click }) => {
    await click(a.approve, 0);
    assert.ok(calls.some((c) => c.path === '/api/mcp/servers/d-1/oauth/start'));
    assert.ok(!calls.some((c) => c.path.endsWith('/connect')), '로그인 전에는 연결하지 않는다');
  });
});
