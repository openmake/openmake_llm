import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { McpCrashTrendBucket, McpMonitoringSummary, McpTopCrashedServer } from '@openmake/shared-types';
// 날짜 표시는 브라우저(프로세스) 시간대를 따른다 — 기대값을 고정하려고 시간대를 통제한다
process.env.TZ = 'Asia/Seoul';

import messages from '../../apps/web/messages/ko.json';
import { McpMonitoringPage } from '../../apps/web/addons/mcp-runtime/pages/admin-mcp-monitoring-page';

// 실제 API 모양(백엔드 repository 반환값과 같은 필드) — 존재하지 않는 server_name 을 쓰지 않는다
const crashed: McpTopCrashedServer[] = [
  { mcp_server_id: 'srv-a', name: 'filesystem', user_id: null, visibility: 'public', crash_count: 50, last_crash_at: '2026-10-20 01:00:00.123456+00' },
  { mcp_server_id: 'srv-b', name: 'filesystem', user_id: 'u1', visibility: 'private', crash_count: 26, last_crash_at: null },
  { mcp_server_id: 'srv-c', name: '', user_id: null, visibility: 'public', crash_count: 23, last_crash_at: null },
];

// crash-trend 실제 wire 필드(hour 는 PostgreSQL ::text, spawned 는 그 시간대 라이프사이클 기록 수)
const trend: McpCrashTrendBucket[] = [
  { hour: '2026-10-21 08:00:00+09', spawned: 6, crashed: 2 },
  { hour: '2026-10-21 09:00:00+09', spawned: 3, crashed: 0 },
];

const auditLogs = [
  { id: 1, timestamp: '2026-10-21T00:00:03Z', action: 'mcp_tool_call', resource_id: 'github::search', details: { isError: true } },
  { id: 2, timestamp: '2026-10-21T00:00:02Z', action: 'user.login', resource_id: 'github::ignored', details: { isError: true } },
  { id: 3, timestamp: '2026-10-21T00:00:01Z', action: 'mcp_tool_call', resource_id: 'github::list', details: { isError: false, durationMs: 12 } },
  { id: 4, timestamp: '2026-10-21T00:00:00Z', action: 'mcp_tool_call', resource_id: 'slack::post', details: { durationMs: 5 } },
];

type Page = {
  text: () => string;
  stat: (label: string) => string | null | undefined;
  refresh: () => Promise<void>;
  setSummary: (next: McpMonitoringSummary) => void;
  reactErrors: string[];
  auditRequests: URL[];
};

const baseSummary: McpMonitoringSummary = {
  totalServers: 5, totalUsers: 3, currentRunning: 14, totalSpawned: 2569, crashed24h: 8, crashRate24hPct: 8.4,
};

async function withPage(run: (page: Page) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/admin/mcp-monitoring' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const reactErrors: string[] = [];
  console.error = (...args: unknown[]) => { reactErrors.push(args.map(String).join(' ')); };
  let summary = baseSummary;
  const auditRequests: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/admin/mcp/monitoring/summary') return Response.json({ success: true, data: { summary } });
    if (url.pathname === '/api/admin/mcp/monitoring/top-crashed') return Response.json({ success: true, data: { items: crashed, limit: 10 } });
    if (url.pathname === '/api/admin/mcp/monitoring/crash-trend') return Response.json({ success: true, data: { timeline: trend } });
    if (url.pathname === '/api/audit') {
      auditRequests.push(url);
      // 표본 크기 계약(최근 감사 기록 200건) 밖의 요청이면 데이터를 주지 않는다
      if (url.searchParams.get('limit') !== '200') return Response.json({ message: 'unexpected audit limit' }, { status: 400 });
      return Response.json({ success: true, data: { logs: auditLogs } });
    }
    return Response.json({ success: true, data: {} });
  };
  const root = createRoot(document.getElementById('root')!);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><McpMonitoringPage /></NextIntlClientProvider>
        </QueryClientProvider>,
      );
    });
    await run({
      text: () => document.body.textContent!,
      /** 라벨이 정확히 일치하는 통계 카드의 값 */
      stat: (label) => {
        const p = [...document.querySelectorAll('p')].find((el) => el.textContent?.trim() === label);
        assert.ok(p, `stat label missing: ${label}`);
        return p.nextElementSibling?.textContent;
      },
      refresh: async () => {
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '새로고침');
        assert.ok(button);
        await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      },
      setSummary: (next) => { summary = next; },
      reactErrors,
      auditRequests,
    });
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    console.error = originalError;
    dom.window.close();
  }
}

