/**
 * Agent Task 실시간 작업 화면 설정 — 실행 중 브라우저 화면·터미널 출력을 작업 폴더 숨김 파일로 남겨 조회한다.
 *
 * 브라우저 러너(infra/task-runtime/browser-runner.mjs)는 spec 의 `live` 를 읽어 화면 프레임을 쓴다.
 * 파일 셋은 작업 변경분(diff)에서 빠진다(config/agent-task-tools CODE_DIFF_INTERNAL_FILES).
 *
 * @module config/agent-task-live-view
 */
function intEnv(raw: string | undefined, def: number): number {
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

export const LIVE_VIEW = {
    /** 마스터 스위치 — TASK_SANDBOX_LIVE_VIEW=false 면 끈다. */
    ENABLED: process.env.TASK_SANDBOX_LIVE_VIEW !== 'false',
    /** 최신 화면 프레임(JPEG) — 작업 폴더 기준. */
    FRAME_FILE: '.live-frame.jpg',
    /** 프레임 메타(주소·제목·시각) — 작업 폴더 기준. */
    META_FILE: '.live-frame.json',
    /** 터미널 출력 꼬리 — 작업 폴더 기준. */
    TERMINAL_FILE: '.live-terminal.json',
    /** 프레임을 다시 쓰는 최소 간격(ms). */
    FRAME_MIN_INTERVAL_MS: intEnv(process.env.TASK_SANDBOX_LIVE_FRAME_INTERVAL_MS, 700),
    /** 조회로 내보내는 프레임 크기 상한(byte). */
    FRAME_MAX_BYTES: intEnv(process.env.TASK_SANDBOX_LIVE_FRAME_MAX_BYTES, 2 * 1024 * 1024),
    /** 터미널 기록에 남기는 출력 꼬리 길이(자). */
    TERMINAL_TAIL_CHARS: intEnv(process.env.TASK_SANDBOX_LIVE_TERMINAL_TAIL_CHARS, 16000),
    /** 터미널 기록 파일을 다시 쓰는 최소 간격(ms). */
    TERMINAL_WRITE_MS: intEnv(process.env.TASK_SANDBOX_LIVE_TERMINAL_WRITE_MS, 500),
} as const;

/** 브라우저 러너 spec 의 `live` 값 — 꺼져 있으면 null(러너는 문자열 경로가 있을 때만 켠다). */
export function liveFrameSpec(): { framePath: string; metaPath: string; minIntervalMs: number } | null {
    if (!LIVE_VIEW.ENABLED) return null;
    return { framePath: LIVE_VIEW.FRAME_FILE, metaPath: LIVE_VIEW.META_FILE, minIntervalMs: LIVE_VIEW.FRAME_MIN_INTERVAL_MS };
}
