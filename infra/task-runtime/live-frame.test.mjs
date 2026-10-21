/**
 * live-frame 테스트 — `node --test infra/` 로 돈다(루트 npm test 에 포함).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFrameWriter } from './live-frame.mjs';

const FRAME = Buffer.from('jpeg-bytes').toString('base64');

/** 이벤트 핸들러를 저장하고 send 호출을 기록하는 가짜 CDP 세션. */
function fakeCdp({ failStart = false } = {}) {
    const handlers = {};
    const calls = [];
    return {
        calls,
        on(event, fn) { handlers[event] = fn; },
        async send(method, params) {
            calls.push({ method, params });
            if (failStart && method === 'Page.startScreencast') throw new Error('cdp 실패');
            return {};
        },
        /** 프레임 하나를 보내고 그 처리가 끝날 때까지 기다린다. */
        async emit(event, payload) { await handlers[event]?.(payload); },
    };
}

function fakeFs({ failWrite = false } = {}) {
    const writes = [];
    const renames = [];
    return {
        writes,
        renames,
        async writeFile(p, data) {
            if (failWrite) throw new Error('디스크 가득');
            writes.push({ p, data });
        },
        async rename(a, b) { renames.push([a, b]); },
    };
}

function setup({ times = [0], failStart = false, failWrite = false } = {}) {
    const cdp = fakeCdp({ failStart });
    const fs = fakeFs({ failWrite });
    let t = 0;
    const writer = createLiveFrameWriter({
        cdp,
        framePath: '/workspace/.live-frame.jpg',
        metaPath: '/workspace/.live-frame.json',
        minIntervalMs: 700,
        getMeta: async () => ({ url: 'https://example.com/', title: '예시' }),
        fs,
        now: () => times[Math.min(t++, times.length - 1)],
    });
    return { cdp, fs, writer };
}

const acks = (cdp) => cdp.calls.filter((c) => c.method === 'Page.screencastFrameAck');
const frameWrites = (fs) => fs.writes.filter((w) => w.p === '/workspace/.live-frame.jpg.tmp');

test('첫 프레임은 바로 쓰고 meta 에 url·title·at 을 남긴다', async () => {
    const { cdp, fs, writer } = setup({ times: [1234] });
    await writer.start();
    assert.deepEqual(cdp.calls[0], {
        method: 'Page.startScreencast',
        params: { format: 'jpeg', quality: 50, maxWidth: 1280, maxHeight: 800 },
    });
    await cdp.emit('Page.screencastFrame', { data: FRAME, sessionId: 7 });

    assert.equal(fs.writes.length, 2);
    assert.equal(fs.writes[0].p, '/workspace/.live-frame.jpg.tmp');
    assert.ok(Buffer.isBuffer(fs.writes[0].data));
    assert.equal(fs.writes[0].data.toString(), 'jpeg-bytes');
    assert.equal(fs.writes[1].p, '/workspace/.live-frame.json.tmp');
    assert.deepEqual(JSON.parse(fs.writes[1].data), { url: 'https://example.com/', title: '예시', at: 1234 });
    assert.deepEqual(fs.renames, [
        ['/workspace/.live-frame.jpg.tmp', '/workspace/.live-frame.jpg'],
        ['/workspace/.live-frame.json.tmp', '/workspace/.live-frame.json'],
    ]);
    assert.deepEqual(acks(cdp).map((c) => c.params), [{ sessionId: 7 }]);
});

test('간격 안의 두 번째 프레임은 쓰지 않지만 ack 는 보낸다', async () => {
    const { cdp, fs, writer } = setup({ times: [0, 300] });
    await writer.start();
    await cdp.emit('Page.screencastFrame', { data: FRAME, sessionId: 1 });
    await cdp.emit('Page.screencastFrame', { data: FRAME, sessionId: 2 });
    assert.equal(frameWrites(fs).length, 1);
    assert.equal(fs.writes.length, 2);
    assert.equal(acks(cdp).length, 2);
});

test('간격이 지나면 다시 쓴다', async () => {
    const { cdp, fs, writer } = setup({ times: [0, 800] });
    await writer.start();
    await cdp.emit('Page.screencastFrame', { data: FRAME, sessionId: 1 });
    await cdp.emit('Page.screencastFrame', { data: FRAME, sessionId: 2 });
    assert.equal(frameWrites(fs).length, 2);
});

test('파일 쓰기가 실패해도 throw 하지 않는다', async () => {
    const { cdp, writer } = setup({ times: [0, 800], failWrite: true });
    await writer.start();
    await cdp.emit('Page.screencastFrame', { data: FRAME, sessionId: 1 });
    await cdp.emit('Page.screencastFrame', { data: FRAME, sessionId: 2 });
    assert.equal(acks(cdp).length, 2);
});

test('startScreencast 가 실패해도 start 는 resolve 한다', async () => {
    const { writer } = setup({ failStart: true });
    await writer.start();
    await writer.stop();
});

test('stop 은 Page.stopScreencast 를 보내고 이후 프레임은 무시한다', async () => {
    const { cdp, fs, writer } = setup({ times: [0, 5000] });
    await writer.start();
    await writer.stop();
    assert.ok(cdp.calls.some((c) => c.method === 'Page.stopScreencast'));
    await cdp.emit('Page.screencastFrame', { data: FRAME, sessionId: 1 });
    assert.equal(fs.writes.length, 0);
});