test('running (server, user) pairs are shown apart from the registered definition count, without an "out of" comparison', async () => {
  await withPage(async ({ text, stat, refresh, setSummary }) => {
    assert.equal(stat('기록상 실행 중 인스턴스'), '14');
    assert.match(text(), /서버·사용자 쌍별 최신 기록 상태 기준/);
    assert.match(text(), /등록된 서버 정의: 5/);
    assert.doesNotMatch(text(), /전체 \d+개 중/);
    setSummary({ ...baseSummary, totalServers: 7 });
    await refresh();
    assert.match(text(), /등록된 서버 정의: 7/);
    assert.equal(stat('기록상 실행 중 인스턴스'), '14');
  });
});

test('lifecycle history and 24h crash share are labeled as lifecycle records, separate from the audit tool-call sample', async () => {
  await withPage(async ({ text, stat, auditRequests }) => {
    assert.ok(auditRequests.length > 0);
    assert.deepEqual(auditRequests.map((u) => u.searchParams.get('limit')), auditRequests.map(() => '200'));
    assert.equal(stat('라이프사이클 기록 — 보존된 전체 이력'), '2,569');
    assert.equal(stat('라이프사이클 기록 중 크래시 비율 — 최근 24시간'), '8.4%');
    assert.doesNotMatch(text(), /총 도구 호출|에러율/);
    // 감사 표본: mcp_tool_call 만 서버별 집계, 비율은 표본 안의 오류 비율
    assert.match(text(), /최근 감사 기록 200건 중 도구 호출 — 상위 8개 서버/);
    assert.match(text(), /2회 · 표본 오류 50\.0%/);
    assert.match(text(), /1회 · 표본 오류 0\.0%/);
    assert.doesNotMatch(text(), /ignored/);
  });
});

test('hourly trend shows lifecycle and crash record counts from the wire fields for the current hour and previous 23 hours', async () => {
  await withPage(async ({ text }) => {
    assert.match(text(), /시간별 라이프사이클·크래시 기록 — 현재 시간대와 이전 23시간/);
    assert.doesNotMatch(text(), /시간별 라이프사이클·크래시 기록 — 최근 24시간/);
    const rows = trend.map((b) => {
      const label = [...document.querySelectorAll('span')].find((el) => el.textContent === b.hour);
      assert.ok(label, `trend hour missing: ${b.hour}`);
      return label.nextElementSibling?.textContent;
    });
    assert.deepEqual(rows, ['기록 6 · 크래시 2', '기록 3 · 크래시 0']);
  });
});

test('successful recent tool calls stay visible alongside nonzero historical crashes', async () => {
  await withPage(async () => {
    const crashCounts = [...document.querySelectorAll('tbody tr')]
      .filter((tr) => tr.querySelector('svg'))
      .map((tr) => Number(tr.querySelectorAll('td')[1]?.textContent));
    assert.deepEqual(crashCounts, [50, 26, 23]);
    const logStatuses = [...document.querySelectorAll('tbody tr')]
      .filter((tr) => tr.querySelectorAll('td').length === 5)
      .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()))
      .map(([, server, tool, , status]) => `${server}/${tool}:${status}`);
    assert.deepEqual(logStatuses, ['github/search:실패', 'github/list:성공', 'slack/post:성공']);
  });
});

test('API-shaped crash rows keep names and counts, stay distinct by server ID, and show valid dates or — for null', async () => {
  await withPage(async ({ text, reactErrors }) => {
    assert.match(text(), /Top 크래시 서버 — 최근 7일/);
    const crashRows = [...document.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('svg'));
    assert.deepEqual(
      crashRows.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim())),
      // 2026-10-20 01:00:00.123456+00 (PostgreSQL ::text) → Asia/Seoul 10:00
      [['filesystem', '50', '10. 20. 오전 10:00'], ['filesystem', '26', '—'], ['srv-c', '23', '—']],
    );
    assert.equal(reactErrors.filter((e) => /same key/.test(e)).length, 0, reactErrors.join('\n'));
  });
});

test('a null 24h crash share stays unavailable instead of becoming 0%', async () => {
  await withPage(async ({ stat, refresh, setSummary }) => {
    setSummary({ ...baseSummary, crashRate24hPct: null });
    await refresh();
    assert.equal(stat('라이프사이클 기록 중 크래시 비율 — 최근 24시간'), '—');
  });
});
