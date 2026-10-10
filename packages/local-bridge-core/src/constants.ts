/** 브리지 코어 공통 상수 — 데스크톱·CLI 에서 자구 동일하던 값을 단일화 (2026-08-22). */
import * as path from 'path';
import type { BridgeAuthCloseReason } from './types';

export const EXEC_TIMEOUT_MS = 120000;
export const MAX_BUFFER = 1024 * 1024;
/** 재연결 기준 간격(ms) — 실제 대기는 이 값의 절반~전체 구간에서 흩어지고(jitter), 실패가 이어지면 두 배씩 늘어난다. */
export const RECONNECT_MS = 10000;
/** 재연결 간격 상한(ms) — 서버가 오래 내려가 있어도 이보다 드물게 두드리지 않는다. */
export const RECONNECT_MAX_MS = 60000;

/**
 * 서버가 인증 문제로 닫은 사유 — 서버 config/local-bridge.ts 의 인증 실패 사유와 #1164·#1168 의 사유(1:1).
 * 이 사유로 닫히면 사용자가 키·계정을 고치기 전에는 다시 연결해도 같은 결과라, 사유를 상태로 보여 주고
 * AUTH_RETRY_MS 간격으로만 다시 시도한다(관리자가 키·계정을 되살리면 저절로 붙는다).
 */
export const AUTH_CLOSE_REASONS: readonly BridgeAuthCloseReason[] = [
    'api_key_revoked', 'api_key_invalid', 'api_key_expired', 'api_key_inactive', 'account_disabled', 'account_deleted', 'bridge_scope_required',
];
/** 인증 사유로 닫혔을 때의 재시도 간격(ms) — 10분. */
export const AUTH_RETRY_MS = 10 * 60 * 1000;
/** 인증 사유별 상태 문구(한국어 원문 — CLI 가 그대로 쓰고, 앱은 사유 코드로 다국어 문구를 고른다). */
export const AUTH_CLOSE_TEXT: Record<BridgeAuthCloseReason, string> = {
    api_key_revoked: 'API key 가 폐기되었습니다 — 새 키를 발급해 설정에 넣으세요',
    api_key_invalid: 'API key 가 없거나 올바르지 않습니다 — 새 키를 발급해 설정에 넣으세요',
    api_key_expired: 'API key 가 만료되었습니다 — 새 키를 발급해 설정에 넣으세요',
    api_key_inactive: 'API key 가 비활성화되었습니다 — 키를 다시 켜거나 새 키를 설정에 넣으세요',
    account_disabled: '계정이 비활성화되었습니다 — 관리자에게 문의하세요',
    account_deleted: '계정이 삭제되었습니다 — 관리자에게 문의하세요',
    bridge_scope_required: "이 API key 에는 'bridge' 스코프가 없습니다 — bridge 스코프 키를 발급해 설정에 넣으세요",
};
export const PATH_PROBE_TIMEOUT_MS = 5000;
/** git 디렉터리 탐지(rev-parse) 프로브 타임아웃(ms). */
export const GIT_PROBE_TIMEOUT_MS = 5000;
/** 테스트 러너 탐지에서 `python3 -c "import pytest"` 한 번에 주는 시간. */
export const TEST_RUNNER_PROBE_TIMEOUT_MS = 5000;

export const SANDBOX_BIN = '/usr/bin/sandbox-exec';
/** sandbox-exec 는 macOS 전용 — 타 플랫폼은 게이트 자체가 꺼진다(데스크톱은 mac 전용 앱이라 등가). */
export const SANDBOX_ENABLED = process.platform === 'darwin' && process.env.OMK_BRIDGE_SANDBOX !== '0';

/** 워크스페이스 밖이지만 쓰기를 허용해야 하는 툴 캐시 — 없으면 npm/pip/cargo 계열이 깨진다. */
export const CACHE_SUBPATHS = ['.npm', '.cache', 'Library/Caches', '.cargo', '.gradle', '.m2', '.yarn', '.pnpm-store', 'go/pkg'];
/** 읽기를 차단할 비밀 경로. */
export const SECRET_SUBPATHS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gcloud', 'Library/Keychains'];

