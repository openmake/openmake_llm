/**
 * MCP 서버 spawn 환경 정책 — 사용자 입력 env 가 런타임·패키지 관리자·동적 로더를 제어하지 못하게 한다.
 *
 * 카탈로그 등록(from-catalog)·env 교체(updateEnv)에서 입력을 거부하고, 실행기(호스트 spawn·docker
 * 샌드박스)에서도 한 번 더 걷어낸다(심층 방어 — 과거에 저장된 행도 막는다). 2026-10-09 점검 ④.
 *
 * HOME 은 포함하지 않는다 — 카탈로그 env_schema default 가 readonly 샌드박스의 캐시 경로로 쓴다.
 * GIT_TOKEN 같은 자격증명 이름은 막지 않는다(제어 변수만).
 *
 * @module security/spawn-env-policy
 */
import { createLogger } from '../utils/logger';

const logger = createLogger('SpawnEnvPolicy');

/** 거부 키 패턴 — 이름 그대로(대소문자 무시) 또는 접두사. */
export const CONTROL_ENV_KEY_PATTERNS: readonly RegExp[] = [
    /^NODE_OPTIONS$/i, /^NODE_PATH$/i, /^NODE_EXTRA_CA_CERTS$/i, /^NODE_TLS_REJECT_UNAUTHORIZED$/i, /^NODE_REPL_EXTERNAL_MODULE$/i,
    /^LD_/i, /^DYLD_/i, /^PATH$/i, /^PATHEXT$/i,
    /^npm_config_/i, /^UV_/i,
    /^PYTHONPATH$/i, /^PYTHONSTARTUP$/i, /^PYTHONHOME$/i, /^PYTHONEXECUTABLE$/i, /^PIP_/i,
    /^BASH_ENV$/i, /^ENV$/i, /^ZDOTDIR$/i, /^PERL5OPT$/i, /^RUBYOPT$/i,
    /^JAVA_TOOL_OPTIONS$/i, /^_JAVA_OPTIONS$/i, /^GCONV_PATH$/i, /^IFS$/i,
    /^DOCKER_/i,
    /^GIT_(SSH|SSH_COMMAND|EXEC_PATH|ASKPASS|PROXY_COMMAND|TEMPLATE_DIR|CONFIG_[A-Z0-9_]*|SSL_[A-Z0-9_]*|CEILING_DIRECTORIES|EXTERNAL_DIFF|PAGER|EDITOR)$/i,
    // 설정 파일·저장소/작업 트리 위치·추적 출력(GIT_TRACE·GIT_TRACE2·GIT_TRACE_* — 파일 경로를 주면 그 파일에 쓴다) — #1471
    /^GIT_(CONFIG|DIR|WORK_TREE|TRACE[A-Z0-9_]*)$/i,
    /_PROXY$/i,
    /^(SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|AWS_CA_BUNDLE|PYTHONHTTPSVERIFY)$/i,
];

export function isControlEnvKey(key: string): boolean {
    return CONTROL_ENV_KEY_PATTERNS.some((re) => re.test(key));
}

/** 제어 키를 뺀 사본. 입력이 없으면 undefined. 뺀 키가 있으면 그 이름만 한 번 경고한다(값은 남기지 않는다). */
export function stripControlEnv<T extends Record<string, unknown>>(env: T | undefined | null): Partial<T> | undefined {
    if (!env) return undefined;
    const out: Partial<T> = {};
    const removed: string[] = [];
    for (const [k, v] of Object.entries(env)) {
        if (!isControlEnvKey(k)) (out as Record<string, unknown>)[k] = v;
        else removed.push(k);
    }
    if (removed.length > 0) logger.warn(`spawn env 에서 제어 키 ${removed.length}개 제거: ${removed.join(', ')}`);
    return out;
}

/** 카탈로그 등록·env 교체의 사용자 입력 오류 — 라우트가 400 으로 변환한다. */
export class McpCatalogInputError extends Error {
    override name = 'McpCatalogInputError';
}
