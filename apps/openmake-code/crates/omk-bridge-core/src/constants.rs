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
pub const SECRET_SUBPATHS: &[&str] = &[".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config/gcloud", "Library/Keychains"];

/// exec 자식에 넘기는 env 허용 목록 — 호스트 env 를 통째로 물려주면 헬퍼의 API 키 등 비밀이 도구 결과로 샌다.
pub const EXEC_ENV_ALLOWLIST_POSIX: &[&str] =
    &["HOME", "USER", "LOGNAME", "SHELL", "TERM", "COLORTERM", "LANG", "LANGUAGE", "TMPDIR", "TZ"];
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
