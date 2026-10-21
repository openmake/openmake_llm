/**
 * 실시간 작업 화면 읽기 — 작업 폴더의 숨김 파일(LIVE_VIEW.FRAME_FILE·META_FILE·TERMINAL_FILE)을 안전하게 읽는다.
 *
 * 에이전트 bash 는 작업 폴더를 마음대로 쓸 수 있다 — 숨김 파일을 심링크·거대 파일·FIFO·깨진 JSON·틀린 타입으로
 * 바꿀 수 있다고 가정한다. 실경로 검사(safeRealWorkspacePath)로 폴더 밖을 거부하고, O_NOFOLLOW·O_NONBLOCK 으로
 * 열어(검사 뒤 심링크로 바꿔치기·FIFO 대기 차단) 연 파일의 fstat 으로 종류·크기를 읽기 전에 확인한다.
 * 어떤 실패든 예외가 아니라 그 부분을 null 로 떨어뜨린다.
 *
 * @module services/task-sandbox/live-view
 */
import { open, constants } from 'fs/promises';
import { safeRealWorkspacePath } from './sandbox';
import type { LiveTerminalState } from './live-terminal';
import { LIVE_VIEW } from '../../config/agent-task-live-view';

/** 프레임 메타 주소의 길이 상한(자). */
const META_URL_MAX_CHARS = 2000;
/** 프레임 메타 제목의 길이 상한(자). */
const META_TITLE_MAX_CHARS = 300;
/** JSON 숨김 파일(meta·terminal)의 크기 상한(byte) — 출력 꼬리(자)에 UTF-8·JSON 이스케이프 여유를 둔다. */
const JSON_MAX_BYTES = 1024 * 1024;

export interface LiveViewData {
    /** image = JPEG base64 — 이미지가 없거나 상한을 넘으면 null(메타는 남는다). */
    browser: { image: string | null; url: string; title: string; at: number } | null;
    terminal: LiveTerminalState | null;
}

/** 작업 폴더 안의 일반 파일을 maxBytes 이하일 때만 읽는다 — 아니면 null. */
async function readBounded(hostWorkdir: string, rel: string, maxBytes: number): Promise<Buffer | null> {
    try {
        const real = await safeRealWorkspacePath(hostWorkdir, rel);
        const fh = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const st = await fh.stat();
            if (!st.isFile() || st.size > maxBytes) return null;
            const buf = Buffer.alloc(st.size);
            const { bytesRead } = await fh.read(buf, 0, st.size, 0);
            return buf.subarray(0, bytesRead);
        } finally {
            await fh.close();
        }
    } catch {
        return null;
    }
}

async function readJson(hostWorkdir: string, rel: string): Promise<Record<string, unknown> | null> {
    const buf = await readBounded(hostWorkdir, rel, JSON_MAX_BYTES);
    if (!buf) return null;
    try {
        const v: unknown = JSON.parse(buf.toString('utf8'));
        return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);

function toTerminal(j: Record<string, unknown> | null): LiveTerminalState | null {
    if (!j || typeof j.command !== 'string' || typeof j.output !== 'string' || typeof j.truncatedHead !== 'boolean'
        || !isNum(j.startedAt) || !isNumOrNull(j.endedAt) || !isNumOrNull(j.exitCode)) return null;
    // 에이전트가 파일을 부풀려도 응답이 커지지 않게 꼬리 길이로 다시 자른다
    const cut = j.output.length > LIVE_VIEW.TERMINAL_TAIL_CHARS;
    return {
        command: j.command,
        output: cut ? j.output.slice(-LIVE_VIEW.TERMINAL_TAIL_CHARS) : j.output,
        truncatedHead: j.truncatedHead || cut,
        startedAt: j.startedAt, endedAt: j.endedAt, exitCode: j.exitCode,
    };
}

export async function readLiveView(hostWorkdir: string): Promise<LiveViewData> {
    const [meta, image, terminal] = await Promise.all([
        readJson(hostWorkdir, LIVE_VIEW.META_FILE),
        readBounded(hostWorkdir, LIVE_VIEW.FRAME_FILE, LIVE_VIEW.FRAME_MAX_BYTES),
        readJson(hostWorkdir, LIVE_VIEW.TERMINAL_FILE),
    ]);
    const browser = meta && typeof meta.url === 'string' && typeof meta.title === 'string' && isNum(meta.at)
        ? {
            image: image && image.length > 0 ? image.toString('base64') : null,
            url: meta.url.slice(0, META_URL_MAX_CHARS),
            title: meta.title.slice(0, META_TITLE_MAX_CHARS),
            at: meta.at,
        }
        : null;
    return { browser, terminal: toTerminal(terminal) };
}
