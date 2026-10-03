/**
 * 브라우저·웹·MCP 영역 설정 (hermes 도입 2단계) — No-Hardcoding L1/L2.
 *
 * 영역 전용 파일이다 — 공용 설정 파일(runtime-limits·task-sandbox)에 줄을 더하지 않으려고 따로 둔다.
 *
 * @module config/agent-task-browser-web
 */

import { BROWSER_URL_GUARD_ENABLED } from './task-sandbox';

function intEnv(raw: string | undefined, def: number): number {
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

/** 에이전트 browser 도구의 일회성 컨테이너 실행. */
export const BROWSER_RUN = {
    /**
     * 일회성 브라우저 컨테이너 이름 접두 — 뒤에 작업 id 와 호출마다 다른 꼬리가 붙는다.
     * 영속 샌드박스(omk-task-)·넘겨받기 세션(omk-browser-)의 이름 필터에 걸리지 않는 값이어야 한다
     * (docker 의 name 필터는 부분 일치다 — 걸리면 동시 실행 상한 집계에 섞인다).
     */
    CONTAINER_PREFIX: 'omk-brun-',
    /** 브라우저 한 번 실행의 최소 상한(ms) — 명령 상한(TASK_SANDBOX_EXEC_TIMEOUT_MS)이 더 짧아도 이만큼은 준다. */
    MIN_TIMEOUT_MS: intEnv(process.env.TASK_SANDBOX_BROWSER_MIN_TIMEOUT_MS, 90_000),
    /**
     * 실행이 끝난 뒤 넘겨받기(Take control) 여부를 다시 확인해, 그 사이 사용자가 넘겨받았으면 결과를 버린다.
     * 호출마다 `docker inspect` 한 번이 더 든다. TASK_SANDBOX_BROWSER_TAKEOVER_RECHECK=false 로 끈다.
     */
    TAKEOVER_RECHECK_ENABLED: process.env.TASK_SANDBOX_BROWSER_TAKEOVER_RECHECK !== 'false',
} as const;

/** 브라우저 실행 결과 검사(services/task-sandbox/browser-result-guard). */
export const BROWSER_RESULT_GUARD = {
    /**
     * 도착한 주소(리다이렉트 뒤)를 목적지 가드로 다시 검사해, 막힌 주소면 결과 본문을 모델에 주지 않는다.
     * 실행 전 검사(TASK_SANDBOX_BROWSER_URL_GUARD)가 꺼져 있으면 같이 꺼진다.
     * TASK_SANDBOX_BROWSER_REDIRECT_GUARD=false 로 이것만 끈다.
     */
    REDIRECT_GUARD_ENABLED: BROWSER_URL_GUARD_ENABLED && process.env.TASK_SANDBOX_BROWSER_REDIRECT_GUARD !== 'false',
} as const;

/**
 * 봇 차단·캡차 확인 화면 감지(browser-result-guard.looksBotBlocked) — 결정적 패턴.
 * 러너는 페이지 제목을 돌려주지 않으므로 추출된 본문(extractText·extractHtml)에서 본다.
 */
export const BROWSER_BOT_BLOCK = {
    /** 감지되면 결과 뒤에 경고를 붙인다. TASK_SANDBOX_BROWSER_BOT_NOTICE=false 로 끈다. */
    NOTICE_ENABLED: process.env.TASK_SANDBOX_BROWSER_BOT_NOTICE !== 'false',
    /** 본문 텍스트는 이 길이 이하일 때만 본다 — 차단 화면은 짧고, 긴 글에 같은 낱말이 있는 경우를 거른다. */
    SHORT_TEXT_MAX_CHARS: intEnv(process.env.TASK_SANDBOX_BROWSER_BOT_TEXT_MAX_CHARS, 1500),
    /** 차단·확인 화면의 문구 — 짧은 본문과 HTML 제목에 적용한다. */
    TEXT_PATTERNS: [
        /just a moment/i,
        /checking your browser/i,
        /attention required/i,
        /verify (that )?you are (a )?human/i,
        /are you a robot/i,
        /unusual traffic/i,
        /access (to this page has been )?denied/i,
        /bot detected/i,
        /ddos protection/i,
        /captcha/i,
        /로봇이 아닙니다/,
        /보안 ?문자/,
        /자동 ?입력 ?방지/,
        /비정상적인 (접근|트래픽)/,
    ] as readonly RegExp[],
    /** 차단 서비스가 확인 화면에 넣는 표지(HTML 어디에 있든) — 일반 로그인 폼의 캡차 위젯(g-recaptcha 등)은 넣지 않는다. */
    HTML_MARKERS: [
        /cf-chl-/,
        /\/cdn-cgi\/challenge-platform\//,
        /px-captcha/,
        /captcha-delivery\.com/,
        /_Incapsula_Resource/,
    ] as readonly RegExp[],
} as const;

/** 외부 MCP 도구 스키마 정규화(addons/mcp-runtime/tool-schema). */
export const MCP_TOOL_SCHEMA = {
    /**
     * 스키마의 로컬 `$ref` 를 최상위 정의(`$defs`·`definitions`) 내용으로 풀어 넣는다 — 내부 스키마는 최상위 정의를
     * 싣지 않아, 풀지 않으면 참조가 끊긴다. MCP_SCHEMA_INLINE_REFS=false 로 끈다(종전 동작).
     */
    INLINE_REFS_ENABLED: process.env.MCP_SCHEMA_INLINE_REFS !== 'false',
    /** 참조 안의 참조를 따라가는 깊이 상한 — 넘으면 그 참조는 풀지 않는다(스키마가 부풀지 않게). */
    REF_MAX_DEPTH: intEnv(process.env.MCP_SCHEMA_REF_MAX_DEPTH, 8),
} as const;
