/** 저장소 updateOrchestratorTask — startedAt 은 running 으로 바뀔 때만 찍고, 이미 running 이면 유지한다 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { useAppStore } from '../../apps/web/lib/store';

function withNow<T>(now: number, fn: () => T): T {
  const real = Date.now;
  Date.now = () => now;
  try { return fn(); } finally { Date.now = real; }
}
const task = (id: string) => useAppStore.getState().orchestratorProgress!.tasks.find((t) => t.id === id)!;

test('running 으로 바뀔 때 startedAt, 같은 id 의 running 이 다시 와도 유지, 끝난 뒤 reason·provider 저장', () => {
  const s = useAppStore.getState();
  s.setOrchestratorProgress({ phase: 'executing', tasks: [{ id: 'a', capability: 'image.generate', status: 'pending' }] });
  assert.equal(task('a').startedAt, undefined);
  withNow(1000, () => s.updateOrchestratorTask({ id: 'a', capability: 'image.generate', status: 'running' }));
  assert.equal(task('a').startedAt, 1000);
  withNow(5000, () => s.updateOrchestratorTask({ id: 'a', capability: 'image.generate', status: 'running' }));
  assert.equal(task('a').startedAt, 1000);
  withNow(9000, () => s.updateOrchestratorTask({ id: 'a', capability: 'image.generate', status: 'failed', reason: 'timeout', provider: 'ext' }));
  assert.deepEqual([task('a').status, task('a').reason, task('a').provider], ['failed', 'timeout', 'ext']);
});

test('plan 없이 처음 온 running 작업도 startedAt 을 찍는다', () => {
  const s = useAppStore.getState();
  s.setOrchestratorProgress({ phase: 'executing', tasks: [] });
  withNow(2000, () => s.updateOrchestratorTask({ id: 'b', capability: 'web.search', status: 'running' }));
  assert.equal(task('b').startedAt, 2000);
  s.setOrchestratorProgress(null);
});