/**
 * exec 자식 프로세스에 넘기는 env allowlist(2026-10-09 점검 ⑤) — 호스트 env 를 통째로 상속하면
 * 헬퍼의 OMK_COMPANION_API_KEY·사용자 셸의 비밀이 `env` 한 번에 도구 결과로 새어 서버 DB 까지 남는다.
 * PATH 는 exec-path 가 계산한 값으로 따로 넣는다.
 */
export const EXEC_ENV_ALLOWLIST_POSIX = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'COLORTERM', 'LANG', 'LANGUAGE', 'TMPDIR', 'TZ'] as const;
export const EXEC_ENV_ALLOWLIST_PREFIX_POSIX = ['LC_'] as const;
/**
 * 셸 경로 탐색(exec-path)의 로그인 셸·mise 자식에만 더 넘기는 키 — 설정·데이터 "위치"만 가리킨다(비밀 아님).
 * 빼면 위치를 기본값에서 옮긴 사용자(ZDOTDIR 의 zprofile, XDG·MISE_*_DIR 의 mise 설치본)의 PATH 가 덜 잡혀 exec 가 런타임을 못 찾는다.
 * 테스트 러너 탐지·진단은 exec 와 같은 환경이어야 결과가 exec 와 어긋나지 않으므로 이 키를 더하지 않는다.
 */
export const PATH_PROBE_ENV_EXTRA_POSIX = [
    'ZDOTDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME',
    'MISE_DATA_DIR', 'MISE_CONFIG_DIR', 'MISE_CACHE_DIR', 'MISE_STATE_DIR',
] as const;
export const EXEC_ENV_ALLOWLIST_WIN32 = [
    'SystemRoot', 'windir', 'SystemDrive', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME',
    'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)',
    'NUMBER_OF_PROCESSORS', 'OS',
] as const;

export const WORKTREE_DIR = '.openmake/worktrees';
export const WORKTREE_BRANCH_PREFIX = 'omk-task/';
/** taskId 재검증 — 경로·브랜치명에 들어가므로 UUID 문자만 허용(디렉토리 탈출·옵션 주입 차단). */
export const TASK_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

/**
 * 서버→디바이스 단방향 알림(bridge_notice) — 종류 화이트리스트와 표시 텍스트 상한.
 * 알림은 표시만 하고 아무것도 실행하지 않는다(임의 RPC 금지). 도구 이름은 서버 발 텍스트라
 * 제어문자를 걷어내고 길이를 자른 뒤에만 호스트로 넘긴다.
 */
export const NOTICE_KINDS: readonly string[] = ['approval_pending'];
export const NOTICE_TOOL_NAME_MAX = 100;

/**
 * 이 코어가 처리하는 요청 종류 — bridge_hello.capabilities 로 서버에 알린다. core.ts handleExec 의 case 와 1:1
 * (`__tests__/core.test.ts` 가 확인). 서버는 여기 없는 종류를 이 기기로 보내지 않는다.
 */
export const BRIDGE_KINDS: readonly string[] = [
    'exec', 'read', 'write', 'list', 'listAll', 'delete', 'task_end', 'worktree', 'folders', 'lsp_diagnostics', 'code_nav', 'test_runner',
];

/** 로컬 브라우저 요청 종류 — 호스트가 전용 프로필을 주고 Chrome 이 있을 때만 능력 목록에 넣는다(BridgeCore.capabilities). */
export const BROWSER_KIND = 'browser';
/**
 * 브라우저 업로드(uploadFile) 능력 — 요청 종류가 아니라 browser 요청 안의 액션이다(2026-10-06 추가).
 * 이 값을 알리지 않는 구버전 기기에는 서버가 업로드를 보내지 않고 모델에 "이 기기는 업로드를 지원하지 않는다"고 돌려준다.
 */
export const BROWSER_UPLOAD_CAPABILITY = 'browser_upload';

/** 요청 만료 판정의 시계 오차 허용(ms) — 서버와 PC 의 시계가 이만큼 어긋나도 정상 요청을 버리지 않는다. */
export const EXPIRY_SKEW_TOLERANCE_MS = 120000;
/** 중복 판정을 위해 기억하는 reqId 수 */
export const SEEN_REQ_MAX = 2000;

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

