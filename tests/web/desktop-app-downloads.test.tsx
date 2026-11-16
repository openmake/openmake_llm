import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesktopLatestPayload, DesktopReleaseBlock } from '@openmake/shared-types';

import messages from '../../apps/web/messages/ko.json';
import { DesktopAppDownloads } from '../../apps/web/components/desktop-app/desktop-app-downloads';

// 지어낸 게시 정보 — 실제 서버(/api/desktop/latest) 응답 모양을 따른다
const SHA_MAC = `3fa9${'0123456789abcdef'.repeat(3)}${'c'.repeat(12)}`;
const copyLabel = (os: string) => messages.desktopApp.copyFor.replace('{os}', os);
const SHA_WIN = `9c1e${'fedcba9876543210'.repeat(3)}${'d'.repeat(12)}`;
const mac: DesktopReleaseBlock = {
  version: '0.4.1', file: 'OpenMake-Companion-0.4.1-arm64.dmg', sha256: SHA_MAC, url: '/api/desktop/download/OpenMake-Companion-0.4.1-arm64.dmg',
};
const win: DesktopReleaseBlock = {
  version: '0.4.2', file: 'OpenMake-Companion-Setup-0.4.2.exe', sha256: SHA_WIN, url: '/api/desktop/download/OpenMake-Companion-Setup-0.4.2.exe',
};
const both: DesktopLatestPayload = { ...mac, native: mac, windows: win };

const ok = (data: DesktopLatestPayload) => () => Response.json({ success: true, data, meta: { timestamp: '2026-11-16T00:00:00Z' } });
const fail = (status: number) => () => Response.json({ success: false, error: { code: `HTTP_${status}`, message: 'x' }, meta: { timestamp: '2026-11-16T00:00:00Z' } }, { status });

type Responder = () => Response | Promise<Response>;

type Page = {
  text: () => string;
  downloads: () => HTMLAnchorElement[];
  /** 텍스트가 정확히 일치하는 OS 라벨 줄 수 */
  osRows: (label: string) => number;
  button: (name: string) => HTMLButtonElement | undefined;
  click: (el: Element) => Promise<void>;
  requests: () => number;
  /** 화면 밖 재조회(창 포커스 재조회 등)를 흉내 낸다 */
  refetchAll: () => Promise<void>;
  writes: string[];
};

async function withPage(responses: Responder[], run: (page: Page) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/desktop-app' });
  Object.assign(globalThis, { window: dom.window, self: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const writes: string[] = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (s: string) => { writes.push(s); } },
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  let count = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname !== '/api/desktop/latest') return Response.json({ success: true, data: {} });
    const next = responses[Math.min(count, responses.length - 1)];
    count += 1;
    return next();
  };
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };
  const root = createRoot(document.getElementById('root')!);
  // 브라우저 기본값(재시도 3회)을 명시한다 — TanStack 은 모듈을 읽을 때 window 가 없으면 기본 재시도를 0 으로 둬서,
  // 그대로 두면 화면 쪽 retry: false 가 빠져도 404 테스트가 통과한다
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><DesktopAppDownloads /></NextIntlClientProvider>
        </QueryClientProvider>,
      );
    });
    await settle();
    await run({
      text: () => document.body.textContent!,
      downloads: () => [...document.querySelectorAll<HTMLAnchorElement>('a[download]')],
      osRows: (label) => [...document.querySelectorAll('p')].filter((p) => p.textContent?.trim() === label).length,
      button: (name) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name),
      click: async (el) => {
        await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
        await settle();
      },
      requests: () => count,
      refetchAll: async () => {
        await act(async () => { await queryClient.refetchQueries(); });
        await settle();
      },
      writes,
    });
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    globalThis.fetch = originalFetch;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    dom.window.close();
  }
}

test('macOS·Windows 둘 다 게시: 두 줄, 서버 url 그대로의 받기 링크, 버전·파일명·sha256 전체, 두 OS 설치 안내와 API 액세스 링크', async () => {
  await withPage([ok(both)], async ({ text, downloads, osRows }) => {
    assert.equal(osRows('macOS'), 1);
    assert.equal(osRows('Windows'), 1);
    const links = downloads();
    assert.deepEqual(links.map((a) => a.getAttribute('href')), [mac.url, win.url]);
    for (const b of [mac, win]) {
      assert.ok(text().includes(b.file));
      assert.ok(text().includes(b.sha256!));
      assert.ok(text().includes(`버전 ${b.version}`));
    }
    assert.ok(text().includes(messages.desktopApp.install.native));
    assert.ok(text().includes(messages.desktopApp.install.windows));
    assert.ok(document.querySelector('a[href="/api-access"]'));
  });
});

