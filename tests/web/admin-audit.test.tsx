import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../apps/web/messages/ko.json';
import AdminAuditPage from '../../apps/web/app/(workspace)/admin/audit/page';

test('audit requests follow period and recorded actions, and failures stay distinct from empty results', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/admin/audit' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  const urls: URL[] = [];
  let fail = false;
  let actionsFail = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    urls.push(url);
    if (url.pathname === '/api/audit/actions') {
      if (actionsFail) return Response.json({ message: 'Unavailable' }, { status: 503 });
      return Response.json({ success: true, data: { actions: ['api_key.create', 'user.role_change'] } });
    }
    if (fail) return Response.json({ message: 'Unavailable' }, { status: 503 });
    return Response.json({ success: true, data: { logs: [], total: 0 } });
  };
  const root = createRoot(document.getElementById('root')!);
  const render = async () => {
    await act(async () => {
      root.render(<NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><AdminAuditPage /></NextIntlClientProvider>);
    });
  };
  const click = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
    assert.ok(button, label);
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  };
  const lastAudit = () => urls.filter((u) => u.pathname === '/api/audit').at(-1)!;
  try {
    await render();
    assert.ok(lastAudit().searchParams.get('startDate'), 'default 7-day filter must reach API');
    assert.ok(document.querySelector('option[value="api_key.create"]'), 'recorded API-key action must be selectable');
    const initialStart = lastAudit().searchParams.get('startDate');
    await click('30일');
    assert.ok(lastAudit().searchParams.get('startDate')! < initialStart!, '30-day filter must include older records');
    await click('전체');
    assert.equal(lastAudit().searchParams.has('startDate'), false);
    const select = document.querySelector('select')!;
    await act(async () => {
      select.value = 'api_key.create';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.equal(lastAudit().searchParams.get('action'), 'api_key.create');
    const navigation = { href: '' };
    globalThis.window = new Proxy(dom.window, {
      get(target, key) { return key === 'location' ? navigation : Reflect.get(target, key); },
    }) as unknown as Window & typeof globalThis;
    await click('CSV 내보내기');
    const exported = new URL(navigation.href, 'http://localhost');
    assert.equal(exported.pathname, '/api/audit/export');
    assert.equal(exported.searchParams.get('action'), lastAudit().searchParams.get('action'));
    assert.equal(exported.searchParams.has('startDate'), false);
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    fail = true;
    await click('오늘');
    assert.match(document.body.textContent!, /감사 로그를 가져오지 못했습니다/);
    assert.doesNotMatch(document.body.textContent!, /조건에 맞는 로그가 없습니다/);
    fail = false;
    actionsFail = true;
    await act(async () => {
      root.render(<NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><AdminAuditPage key="metadata-failure" /></NextIntlClientProvider>);
    });
    assert.match(document.body.textContent!, /조건에 맞는 로그가 없습니다/);
    assert.doesNotMatch(document.body.textContent!, /감사 로그를 가져오지 못했습니다/);
    const exportButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'CSV 내보내기')!;
    assert.equal(exportButton.disabled, false, 'metadata failure must not disable export');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
