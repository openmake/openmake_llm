import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';

import messages from '../../apps/web/messages/ko.json';
import { AdminUserServersPanel } from '../../apps/web/addons/mcp-runtime/components/admin-user-servers-panel';

// 관리자 bridge 허용 옵션(2026-11-08 점검 후속) — 네트워크 라벨은 API 의 effective_network 로만 그린다.
const items = [
  { id: 'mcp_a', name: 'docs', transport_type: 'stdio', owner_user_id: 'u1', owner_email: 'owner@example.com',
    sandbox_network: 'full', sandbox_bridge_allowed: false, effective_network: 'egress', enabled: true, created_at: '' },
  // 화면이 판정을 다시 계산하지 않는지 — 허용 false 인데 API 가 bridge 라고 하면 bridge 로 보인다
  { id: 'mcp_b', name: 'lan', transport_type: 'stdio', owner_user_id: 'u2', owner_email: null,
    sandbox_network: 'full', sandbox_bridge_allowed: false, effective_network: 'bridge', enabled: true, created_at: '' },
  { id: 'mcp_c', name: 'remote', transport_type: 'streamable-http', owner_user_id: 'u3', owner_email: 'r@example.com',
    sandbox_network: null, sandbox_bridge_allowed: false, effective_network: null, enabled: true, created_at: '' },
];

async function withPanel(run: (p: { dom: JSDOM; text: () => string; patches: Array<{ url: string; body: unknown }>; click: (label: string, index?: number) => Promise<void>; buttons: (label: string) => HTMLButtonElement[] }) => Promise<void>, opts: { failList?: boolean } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/admin/mcp-monitoring' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  const patches: Array<{ url: string; body: unknown }> = [];
  let current = items.map((i) => ({ ...i }));
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/admin/mcp/servers/user-owned') {
      if (opts.failList) return Response.json({ success: false, error: { message: 'x' } }, { status: 500 });
      return Response.json({ success: true, data: { items: current } });
    }
    const m = /^\/api\/admin\/mcp\/servers\/([^/]+)\/sandbox-bridge$/.exec(url.pathname);
    if (m && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      patches.push({ url: url.pathname, body });
      current = current.map((i) => (i.id === m[1] ? { ...i, sandbox_bridge_allowed: body.allowed, effective_network: body.allowed ? 'bridge' : 'egress' } : i));
      return Response.json({ success: true, data: { server: { id: m[1] }, respawnRequired: true } });
    }
    return Response.json({ success: true, data: {} });
  };
  const root = createRoot(document.getElementById('root')!);
  const buttons = (label: string) => [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label) as HTMLButtonElement[];
  try {
    await act(async () => {
      root.render(<NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><AdminUserServersPanel /></NextIntlClientProvider>);
    });
    await run({
      dom,
      text: () => document.body.textContent!,
      patches,
      buttons,
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

const k = messages.mcpMonitoring as Record<string, string>;

test('user-owned servers list shows owner, name and the network label from the API value only', async () => {
  await withPanel(async ({ text, buttons }) => {
    assert.ok(text().includes(k.userServersTitle), k.userServersTitle);
    assert.match(text(), /owner@example\.com/);
    const rows = [...document.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
    assert.equal(rows.length, 3);
    assert.ok(rows[0].includes(k.networkEgress));
    assert.ok(rows[1].includes(k.networkBridge), 'API 값 bridge 를 그대로 보여 준다');
    assert.ok(rows[2].includes('—'));
    // 비 stdio 서버의 버튼은 비활성
    const allow = buttons(k.bridgeAllow);
    assert.equal(allow.length, 3);
    assert.equal(allow[2].disabled, true);
    assert.equal(allow[0].disabled, false);
  });
});

test('toggle needs an inline confirm, then PATCHes and reloads the list with the applied notice', async () => {
  await withPanel(async ({ text, patches, click }) => {
    await click(k.bridgeAllow, 0);
    assert.equal(patches.length, 0, '첫 클릭은 확인 단계만');
    await click(k.bridgeConfirm, 0);
    assert.deepEqual(patches, [{ url: '/api/admin/mcp/servers/mcp_a/sandbox-bridge', body: { allowed: true } }]);
    const row = [...document.querySelectorAll('tbody tr')][0].textContent ?? '';
    assert.ok(row.includes(k.networkBridge));
    assert.ok(row.includes(k.bridgeRevoke));
    assert.ok(text().includes(k.bridgeApplied), k.bridgeApplied);
  });
});

test('list failure shows the error text', async () => {
  await withPanel(async ({ text }) => {
    assert.ok(text().includes(k.userServersError), k.userServersError);
  }, { failList: true });
});