/**
 * 로컬 브라우저(Companion P2) — 전용 프로필 Chrome 을 CDP 로 제어한다.
 * 액션 형식·상한은 서버 샌드박스 러너(infra/task-runtime/browser-runner.mjs)와 같게 둔다.
 */
/** 한 번의 요청에서 실행하는 액션 수 상한 */
export const BROWSER_MAX_ACTIONS = 40;
/** 액션 1개의 대기 상한(ms) — 요소 대기·이동 완료 */
export const BROWSER_ACTION_TIMEOUT_MS = Number(process.env.OMK_BRIDGE_BROWSER_TIMEOUT_MS || 20000);
/** selector 없는 extractText·extractHtml 이 문서 읽기(readyState !== 'loading')를 기다리는 상한(ms) — 넘으면 던지지 않고 결과에 loading: true 를 싣는다 */
export const BROWSER_EXTRACT_READY_MS = Number(process.env.OMK_BRIDGE_BROWSER_EXTRACT_READY_MS || BROWSER_ACTION_TIMEOUT_MS);
/** wait 액션의 상한(ms) */
export const BROWSER_WAIT_MAX_MS = 10000;
/** 추출 결과(text·html) 길이 상한(chars) */
export const BROWSER_EXTRACT_MAX_CHARS = 8000;
/** snapshot 이 돌려주는 상호작용 요소 수 상한 */
export const BROWSER_SNAPSHOT_MAX_ELEMENTS = 100;
/** snapshot 요소 이름 길이 상한 */
export const BROWSER_SNAPSHOT_NAME_MAX = 120;
/** 입력 뒤 결과에 되돌려 주는 값의 길이 상한 — 모델이 "들어갔는지" 확인하는 용도라 앞부분이면 충분하다 */
export const BROWSER_FILL_ECHO_MAX_CHARS = 200;
/** uploadFile 한 번에 올리는 파일 수 상한 */
export const BROWSER_UPLOAD_MAX_FILES = 10;
/** uploadFile 파일 하나의 크기 상한(bytes) — 서버의 파일 쓰기 상한(LOCAL_BRIDGE_MAX_WRITE_BYTES 기본 8MiB)과 같은 값 */
export const BROWSER_UPLOAD_MAX_FILE_BYTES = Number(process.env.OMK_BRIDGE_UPLOAD_MAX_FILE_BYTES || 8 * 1024 * 1024);
/** CDP 명령 1회 응답 상한(ms) */
export const BROWSER_CDP_TIMEOUT_MS = 30000;
/** Chrome 기동 후 디버깅 포트가 열릴 때까지의 대기 상한(ms) */
export const BROWSER_LAUNCH_TIMEOUT_MS = 20000;
/** 정리할 때 Chrome 종료를 기다리는 상한(ms) */
export const BROWSER_EXIT_WAIT_MS = 5000;
/** 요소·주소 폴링 간격(ms) */
export const BROWSER_POLL_MS = 100;
/** 누르기 뒤 이동이 시작되는지 지켜보는 시간(ms) */
export const BROWSER_CLICK_SETTLE_MS = 250;
/** 작업별 탭 수 상한 — 넘으면 가장 오래된 작업의 탭을 닫는다 */
export const BROWSER_MAX_TABS = 4;
/** 확인창 기록 문구 길이·개수 상한(한 액션) */
export const BROWSER_DIALOG_MESSAGE_MAX = 300;
export const BROWSER_DIALOG_RECORD_MAX = 20;
/** 화면 없이 띄울지 — 테스트·서버 환경용. 기본은 사용자에게 보이는 창 */
export const BROWSER_HEADLESS = process.env.OMK_BRIDGE_BROWSER_HEADLESS === '1';
/** snapshot·smartClick 이 다루는 상호작용 역할 */
export const BROWSER_INTERACTIVE_ROLES: readonly string[] = [
    'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem',
    'tab', 'switch', 'searchbox', 'slider', 'spinbutton', 'option',
];
