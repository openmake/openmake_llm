/**
 * @module config/extension-mcp-server-policy
 * @description 확장 MCP 서버 정책(마켓플레이스 남은 개발계획 v3.7 §8-3 · §0-4) — 플래그·매처 규칙 스키마.
 *
 * M2(`config/extension-source-policy`)가 확장 **원본 저장소**를 거른다면, 이 정책은 허용된 원본의 확장이 동봉한
 * **MCP 서버 자체**(원격 URL · stdio 명령)를 거른다 — GitHub Copilot 관리 설정 `allowedMcpServers`·`deniedMcpServers`
 * (`serverUrl`·`serverCommand` 매처, 설정 오류 시 fail-closed) 방식. 조직 정책 `MCP_ALLOWED_SERVERS`(카탈로그 템플릿 id,
 * 빈 목록 = 제한 없음)의 의미는 바꾸지 않는다 — 별개 키다.
 *
 * 전부 opt-in(기본 OFF = 종전 동작). 운영 기능 프로필(`scripts/setup/profiles/ops-features.env`)이 켠다.
 * 값은 호출 시점에 `getConfig()`(system_settings overlay > env > 기본값)로 읽는다 — 관리자 설정 변경이 재시작 없이 닿는다.
 *
 * - `EXTENSION_MCP_SERVER_POLICY_ENFORCED`  마스터 스위치. OFF 면 정책이 저장돼 있어도 검사하지 않는다.
 *                                           ON + 정책 조회 실패 = 마지막으로 적용한 정책 유지(없으면 거절).
 * - `EXTENSION_MCP_SERVER_POLICY`           전역 매처 `{ allow?: Rule[], deny?: Rule[] }`(JSON). 조직 정책 같은 키와 층으로 겹친다.
 *
 * 규칙(한 규칙에 매처 하나):
 *   - `{type:'url', url}`                    원격(sse·streamable-http). 스킴·호스트(`*.example.com` 하위 도메인 와일드카드)·포트·경로 접두.
 *   - `{type:'command', command, package?}`  stdio. 실행 파일 + 패키지 식별자 — `npx @scope/pkg@1.2.3` → command `npx`,
 *                                           package `@scope/pkg@1.2.3`(버전 생략 = 모든 버전, `@scope/*` = 그 스코프 전부).
 *                                           `uvx pkg==1.0` · `docker run ghcr.io/org/img:tag` 도 같은 꼴(command `uvx`·`docker`).
 * 매칭·정규화는 services/extensions/mcp-server-policy.ts 머리말.
 */
import { z } from 'zod';
import { getConfig } from './env';

export const EXTENSION_MCP_SERVER_POLICY_KEYS = {
    ENFORCED: 'EXTENSION_MCP_SERVER_POLICY_ENFORCED',
    POLICY: 'EXTENSION_MCP_SERVER_POLICY',
} as const;

/** 거절 오류 코드 — HTTP 403. add-on 라우트가 메시지 접두어로 알아본다(runtime-ports/extension-mcp-server-policy 재노출) */
export const EXTENSION_MCP_SERVER_BLOCKED_CODE = 'EXTENSION_MCP_SERVER_BLOCKED';

/** 규칙·목록 길이 상한 (명명 상수 — 저장 검증과 읽기 검증이 같은 값을 쓴다) */
export const EXTENSION_MCP_SERVER_POLICY_LIMITS = {
    MAX_RULES: 200,
    MAX_FIELD_CHARS: 500,
} as const;

const field = z.string().trim().min(1).max(EXTENSION_MCP_SERVER_POLICY_LIMITS.MAX_FIELD_CHARS);

