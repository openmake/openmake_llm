/**
 * `{{env.KEY}}` 자리표시자를 값으로 치환하지 않고 **셸 변수 참조**로 바꿔 spawn 한다.
 *
 * 종전(lifecycle-supervisor.substituteEnvPlaceholders)엔 복호화된 비밀이 command/args 에
 * 그대로 들어가 `docker run … <값>` / `npx … <값>` argv 로 실려, 같은 호스트의 다른 로컬 계정이
 * `ps` 로 읽을 수 있었다(2026-09-02 보안 리뷰 B5-01 — 카탈로그 server-postgres 의
 * `{{env.DATABASE_URL}}` 위치 인자). 값은 이미 env(-e KEY / StdioClientTransport env)로
 * 프로세스에 도달하므로 argv 엔 `"$KEY"` 참조만 싣고 sh 가 실행 직전에 전개하게 한다.
 *
 * 변환 규칙(결정적·인용 안전):
 *   command/args 에 자리표시자가 하나도 없으면 원본 그대로.
 *   있으면 command='sh', args=['-c', <script>, 'sh', ...positional]
 *   - 자리표시자가 없는 토큰은 positional 로 넘기고 script 에서 "$N" 으로 참조(인용 문제 없음)
 *   - 자리표시자가 있는 토큰은 리터럴 조각을 작은따옴표로, `{{env.KEY}}` 를 "$KEY" 로 이어 붙인다
 *   - script 는 `exec <cmd> <args...>` — 컨테이너/호스트 모두 sh 가 있다(node·uv 런타임 이미지 포함)
 */
export const ENV_PLACEHOLDER_RE = /\{\{env\.(\w+)\}\}/g;

export interface ShellWrapped {
    command: string;
    args: string[];
    /** 자리표시자가 있어 sh 로 감쌌는지 */
    wrapped: boolean;
    /** 참조된 env 키 (호출측이 env 에 실렸는지 확인·로그용) */
    keys: string[];
}

function shellQuoteLiteral(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 토큰 하나를 셸 표현식으로 — 리터럴은 작은따옴표, 자리표시자는 "$KEY" */
function tokenToShellExpr(token: string, keys: Set<string>): string {
    let out = '';
    let last = 0;
    // ⚠️ 전역 regex 는 lastIndex 상태를 가지므로 매번 새 인스턴스로 순회한다
    for (const m of token.matchAll(new RegExp(ENV_PLACEHOLDER_RE.source, 'g'))) {
        const idx = m.index ?? 0;
        if (idx > last) out += shellQuoteLiteral(token.slice(last, idx));
        out += `"$${m[1]}"`;
        keys.add(m[1]);
        last = idx + m[0].length;
    }
    if (last < token.length) out += shellQuoteLiteral(token.slice(last));
    return out || "''";
}

export function wrapEnvPlaceholdersAsShellRefs(command: string, args: readonly unknown[]): ShellWrapped {
    const strArgs = args.map((a) => String(a));
    const hasPlaceholder = (s: string) => new RegExp(ENV_PLACEHOLDER_RE.source).test(s);
    if (!hasPlaceholder(command) && !strArgs.some(hasPlaceholder)) {
        return { command, args: strArgs, wrapped: false, keys: [] };
    }
    const keys = new Set<string>();
    const positional: string[] = [];
    const parts: string[] = [];
    for (const token of [command, ...strArgs]) {
        if (hasPlaceholder(token)) {
            parts.push(tokenToShellExpr(token, keys));
        } else {
            positional.push(token);
            parts.push(`"$${positional.length}"`);
        }
    }
    const script = `exec ${parts.join(' ')}`;
    return { command: 'sh', args: ['-c', script, 'sh', ...positional], wrapped: true, keys: [...keys] };
}
