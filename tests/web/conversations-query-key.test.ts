/**
 * 회귀 가드 — 토큰 만료 뒤 첫 로드에 "최근 대화"가 비던 결함(2026-11-15). /api/chat/conversations 는 토큰이
 * 없으면 200 + 게스트 빈 목록을 주므로, 캐시 키에 사용자를 넣어 게스트→로그인 전환 때 다시 부르게 한다.
 * 무효화 쪽은 앞부분 ["conversations"] 일치로 사용자 키 질의까지 닿는다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { conversationsQueryKey } from '../../apps/web/lib/conversations-query';

const ROOT = process.cwd(); // run-tests.mjs 가 저장소 루트를 cwd 로 준다

function waitFor(cond: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - started > 2000) return reject(new Error('timeout'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

test('게스트·사용자 키가 다르고 앞부분은 ["conversations"]', () => {
  assert.deepEqual(conversationsQueryKey(undefined), ['conversations', 'guest']);
  assert.deepEqual(conversationsQueryKey(null), ['conversations', 'guest']);
  assert.deepEqual(conversationsQueryKey('u1'), ['conversations', 'u1']);
});

test('게스트 키로 빈 목록을 받은 뒤 사용자 키로 바꾸면 다시 부른다', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls: string[] = [];
  const fetcher = (who: string) => async () => {
    calls.push(who);
    return who === 'guest' ? [] : [{ id: 's1' }];
  };
  const observer = new QueryObserver(client, { queryKey: conversationsQueryKey(undefined), queryFn: fetcher('guest') });
  const unsub = observer.subscribe(() => {});
  await waitFor(() => observer.getCurrentResult().isSuccess);
  assert.deepEqual(observer.getCurrentResult().data, []);

  observer.setOptions({ queryKey: conversationsQueryKey('u1'), queryFn: fetcher('u1') });
  await waitFor(() => (observer.getCurrentResult().data as unknown[] | undefined)?.length === 1);
  assert.deepEqual(calls, ['guest', 'u1']);
  unsub();
  client.clear();
});

test('invalidateQueries(["conversations"]) 가 사용자 키 질의를 무효화한다', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let n = 0;
  const observer = new QueryObserver(client, {
    queryKey: conversationsQueryKey('u1'),
    queryFn: async () => ++n,
  });
  const unsub = observer.subscribe(() => {});
  await waitFor(() => observer.getCurrentResult().data === 1);
  await client.invalidateQueries({ queryKey: ['conversations'] });
  await waitFor(() => observer.getCurrentResult().data === 2);
  assert.equal(n, 2);
  unsub();
  client.clear();
});

test('sidebar.tsx 는 conversationsQueryKey 로 질의하고 ["conversations"] 리터럴 질의가 없다', () => {
  const src = readFileSync(join(ROOT, 'apps/web/components/sidebar.tsx'), 'utf8');
  assert.ok(src.includes('conversationsQueryKey('), 'sidebar 최근 대화 질의 키는 conversationsQueryKey(user?.id)');
  assert.ok(!/queryKey:\s*\["conversations"\],\s*\n\s*queryFn/.test(src), '사용자 없는 질의 키 정의 금지');
});

test('history/page.tsx 목록 effect 의존성에 myUserId 가 있다', () => {
  const src = readFileSync(join(ROOT, 'apps/web/app/(workspace)/history/page.tsx'), 'utf8');
  assert.ok(
    /\}, \[t, tChat, locale, viewAll, filter\.folderId, filter\.tag, myUserId\]\);/.test(src),
    '/history 목록은 사용자 전환(게스트→로그인) 때 다시 조회한다',
  );
});
