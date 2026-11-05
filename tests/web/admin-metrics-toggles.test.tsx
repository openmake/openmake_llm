/**
 * 관리자 지표 — 사용자 토글 표(PR-H1-2). 웹은 중립 필드 addonToolIntentTurns 를 읽고, 구 필드 discussionIntentTurns 는 쓰지 않는다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import messages from '../../apps/web/messages/ko.json';
import AdminMetricsPage from '../../apps/web/app/(workspace)/admin/metrics/page';

const routingGates = {
  days: 30,
  orchestration: {
    totalTurns: 5, intentTurns: 0, exposedTurns: 0, calledTurns: 0, successTurns: 0, callRate: 0, successRate: 0,
    byTool: [],
    toggles: [{ userMode: 'm', turns: 5, addonToolIntentTurns: 3, discussionIntentTurns: 999, taskDelegateIntentTurns: 1 }],
  },
  tailShadow: {
    totalDecisions: 0, tailDecisions: 0, tailRate: 0, labeledDecisions: 0, groundingFired: 0, groundingFixed: 0,
    lastDecisionAt: null, byVerifiability: [],
  },
};

test('사용자 토글 표는 addonToolIntentTurns 를 중립 머리글 아래 그린다', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/admin/metrics' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/metrics/routing/gates') return Response.json({ success: true, data: routingGates });
    // 다른 지표는 이 테스트와 무관 — 페이지가 실패를 조용히 넘긴다
    return Response.json({ message: 'Not Found' }, { status: 404 });
  };
  const root = createRoot(document.getElementById('root')!);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><AdminMetricsPage /></NextIntlClientProvider>
        </QueryClientProvider>,
      );
    });
    // load() 는 요청을 차례로 기다린다 — 라우팅 표가 뜰 때까지 몇 번 비운다
    const table = () => [...document.querySelectorAll('table')].find((t) => t.textContent?.includes('Add-on 도구 의도 적중'));
    for (let i = 0; i < 50 && !table(); i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    const t = table();
    assert.ok(t, '머리글 "Add-on 도구 의도 적중" 이 있는 표가 보여야 한다');
    const cells = [...t.querySelectorAll('tbody td')].map((td) => td.textContent?.trim());
    assert.deepEqual(cells, ['m', '5', '3', '1']);
    assert.doesNotMatch(document.body.textContent!, /999/);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
