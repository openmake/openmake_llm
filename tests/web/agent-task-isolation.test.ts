/**
 * worktree 격리 상태 표시(200) — 서버 값 → 문구 키·색 대응, 카드 병합분, 종료 뒤 정리 알림의 재조회 생략 판정.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import ko from '../../apps/web/messages/ko.json';
import { isolationLabel, isolationFromTask, isolationFromEvent, isIsolationOnlyUpdate, startTerminalFetch, isLatestTerminalFetch } from '../../apps/web/lib/agent-task-isolation';

const WT = { state: 'worktree' as const, branch: 'omk-task/abcd1234', worktreeRel: '.openmake/worktrees/t1' };

test('값 6종 → 문구 키·색', () => {
  assert.deepEqual(isolationLabel(WT), { key: 'worktree', params: { branch: 'omk-task/abcd1234' }, tone: 'accent' });
  assert.deepEqual(isolationLabel({ ...WT, outcome: 'kept' }), { key: 'worktreeKept', params: { branch: 'omk-task/abcd1234', path: '.openmake/worktrees/t1' }, tone: 'accent' });
  assert.deepEqual(isolationLabel({ ...WT, outcome: 'removed' }), { key: 'worktreeRemoved', params: {}, tone: 'neutral' });
  // 무시 파일만 남아 보존(2026-11-18) — 서버가 실은 ignoredOnly 로 키만 고른다.
  assert.deepEqual(isolationLabel({ ...WT, outcome: 'kept', ignoredOnly: true }), { key: 'worktreeKeptIgnored', params: { branch: 'omk-task/abcd1234', path: '.openmake/worktrees/t1' }, tone: 'accent' });
  assert.equal(isolationLabel({ ...WT, outcome: 'removed', ignoredOnly: true })?.key, 'worktreeRemoved');
  assert.deepEqual(isolationLabel({ state: 'direct', reason: 'not_repo' }), { key: 'notRepo', params: {}, tone: 'neutral' });
  assert.deepEqual(isolationLabel({ state: 'direct', reason: 'disabled' }), { key: 'disabled', params: {}, tone: 'neutral' });
  assert.deepEqual(isolationLabel({ state: 'direct', reason: 'unavailable' }), { key: 'unavailable', params: {}, tone: 'warn' });
});

test('kept 문구의 경로는 서버가 정한 rootRel(연결 폴더 기준)이다', () => {
  assert.equal(isolationLabel({ ...WT, worktreeRel: 'w/sub', rootRel: 'ws-git/sub/w/sub', outcome: 'kept' })?.params.path, 'ws-git/sub/w/sub');
});

test('rootRel 이 없는 옛 값은 worktreeRel 을 쓴다', () => {
  assert.equal(isolationLabel({ ...WT, worktreeRel: 'w', outcome: 'kept' })?.params.path, 'w');
});

test('없음·모르는 state·reason·outcome 은 null', () => {
  assert.equal(isolationLabel(null), null);
  assert.equal(isolationLabel(undefined), null);
  assert.equal(isolationLabel({ state: 'other' } as never), null);
  assert.equal(isolationLabel({ state: 'direct', reason: 'constructor' } as never), null);
  assert.equal(isolationLabel({ ...WT, outcome: 'weird' } as never), null);
});

test('문구 키는 ko 원본에 모두 있다', () => {
  const iso = (ko as { agentTasks: { isolation: Record<string, string> } }).agentTasks.isolation;
  for (const k of ['worktree', 'worktreeKept', 'worktreeKeptIgnored', 'worktreeRemoved', 'notRepo', 'disabled', 'unavailable']) assert.ok(iso[k], k);
});

test('작업 응답 병합 — 값은 넣고, null 은 비우고, 없으면(옛 서버) 건드리지 않는다', () => {
  assert.deepEqual(isolationFromTask({ isolation: WT }), { isolation: WT });
  assert.deepEqual(isolationFromTask({ isolation: null }), { isolation: undefined });
  assert.deepEqual(isolationFromTask({}), {});
});

test('진행 이벤트 병합 — 실린 값만 넣는다', () => {
  assert.deepEqual(isolationFromEvent({ isolation: WT }), { isolation: WT });
  assert.deepEqual(isolationFromEvent({}), {});
});

test('reason:isolation + 이미 종료된 카드만 재조회를 건너뛴다(isolation 필드 유무가 아니라 reason 으로)', () => {
  assert.equal(isIsolationOnlyUpdate('isolation', 'completed'), true);
  assert.equal(isIsolationOnlyUpdate('isolation', 'failed'), true);
  assert.equal(isIsolationOnlyUpdate('isolation', 'cancelled'), true);
  assert.equal(isIsolationOnlyUpdate('isolation', 'running'), false);
  assert.equal(isIsolationOnlyUpdate('isolation', undefined), false);
  assert.equal(isIsolationOnlyUpdate(undefined, 'completed'), false);
  assert.equal(isIsolationOnlyUpdate('plan_edited', 'completed'), false);
});

test('종료 재조회는 나중에 시작한 조회만 병합한다 — 앞 응답이 늦게 와도 덮지 않는다', () => {
  const gens = new Map<string, number>();
  const first = startTerminalFetch(gens, 't1');
  const second = startTerminalFetch(gens, 't1');
  const other = startTerminalFetch(gens, 't2');
  assert.equal(isLatestTerminalFetch(gens, 't1', first), false);
  assert.equal(isLatestTerminalFetch(gens, 't1', second), true);
  assert.equal(isLatestTerminalFetch(gens, 't2', other), true);
});
