/**
 * extension-marketplace 판정 규칙의 이름 붙은 값 — 판정 버전·캐시 수명·사유 코드·정적 패턴.
 *
 * 규칙(코드·패턴·심각도)을 바꾸면 `VERDICT_VERSION` 을 올린다 — 캐시가 다음 요청에 다시 계산된다.
 *
 * @module addons/extension-marketplace/constants
 */

/** 판정 규칙 버전 — 규칙이 바뀌면 올린다 */
export const VERDICT_VERSION = 1;

/** 판정 캐시 수명(ms) — 기본 6시간. env 로 바꾼다(최소 1분) */
export const VERDICT_TTL_MS = Math.max(60_000, Number.parseInt(process.env.EXTENSION_VERDICT_TTL_MS || '', 10) || 6 * 60 * 60 * 1000);

export type Verdict = 'supported' | 'partial' | 'unsupported';

/**
 * 사유의 무게 — `blocking` 하나면 불가, `degrading` 하나면 부분 지원, `info` 는 판정을 바꾸지 않는다(배지 설명만).
 */
export type ReasonSeverity = 'blocking' | 'degrading' | 'info';

/** 사유 코드 → 무게. 새 사유는 여기에 한 줄(코드 분기 없음) */
export const REASON_SEVERITY = {
    // 설치 가능성(동기화 시점 판정)
    NOT_INSTALLABLE: 'blocking',
    INSTALLABILITY_UNKNOWN: 'degrading',
    // 스킬 본문의 외부 관용구(2026-09-21 외부 플러그인 설치 적응 조사 ①~⑤)
    SKILL_MCP_TOOL_IDIOM: 'degrading',
    SKILL_ASSET_OUTSIDE_DIR: 'degrading',
    SKILL_COMMAND_ASSETS_SKIPPED: 'degrading',
    SKILL_CLAUDE_DIR_PATH: 'degrading',
    SKILL_CLAUDE_INSTALL_GUIDE: 'info',
    SKILL_TOOL_UNSUPPORTED: 'degrading',
    SKILL_REQUIRED_TOOL_MISSING: 'degrading',
    SKILL_EXECUTION_BLOCKED: 'degrading',
    // 설치 리포트
    COMPONENTS_UNSUPPORTED: 'degrading',
    MCP_ENTRIES_SKIPPED: 'degrading',
    MCP_BLOCKED_BY_CONVENTION: 'degrading',
    ASSETS_SKIPPED: 'degrading',
    COMPONENTS_TRUNCATED: 'degrading',
    // MCP 런타임 관측
    MCP_TRANSPORT_SSE_DEPRECATED: 'degrading',
    MCP_EXT_APPS_UNSUPPORTED: 'degrading',
    MCP_EXT_TASKS_UNSUPPORTED: 'degrading',
    MCP_EXT_UNRECOGNIZED: 'info',
    MCP_SKILLS_PROVIDER: 'info',
    MCP_AUTH_DYNAMIC_REGISTRATION: 'info',
    MCP_PROTOCOL_MODERN: 'info',
    MCP_PROTOCOL_LEGACY: 'info',
    // 출처·평가 범위
    CROSS_REPO_SOURCE: 'info',
    CONTENT_NOT_EVALUATED: 'info',
} as const satisfies Record<string, ReasonSeverity>;

export type ReasonCode = keyof typeof REASON_SEVERITY;

/** 설치 리포트 경고 코드 → 판정 사유 */
export const WARNING_REASON_MAP: Readonly<Record<string, ReasonCode>> = {
    UNSUPPORTED_COMPONENTS: 'COMPONENTS_UNSUPPORTED',
    MCP_ENTRIES_SKIPPED: 'MCP_ENTRIES_SKIPPED',
    ASSET_BINARY_SKIPPED: 'ASSETS_SKIPPED',
    ASSET_TOO_LARGE: 'ASSETS_SKIPPED',
    ASSETS_BUDGET_EXCEEDED: 'ASSETS_SKIPPED',
    SKILL_SYMLINK_SKIPPED: 'ASSETS_SKIPPED',
    SKILLS_TRUNCATED: 'COMPONENTS_TRUNCATED',
    COMMANDS_TRUNCATED: 'COMPONENTS_TRUNCATED',
    AGENTS_TRUNCATED: 'COMPONENTS_TRUNCATED',
    MCP_SERVERS_TRUNCATED: 'COMPONENTS_TRUNCATED',
    ASSETS_TRUNCATED: 'COMPONENTS_TRUNCATED',
};

/** 설치 때 skill-compat 이 남긴 마커 → 판정 사유 */
export const MARKER_REASON_MAP: Readonly<Record<string, ReasonCode>> = {
    '.claude/': 'SKILL_CLAUDE_DIR_PATH',
    'install-guide': 'SKILL_CLAUDE_INSTALL_GUIDE',
};

/** 선언 확장 분류 → 판정 사유(MCP-5 분류값) */
export const EXTENSION_KIND_REASON_MAP: Readonly<Record<string, ReasonCode>> = {
    apps: 'MCP_EXT_APPS_UNSUPPORTED',
    tasks: 'MCP_EXT_TASKS_UNSUPPORTED',
    skills: 'MCP_SKILLS_PROVIDER',
    unknown: 'MCP_EXT_UNRECOGNIZED',
};

/** 본문 정적 패턴(설치 때 마커로 남지 않는 것) */
export const SKILL_BODY_PATTERNS: ReadonlyArray<{ code: ReasonCode; pattern: RegExp }> = [
    // Claude Code MCP 도구 표기 — 이 환경은 server::tool
    { code: 'SKILL_MCP_TOOL_IDIOM', pattern: /\bmcp__[A-Za-z0-9_-]+?__[A-Za-z0-9_-]+\b/ },
    // 스킬 디렉터리 밖 파일 참조 — 설치는 SKILL.md 자기 디렉터리의 scripts·references·assets 만 담는다
    { code: 'SKILL_ASSET_OUTSIDE_DIR', pattern: /(?:\]\(|[\s`'"(])\.\.\/[\w./-]+/ },
    // 마커가 없던 옛 설치본 대비 — .claude/ 경로 지시
    { code: 'SKILL_CLAUDE_DIR_PATH', pattern: /(?:^|[\s`'"(])\.claude\/[\w.-]/ },
];