test('macOS 만 게시: macOS 줄은 정확히 1개(최상위 복제값을 따로 그리지 않는다), Windows 줄·설치 안내 없음', async () => {
  await withPage([ok({ ...mac, native: mac })], async ({ text, downloads, osRows }) => {
    assert.equal(osRows('macOS'), 1);
    assert.equal(osRows('Windows'), 0);
    assert.equal(downloads().length, 1);
    assert.ok(text().includes(messages.desktopApp.install.native));
    assert.ok(!text().includes(messages.desktopApp.install.windows));
  });
});

test('Windows 만 게시(최상위·native 없음): macOS 줄·설치 안내 없음', async () => {
  await withPage([ok({ windows: win })], async ({ text, downloads, osRows }) => {
    assert.equal(osRows('macOS'), 0);
    assert.equal(osRows('Windows'), 1);
    assert.deepEqual(downloads().map((a) => a.getAttribute('href')), [win.url]);
    assert.ok(!text().includes(messages.desktopApp.install.native));
    assert.ok(text().includes(messages.desktopApp.install.windows));
  });
});

test('sha256 이 null 이면 SHA-256 줄과 복사 버튼을 그리지 않는다', async () => {
  await withPage([ok({ windows: { ...win, sha256: null } })], async ({ text, downloads, button }) => {
    assert.equal(downloads().length, 1);
    assert.ok(!text().includes(messages.desktopApp.sha256));
    assert.equal(button(copyLabel('Windows')), undefined);
  });
});

test('404: 게시본 없음 문구만, 받기 링크·설치 안내·다시 시도 없음, 요청은 1회', async () => {
  await withPage([fail(404)], async ({ text, downloads, button, requests }) => {
    assert.ok(text().includes(messages.desktopApp.notPublished));
    assert.equal(downloads().length, 0);
    assert.ok(!text().includes(messages.desktopApp.install.title));
    assert.equal(button(messages.desktopApp.retry), undefined);
    assert.equal(requests(), 1);
  });
});

// TanStack v5 는 데이터 없이 재요청하면 상태를 pending 으로 되돌린다 — 재요청 중엔 다시 시도 대신 로딩이 보인다
test('500: 오류 문구와 다시 시도 — 재요청 중엔 로딩만 보이고(연타해도 요청 2회), 응답이 오면 목록이 보인다', async () => {
  let release!: () => void;
  const pending = new Promise<void>((r) => { release = r; });
  await withPage([fail(500), () => pending.then(ok(both))], async ({ text, downloads, button, click, requests }) => {
    assert.ok(text().includes(messages.desktopApp.loadFailed));
    assert.equal(downloads().length, 0);
    const retry = button(messages.desktopApp.retry);
    assert.ok(retry);
    await click(retry);
    assert.ok(text().includes(messages.desktopApp.loading));
    assert.equal(button(messages.desktopApp.retry), undefined);
    await click(retry);
    await click(retry);
    assert.equal(requests(), 2);
    await act(async () => { release(); });
    for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    assert.equal(requests(), 2);
    assert.equal(downloads().length, 2);
    assert.ok(!text().includes(messages.desktopApp.loadFailed));
  });
});

test('서버가 준 url 이 예상 경로와 달라도 조립하지 않고 그대로 href 에 넣는다', async () => {
  const odd: DesktopReleaseBlock = { ...mac, url: '/somewhere/else/mac-build?x=1' };
  await withPage([ok({ ...odd, native: odd })], async ({ downloads }) => {
    assert.deepEqual(downloads().map((a) => a.getAttribute('href')), ['/somewhere/else/mac-build?x=1']);
  });
});

test('목록을 본 뒤 재조회가 500 이면 오류 화면으로 바꾸지 않고 목록을 유지한다', async () => {
  await withPage([ok(both), fail(500)], async ({ text, downloads, refetchAll, requests }) => {
    assert.equal(downloads().length, 2);
    await refetchAll();
    assert.equal(requests(), 2);
    assert.equal(downloads().length, 2);
    assert.ok(!text().includes(messages.desktopApp.loadFailed));
  });
});

test('Windows 줄의 복사 버튼은 Windows 해시를 한 번 복사한다', async () => {
  await withPage([ok(both)], async ({ button, click, writes }) => {
    const copyWin = button(copyLabel('Windows'));
    assert.ok(copyWin);
    assert.equal(copyWin.getAttribute('title'), copyLabel('Windows'));
    assert.ok(button(copyLabel('macOS')));
    await click(copyWin);
    assert.deepEqual(writes, [SHA_WIN]);
  });
});
