/**
 * live-frame 테스트 — `node --test infra/` 로 돈다(루트 npm test 에 포함).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFrameWriter } from './live-frame.mjs';

const FRAME = Buffer.from('jpeg-bytes').toString('base64');

/** 이벤트 핸들러를 저장하고 send 호출을 기록하는 가짜 CDP 세션. */
function fakeCdp({ failStart = false, capture = async () => ({}) } = {}) {
    const handlers = {};
    const calls = [];
    return {
        calls,
        on(event, fn) { handlers[event] = fn; },
        async send(method, params) {
            calls.push({ method, params });
            if (failStart && method === 'Page.startScreencast') throw new Error('cdp 실패');
            if (method === 'Page.captureScreenshot') return capture();
            return {};
        },
        /** 프레임 하나를 보내고 그 처리가 끝날 때까지 기다린다. */
        async emit(event, payload) { await handlers[event]?.(payload); },
    };
}

function fakeFs({ failWrite = false, gate = null } = {}) {
    const writes = [];
    const renames = [];
    return {
        writes,
        renames,
        async writeFile(p, data) {
            if (failWrite) throw new Error('디스크 가득');
            if (gate) await gate.promise;
            writes.push({ p, data });
        },
        async rename(a, b) { renames.push([a, b]); },
    };
}

