/**
 * exec PATH 보강 — Finder 기동 GUI 앱은 로그인 셸 PATH 를 물려받지 못해 mise/Homebrew
 * 런타임(node·npm 등)을 못 찾는다 (2026-08-15 실측: 최소 PATH 에서 `node: command not found`).
 * ① 로그인 셸 PATH 캡처 ② mise 도구 경로(activate 가 zshrc 전용이라 ①에도 안 잡힘 —
 * bin-paths 직접 조회, cwd=연결 폴더라 프로젝트 버전 반영) ③ 표준 설치 경로 폴백을 병합한다.
 * 폴더 연결 시 1회 계산하고, 각 단계 실패는 다음 폴백으로 넘어간다(exec 자체를 막지 않음).
 */
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { PATH_PROBE_TIMEOUT_MS } from './constants';

export function resolveExecPath(folderRoot: string | null): string {
    const parts: string[] = [];
    try {
        parts.push(...execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'echo -n "$PATH"'],
            { encoding: 'utf8', timeout: PATH_PROBE_TIMEOUT_MS }).trim().split(':'));
    } catch { /* 로그인 셸 실패 → 아래 폴백만 사용 */ }
    parts.push(...(process.env.PATH || '').split(':'));
    parts.push('/opt/homebrew/bin', '/usr/local/bin',
        path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.local/share/mise/shims'));
    const base = [...new Set(parts.filter(Boolean))].join(':');
    let merged = base;
    try {
        const misePaths = execFileSync('mise', ['bin-paths'],
            { encoding: 'utf8', timeout: PATH_PROBE_TIMEOUT_MS, cwd: folderRoot || os.homedir(), env: { ...process.env, PATH: base } })
            .trim().split('\n').filter(Boolean);
        // 프로젝트 버전이 이기도록 mise 경로를 앞에 둔다.
        merged = [...new Set([...misePaths, ...base.split(':')])].join(':');
    } catch { /* mise 부재/미신뢰 설정 — base 만 사용 */ }
    return merged;
}
