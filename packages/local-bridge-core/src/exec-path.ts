/**
 * exec PATH 보강 — Finder 기동 GUI 앱은 로그인 셸 PATH 를 물려받지 못해 mise/Homebrew
 * 런타임(node·npm 등)을 못 찾는다 (2026-08-15 실측: 최소 PATH 에서 `node: command not found`).
 * ① 로그인 셸 PATH 캡처 ② mise 도구 경로(activate 가 zshrc 전용이라 ①에도 안 잡힘 —
 * bin-paths 직접 조회, cwd=연결 폴더라 프로젝트 버전 반영) ③ 표준 설치 경로 폴백을 병합한다.
 * 폴더 연결 시 1회 계산하고, 각 단계 실패는 다음 폴백으로 넘어간다(exec 자체를 막지 않음).
 * 두 자식(로그인 셸·mise)에는 호스트 env 를 통째로 주지 않는다 — exec 와 같은 allowlist + 위치 변수만(사용자 rc·프로젝트 mise 설정이 비밀을 읽지 못하게).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { FALLBACK_CHILD_PATH, PATH_PROBE_ENV_EXTRA_POSIX, PATH_PROBE_TIMEOUT_MS } from './constants';
import { buildExecEnv } from './exec-env';
import { wrapInSandbox } from './sandbox';

/** execPath(`:` 구분) 안에 실행 가능한 bin 이 있는가. */
export function onPath(bin: string, execPath: string): boolean {
    return execPath.split(':').filter(Boolean).some((d) => {
        try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return true; } catch { return false; }
    });
}

const isAbsEntry = (p: string): boolean => p.startsWith('/');

/**
 * 자식에게 넘길 PATH(`:` 구분)에서 절대경로 항목만 남긴다 — 상대 항목(`.`·`bin`)은 자식 cwd(연결 폴더) 기준으로 풀려 폴더의
 * 파일을 고를 수 있다(설계 D-5). 프로세스 PATH 를 자식 PATH 로 넘기는 자리(git 자식·도구의 PATH 폴백)도 이것을 지난다(설계 D-14).
 * 거른 결과가 비면 `FALLBACK_CHILD_PATH` — 빈 PATH 는 현재 폴더 한 항목이다(설계 D-14 보완). Windows 는 그대로 — exec PATH 의 Windows 갈래와 같다.
 */
export function absPathEntries(p: string, platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? p : p.split(':').filter(isAbsEntry).join(':') || FALLBACK_CHILD_PATH;
}

/**
 * toolSandbox: mise 를 감쌀 도구 프로파일 — undefined = 샌드박스 꺼짐(감싸지 않음), null = 켜졌는데 프로파일 없음(mise 를 건너뛴다).
 * 신뢰된 경로의 mise 설정은 에이전트가 파일 쓰기로 고칠 수 있어, 그 `exec()` 가 샌드박스 밖에서 돌지 않게 한다(설계 D-6).
 */
export function resolveExecPath(folderRoot: string | null, toolSandbox?: string | null): string {
    // Windows — 로그인 셸·Homebrew·mise 관행이 없다. 프로세스의 PATH 를 그대로 쓴다.
    if (process.platform === 'win32') return process.env.PATH || process.env.Path || '';
    const parts: string[] = [];
    const probeEnv = (p: string): Record<string, string> => buildExecEnv(process.env, p, process.platform, PATH_PROBE_ENV_EXTRA_POSIX);
    try {
        // 홈에서 띄운다 — 사용자 로그인 rc 의 cwd 훅(mise activate·direnv)이 연결 폴더 설정을 샌드박스 밖에서 돌리지 않게(설계 D-13).
        parts.push(...execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'echo -n "$PATH"'],
            { encoding: 'utf8', timeout: PATH_PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'], cwd: os.homedir(), env: probeEnv(absPathEntries(process.env.PATH || '')) }).trim().split(':'));
    } catch { /* 로그인 셸 실패 → 아래 폴백만 사용 */ }
    parts.push(...(process.env.PATH || '').split(':'));
    parts.push('/opt/homebrew/bin', '/usr/local/bin',
        path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.local/share/mise/shims'));
    // 절대경로 항목만 — 상대 항목(`.`·`bin`)은 자식 cwd(연결 폴더) 기준으로 풀려 폴더의 파일을 고를 수 있다(설계 D-5).
    const base = [...new Set(parts.filter(isAbsEntry))].join(':');
    let merged = base;
    if (toolSandbox === null) return merged; // PATH 계산은 exec 를 막지 않는다 — 그 exec·도구는 뒤에서 126 으로 거절된다
    try {
        const mise = wrapInSandbox('mise', ['bin-paths'], toolSandbox);
        const misePaths = execFileSync(mise.file, mise.args,
            { encoding: 'utf8', timeout: PATH_PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'], cwd: folderRoot || os.homedir(), env: probeEnv(base) })
            .trim().split('\n').flatMap((l) => l.split(':')).filter(isAbsEntry); // 한 줄 안의 `:` 도 항목 경계다(설계 D-5 보완)
        // 프로젝트 버전이 이기도록 mise 경로를 앞에 둔다.
        merged = [...new Set([...misePaths, ...base.split(':')])].join(':');
    } catch { /* mise 부재/미신뢰 설정/감싼 실행 실패(65·71 포함) — base 만 사용 */ }
    return merged;
}
