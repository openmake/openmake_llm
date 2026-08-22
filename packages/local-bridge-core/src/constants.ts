/** 브리지 코어 공통 상수 — 데스크톱·CLI 에서 자구 동일하던 값을 단일화 (2026-08-22). */
import * as path from 'path';

export const EXEC_TIMEOUT_MS = 120000;
export const MAX_BUFFER = 1024 * 1024;
export const RECONNECT_MS = 10000;
export const PATH_PROBE_TIMEOUT_MS = 5000;

export const SANDBOX_BIN = '/usr/bin/sandbox-exec';
/** sandbox-exec 는 macOS 전용 — 타 플랫폼은 게이트 자체가 꺼진다(데스크톱은 mac 전용 앱이라 등가). */
export const SANDBOX_ENABLED = process.platform === 'darwin' && process.env.OMK_BRIDGE_SANDBOX !== '0';

/** 워크스페이스 밖이지만 쓰기를 허용해야 하는 툴 캐시 — 없으면 npm/pip/cargo 계열이 깨진다. */
export const CACHE_SUBPATHS = ['.npm', '.cache', 'Library/Caches', '.cargo', '.gradle', '.m2', '.yarn', '.pnpm-store', 'go/pkg'];
/** 읽기를 차단할 비밀 경로. */
export const SECRET_SUBPATHS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gcloud', 'Library/Keychains'];

export const WORKTREE_DIR = '.openmake/worktrees';
export const WORKTREE_BRANCH_PREFIX = 'omk-task/';
/** taskId 재검증 — 경로·브랜치명에 들어가므로 UUID 문자만 허용(디렉토리 탈출·옵션 주입 차단). */
export const TASK_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

/** folders(하위 폴더 열거) 1회 상한 — 서버 BRIDGE_FOLDERS_MAX_ENTRIES 와 같은 축(디바이스측 강제). */
export const FOLDERS_MAX_ENTRIES = 200;

/** listAll 재귀 나열 상한. */
export const LIST_ALL_MAX = 1000;

/** SBPL 문자열 리터럴 escape. */
export function sbq(p: string): string {
    return `"${String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 홈 하위 경로 목록을 SBPL subpath 절로. */
export function sbSub(base: string, list: string[]): string {
    return list.map((d) => `(subpath ${sbq(path.join(base, d))})`).join(' ');
}
