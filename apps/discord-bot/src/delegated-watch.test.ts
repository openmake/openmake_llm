/// <reference types="node" />
/**
 * 채팅에서 위임한 백그라운드 작업 지켜보기 시작 — 새로 만든 작업만, 같은 작업은 한 번만, 채널당 동시 상한.
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createDelegatedWatchRegistry,
    formatNotWatched,
    MAX_DELEGATED_WATCHES_PER_CHANNEL,
    startDelegatedWatches,
    type AgentTaskRef,
} from './delegated-watch';

const created = (id: string): AgentTaskRef => ({ id, goal: `목표 ${id}`, status: 'created' });

/** 끝나지 않는 지켜보기 — release 로 끝낸다 */
function fakeWatch() {
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const watch = (task: AgentTaskRef) => {
        started.push(task.id);
        return new Promise<void>((resolve) => releases.set(task.id, resolve));
    };
    return { started, releases, watch };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('created 만 지켜보고 duplicate 는 건너뛴다(안내도 없다)', () => {
    const registry = createDelegatedWatchRegistry();
    const w = fakeWatch();
    const notices: string[] = [];
    const r = startDelegatedWatches([created('a'), { id: 'b', goal: 'g', status: 'duplicate' }], {
        channelId: 'c1', registry, watch: w.watch, notifyNotWatched: async (t) => { notices.push(t.id); },
    });
    assert.deepEqual(w.started, ['a']);
    assert.deepEqual(r, { started: ['a'], notWatched: [] });
    assert.deepEqual(notices, []);
});

test('이미 지켜보는 작업 id 는 다시 지켜보지 않는다', () => {
    const registry = createDelegatedWatchRegistry();
    const w = fakeWatch();
    const deps = { channelId: 'c1', registry, watch: w.watch, notifyNotWatched: async () => undefined };
    startDelegatedWatches([created('a')], deps);
    startDelegatedWatches([created('a'), created('a')], deps);
    assert.deepEqual(w.started, ['a']);
});

test(`채널당 동시 ${MAX_DELEGATED_WATCHES_PER_CHANNEL}개까지 — 넘는 작업은 안내 한 줄`, () => {
    const registry = createDelegatedWatchRegistry();
    const w = fakeWatch();
    const notices: AgentTaskRef[] = [];
    const r = startDelegatedWatches(['a', 'b', 'c', 'd'].map(created), {
        channelId: 'c1', registry, watch: w.watch, notifyNotWatched: async (t) => { notices.push(t); },
    });
    assert.deepEqual(r, { started: ['a', 'b', 'c'], notWatched: ['d'] });
    assert.deepEqual(notices.map((t) => t.id), ['d']);
    // 다른 채널은 따로 센다
    const other = startDelegatedWatches([created('e')], { channelId: 'c2', registry, watch: w.watch, notifyNotWatched: async () => undefined });
    assert.deepEqual(other.started, ['e']);
});

test('지켜보기가 끝나면(실패해도) 자리를 돌려준다', async () => {
    const registry = createDelegatedWatchRegistry();
    let calls = 0;
    const watch = (task: AgentTaskRef) => {
        calls += 1;
        return task.id === 'boom' ? Promise.reject(new Error('화면 오류')) : Promise.resolve('completed');
    };
    const deps = { channelId: 'c1', registry, watch, notifyNotWatched: async () => undefined };
    startDelegatedWatches([created('a'), created('b'), created('boom')], deps);
    await tick();
    await tick();
    const again = startDelegatedWatches([created('x'), created('y'), created('z')], deps);
    assert.deepEqual(again.started, ['x', 'y', 'z']);
    assert.equal(calls, 6);
});

test('안내 전송 실패는 삼킨다', async () => {
    const registry = createDelegatedWatchRegistry();
    const w = fakeWatch();
    const r = startDelegatedWatches(['a', 'b', 'c', 'd'].map(created), {
        channelId: 'c1', registry, watch: w.watch, notifyNotWatched: async () => { throw new Error('전송 실패'); },
    });
    await tick();
    assert.deepEqual(r.notWatched, ['d']);
});

test('안내 문구는 목표를 짧게 붙인 한 줄', () => {
    const text = formatNotWatched({ id: 'd', goal: '아주 '.repeat(50), status: 'created' });
    assert.equal(text.includes('\n'), false);
    assert.match(text, /이 작업은 지켜보지 않습니다 — 웹의 작업 화면에서 확인하세요/);
    assert.ok(text.length < 160);
});
