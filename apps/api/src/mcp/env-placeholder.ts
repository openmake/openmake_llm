/**
 * MCP env 플레이스홀더 판정 (순수 함수).
 *
 * 외부 플러그인의 `mcpServers[].env` 는 값을 비워 두고 자리표시자만 적는 관용이 있다:
 *   - `"${API_KEY}"`              — 셸/환경변수 스타일
 *   - `"${user_config.api_key}"`  — Claude Code `userConfig` 참조
 *   - `""`                        — 빈 값
 *
 * 이 환경은 그 값을 채워 주는 주입 경로가 없으므로, **자리표시자인 채로 승인되면
 * 서버는 뜨지만 인증이 전부 실패한다** — 오류도 경고도 없이 도구만 안 되는
 * 전형적인 조용한 실패다. 승인 화면에서 실제 값을 받기 위해 어떤 키가 비어 있는지
 * 먼저 알아내는 것이 이 모듈의 역할이다.
 *
 * ⚠️ 판정은 **값 전체가** 자리표시자인 경우로 한정한다. `"Bearer ${TOKEN}"` 처럼
 * 부분 치환이 섞인 값을 필수 입력으로 올리면 이미 의미 있는 접두사를 사용자가
 * 통째로 다시 써야 한다.
 *
 * @module mcp/env-placeholder
 */

/** 값 전체가 `${...}` 형태이거나 비어 있으면 자리표시자. */
export function isEnvPlaceholder(value: string | undefined | null): boolean {
    if (!value) return true;
    return /^\$\{.+\}$/.test(value);
}

/**
 * env record 에서 자리표시자인 키만 추린다 (승인 시 입력받아야 할 키).
 *
 * 값이 실제로 채워져 있는 키는 제외한다 — 플러그인이 기본값을 준 경우까지
 * 입력을 강요하면 승인이 불필요하게 막힌다.
 */
export function collectPlaceholderEnvKeys(env: Record<string, string> | null | undefined): string[] {
    if (!env) return [];
    return Object.keys(env).filter(k => isEnvPlaceholder(env[k]));
}

/** `${user_config.api_key}` → `api_key` (Claude Code userConfig 참조 키). */
export function parseUserConfigRef(value: string | undefined | null): string | null {
    if (!value) return null;
    const m = /^\$\{user_config\.([A-Za-z0-9_.-]+)\}$/.exec(value);
    return m ? m[1] : null;
}

/** 승인 화면에 보여줄 입력 힌트 (plugin.json `userConfig` 에서 유도). */
export interface EnvInputHint {
    /** env 키 (예: LAW_OC) */
    key: string;
    /** 사람이 읽는 이름 (userConfig.title) */
    title?: string;
    /** 설명·발급 안내 (userConfig.description) */
    description?: string;
    /** 시크릿이면 입력 UI 를 마스킹한다 */
    sensitive?: boolean;
}

/** plugin.json `userConfig` 스키마 중 이 환경이 쓰는 부분. */
export interface UserConfigEntry {
    title?: string;
    description?: string;
    sensitive?: boolean;
}

/**
 * env 의 자리표시자 키 → 입력 힌트.
 *
 * `${user_config.X}` 인 값은 매니페스트 `userConfig.X` 의 title/description 을 끌어와
 * "법제처 API 키 (LAW_OC)" 처럼 발급처까지 안내할 수 있게 한다. 참조가 아닌 일반
 * 자리표시자(`${API_KEY}`)는 키 이름만 남긴다.
 */
export function buildEnvInputHints(
    env: Record<string, string> | null | undefined,
    userConfig: Record<string, UserConfigEntry> | null | undefined,
): EnvInputHint[] {
    if (!env) return [];
    const hints: EnvInputHint[] = [];
    for (const key of collectPlaceholderEnvKeys(env)) {
        const ref = parseUserConfigRef(env[key]);
        const entry = ref && userConfig ? userConfig[ref] : undefined;
        hints.push({
            key,
            title: entry?.title,
            description: entry?.description,
            sensitive: entry?.sensitive,
        });
    }
    return hints;
}
