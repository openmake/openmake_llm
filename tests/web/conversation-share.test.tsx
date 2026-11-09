import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import messages from '../../apps/web/messages/ko.json';
import { ConversationShareModal } from '../../apps/web/components/chat/conversation-share-modal';
import { ConversationShareButton } from '../../apps/web/components/chat/conversation-share-button';
import { ConversationShareDocumentView } from '../../apps/web/components/chat/conversation-share-document';
import { SharedConversationViewer } from '../../apps/web/app/shared/conversation/[shareId]/viewer';
import { safeShareReturnPath, shareLoginHref } from '../../apps/web/lib/conversation-share';
import { useAppStore } from '../../apps/web/lib/store';

const PREVIEW_ID = '0b7f0a0e-1111-4222-8333-944445555666';
const SHARE_ID = '1b7f0a0e-1111-4222-8333-944445555666';
const DOC = {
  schemaVersion: 1,
  title: '테스트 대화',
  messages: [
    { role: 'user', content: '질문 [링크](https://evil.example/x) ![그림](https://evil.example/p.png) <img src="https://evil.example/h.png"> https://auto.example' },
    { role: 'assistant', content: '**답변**' },
  ],
};

type Call = { method: string; path: string; body: unknown };

function setup(url = 'http://localhost/') {
  const dom = new JSDOM('<div id="root"></div>', { url });
  Object.assign(globalThis, {
    window: dom.window, self: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,

    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  });
  const calls: Call[] = [];
  const original = globalThis.fetch;
  let handler: (c: Call) => Response = () => Response.json({ success: true, data: {} });
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input), 'http://localhost');
    const c = { method: init?.method ?? 'GET', path: u.pathname + u.search, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    if (u.pathname === '/api/csrf-token') return Response.json({});
    calls.push(c);
    return handler(c);
  };
  const root: Root = createRoot(document.getElementById('root')!);
  const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
  const render = (node: React.ReactNode) => act(async () => {
    const router = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} };
    root.render(
      <AppRouterContext.Provider value={router as any}>
        <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">{node}</NextIntlClientProvider>
      </AppRouterContext.Provider>,
    );
  });
  const click = (el: Element | null) => act(async () => { (el as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const byText = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) ?? null;
  const cleanup = async () => { await act(async () => root.unmount()); globalThis.fetch = original; };
  return { dom, calls, setHandler: (h: typeof handler) => { handler = h; }, flush, render, click, byText, cleanup };
}

const ok = (data: unknown) => Response.json({ success: true, data });
const fail = (status: number, code: string) => Response.json({ success: false, error: { code, message: code } }, { status });
const status = (share: unknown = null) => ok({
  share,
  capabilities: { canShare: true, allowedVisibilities: ['private', 'authenticated', 'link', 'org'], organizations: [{ orgId: 'o1', name: '알파팀' }, { orgId: 'o2', name: '베타팀' }] },
});
const t = (messages as any).conversationShare;

test('미리보기·확인 없이는 게시할 수 없고, 게시는 previewId 와 confirmed 만 보낸다', async () => {
  const s = setup();
  try {
    s.setHandler((c) => {
      if (c.method === 'GET') return status();
      if (c.path.endsWith('/share/preview')) return ok({ previewId: PREVIEW_ID, document: DOC, capturedAt: '2026-11-09T00:00:00Z', expiresAt: '2026-11-09T00:15:00Z', visibility: c.body && (c.body as any).visibility || 'private', orgId: null, baseRevision: 0 });
      return ok({ shareId: SHARE_ID, visibility: 'private', orgId: null, revision: 1, capturedAt: 'x', updatedAt: 'x', path: `/shared/conversation/${SHARE_ID}` });
    });
    await s.render(<ConversationShareModal sessionId="s1" onCloseAction={() => {}} />);
    await s.flush();
    const publish = () => s.byText(t.publish) as HTMLButtonElement;
    assert.equal(publish().disabled, true);

    await s.click(s.byText(t.preview));
    await s.flush();
    assert.ok(document.body.textContent?.includes('테스트 대화'));
    assert.equal(publish().disabled, true, '확인 체크 전에는 게시 불가');

    const confirm = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    assert.ok(confirm.labels && confirm.labels.length === 1, '확인 체크에 label');
    await s.click(confirm);
    assert.equal(publish().disabled, false);

    // 범위를 바꾸면 미리보기·확인이 초기화된다
    await s.click(document.querySelector('input[value="link"]'));
    assert.equal(document.querySelector('input[type="checkbox"]'), null);
    assert.equal(publish().disabled, true);

    await s.click(s.byText(t.preview));
    await s.flush();
    await s.click(document.querySelector('input[type="checkbox"]'));
    await s.click(publish());
    await s.flush();
    const post = s.calls.find((c) => c.method === 'POST' && c.path === '/api/sessions/s1/share');
    assert.deepEqual(post?.body, { previewId: PREVIEW_ID, confirmed: true });
    assert.ok(document.body.textContent?.includes(t.copyLink));
  } finally {
    await s.cleanup();
  }
});

test('org 는 서버가 준 조직 목록에서 명시 선택해야 미리보기할 수 있다(기본 선택 없음)', async () => {
  const s = setup();
  try {
    s.setHandler((c) => (c.method === 'GET' ? status() : ok({ previewId: PREVIEW_ID, document: DOC, capturedAt: 'x', expiresAt: 'x', visibility: 'org', orgId: 'o2', baseRevision: 0 })));
    await s.render(<ConversationShareModal sessionId="s1" onCloseAction={() => {}} />);
    await s.flush();
    await s.click(document.querySelector('input[value="org"]'));
    const select = document.querySelector('select') as HTMLSelectElement;
    assert.deepEqual([...select.options].map((o) => o.textContent), [t.orgPlaceholder, '알파팀', '베타팀']);
    assert.equal(select.value, '');
    assert.equal((s.byText(t.preview) as HTMLButtonElement).disabled, true);
    await act(async () => {
      select.value = 'o2';
      select.dispatchEvent(new s.dom.window.Event('change', { bubbles: true }));
    });
    await s.click(s.byText(t.preview));
    await s.flush();
    const pv = s.calls.find((c) => c.path.endsWith('/share/preview'));
    assert.deepEqual(pv?.body, { visibility: 'org', orgId: 'o2' });
  } finally {
    await s.cleanup();
  }
});

test('게시 409 는 새 미리보기 안내를 보이고 이전 미리보기를 지운다', async () => {
  const s = setup();
  try {
    s.setHandler((c) => {
      if (c.method === 'GET') return status();
      if (c.path.endsWith('/share/preview')) return ok({ previewId: PREVIEW_ID, document: DOC, capturedAt: 'x', expiresAt: 'x', visibility: 'private', orgId: null, baseRevision: 0 });
      return fail(409, 'CONVERSATION_SHARE_PREVIEW_STALE');
    });
    await s.render(<ConversationShareModal sessionId="s1" onCloseAction={() => {}} />);
    await s.flush();
    await s.click(s.byText(t.preview));
    await s.flush();
    await s.click(document.querySelector('input[type="checkbox"]'));
    await s.click(s.byText(t.publish));
    await s.flush();
    assert.ok(document.querySelector('[role="alert"]')?.textContent?.includes(t.error.stale));
    assert.equal(document.body.textContent?.includes('테스트 대화'), false);
  } finally {
    await s.cleanup();
  }
});

test('공유 문서 렌더러 — 링크는 라벨만, 이미지·raw HTML 은 불러오지 않는다', async () => {
  const s = setup();
  try {
    await s.render(<ConversationShareDocumentView document={DOC as any} />);
    assert.equal(document.querySelectorAll('a').length, 0);
    assert.equal(document.querySelectorAll('img').length, 0);
    assert.equal(document.querySelectorAll('[href],[src]').length, 0);
    assert.ok(document.body.textContent?.includes('링크'));
    assert.ok(document.body.textContent?.includes(t.imageOmitted));
    assert.ok(document.querySelector('strong')?.textContent === '답변');
  } finally {
    await s.cleanup();
  }
});

test('저장된 세션이 없으면 공유 버튼은 비활성이고 서버를 부르지 않는다', async () => {
  const s = setup();
  try {
    useAppStore.setState({ currentSessionId: null });
    await s.render(<ConversationShareButton />);
    await s.flush();
    const btn = document.querySelector('button') as HTMLButtonElement;
    assert.equal(btn.disabled, true);
    assert.equal(s.calls.length, 0);
  } finally {
    await s.cleanup();
  }
});

test('공유 뷰어 — 읽기 전용, 404 면 본문을 지우고 같은 거절 문구 + 공유 경로로 돌아오는 로그인 링크', async () => {
  const s = setup(`http://localhost/shared/conversation/${SHARE_ID}`);
  try {
    useAppStore.setState({ authResolved: true, auth: { currentUser: null, isGuestMode: false } });
    let allow = true;
    s.setHandler(() => (allow ? ok({ shareId: SHARE_ID, visibility: 'org', capturedAt: '2026-11-09T00:00:00Z', updatedAt: 'x', document: DOC }) : fail(404, 'NOT_FOUND')));
    await s.render(<SharedConversationViewer shareId={SHARE_ID} token={null} />);
    await s.flush();
    assert.ok(document.body.textContent?.includes('테스트 대화'));
    assert.equal(document.querySelectorAll('textarea, input, form').length, 0, '입력·재개 UI 없음');
    assert.equal(s.calls[0].path, `/api/shared-conversations/${SHARE_ID}`);

    allow = false;
    await s.render(<SharedConversationViewer shareId={SHARE_ID} token="tok" />);
    await s.flush();
    assert.equal(document.body.textContent?.includes('테스트 대화'), false, '거절 시 이전 본문 제거');
    assert.ok(document.body.textContent?.includes((messages as any).sharedConversation.denied));
    const login = document.querySelector('a[href^="/login"]') as HTMLAnchorElement;
    assert.equal(login.getAttribute('href'), shareLoginHref(SHARE_ID));
    assert.equal(login.getAttribute('href')?.includes('tok'), false, '토큰은 로그인 이동에 싣지 않는다');
  } finally {
    await s.cleanup();
  }
});

test('공유 뷰어 — 인증 판정 전엔 조회하지 않고(만료 토큰 갱신 대기), 계정이 바뀌면 이전 본문을 숨기고 다시 조회', async () => {
  const s = setup(`http://localhost/shared/conversation/${SHARE_ID}`);
  try {
    useAppStore.setState({ authResolved: false, auth: { currentUser: null, isGuestMode: false } });
    let allowFor: string | null = 'u-b';
    let seen = 0;
    s.setHandler(() => { seen += 1; return allowFor ? ok({ shareId: SHARE_ID, visibility: 'org', capturedAt: 'x', updatedAt: 'x', document: DOC }) : fail(404, 'NOT_FOUND'); });
    await s.render(<SharedConversationViewer shareId={SHARE_ID} token={null} />);
    await s.flush();
    assert.equal(seen, 0, '인증 판정 전 조회 없음');

    await act(async () => { useAppStore.setState({ authResolved: true, auth: { currentUser: { id: 'u-b', email: 'b', role: 'user' }, isGuestMode: false } }); });
    await s.flush();
    assert.equal(seen, 1);
    assert.ok(document.body.textContent?.includes('테스트 대화'));

    allowFor = null;
    await act(async () => { useAppStore.setState({ auth: { currentUser: { id: 'u-c', email: 'c', role: 'user' }, isGuestMode: false } }); });
    await s.flush();
    assert.equal(seen, 2, '계정 전환 시 다시 조회');
    assert.equal(document.body.textContent?.includes('테스트 대화'), false);
  } finally {
    await s.cleanup();
  }
});

test('safeShareReturnPath — 같은 origin 의 공유 대화 경로만', () => {
  assert.equal(safeShareReturnPath(`/shared/conversation/${SHARE_ID}`), `/shared/conversation/${SHARE_ID}`);
  for (const bad of [null, '', '/', '//evil.example', 'https://evil.example/shared/conversation/x', `/shared/conversation/${SHARE_ID}?token=a`, '/shared/conversation/../admin', '/shared/task/x']) {
    assert.equal(safeShareReturnPath(bad), null, String(bad));
  }
  assert.equal(shareLoginHref(SHARE_ID), `/login?next=${encodeURIComponent(`/shared/conversation/${SHARE_ID}`)}`);
});