/** url 규칙 — http(s) URL 이어야 하고, 호스트 와일드카드는 맨 앞 `*.` 하나만(정규화는 서비스가 같은 함수로) */
const urlField = field.refine((v) => {
    const m = /^(https?):\/\/(\*\.)?([^/?#]+)/i.exec(v);
    if (!m) return false;
    try { new URL(v.replace('://*.', '://wildcard.')); return true; } catch { return false; }
}, 'http(s) URL 이어야 합니다 (호스트 와일드카드는 https://*.example.com 형식만)');

/** 실행 파일 — 공백·셸 메타문자 없는 한 토큰 */
const commandField = field.regex(/^[^\s;&|`$<>]+$/, '실행 파일 이름 하나여야 합니다 (예: npx, uvx, docker)');

/** 패키지 식별자 — 공백 없는 한 토큰. 이름 자리의 `*` 는 끝(`@scope/*`·`ghcr.io/org/*`)에만 */
const packageField = field
    .regex(/^\S+$/, '패키지 식별자는 공백 없는 한 토큰이어야 합니다 (예: @scope/pkg@1.2.3, pkg==1.0, ghcr.io/org/img:tag)')
    .refine((v) => !v.includes('*') || /^[^*]*\/\*$/.test(v), '와일드카드는 끝의 "/*" 만 허용합니다 (예: @scope/*)');

export const EXTENSION_MCP_SERVER_RULE_SCHEMA = z.discriminatedUnion('type', [
    z.object({ type: z.literal('url'), url: urlField }).strict(),
    z.object({ type: z.literal('command'), command: commandField, package: packageField.optional() }).strict(),
]);
export type ExtensionMcpServerRule = z.infer<typeof EXTENSION_MCP_SERVER_RULE_SCHEMA>;

const ruleList = z.array(EXTENSION_MCP_SERVER_RULE_SCHEMA).max(EXTENSION_MCP_SERVER_POLICY_LIMITS.MAX_RULES);

export const EXTENSION_MCP_SERVER_POLICY_SCHEMA = z.object({ allow: ruleList.optional(), deny: ruleList.optional() }).strict();

/** 한 층(전역 또는 조직)의 정책. `allow` 미설정 = 제한 없음, `allow: []` = 전부 차단 */
export interface ExtensionMcpServerPolicyLayer {
    allow?: ExtensionMcpServerRule[];
    deny: ExtensionMcpServerRule[];
    scope: 'global' | 'organization';
    /** 저장 값이 스키마에 맞지 않아 전부 차단으로 바꿨는지 */
    broken?: boolean;
}

/** PURE: 저장 값(파싱된 JSON) → 층. 깨진 값은 `allow: []`(전부 차단) — GitHub Copilot 규칙(fail-closed). */
export function parseExtensionMcpServerPolicy(value: unknown, scope: ExtensionMcpServerPolicyLayer['scope']): ExtensionMcpServerPolicyLayer {
    const parsed = EXTENSION_MCP_SERVER_POLICY_SCHEMA.safeParse(value);
    if (!parsed.success) return { allow: [], deny: [], scope, broken: true };
    return { ...(parsed.data.allow !== undefined ? { allow: parsed.data.allow } : {}), deny: parsed.data.deny ?? [], scope };
}

/** 저장 검증 — 비면 저장해도 된다(시스템 설정 registry·조직 정책 저장이 같은 규칙). */
export function extensionMcpServerPolicyProblems(raw: string): string[] {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return ['JSON 이 아닙니다']; }
    const parsed = EXTENSION_MCP_SERVER_POLICY_SCHEMA.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

export const EXTENSION_MCP_SERVER_POLICY_SETTINGS = {
    get enforced(): boolean {
        return getConfig().extensionMcpServerPolicyEnforced;
    },
    /** 전역 층 — 설정 없음 = undefined(층 없음), JSON 깨짐 = 전부 차단 층 */
    get globalLayer(): ExtensionMcpServerPolicyLayer | undefined {
        const raw = getConfig().extensionMcpServerPolicy;
        if (raw.trim() === '') return undefined;
        let value: unknown;
        try { value = JSON.parse(raw); } catch { return { allow: [], deny: [], scope: 'global', broken: true }; }
        return parseExtensionMcpServerPolicy(value, 'global');
    },
} as const;

// ── 명령 식별 표 (services/extensions/mcp-server-policy 가 읽는다 — 새 실행기·플래그는 여기에) ─────────────────────────

/** 패키지 실행기 계열 — 같은 계열이면 deny 가 서로를 막는다(`npx` 차단이 `pnpm dlx`·`npm exec` 우회를 막게) */
export type McpRunnerFamily = 'npm' | 'python' | 'container';

/**
 * 실행 파일(basename) → 계열과 "패키지를 실행하는 하위 명령". 하위 명령 `[]` 이면 실행 파일 자체가 실행기(npx·uvx),
 * 아니면 그 하위 명령으로 시작할 때만 실행기다(`npm exec`·`docker run`·`uv tool run`).
 */
export const MCP_RUNNER_COMMANDS: Readonly<Record<string, { family: McpRunnerFamily; subcommands: ReadonlyArray<readonly string[]> }>> = {
    npx: { family: 'npm', subcommands: [[]] },
    pnpx: { family: 'npm', subcommands: [[]] },
    bunx: { family: 'npm', subcommands: [[]] },
    npm: { family: 'npm', subcommands: [['exec'], ['x']] },
    pnpm: { family: 'npm', subcommands: [['dlx']] },
    yarn: { family: 'npm', subcommands: [['dlx']] },
    bun: { family: 'npm', subcommands: [['x']] },
    uvx: { family: 'python', subcommands: [[]] },
    uv: { family: 'python', subcommands: [['tool', 'run']] },
    pipx: { family: 'python', subcommands: [['run']] },
    docker: { family: 'container', subcommands: [['run'], ['container', 'run']] },
    podman: { family: 'container', subcommands: [['run'], ['container', 'run']] },
    nerdctl: { family: 'container', subcommands: [['run'], ['container', 'run']] },
};

/** 계열별 플래그 — `valueFlags` 는 다음 토큰을 값으로 먹는다, `packageFlags` 의 값이 곧 실행할 패키지다 */
export const MCP_RUNNER_FLAGS: Readonly<Record<McpRunnerFamily, { valueFlags: readonly string[]; packageFlags: readonly string[] }>> = {
    npm: {
        valueFlags: ['-p', '--package', '-c', '--call', '--registry', '--cache', '--userconfig', '-w', '--workspace'],
        packageFlags: ['-p', '--package'],
    },
    python: {
        valueFlags: ['--from', '--with', '--with-requirements', '--with-editable', '-p', '--python', '--index', '--index-url',
            '--extra-index-url', '--default-index', '--spec', '--pip-args', '-c', '--constraints', '--overrides'],
        packageFlags: ['--from', '--spec'],
    },
    container: {
        valueFlags: ['-e', '--env', '--env-file', '-v', '--volume', '-p', '--publish', '--name', '--network', '--net', '--mount',
            '--entrypoint', '-w', '--workdir', '-u', '--user', '-l', '--label', '-m', '--memory', '--memory-swap', '--cpus',
            '--platform', '--pull', '--add-host', '-h', '--hostname', '--ipc', '--pid', '--cap-add', '--cap-drop', '--security-opt',
            '--tmpfs', '--device', '--log-driver', '--log-opt', '--restart', '--runtime', '--shm-size', '--ulimit', '--pids-limit',
            '--stop-signal', '--stop-timeout', '--dns', '--group-add', '--cidfile', '--expose', '--label-file', '--userns', '--uts',
            '--gpus', '--health-cmd', '--isolation', '--link', '--mac-address', '--ip', '--ip6', '--cgroupns', '--cgroup-parent'],
        packageFlags: [],
    },
};

/** 셸 감싸기 — deny 가 문자열 안의 명령까지 본다(`sh -c "npx evil"`). 값 = 명령 문자열을 받는 플래그(소문자) */
export const MCP_SHELL_WRAPPERS: Readonly<Record<string, readonly string[]>> = {
    sh: ['-c'], bash: ['-c'], zsh: ['-c'], dash: ['-c'], ksh: ['-c'], fish: ['-c', '--command'],
    cmd: ['/c', '/k'], powershell: ['-command', '-c'], pwsh: ['-command', '-c'],
};

/** 셸 문자열 중첩 해석 상한(명명 상수) */
export const MCP_SHELL_UNWRAP_MAX_DEPTH = 3;

/** 실행 파일 확장자 — 비교 전에 뗀다(Windows `npx.cmd` = `npx`) */
export const MCP_COMMAND_STRIP_EXTENSIONS = /\.(exe|cmd|bat|ps1)$/i;

/** 컨테이너 이미지 기본 레지스트리(이름만 쓴 이미지 = 이 레지스트리의 library/…) */
export const MCP_CONTAINER_DEFAULT_REGISTRY = { host: 'docker.io', aliases: ['index.docker.io', 'registry-1.docker.io'], library: 'library' } as const;

/** 떠다니는 태그 — 고정 버전으로 보지 않는다(allow 의 버전 규칙에 맞지 않고, deny 의 버전 규칙엔 걸린다) */
export const MCP_FLOATING_VERSIONS: readonly string[] = ['latest'];
