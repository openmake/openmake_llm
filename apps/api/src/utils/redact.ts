/**
 * 공유용 텍스트 정화(redaction) — 결정적 규칙만. LLM 재작성 없음(판단 경계 A형 회피).
 *
 * 에이전트 작업 기록에는 절대경로·셸 출력·자격증명 흔적이 섞인다(2026-08-26 실측: 전체
 * 4,643 스텝 중 절대경로 113건·자격증명 패턴 250건·홈 경로 16건). 이 모듈은 그 표면을
 * 줄이지만 **완전하지 않다** — 안전의 본선은 공유 흐름의 "미리보기 + 명시 확인 + 게시 시점
 * 스냅샷"이다(plan `2026-08-26-agent-task-share-plan.md` §4).
 *
 * PURE — DB·env·시간에 의존하지 않는다(단위테스트/회귀 코퍼스 대상).
 *
 * @module utils/redact
 */

/** 자격증명 형태 — 값 자체를 지운다. 키 이름은 남겨 맥락을 보존한다. */
const CREDENTIAL_PATTERNS: { re: RegExp; to: string }[] = [
    // 우리 API key / OpenAI / GitHub / Slack / AWS access key
    { re: /\bomk_live_[A-Za-z0-9_-]{6,}/g, to: '<redacted:api-key>' },
    { re: /\bsk-[A-Za-z0-9_-]{16,}/g, to: '<redacted:api-key>' },
    { re: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, to: '<redacted:token>' },
    { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, to: '<redacted:token>' },
    { re: /\bAKIA[0-9A-Z]{16}\b/g, to: '<redacted:aws-key>' },
    // JWT (헤더.페이로드.서명)
    { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, to: '<redacted:jwt>' },
    // Authorization 헤더 값
    { re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, to: '$1 <redacted>' },
];

/** `SOME_KEY=값` / `"api_key": "값"` 형태 — 키 이름은 유지하고 값만 가린다. */
const ASSIGNMENT_PATTERNS: { re: RegExp; to: string }[] = [
    // ENV 대입: 키에 KEY/TOKEN/SECRET/PASSWORD/PASSWD/PWD 가 들어간 경우만
    {
        re: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD))=(?!<redacted)\S+/g,
        to: '$1=<redacted>',
    },
    // JSON/객체 표기: "apiKey": "값"
    {
        re: /(["']?[A-Za-z_][A-Za-z0-9_]*(?:[Kk]ey|[Tt]oken|[Ss]ecret|[Pp]assword)["']?\s*[:=]\s*)["'][^"']{6,}["']/g,
        to: '$1"<redacted>"',
    },
];

/** 이메일 — 소유자 본인 것도 공유본에 남길 이유가 없다. */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** 홈 디렉토리 절대경로 — macOS/Linux. */
const HOME_RE = /\/(?:Users|home)\/[^/\s"']+/g;

/** worktree 경로 조각 — `.openmake/worktrees/<uuid>/` 를 떼어 레포 상대경로로 만든다. */
const WORKTREE_RE = /(?:^|\/)?\.openmake\/worktrees\/[0-9a-f-]{8,}\//g;

/**
 * 남은 절대경로 — 마지막 세그먼트만 남기고 앞을 접는다.
 * ⚠️ lookbehind 에 `/` 와 `:` 를 포함해야 한다 — 없으면 `https://host/a/b/c.md` 의 경로 부분이
 * 걸려 URL 이 `https:/<path>/c.md` 로 깨진다(회귀 테스트로 고정).
 */
const ABS_PATH_RE = /(?<![\w~:/])\/(?:[\w.@+-]+\/){2,}([\w.@+-]+)/g;

export interface RedactOptions {
    /** 이 경로 이하를 상대경로로 만든다(레포/워크스페이스 루트). 없으면 생략. */
    rootPath?: string | null;
}

/**
 * 공유 텍스트 1건 정화. 순서가 중요하다 — worktree/홈/루트를 먼저 접어야
 * 뒤의 절대경로 규칙이 이미 상대화된 경로를 다시 건드리지 않는다.
 */
export function redactText(input: string, opts: RedactOptions = {}): string {
    if (!input) return input;
    let out = input;

    // 1) 경로 상대화 — 구체적인 것부터
    out = out.replace(WORKTREE_RE, '');
    if (opts.rootPath) {
        // 정규식 메타문자를 이스케이프해 리터럴로 치환
        const escaped = opts.rootPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(`${escaped}/?`, 'g'), '');
    }
    out = out.replace(HOME_RE, '~');

    // 2) 자격증명 — 대입 형태를 먼저 처리해 `KEY=<redacted>` 로 키 맥락을 남기고,
    //    그 다음 남은 날 토큰(맨몸 값·헤더)을 종류별로 마스킹한다.
    for (const { re, to } of ASSIGNMENT_PATTERNS) out = out.replace(re, to);
    for (const { re, to } of CREDENTIAL_PATTERNS) out = out.replace(re, to);

    // 3) 남은 절대경로 접기 — 위에서 상대화되지 않은 시스템 경로(/private/tmp/... 등)
    out = out.replace(ABS_PATH_RE, '<path>/$1');

    // 4) 이메일
    out = out.replace(EMAIL_RE, '<email>');

    return out;
}

/** 길이 캡 — 공유 문서가 통째로 커지는 것을 막는다. 잘리면 표시를 남긴다. */
export function capText(input: string, max: number): string {
    if (!input || input.length <= max) return input;
    return `${input.slice(0, max)}… (${input.length}자 중 ${max}자)`;
}
