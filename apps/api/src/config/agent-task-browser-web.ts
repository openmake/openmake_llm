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
    /** 본문 텍스트는 이 길이 이하일 때만 본다 — 차단 화면은 짧고, 긴 글에 같은 문구가 있는 경우를 거른다. */
    SHORT_TEXT_MAX_CHARS: intEnv(process.env.TASK_SANDBOX_BROWSER_BOT_TEXT_MAX_CHARS, 1500),
    /** 첫 줄(제목 자리) 문구로 판정할 때의 본문 길이 상한 — 제목만으로는 약한 근거라 더 짧은 본문에만 쓴다. */
    HEADING_TEXT_MAX_CHARS: intEnv(process.env.TASK_SANDBOX_BROWSER_BOT_HEADING_MAX_CHARS, 400),
    /**
     * 차단·확인 화면에만 나오는 문구 — 짧은 본문 어디에 있든, HTML 제목에 있든 차단으로 본다.
     * captcha·access denied 같은 낱말 하나는 넣지 않는다(캡차 설명 글·오류 안내 문서·로그인 폼이 걸린다).
     */
    TEXT_PATTERNS: [
        /checking your browser/i,
        /verify(ing)? (that )?you are (a )?human/i,
        /are you a robot\?/i,
        // "unusual traffic" 만으로는 그 메시지를 설명하는 고객센터 글의 제목이 걸린다(2026-10-04 실측) — 확인 화면의 문장으로 좁힌다
        /detected unusual traffic/i,
        /access to this page has been denied/i,
        /press (&|and) hold/i,
        /complete the security check to access/i,
        /ddos protection by/i,
        /incapsula incident id/i,
        // Akamai 차단 화면의 참조 번호
        /access denied[\s\S]{0,300}reference\s*#\s*[0-9a-f]+\.[0-9a-f]+\./i,
        /비정상적인 (접근|트래픽)(이|을)? ?감지/,
        // DataDome 확인 화면의 본문(2026-10-04 실측)
        /please enable js and disable any ad blocker/i,
    ] as readonly RegExp[],
    /**
     * 제목 자리의 문구 — HTML 제목이거나, 본문의 첫 줄이면서 본문이 HEADING_TEXT_MAX_CHARS 이하일 때만 차단으로 본다.
     * 영문은 줄 전체가 맞아야 한다("Access Denied errors explained" 같은 문서 제목을 거른다).
     */
    HEADING_PATTERNS: [
        /^just a moment[.…]*$/i,
        /^attention required!?(\s*\|\s*cloudflare)?$/i,
        /^access denied[.!]?$/i,
        /^one more step$/i,
        /^bot detected[.!]?$/i,
        /^로봇이 아닙니다/,
        /^(보안 ?문자|자동 ?입력 ?방지)/,
    ] as readonly RegExp[],
    /** 차단 서비스가 확인 화면에 넣는 표지(HTML 어디에 있든) — 일반 로그인 폼의 캡차 위젯(g-recaptcha 등)은 넣지 않는다. */
    HTML_MARKERS: [
        /cf-chl-/,
        // 확인 화면의 스크립트 경로만 — 같은 폴더의 scripts/jsd/main.js 는 Cloudflare 뒤의 정상 페이지에도 붙는다(2026-10-04 실측)
        /\/cdn-cgi\/challenge-platform\/h\/[a-z]\/orchestrate\//,
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

/** MCP 결과의 이미지·오디오 블록 처리(addons/mcp-runtime/media-content). */
export const MCP_MEDIA = {
    /**
     * 이미지·오디오 블록의 base64 를 도구 결과 본문에 싣지 않는다 — 작업 공간이 있으면 파일로 저장해 경로를 적고,
     * 없으면 건수·종류·크기만 적는다. MCP_MEDIA_OFFLOAD_ENABLED=false 로 끈다(종전 동작).
     */
    OFFLOAD_ENABLED: process.env.MCP_MEDIA_OFFLOAD_ENABLED !== 'false',
    /** 저장하는 작업 공간 하위 디렉터리 — 숨김이 아니라 산출물 목록에 나온다(도구가 만든 이미지는 결과물이다). */
    DIR: 'mcp-media',
    /** 파일 하나의 저장 상한(byte) — 넘으면 저장하지 않고 생략 안내만 적는다(작업 공간 쿼터 보호). */
    MAX_SAVE_BYTES: intEnv(process.env.MCP_MEDIA_MAX_SAVE_BYTES, 20 * 1024 * 1024),
    /** MIME → 확장자. 표에 없으면 bin. */
    EXT_BY_MIME: {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'audio/wav': 'wav',
        'audio/x-wav': 'wav',
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/ogg': 'ogg',
        'audio/flac': 'flac',
        'audio/webm': 'webm',
        'audio/mp4': 'm4a',
    } as Readonly<Record<string, string>>,
} as const;

/** web_search 결과 메모(tools/web-search/search-memo) — 프로세스 메모리, 사용자·조직 범위. */
export const WEB_SEARCH_MEMO = {
    /** 같은 사용자·같은 질의를 기억하고 동시 호출을 합친다. WEB_SEARCH_MEMO_ENABLED=false 로 끈다. */
    ENABLED: process.env.WEB_SEARCH_MEMO_ENABLED !== 'false',
    /** 기억하는 시간(ms) — 기본 20분. 길수록 뉴스·시세 같은 질의가 낡은 결과를 받는다. */
    TTL_MS: intEnv(process.env.WEB_SEARCH_MEMO_TTL_MS, 20 * 60_000),
    /** 기억하는 질의 수 상한 — 넘으면 오래된 것부터 버린다. */
    MAX_ENTRIES: intEnv(process.env.WEB_SEARCH_MEMO_MAX_ENTRIES, 200),
} as const;
