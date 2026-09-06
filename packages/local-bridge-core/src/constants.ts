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

/**
 * 편집 후 진단(lsp_diagnostics) — 1회 실행 타임아웃과 결과 캡.
 * 콜드 스타트(대형 TS 레포의 첫 tsc)를 고려해 exec 보다 짧고 FS 보다 길게 잡는다.
 * 서버측(LOCAL_BRIDGE.LSP_TIMEOUT_MS)이 더 짧으면 서버가 먼저 포기한다 — 그쪽이 fail-open 이라 무해.
 */
export const DIAG_TIMEOUT_MS = Number(process.env.OMK_BRIDGE_DIAG_TIMEOUT_MS || 15000);
/** 파일당 진단 상한 — 한 파일의 연쇄 오류가 결과를 독점하지 않게. */
export const DIAG_MAX_PER_FILE = 20;
/** 전체 진단 상한 — tool_result 팽창 방지(MAX_TOOL_RESULT_CHARS 절단과 이중). */
export const DIAG_MAX_TOTAL = 60;
/** 진단 메시지 1건 길이 상한. */
export const DIAG_MSG_MAX = 300;

/** listAll 재귀 나열 상한. */
export const LIST_ALL_MAX = 1000;

/**
 * 코드 탐색(code_nav) 상한 — 읽기 전용이라 confirmExec 를 거치지 않으므로, 폭주를 막는 것은
 * 전적으로 이 캡이다. 서버(TASK_CODE_NAV)도 같은 축의 캡을 갖지만 디바이스가 자체 강제한다.
 */
export const CODE_NAV_TIMEOUT_MS = Number(process.env.OMK_BRIDGE_CODE_NAV_TIMEOUT_MS || 15000);
/** 1회 요청에서 훑을 최대 파일 수(대형 레포 보호). 초과하면 truncated. */
export const CODE_NAV_MAX_FILES = 4000;
/** 내용을 읽을 파일 크기 상한 — 초과 파일은 건너뛴다(번들·미니파이·데이터 덤프). */
export const CODE_NAV_MAX_FILE_BYTES = 512 * 1024;
/** grep 매치 상한(요청이 더 크게 요구해도 이 값으로 자른다). */
export const CODE_NAV_MAX_MATCHES = 400;
/** 한 파일에서 가져올 최대 매치 수 — 한 파일이 결과를 독점하지 않게. */
export const CODE_NAV_MAX_PER_FILE = 20;
/** 매치 줄 1건 길이 상한. */
export const CODE_NAV_LINE_MAX_CHARS = 300;
/** 정규식 소스 길이 상한. */
export const CODE_NAV_PATTERN_MAX_CHARS = 500;
/**
 * 탐색에서 제외하는 자격증명 글롭 — 단일 출처는 @openmake/config 의 SENSITIVE_FILE_PATTERNS
 * (서버 approval-gate·셸 폴백과 같은 목록). 승인은 도구 단위라 어떤 파일을 읽을지 사용자에게
 * 보이지 않으므로 정책과 무관하게 거른다. 봉쇄가 아니라 위생 — 경로를 지목한 read 는 그대로
 * 되고, 건너뛴 개수는 결과에 실려 모델이 "파일이 없다"로 오판하지 않는다.
 * 파일뿐 아니라 **같은 이름의 디렉토리도** 건너뛴다(셸 find -prune·rg -g 와 결과를 맞추기 위해).
 */
export { SENSITIVE_FILE_PATTERNS as CODE_NAV_EXCLUDED_FILES } from '@openmake/config';

/** 탐색에서 제외하는 디렉토리 — 서버 TASK_CODE_NAV.EXCLUDED_DIRS 와 같은 목록(양쪽 강제). */
export const CODE_NAV_EXCLUDED_DIRS: readonly string[] = [
    'node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'coverage', '.openmake',
];

/**
 * 파일 kind(read/write/list/listAll/delete/folders) 1회 처리 타임아웃 — OS 가 FS 호출을
 * 무기한 블록하면(외장 볼륨 TCC 권한 미결 실사례, 2026-08-23) 요청을 오류로 해소해
 * 연결(하트비트)을 지킨다. 블록된 호출 자체는 취소할 수 없어 threadpool 스레드는 남는다.
 */
export const FS_OP_TIMEOUT_MS = Number(process.env.OMK_BRIDGE_FS_TIMEOUT_MS || 15000);

/** SBPL 문자열 리터럴 escape. */
export function sbq(p: string): string {
    return `"${String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 홈 하위 경로 목록을 SBPL subpath 절로. */
export function sbSub(base: string, list: string[]): string {
    return list.map((d) => `(subpath ${sbq(path.join(base, d))})`).join(' ');
}
