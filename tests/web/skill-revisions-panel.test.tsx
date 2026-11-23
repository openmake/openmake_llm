import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';

import messages from '../../apps/web/messages/ko.json';
import { SkillRevisionsPanel } from '../../apps/web/addons/skill-runtime/components/skill-revisions-panel';

// 스킬 이전 버전 — 목록·미리보기·복원(확인 후 POST), 볼 권한이 없으면 패널을 숨긴다.
const revisions = [
  { id: '12', name: 'Repo Helper v2', description: null, content: '# 두 번째 내용', category: 'coding', createdAt: '2026-11-22T03:00:00.000Z' },
  { id: '11', name: 'Repo Helper', description: null, content: '# 첫 내용', category: 'coding', createdAt: '2026-11-21T03:00:00.000Z' },
];

async function render(opts: { listStatus?: number; list?: unknown[]; confirm?: boolean; restoreStatus?: number } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/skill-library' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.confirm = () => opts.confirm ?? true;
  const originalFetch = globalThis.fetch;
  const posts: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/agents/skills/s1/revisions') {
      if (opts.listStatus) return Response.json({ success: false, error: { message: 'no' } }, { status: opts.listStatus });
      return Response.json({ success: true, data: { revisions: opts.list ?? revisions } });
    }
    if (init?.method === 'POST' && url.pathname.endsWith('/restore')) {
      posts.push(url.pathname);
      if (opts.restoreStatus) return Response.json({ success: false, error: { message: 'boom' } }, { status: opts.restoreStatus });
      return Response.json({ success: true, data: { id: 's1' } });
    }
    return Response.json({ success: true, data: {} });
  };
  let restored = 0;
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
        <SkillRevisionsPanel skillId="s1" onRestored={() => { restored++; }} />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const buttons = (label: string) => [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label) as HTMLButtonElement[];
  const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 20)); }); };
  return {
    text: () => document.body.textContent ?? '',
    panel: () => document.querySelector('[data-testid="skill-revisions"]'),
    items: () => [...document.querySelectorAll('[data-testid="skill-revision"]')],
    buttons, click, posts, restored: () => restored,
    cleanup: () => { act(() => root.unmount()); globalThis.fetch = originalFetch; dom.window.close(); },
  };
}

test('이전 버전을 최신순으로 보이고, 이름을 누르면 내용을 미리 본다', async () => {
  const v = await render();
  try {
    assert.equal(v.items().length, 2);
    assert.match(v.items()[0].textContent!, /Repo Helper v2/);
    assert.ok(!v.text().includes('# 두 번째 내용'));
    await v.click(v.items()[0].querySelector('button')!);
    assert.ok(v.text().includes('# 두 번째 내용'));
  } finally { v.cleanup(); }
});

test('복원 — 확인하면 해당 이력으로 POST 하고 onRestored 를 부른다', async () => {
  const v = await render();
  try {
    await v.click(v.buttons('복원')[1]);
    assert.deepEqual(v.posts, ['/api/agents/skills/s1/revisions/11/restore']);
    assert.equal(v.restored(), 1);
  } finally { v.cleanup(); }
});

test('복원 확인을 취소하면 아무것도 보내지 않는다', async () => {
  const v = await render({ confirm: false });
  try {
    await v.click(v.buttons('복원')[0]);
    assert.deepEqual(v.posts, []);
    assert.equal(v.restored(), 0);
  } finally { v.cleanup(); }
});

test('복원 실패는 패널에 오류를 보이고 onRestored 를 부르지 않는다', async () => {
  const v = await render({ restoreStatus: 500 });
  try {
    await v.click(v.buttons('복원')[0]);
    assert.match(v.text(), /복원하지 못했습니다/);
    assert.equal(v.restored(), 0);
  } finally { v.cleanup(); }
});

test('이력이 없으면 안내, 볼 권한이 없으면(403) 패널을 숨긴다', async () => {
  const empty = await render({ list: [] });
  try { assert.match(empty.text(), /아직 이전 버전이 없습니다/); } finally { empty.cleanup(); }
  const denied = await render({ listStatus: 403 });
  try { assert.equal(denied.panel(), null); } finally { denied.cleanup(); }
});
