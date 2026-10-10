/**
 * exec 자식 환경 조립 — allowlist(constants) 키만 복사하고 PATH 는 resolveExecPath 결과로 둔다.
 * Windows 는 env 키가 대소문자를 구분하지 않으므로 allowlist 와 대소문자 무시로 맞추되 원래 표기를 유지한다.
 * extraPosixKeys 는 고정 명령(셸 경로 탐색)이 allowlist 밖에서 더 필요로 하는 키 — exec 에는 쓰지 않는다.
 */
import { EXEC_ENV_ALLOWLIST_POSIX, EXEC_ENV_ALLOWLIST_PREFIX_POSIX, EXEC_ENV_ALLOWLIST_WIN32 } from './constants';

export function buildExecEnv(source: NodeJS.ProcessEnv, execPath: string, platform: NodeJS.Platform = process.platform, extraPosixKeys: readonly string[] = []): Record<string, string> {
    const out: Record<string, string> = {};
    if (platform === 'win32') {
        const wanted = new Set(EXEC_ENV_ALLOWLIST_WIN32.map((k) => k.toLowerCase()));
        for (const [k, v] of Object.entries(source)) {
            if (v !== undefined && wanted.has(k.toLowerCase())) out[k] = v;
        }
    } else {
        for (const [k, v] of Object.entries(source)) {
            if (v === undefined) continue;
            if ((EXEC_ENV_ALLOWLIST_POSIX as readonly string[]).includes(k) || EXEC_ENV_ALLOWLIST_PREFIX_POSIX.some((p) => k.startsWith(p)) || extraPosixKeys.includes(k)) out[k] = v;
        }
    }
    out.PATH = execPath;
    return out;
}
