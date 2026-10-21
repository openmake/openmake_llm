/**
 * live-frame — browser 실행 중 화면을 작업 폴더의 숨김 파일에 덮어쓴다(agent-task 실시간 작업 화면).
 *
 * CDP Page.startScreencast 로 프레임을 받아 minIntervalMs 간격으로만 framePath(JPEG)·metaPath(JSON)에 쓴다.
 * 둘 다 `<path>.tmp` 에 쓴 뒤 rename 으로 교체해 읽는 쪽이 반쯤 쓴 파일을 보지 않게 한다.
 * 화면 전송은 부가 기능이다 — 어떤 실패도 throw 하지 않아 브라우저 액션·결과 JSON 에 영향을 주지 않는다(fail-open).
 */
import { writeFile, rename } from 'node:fs/promises';

const SCREENCAST_PARAMS = { format: 'jpeg', quality: 50, maxWidth: 1280, maxHeight: 800 };

export function createLiveFrameWriter({
    cdp, framePath, metaPath, minIntervalMs, getMeta,
    fs = { writeFile, rename },
    now = Date.now,
}) {
    let stopped = false;
    let writing = false;
    let lastWrittenAt = -Infinity;

    async function replace(path, data) {
        await fs.writeFile(`${path}.tmp`, data);
        await fs.rename(`${path}.tmp`, path);
    }

    async function onFrame({ data, sessionId }) {
        if (stopped) return;
        // ack 를 보내야 다음 프레임이 온다 — 쓰지 않는 프레임에도 항상 보낸다.
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
        const at = now();
        if (writing || at - lastWrittenAt < minIntervalMs) return; // 쓰기는 한 번에 하나, 간격 안이면 건너뜀
        writing = true;
        lastWrittenAt = at;
        try {
            await replace(framePath, Buffer.from(data, 'base64'));
            const { url, title } = await getMeta();
            await replace(metaPath, JSON.stringify({ url, title, at }));
        } catch { /* 화면 전송 실패는 무시 */ } finally {
            writing = false;
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
            try { await cdp.send('Page.stopScreencast'); } catch { /* 이미 닫힌 세션 */ }
        },
    };
}
