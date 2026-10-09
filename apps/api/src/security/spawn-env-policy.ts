/**
 * MCP 서버 spawn 환경 정책 — 사용자 입력 env 가 런타임·패키지 관리자·동적 로더를 제어하지 못하게 한다.
 *
 * 카탈로그 등록(from-catalog)·env 교체(updateEnv)에서 입력을 거부하고, 실행기(호스트 spawn·docker
 * 샌드박스)에서도 한 번 더 걷어낸다(심층 방어 — 과거에 저장된 행도 막는다). 2026-10-09 점검 ④.
 *
 * HOME 은 포함하지 않는다 — 카탈로그 env_schema default 가 readonly 샌드박스의 캐시 경로로 쓴다.
 *
 * @module security/spawn-env-policy
 */

/** 거부 키 패턴 — 이름 그대로(대소문자 무시) 또는 접두사. */
export const CONTROL_ENV_KEY_PATTERNS: readonly RegExp[] = [
    /^NODE_OPTIONS$/i, /^NODE_PATH$/i, /^NODE_EXTRA_CA_CERTS$/i, /^NODE_TLS_REJECT_UNAUTHORIZED$/i, /^NODE_REPL_EXTERNAL_MODULE$/i,
    /^LD_/i, /^DYLD_/i, /^PATH$/i, /^PATHEXT$/i,
    /^npm_config_/i, /^UV_/i,
    /^PYTHONPATH$/i, /^PYTHONSTARTUP$/i, /^PYTHONHOME$/i, /^PYTHONEXECUTABLE$/i, /^PIP_/i,
    /^BASH_ENV$/i, /^ENV$/i, /^ZDOTDIR$/i, /^PERL5OPT$/i, /^RUBYOPT$/i,
    /^JAVA_TOOL_OPTIONS$/i, /^_JAVA_OPTIONS$/i, /^GCONV_PATH$/i, /^IFS$/i,
    /^DOCKER_/i,
];

export function isControlEnvKey(key: string): boolean {
    return CONTROL_ENV_KEY_PATTERNS.some((re) => re.test(key));
}

/** 제어 키를 뺀 사본. 입력이 없으면 undefined. */
export function stripControlEnv<T extends Record<string, unknown>>(env: T | undefined | null): Partial<T> | undefined {
    if (!env) return undefined;
    const out: Partial<T> = {};
    for (const [k, v] of Object.entries(env)) {
        if (!isControlEnvKey(k)) (out as Record<string, unknown>)[k] = v;
    }
    return out;
}

/** 카탈로그 등록·env 교체의 사용자 입력 오류 — 라우트가 400 으로 변환한다. */
export class McpCatalogInputError extends Error {
    override name = 'McpCatalogInputError';
}
