/**
 * live-frame — browser 실행 중 화면을 작업 폴더의 숨김 파일에 덮어쓴다(agent-task 실시간 작업 화면).
 *
 * CDP Page.startScreencast 로 프레임을 받아 minIntervalMs 간격으로만 framePath(JPEG)·metaPath(JSON)에 쓴다.
 * 둘 다 `<path>.tmp` 에 쓴 뒤 rename 으로 교체해 읽는 쪽이 반쯤 쓴 파일을 보지 않게 한다.
 * 화면 전송은 부가 기능이다 — 어떤 실패도 throw 하지 않아 브라우저 액션·결과 JSON 에 영향을 주지 않는다(fail-open).
 */
import { writeFile, rename } from 'node:fs/promises';

const SCREENCAST_PARAMS = { format: 'jpeg', quality: 50, maxWidth: 1280, maxHeight: 800 };
// stop 때 남기는 마지막 화면 — screencast 와 같은 형식·품질.
const FINAL_CAPTURE_PARAMS = { format: SCREENCAST_PARAMS.format, quality: SCREENCAST_PARAMS.quality };
// stop 이 마지막 화면 캡처·쓰기를 기다리는 상한 — 넘기면 화면 없이 브라우저 정리로 넘어간다.
const FINAL_CAPTURE_TIMEOUT_MS = 2000;
// stop 이 Page.stopScreencast 응답을 기다리는 상한 — CDP 가 걸려도 browser.close 를 막지 않게.
const STOP_SCREENCAST_TIMEOUT_MS = 1000;

export function createLiveFrameWriter({
    cdp, framePath, metaPath, minIntervalMs, getMeta,
    fs = { writeFile, rename },
    now = Date.now,
    timers = { setTimeout, clearTimeout },
}) {
    let stopped = false;
    let lastWrittenAt = -Infinity;
    let inflight = null; // 진행 중인 쓰기(한 번에 하나)
    let pending = null; // 간격 안이거나 쓰는 중이라 미룬 가장 최근 프레임 { data, at }
    let timer = null;
    let finalWriteAbandoned = false; // 마지막 화면 상한이 지났다 — 늦게 온 캡처는 쓰지 않는다

    async function replace(path, data) {
        await fs.writeFile(`${path}.tmp`, data);
        await fs.rename(`${path}.tmp`, path);
    }

    async function writeFrame({ data, at }) {
        try {
            await replace(framePath, Buffer.from(data, 'base64'));
            const { url, title } = await getMeta();
            await replace(metaPath, JSON.stringify({ url, title, at }));
        } catch { /* 화면 전송 실패는 무시 */ }
    }

    // 간격 판정은 실제 쓰기 시각(writtenAt) 기준, meta 의 at 은 프레임 도착 시각.
    async function write(frame, writtenAt) {
        lastWrittenAt = writtenAt;
        inflight = writeFrame(frame);
        await inflight;
        inflight = null;
        schedulePending(); // 쓰는 중에 온 프레임이 있으면 이어서 쓴다
    }

    /** 대기 프레임을 간격이 지나면 쓰도록 건다 — 이미 지났으면 바로 쓴다. */
    function schedulePending() {
        if (stopped || !pending || timer || inflight) return;
        const at = now();
        const remaining = lastWrittenAt + minIntervalMs - at;
        if (remaining <= 0) {
            flushPending(at);
            return;
        }
        timer = timers.setTimeout(() => {
            timer = null;
            return flushPending(now());
        }, remaining);
    }

    function flushPending(writtenAt) {
        if (stopped || !pending || inflight) return undefined;
        const frame = pending;
        pending = null;
        return write(frame, writtenAt);
    }

    async function onFrame({ data, sessionId }) {
        if (stopped) return;
        // ack 를 보내야 다음 프레임이 온다 — 쓰지 않는 프레임에도 항상 보낸다.
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
        const at = now();
        if (inflight || at - lastWrittenAt < minIntervalMs) {
            // 버리지 않고 가장 최근 것 하나만 남겨 둔다 — 화면 변화가 멈춰도 마지막 장면이 써지게.
            pending = { data, at };
            schedulePending();
            return;
        }
        await write({ data, at }, at);
    }

    /** 현재 화면을 한 장 받아 간격과 상관없이 쓴다 — 실패하면 대기 프레임, 그것도 없으면 그대로 둔다. */
    async function writeFinalFrame() {
        if (inflight) await inflight;
        if (finalWriteAbandoned) return;
        let captured = null;
        try {
            const result = await cdp.send('Page.captureScreenshot', FINAL_CAPTURE_PARAMS);
            if (result?.data) captured = { data: result.data, at: now() };
        } catch { /* 캡처 실패 — 대기 프레임으로 대신한다 */ }
        if (finalWriteAbandoned) return; // stop 이 이미 반환했다 — 늦은 쓰기 금지
        const frame = captured ?? pending;
        pending = null;
        if (frame) await writeFrame(frame);
    }

    /** promise 를 ms 까지만 기다린다 — 거부·시간 초과 모두 삼키고, 시간 초과면 onTimeout 을 부른다. */
    async function waitWithin(promise, ms, onTimeout = () => {}) {
        let limit = null;
        try {
            await Promise.race([
                promise,
                new Promise((resolve) => {
                    limit = timers.setTimeout(() => { onTimeout(); resolve(); }, ms);
                }),
            ]);
        } catch { /* fail-open */ } finally {
            timers.clearTimeout(limit);
        }
    }

    return {
        async start() {
            try {
                cdp.on('Page.screencastFrame', onFrame);
                await cdp.send('Page.startScreencast', SCREENCAST_PARAMS);
            } catch { /* 화면 전송 없이 진행 */ }
        },
        async stop() {
            stopped = true;
            if (timer) timers.clearTimeout(timer);
            timer = null;
            // 짧은 실행은 screencast 가 로딩 장면에서 멈춰 있을 수 있어 마지막 화면을 직접 남긴다(상한 안에서만).
            await waitWithin(writeFinalFrame(), FINAL_CAPTURE_TIMEOUT_MS, () => { finalWriteAbandoned = true; });
            // 이미 닫힌 세션이면 거부되고, CDP 가 걸리면 상한에서 끊는다.
            await waitWithin(cdp.send('Page.stopScreencast'), STOP_SCREENCAST_TIMEOUT_MS);
        },
    };
}
