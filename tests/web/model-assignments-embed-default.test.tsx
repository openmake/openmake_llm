/**
 * 모델 배정 — 임베딩 슬롯의 빈 선택·초기화 의미(2026-11-10, 코드 기본값 제거).
 * 관리자 빈 선택 = 미배정, 개인 빈 선택 = 전역 배정 사용. 실행 가능 여부는 서버 effective 가 판정하고 화면은 그대로 보인다.
 * 다른 슬롯은 종전 "기본(자동)"·"기본값으로 되돌리기" 를 유지한다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';

import messages from '../../apps/web/messages/ko.json';
import { ModelAssignmentsSection } from '../../apps/web/components/settings/model-assignments-section';

const k = messages.modelAssignments;
const UNASSIGNED_ERROR = 'text.embed 모델이 배정되어 있지 않습니다. 설정 → 모델 & 응답 → 모델 배정에서 배정하세요.';

const slots = [
  { id: 'code', group: 'quality', kind: 'text', roles: ['review'], capabilities: ['text.code'], paramKeys: [], available: true },
  { id: 'text.embed', group: 'multimodal', kind: 'modality', roles: [], capabilities: ['text.embed'], paramKeys: ['dimensions'], available: true },
];
const models = [
  { modelId: 'local-llm:fixture-chat', name: 'fixture-chat', provider: 'local-llm' },
  { modelId: 'local-llm:fixture-embed', name: 'fixture-embed', provider: 'local-llm' },
];

type Assignment = { slot: string; fullId: string; params: Record<string, string>; updatedAt: string };
type Effective = Record<string, unknown> & { slot: string };

/**
 * 가짜 서버 — scope 의 배정 목록과, 배정 삭제 뒤 서버가 내려줄 effective 를 테스트가 정한다(화면이 판정을 다시 계산하지 않는지 보려고).
 */
