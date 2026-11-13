//! 브리지 코어 공통 상수 — TS `constants.ts` 중 판정 함수가 쓰는 값. fixture `constants.json` 과 같아야 한다.

/// exec 1회 시간 제한(ms).
pub const EXEC_TIMEOUT_MS: u64 = 120_000;
/// exec 출력 버퍼 상한(bytes).
pub const MAX_BUFFER: u64 = 1024 * 1024;

pub const SANDBOX_BIN: &str = "/usr/bin/sandbox-exec";

/// 워크스페이스 밖이지만 쓰기를 열어야 하는 툴 캐시 — 없으면 npm/pip/cargo 계열이 깨진다.
pub const CACHE_SUBPATHS: &[&str] = &[
    ".npm",
    ".cache",
    "Library/Caches",
    ".cargo",
    ".gradle",
    ".m2",
    ".yarn",
    ".pnpm-store",
    "go/pkg",
];
/// 읽기를 막는 비밀 경로.
pub const SECRET_SUBPATHS: &[&str] = &[
    ".ssh",
    ".aws",
    ".gnupg",
    ".kube",
    ".docker",
    ".config/gcloud",
    "Library/Keychains",
];

/// exec 자식에 넘기는 env 허용 목록 — 호스트 env 를 통째로 물려주면 헬퍼의 API 키 등 비밀이 도구 결과로 샌다.
pub const EXEC_ENV_ALLOWLIST_POSIX: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TERM",
    "COLORTERM",
    "LANG",
    "LANGUAGE",
    "TMPDIR",
    "TZ",
];
pub const EXEC_ENV_ALLOWLIST_PREFIX_POSIX: &[&str] = &["LC_"];
/// 셸 경로 탐색 자식에만 더 넘기는 위치 변수. `MISE_GITHUB_TOKEN` 같은 비밀이 같은 접두를 써서 접두 매칭 없이 하나씩 적는다.
pub const PATH_PROBE_ENV_EXTRA_POSIX: &[&str] = &[
    "ZDOTDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "MISE_DATA_DIR",
    "MISE_CONFIG_DIR",
    "MISE_CACHE_DIR",
    "MISE_STATE_DIR",
    "MISE_INSTALLS_DIR",
    "MISE_INSTALL_STORE_DIR",
    "MISE_PLUGINS_DIR",
    "MISE_SHIMS_DIR",
    "MISE_SHARED_INSTALL_DIRS",
    "MISE_GLOBAL_CONFIG_FILE",
    "MISE_GLOBAL_CONFIG_ROOT",
    "MISE_SYSTEM_CONFIG_DIR",
    "MISE_SYSTEM_DIR",
    "MISE_SYSTEM_CONFIG_FILE",
    "MISE_SYSTEM_DATA_DIR",
    "MISE_SYSTEM_INSTALLS_DIR",
    "MISE_SYSTEM_SHIMS_DIR",
];
pub const EXEC_ENV_ALLOWLIST_WIN32: &[&str] = &[
    "SystemRoot",
    "windir",
    "SystemDrive",
    "ComSpec",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "USERNAME",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "NUMBER_OF_PROCESSORS",
    "OS",
];

/// 이 코어가 처리하는 요청 종류 — 서버는 여기 없는 종류를 이 기기로 보내지 않는다.
pub const BRIDGE_KINDS: &[&str] = &[
    "exec",
    "read",
    "write",
    "list",
    "listAll",
    "delete",
    "task_end",
    "worktree",
    "folders",
    "lsp_diagnostics",
    "code_nav",
    "test_runner",
];

/// 브라우저 요청 종류 — 능력 목록에는 조건부로만 들어간다.
pub const BROWSER_KIND: &str = "browser";
/// 요청 만료 판정에서 서버·PC 시계 어긋남을 봐주는 폭(ms).
pub const EXPIRY_SKEW_TOLERANCE_MS: u64 = 120_000;
/// 중복 판정을 위해 기억하는 reqId 수.
pub const SEEN_REQ_MAX: usize = 2000;
/// `folders` 1회 상한 — 서버 `BRIDGE_FOLDERS_MAX_ENTRIES` 와 같은 축.
pub const FOLDERS_MAX_ENTRIES: usize = 200;
/// `listAll` 1회 상한.
pub const LIST_ALL_MAX: usize = 1000;
/// 파일 kind FS 처리 시간 제한 기본값(ms). TS 는 `OMK_BRIDGE_FS_TIMEOUT_MS || 15000` 이다.
pub const FS_OP_TIMEOUT_DEFAULT_MS: u64 = 15_000;
/// 코어 하나가 동시에 돌리는 FS 작업 수 — TS 에는 대응 값이 없고, libuv 스레드 풀 기본값(4)이
/// 사실상의 상한이었다. 블록된 볼륨에 요청이 쌓여도 스레드가 늘지 않게 한다(설계 D-13).
pub const FS_MAX_CONCURRENT: usize = 4;

// exec·worktree (PR-1.3)

/// 로그인 셸·mise PATH 탐지 1회 시간 제한(ms).
pub const PATH_PROBE_TIMEOUT_MS: u64 = 5_000;
/// 샌드박스 git 디렉터리 탐지 시간 제한(ms).
pub const GIT_PROBE_TIMEOUT_MS: u64 = 5_000;
/// worktree 를 만드는 자리(연결 폴더 기준).
pub const WORKTREE_DIR: &str = ".openmake/worktrees";
pub const WORKTREE_BRANCH_PREFIX: &str = "omk-task/";
/// taskId 형식 — TS `TASK_ID_RE.source`(플래그 없음). 경로·브랜치 이름에 들어가는 유일한 서버 문자열이다.
pub const TASK_ID_RE: &str = "^[a-zA-Z0-9-]{8,64}$";
