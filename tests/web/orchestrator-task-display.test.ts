/**
 * 오케스트레이터 작업 배너 표시 규칙 — 실패 코드 → 문구 키, 실행 중 경과 시간 m:ss, 실행 중 작업 여부.
 * 실패 분류는 서버(reason·provider), 웹은 코드 → 문구 대응만 한다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import ko from '../../apps/web/messages/ko.json';
import { orchestratorFailureMessage, formatElapsed, hasRunningTask } from '../../apps/web/lib/orchestrator-task-display';

test('timeout — provider 가 있으면 외부 서비스 문구(provider 전달), 없으면 일반 시간 초과 문구', () => {
  assert.deepEqual(orchestratorFailureMessage('timeout', 'ext'), { key: 'timeoutExternal', provider: 'ext' });
  assert.deepEqual(orchestratorFailureMessage('timeout'), { key: 'timeout' });
});

test('분류가 뚜렷한 코드만 문구를 둔다', () => {
  assert.deepEqual(orchestratorFailureMessage('unassigned'), { key: 'unassigned' });
  assert.deepEqual(orchestratorFailureMessage('unsupported'), { key: 'unavailable' });
  assert.deepEqual(orchestratorFailureMessage('disabled'), { key: 'unavailable' });
  assert.deepEqual(orchestratorFailureMessage('skipped'), { key: 'skipped' });
  assert.deepEqual(orchestratorFailureMessage('deadline'), { key: 'deadline' });
});

test('reason 없음(옛 서버)·cancelled·failed·그 밖의 코드는 null — summary 원문을 그대로 그린다', () => {
  for (const r of [undefined, '', 'cancelled', 'failed', 'input', 'budget', 'quota', 'expired', 'no-such-code', 'constructor']) {
    assert.equal(orchestratorFailureMessage(r), null, String(r));
  }
});

test('문구 키는 ko 원본에 모두 있다', () => {
  const failure = (ko as { chat: { orchestrator: { failure: Record<string, string> } } }).chat.orchestrator.failure;
  for (const r of ['timeout', 'unassigned', 'unsupported', 'skipped', 'deadline']) {
    assert.ok(failure[orchestratorFailureMessage(r)!.key], r);
  }
  assert.ok(failure[orchestratorFailureMessage('timeout', 'ext')!.key].includes('{provider}'));
});

test('formatElapsed — m:ss, 음수는 0:00', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(999), '0:00');
  assert.equal(formatElapsed(1000), '0:01');
  assert.equal(formatElapsed(65_400), '1:05');
  assert.equal(formatElapsed(600_000), '10:00');
  assert.equal(formatElapsed(-5), '0:00');
});

test('hasRunningTask — 실행 중 작업이 하나라도 있을 때만 true', () => {
  assert.equal(hasRunningTask([]), false);
  assert.equal(hasRunningTask([{ status: 'pending' }, { status: 'ok' }, { status: 'failed' }]), false);
  assert.equal(hasRunningTask([{ status: 'ok' }, { status: 'running' }]), true);
});