async function withSection(
  scope: 'user' | 'global',
  server: { assignments: Assignment[]; effective: () => Effective[] },
  run: (p: { dom: JSDOM; deletes: string[]; gets: () => number; select: (slotTitle: string) => HTMLSelectElement; button: (label: string) => HTMLButtonElement | undefined }) => Promise<void>,
) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/settings' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  const base = scope === 'global' ? '/api/admin/model-assignments' : '/api/users/me/model-assignments';
  const deletes: string[] = [];
  let getCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/models') return Response.json({ success: true, data: { defaultModel: '', models } });
    if (url.pathname === base && (!init?.method || init.method === 'GET')) {
      getCount++;
      return Response.json({ success: true, data: { slots, assignments: server.assignments, effective: server.effective() } });
    }
    if (url.pathname.startsWith(`${base}/`) && init?.method === 'DELETE') {
      deletes.push(url.pathname);
      const slot = decodeURIComponent(url.pathname.slice(base.length + 1));
      server.assignments = server.assignments.filter((a) => a.slot !== slot);
      return Response.json({ success: true, data: { deleted: true } });
    }
    return Response.json({ success: true, data: {} });
  };
  const root = createRoot(document.getElementById('root')!);
  const flush = async () => { for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  try {
    await act(async () => {
      root.render(<NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul"><ModelAssignmentsSection scope={scope} /></NextIntlClientProvider>);
    });
    await flush();
    await run({
      dom,
      deletes,
      gets: () => getCount,
      select: (slotTitle) => {
        const s = document.querySelector(`select[aria-label="${slotTitle}"]`) as HTMLSelectElement | null;
        assert.ok(s, `select missing: ${slotTitle}`);
        return s;
      },
      button: (label) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined,
    });
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
}

const emptyOptionText = (s: HTMLSelectElement) => [...s.options].find((o) => o.value === '')?.textContent;

test('개인 scope: 임베딩 빈 선택은 "전역 배정 사용", 초기화하면 DELETE 후 재조회 — 서버 미배정 오류를 함께 보인다', async () => {
  const server = {
    assignments: [{ slot: 'text.embed', fullId: 'local-llm:fixture-embed', params: {}, updatedAt: '2026-11-10T00:00:00.000Z' }] as Assignment[],
    effective: (): Effective[] => (server.assignments.some((a) => a.slot === 'text.embed')
      ? [{ slot: 'code', fullId: 'local-llm:fixture-chat', source: 'default' }, { slot: 'text.embed', fullId: 'local-llm:fixture-embed', source: 'user' }]
      : [{ slot: 'code', fullId: 'local-llm:fixture-chat', source: 'default' }, { slot: 'text.embed', fullId: null, source: 'none', error: UNASSIGNED_ERROR, code: 'CAPABILITY_UNASSIGNED' }]),
  };
  await withSection('user', server, async ({ dom, deletes, gets, select, button }) => {
    const embed = select(k.slots.text_embed.title);
    assert.equal(embed.value, 'local-llm:fixture-embed');
    assert.equal(emptyOptionText(embed), k.embedUserOption);
    assert.equal(button(k.embedGlobalResetLabel), undefined);
    const reset = button(k.embedUserResetLabel);
    assert.ok(reset, '개인 임베딩 초기화 버튼은 "전역 임베딩 배정 사용" 의미여야 한다');
    assert.equal(reset.getAttribute('title'), k.embedUserResetLabel);

    const before = gets();
    await act(async () => reset.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    for (let i = 0; i < 20 && gets() === before; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    assert.deepEqual(deletes, ['/api/users/me/model-assignments/text.embed']);
    assert.ok(gets() > before, 'DELETE 뒤 배정을 다시 불러온다');
    const after = select(k.slots.text_embed.title);
    assert.equal(after.value, '');
    assert.equal(after.selectedOptions[0]?.textContent, k.embedUserOption);
    assert.ok(document.body.textContent!.includes(UNASSIGNED_ERROR), '상속 선택 상태에서도 서버 미배정 오류가 보여야 한다');
    assert.equal(button(k.embedUserResetLabel), undefined, '배정이 없으면 초기화 버튼이 없다');
  });
});

test('관리자 scope: 임베딩 빈 선택은 "미배정", 초기화는 "임베딩 배정 해제" 로 전역 DELETE', async () => {
  const server = {
    assignments: [{ slot: 'text.embed', fullId: 'local-llm:fixture-embed', params: {}, updatedAt: '2026-11-10T00:00:00.000Z' }] as Assignment[],
    effective: (): Effective[] => (server.assignments.length
      ? [{ slot: 'text.embed', fullId: 'local-llm:fixture-embed', source: 'global', keyPolicy: 'actor-byok' }]
      : [{ slot: 'text.embed', fullId: null, source: 'none', error: UNASSIGNED_ERROR, code: 'CAPABILITY_UNASSIGNED' }]),
  };
  await withSection('global', server, async ({ dom, deletes, gets, select, button }) => {
    const embed = select(k.slots.text_embed.title);
    assert.equal(emptyOptionText(embed), k.embedGlobalOption);
    assert.equal(button(k.embedUserResetLabel), undefined);
    const reset = button(k.embedGlobalResetLabel);
    assert.ok(reset);

    const before = gets();
    await act(async () => reset.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    for (let i = 0; i < 20 && gets() === before; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    assert.deepEqual(deletes, ['/api/admin/model-assignments/text.embed']);
    const after = select(k.slots.text_embed.title);
    assert.equal(after.selectedOptions[0]?.textContent, k.embedGlobalOption);
    assert.ok(document.body.textContent!.includes(UNASSIGNED_ERROR));
  });
});

test('다른 슬롯은 종전 "기본(자동)" · "기본값으로 되돌리기" 를 유지한다', async () => {
  const server = {
    assignments: [{ slot: 'code', fullId: 'local-llm:fixture-chat', params: {}, updatedAt: '2026-11-10T00:00:00.000Z' }] as Assignment[],
    effective: (): Effective[] => [{ slot: 'code', fullId: 'local-llm:fixture-chat', source: 'user' }],
  };
  for (const scope of ['user', 'global'] as const) {
    await withSection(scope, { ...server, assignments: [...server.assignments] }, async ({ select, button }) => {
      assert.equal(emptyOptionText(select(k.slots.code.title)), k.defaultOption);
      assert.ok(button(k.resetLabel), `${scope}: code 슬롯 초기화 문구 유지`);
      assert.equal(button(k.embedGlobalResetLabel), undefined);
      assert.equal(button(k.embedUserResetLabel), undefined);
    });
  }
});