/** 직접 돌릴 때까지 실행되지 않는 가짜 타이머. */
function fakeTimers() {
    const pending = new Map();
    let nextId = 1;
    return {
        pending,
        setTimeout(fn, ms) { const id = nextId++; pending.set(id, { fn, ms }); return id; },
        clearTimeout(id) { pending.delete(id); },
        /** 지금 걸린 타이머를 모두 실행하고 그 처리가 끝날 때까지 기다린다. */
        async runAll() {
            const due = [...pending.entries()];
            pending.clear();
            await Promise.all(due.map(([, { fn }]) => fn()));
        },
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

function setup({ times = [0], failStart = false, failWrite = false, capture, gate = null, clock = null } = {}) {
    const cdp = fakeCdp({ failStart, capture });
    const fs = fakeFs({ failWrite, gate });
    const timers = fakeTimers();
    let t = 0;
    let metaCalls = 0;
    const writer = createLiveFrameWriter({
        cdp,
        framePath: '/workspace/.live-frame.jpg',
        metaPath: '/workspace/.live-frame.json',
        minIntervalMs: 700,
        getMeta: async () => {
            metaCalls += 1;
            return metaCalls === 1
                ? { url: 'https://example.com/', title: '예시' }
                : { url: 'https://example.com/', title: `예시 ${metaCalls}` };
        },
        fs,
        now: clock ? () => clock.t : () => times[Math.min(t++, times.length - 1)],
        timers,
    });
    return { cdp, fs, writer, timers };
}

const acks = (cdp) => cdp.calls.filter((c) => c.method === 'Page.screencastFrameAck');
const frameWrites = (fs) => fs.writes.filter((w) => w.p === '/workspace/.live-frame.jpg.tmp');
const metaWrites = (fs) => fs.writes.filter((w) => w.p === '/workspace/.live-frame.json.tmp');
const frameOf = (text) => Buffer.from(text).toString('base64');
const lastFrameText = (fs) => frameWrites(fs).at(-1)?.data.toString();

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

test('간격 안에 건너뛴 마지막 프레임은 간격이 지나면 쓴다', async () => {
    const clock = { t: 0 };
    const { cdp, fs, writer, timers } = setup({ clock });
    await writer.start();
    await cdp.emit('Page.screencastFrame', { data: frameOf('A'), sessionId: 1 });
    clock.t = 300;
    await cdp.emit('Page.screencastFrame', { data: frameOf('B'), sessionId: 2 });
    assert.equal(lastFrameText(fs), 'A');
    assert.equal(timers.pending.size, 1);
    assert.equal([...timers.pending.values()][0].ms, 400); // 남은 간격만큼 기다린다

    clock.t = 700;
    await timers.runAll();
    assert.equal(frameWrites(fs).length, 2);
    assert.equal(lastFrameText(fs), 'B');
    assert.equal(JSON.parse(metaWrites(fs).at(-1).data).at, 300);
    assert.equal(acks(cdp).length, 2);
});

test('간격 안에 여러 프레임이 오면 가장 최근 것 하나만 쓴다', async () => {
    const clock = { t: 0 };
    const { cdp, fs, writer, timers } = setup({ clock });
    await writer.start();
    await cdp.emit('Page.screencastFrame', { data: frameOf('A'), sessionId: 1 });
    clock.t = 200;
    await cdp.emit('Page.screencastFrame', { data: frameOf('B'), sessionId: 2 });
    clock.t = 400;
    await cdp.emit('Page.screencastFrame', { data: frameOf('C'), sessionId: 3 });
    assert.equal(timers.pending.size, 1);
    clock.t = 700;
    await timers.runAll();
    assert.deepEqual(frameWrites(fs).map((w) => w.data.toString()), ['A', 'C']);
});

test('쓰는 중에 온 프레임은 쓰기가 끝난 뒤 쓴다', async () => {
    const clock = { t: 0 };
    const gate = deferred();
    const { cdp, fs, writer, timers } = setup({ clock, gate });
    await writer.start();
    const first = cdp.emit('Page.screencastFrame', { data: frameOf('A'), sessionId: 1 });
    clock.t = 800; // 간격은 지났지만 A 를 쓰는 중
    await cdp.emit('Page.screencastFrame', { data: frameOf('B'), sessionId: 2 });
    assert.equal(frameWrites(fs).length, 0);

    clock.t = 900;
    gate.resolve();
    await first;
    await timers.runAll();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(frameWrites(fs).map((w) => w.data.toString()), ['A', 'B']);
});

test('stop 은 captureScreenshot 결과를 간격과 상관없이 쓴다', async () => {
    const clock = { t: 0 };
    const { cdp, fs, writer } = setup({ clock, capture: async () => ({ data: frameOf('FINAL') }) });
    await writer.start();
    await cdp.emit('Page.screencastFrame', { data: frameOf('LOADING'), sessionId: 1 });
    clock.t = 10; // 마지막 쓰기 직후
    await writer.stop();

    const capture = cdp.calls.find((c) => c.method === 'Page.captureScreenshot');
    assert.deepEqual(capture.params, { format: 'jpeg', quality: 50 });
    assert.equal(lastFrameText(fs), 'FINAL');
    assert.deepEqual(JSON.parse(metaWrites(fs).at(-1).data), { url: 'https://example.com/', title: '예시 2', at: 10 });
    const methods = cdp.calls.map((c) => c.method);
    assert.ok(methods.indexOf('Page.captureScreenshot') < methods.indexOf('Page.stopScreencast'));
});

test('stop 은 진행 중인 쓰기가 끝난 뒤 마지막 화면을 쓴다', async () => {
    const clock = { t: 0 };
    const gate = deferred();
    const { cdp, fs, writer } = setup({ clock, gate, capture: async () => ({ data: frameOf('FINAL') }) });
    await writer.start();
    const first = cdp.emit('Page.screencastFrame', { data: frameOf('A'), sessionId: 1 });
    const stopping = writer.stop();
    gate.resolve();
    await Promise.all([first, stopping]);
    assert.deepEqual(frameWrites(fs).map((w) => w.data.toString()), ['A', 'FINAL']);
});

test('captureScreenshot 이 실패하면 대기 프레임을 쓰고, 그것도 없으면 아무것도 쓰지 않으며 throw 하지 않는다', async () => {
    const failing = async () => { throw new Error('세션 닫힘'); };

    const clock = { t: 0 };
    const withPending = setup({ clock, capture: failing });
    await withPending.writer.start();
    await withPending.cdp.emit('Page.screencastFrame', { data: frameOf('A'), sessionId: 1 });
    clock.t = 300;
    await withPending.cdp.emit('Page.screencastFrame', { data: frameOf('B'), sessionId: 2 });
    await withPending.writer.stop();
    assert.equal(lastFrameText(withPending.fs), 'B');
    assert.ok(withPending.cdp.calls.some((c) => c.method === 'Page.stopScreencast'));

    const empty = setup({ capture: failing });
    await empty.writer.start();
    await empty.writer.stop();
    assert.equal(empty.fs.writes.length, 0);
    assert.ok(empty.cdp.calls.some((c) => c.method === 'Page.stopScreencast'));
});

test('stop 뒤에는 대기 타이머가 남지 않는다', async () => {
    const clock = { t: 0 };
    const { cdp, writer, timers } = setup({ clock });
    await writer.start();
    await cdp.emit('Page.screencastFrame', { data: frameOf('A'), sessionId: 1 });
    clock.t = 300;
    await cdp.emit('Page.screencastFrame', { data: frameOf('B'), sessionId: 2 });
    assert.equal(timers.pending.size, 1);
    await writer.stop();
    assert.equal(timers.pending.size, 0);
});

test('captureScreenshot 이 응답하지 않아도 stop 은 상한 시간에 끝난다', async () => {
    const { cdp, writer, timers } = setup({ capture: () => new Promise(() => {}) });
    await writer.start();
    let done = false;
    const stopping = writer.stop().then(() => { done = true; });
    await new Promise((r) => setImmediate(r));
    assert.equal(done, false);
    const limit = [...timers.pending.values()].map((x) => x.ms);
    assert.deepEqual(limit, [2000]);
    await timers.runAll();
    await stopping;
    assert.ok(cdp.calls.some((c) => c.method === 'Page.stopScreencast'));
    assert.equal(timers.pending.size, 0);
});
