import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';

import messages from '../../apps/web/messages/ko.json';
import { ConnectorsSection } from '../../apps/web/addons/mcp-runtime/components/connectors-section';

// 연결 상태와 별개로 "모델에 노출됨"·"권한 승인됨" 을 따로 보인다 — 연결됐다고 모델이 쓸 수 있는 게 아니다.
const servers = [
  { id: 'mcp_ext', name: 'ext-files', transport_type: 'stdio', connectionStatus: 'connected', toolCount: 3, enabled: true,
    auto_spawn: true, visibility: 'user_private', user_id: 'u1', extension_id: 'ext-1',
    modelExposure: { state: 'on_mention', viaMetaTools: true } },
  { id: 'mcp_off', name: 'paused', transport_type: 'stdio', connectionStatus: 'disconnected', toolCount: 0, enabled: false,
    auto_spawn: true, visibility: 'user_private', user_id: 'u1', extension_id: 'ext-2',
    modelExposure: { state: 'none', reason: 'disabled', viaMetaTools: false } },
  // 구 API — modelExposure 가 없으면 배지를 그리지 않는다
  { id: 'mcp_old', name: 'legacy-api', transport_type: 'stdio', connectionStatus: 'connected', toolCount: 1, enabled: true,
    auto_spawn: true, visibility: 'user_private', user_id: 'u1' },
];
const extensions = [
  { id: 'ext-1', permission_state: 'reviewed' },
  { id: 'ext-2', permission_state: 'review_required' },
];

async function render(opts: { failExtensions?: boolean } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/settings' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/mcp/servers') return Response.json({ success: true, data: { servers } });
    if (url.pathname === '/api/users/me/extensions') {
      if (opts.failExtensions) return Response.json({ success: false, error: { message: 'x' } }, { status: 500 });
      return Response.json({ success: true, data: { extensions } });
    }
    return Response.json({ success: true, data: {} });
  };
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(
      <AppRouterContext.Provider value={router as never}>
        <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><ConnectorsSection /></NextIntlClientProvider>
      </AppRouterContext.Provider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const rowOf = (name: string) => [...document.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(name))!;
  return {
    rowOf,
    cleanup: () => { act(() => root.unmount()); globalThis.fetch = originalFetch; dom.window.close(); },
  };
}

test('연결된 확장 서버는 "언급하면 모델에 노출" + "권한 승인됨" 을 따로 보인다', async () => {
  const v = await render();
  try {
    const row = v.rowOf('ext-files');
    const exposure = row.querySelector('[data-testid="mcp-exposure-badge"]')!;
    assert.equal(exposure.getAttribute('data-state'), 'on_mention');
    assert.match(exposure.textContent!, /언급하면 모델에 노출/);
    assert.match(exposure.getAttribute('title')!, /mcp_call/);
    const perm = row.querySelector('[data-testid="mcp-permission-badge"]')!;
    assert.equal(perm.getAttribute('data-kind'), 'reviewed');
    assert.match(perm.textContent!, /권한 승인됨/);
  } finally { v.cleanup(); }
});

test('사용 안 함 서버는 "모델에 노출 안 됨"(이유는 툴팁), 재승인 필요 확장은 경고 배지', async () => {
  const v = await render();
  try {
    const row = v.rowOf('paused');
    const exposure = row.querySelector('[data-testid="mcp-exposure-badge"]')!;
    assert.equal(exposure.getAttribute('data-state'), 'none');
    assert.match(exposure.getAttribute('title')!, /사용 안 함/);
    assert.equal(row.querySelector('[data-testid="mcp-permission-badge"]')!.getAttribute('data-kind'), 'reviewRequired');
  } finally { v.cleanup(); }
});

test('구 API(노출 정보 없음)·단독 설치 서버에는 배지를 그리지 않는다', async () => {
  const v = await render();
  try {
    const row = v.rowOf('legacy-api');
    assert.equal(row.querySelector('[data-testid="mcp-exposure-badge"]'), null);
    assert.equal(row.querySelector('[data-testid="mcp-permission-badge"]'), null);
  } finally { v.cleanup(); }
});

test('확장 목록 조회가 실패해도 서버 목록·노출 배지는 그대로, 권한 배지만 생략', async () => {
  const v = await render({ failExtensions: true });
  try {
    const row = v.rowOf('ext-files');
    assert.ok(row.querySelector('[data-testid="mcp-exposure-badge"]'));
    assert.equal(row.querySelector('[data-testid="mcp-permission-badge"]'), null);
  } finally { v.cleanup(); }
});
