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
import { PATH_PROBE_ENV_EXTRA_POSIX, PATH_PROBE_TIMEOUT_MS } from './constants';
import { buildExecEnv } from './exec-env';

/** execPath(`:` 구분) 안에 실행 가능한 bin 이 있는가. */
export function onPath(bin: string, execPath: string): boolean {
    return execPath.split(':').filter(Boolean).some((d) => {
        try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return true; } catch { return false; }
    });
}

const isAbsEntry = (p: string): boolean => p.startsWith('/');

export function resolveExecPath(folderRoot: string | null): string {
    // Windows — 로그인 셸·Homebrew·mise 관행이 없다. 프로세스의 PATH 를 그대로 쓴다.
    if (process.platform === 'win32') return process.env.PATH || process.env.Path || '';
    const parts: string[] = [];
    const probeEnv = (p: string): Record<string, string> => buildExecEnv(process.env, p, process.platform, PATH_PROBE_ENV_EXTRA_POSIX);
    try {
        // 홈에서 띄운다 — 사용자 로그인 rc 의 cwd 훅(mise activate·direnv)이 연결 폴더 설정을 샌드박스 밖에서 돌리지 않게(설계 D-13).
        parts.push(...execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'echo -n "$PATH"'],
            { encoding: 'utf8', timeout: PATH_PROBE_TIMEOUT_MS, cwd: os.homedir(), env: probeEnv(process.env.PATH || '') }).trim().split(':'));
    } catch { /* 로그인 셸 실패 → 아래 폴백만 사용 */ }
    parts.push(...(process.env.PATH || '').split(':'));
    parts.push('/opt/homebrew/bin', '/usr/local/bin',
        path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.local/share/mise/shims'));
    // 절대경로 항목만 — 상대 항목(`.`·`bin`)은 자식 cwd(연결 폴더) 기준으로 풀려 폴더의 파일을 고를 수 있다(설계 D-5).
    const base = [...new Set(parts.filter(isAbsEntry))].join(':');
    let merged = base;
    try {
        const misePaths = execFileSync('mise', ['bin-paths'],
            { encoding: 'utf8', timeout: PATH_PROBE_TIMEOUT_MS, cwd: folderRoot || os.homedir(), env: probeEnv(base) })
            .trim().split('\n').filter(isAbsEntry);
        // 프로젝트 버전이 이기도록 mise 경로를 앞에 둔다.
        merged = [...new Set([...misePaths, ...base.split(':')])].join(':');
    } catch { /* mise 부재/미신뢰 설정 — base 만 사용 */ }
    return merged;
}
