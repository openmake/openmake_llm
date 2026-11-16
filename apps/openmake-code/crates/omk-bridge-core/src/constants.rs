//! 브리지 코어 공통 상수 — TS `constants.ts` 중 판정 함수가 쓰는 값. fixture `constants.json` 과 같아야 한다.

/// exec 1회 시간 제한(ms).
pub const EXEC_TIMEOUT_MS: u64 = 120_000;
/// exec 출력 버퍼 상한(bytes).
pub const MAX_BUFFER: u64 = 1024 * 1024;

/// exec 를 코어가 끊은 사유 — 결과 stderr 끝에 붙일 문구의 종류(설계 2026-11-16 D1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecStop {
    /// 시간 제한을 넘어 직접 자식을 끊었다.
    TimedOut,
    /// 출력이 [`MAX_BUFFER`] 를 넘어 끊었다.
    Overflow,
}

/// 중단 사유 문구 — TS `execStopNotice` 와 같은 글자(fixture `constants.json` `execStopNotice`). 초는 쓰인 시간 제한을
/// 1000 으로 나눠 올림한 값(최소 1), 상한은 [`MAX_BUFFER`] 의 MB.
pub fn exec_stop_notice(kind: ExecStop, timeout_ms: u64) -> String {
    match kind {
        ExecStop::TimedOut => format!(
            "[명령이 시간 제한({}초)을 넘어 중단됐습니다 — 끝나지 않거나 오래 걸리는 명령은 범위를 줄이거나 나눠서 실행하세요]",
            timeout_ms.div_ceil(1000).max(1)
        ),
        ExecStop::Overflow => format!(
            "[출력이 상한({}MB)을 넘어 중단됐습니다 — head·grep 등으로 출력을 줄여 다시 실행하세요]",
            MAX_BUFFER / (1024 * 1024)
        ),
    }
}

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
/// 도구 프로파일에서만 더 막는 자격 파일 — 확인 없이 뜨는 자식(폴더의 tsc 등)은 이 파일이 필요 없다(설계 D-7).
/// exec 프로파일에는 넣지 않는다 — 승인된 `npm install`·`gh` 가 쓴다. 목록이라 빠지는 이름이 생긴다(닫는 길은 허용 목록, PR-C).
pub const TOOL_SECRET_SUBPATHS: &[&str] = &[
    ".npmrc",
    ".yarnrc.yml",
    ".netrc",
    ".git-credentials",
    ".config/git/credentials",
    ".config/gh",
    ".config/hub",
    ".config/glab-cli",
    ".pypirc",
    ".cargo/credentials",
    ".cargo/credentials.toml",
    ".gem/credentials",
    ".m2/settings.xml",
    ".gradle/gradle.properties",
    ".composer/auth.json",
    ".config/composer/auth.json",
    ".config/op",
    ".terraform.d",
    ".azure",
    ".vault-token",
    ".pgpass",
    ".my.cnf",
    ".boto",
    ".s3cfg",
];

/// 도구 프로파일이 홈에서 읽기를 여는 허용 목록(홈 기준) — git 설정·mise·버전 파일·node/python 런타임 관리자(설계 2026-11-16
/// D-15·§9 L8). 나머지 홈은 읽기 거절(메타데이터만 허용). 새 관리자는 한 줄 더한다. `Library/Python`(framework 빌드)·
/// `.local/lib`(mise·pyenv·uv 등)은 pytest 탐지가 붙이는 사용자 site(`site.getusersitepackages()`)다.
pub const TOOL_HOME_READ_SUBPATHS: &[&str] = &[
    ".gitconfig",
    ".config/git",
    ".config/mise",
    ".config/mise.toml",
    ".mise.toml",
    "mise.toml",
    ".mise.local.toml",
    "mise.local.toml",
    ".mise",
    "mise",
    ".tool-versions",
    ".nvmrc",
    ".node-version",
    ".python-version",
    ".local/share/mise",
    ".local/state/mise",
    ".cache/mise",
    "Library/Caches/mise",
    ".nvm",
    ".volta",
    ".fnm",
    ".local/share/fnm",
    "Library/Application Support/fnm",
    ".local/state/fnm_multishells",
    ".asdf",
    ".asdfrc",
    ".nodenv",
    "n",
    "Library/pnpm",
    ".pyenv",
    ".local/share/uv/python",
    ".rye",
    "miniconda3",
    "anaconda3",
    "miniforge3",
    "mambaforge",
    "micromamba",
    "opt/anaconda3",
    "opt/miniconda3",
    ".conda",
    "Library/Python",
    ".local/lib",
    ".local/bin",
];
/// macOS 가 앱 이름으로 접근 권한 창을 띄우는 홈 위치 — 두 프로파일 모두 내용 읽기를 막고 메타데이터만 둔다(설계 D-16).
pub const HOME_PRIVACY_SUBPATHS: &[&str] = &[
    "Desktop",
    "Documents",
    "Downloads",
    "Pictures",
    "Music",
    "Movies",
    "Library/Mobile Documents",
    "Library/CloudStorage",
    "Library/Photos",
    "Library/Containers",
    "Library/Group Containers",
    "Library/Daemon Containers",
    "Library/Application Support/AddressBook",
    "Library/Calendars",
    "Library/Reminders",
];
/// 연결 폴더와 홈 사이 조상 폴더마다 도구 프로파일이 읽기를 여는 이름 — mise·버전 파일의 조상 탐색(설계 §8 M2·§9 L8).
pub const TOOL_ANCESTOR_READ_NAMES: &[&str] = &[
    "mise.toml",
    ".mise.toml",
    "mise.local.toml",
    ".mise.local.toml",
    ".config/mise.toml",
    ".config/mise",
    ".mise",
    "mise",
    ".tool-versions",
    ".nvmrc",
    ".node-version",
    ".python-version",
];
/// 조상 이름 줄을 붙이는 조상 폴더 수 상한(연결 폴더에 가까운 것부터).
pub const TOOL_ANCESTOR_MAX: usize = 16;
/// 추가 subpath(env 위치·심링크 realpath)·git 설정 literal 전체 상한(넘으면 앞에서부터, 조상 이름 줄은 세지 않는다).
pub const TOOL_READ_EXTRA_MAX: usize = 64;
/// git 전역·로컬 설정이 가리키는 파일 literal 상한(설계 D-18).
pub const GIT_CONFIG_READ_MAX: usize = 32;

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
/// 자식에게 넘길 PATH 를 절대경로 항목만 남겼더니 비었을 때의 값 — POSIX 의 빈 PATH 는 현재 폴더(연결 폴더) 한 항목이라
/// 폴더의 `git`·`python3` 가 떴다(설계 D-14 보완, 리뷰 r2 F4).
pub const FALLBACK_CHILD_PATH: &str = "/usr/bin:/bin";
/// 확인 없이 띄우는 git(worktree·연결 시점 탐지)에 늘 붙이는 인자 — 레포 설정의 fsmonitor·훅을 끈다(설계 D-2).
/// 경계는 도구 프로파일이 맡고 이것은 겹방어다.
pub const GIT_FIXED_ARGS: &[&str] = &[
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
];
/// 연결 시점 git 탐지를 감싸는 인라인 프로파일(`sandbox-exec -p`) — git 은 표준 입출력을 /dev/null 로 다시 열어 그 쓰기만 연다.
pub const GIT_PROBE_PROFILE: &str = r#"(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))(deny network*)"#;
/// worktree 연산 직전 대조에서 git 디렉터리가 연결 때 고정한 값과 다를 때의 거절(git 을 띄우지 않는다).
pub const GIT_DIR_MISMATCH_ERROR: &str =
    "git 디렉터리가 연결할 때와 달라 worktree 연산을 거부했습니다(폴더 재연결 필요).";
/// 파일 kind 가 git 금지 경로(git 디렉터리 자신·config·hooks, worktree 의 .git)를 쓰거나 지우려 할 때의 거절 머리.
pub const GIT_PATH_DENIED_PREFIX: &str = "git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ";
/// 감싼 자식에서 sandbox-exec 가 실행 파일을 띄우지 못했다(종료 코드 71) — 뒤에 `(<파일 이름>).` 가 붙는다, 종료 코드는 같은 126(설계 D-8).
pub const SANDBOX_SPAWN_ERROR_PREFIX: &str =
    "샌드박스 안에서 실행 파일을 띄우지 못해 실행을 거부했습니다";
/// 코어가 직접 읽는 gitfile(`gitdir: <경로>`) 크기 상한(바이트) — 경로 한 줄이면 충분하다. 넘으면 gitfile 이 아니다(TS 같음).
pub const GITFILE_MAX_BYTES: u64 = 4096;
/// worktree 를 만드는 자리(연결 폴더 기준).
pub const WORKTREE_DIR: &str = ".openmake/worktrees";
pub const WORKTREE_BRANCH_PREFIX: &str = "omk-task/";
/// taskId 형식 — TS `TASK_ID_RE.source`(플래그 없음). 경로·브랜치 이름에 들어가는 유일한 서버 문자열이다.
pub const TASK_ID_RE: &str = "^[a-zA-Z0-9-]{8,64}$";

// 읽기 전용 도구 (PR-1.4)

/// 탐색에서 제외하는 자격증명 글롭 — TS 는 `@openmake/config` `SENSITIVE_FILE_PATTERNS` 를 다시 내보낸다.
/// fixture `code-nav.json` `excludedFiles` 와 순서까지 같아야 한다. 같은 이름의 폴더도 건너뛴다.
pub const CODE_NAV_EXCLUDED_FILES: &[&str] = &[
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.jks",
    "*.keystore",
    "id_rsa",
    "id_rsa.*",
    "id_ed25519",
    "id_ed25519.*",
    ".npmrc",
    ".netrc",
    ".pgpass",
    ".htpasswd",
    "credentials",
    "credentials.*",
    "service-account*.json",
    "*.kdbx",
];
/// 탐색에서 제외하는 이름(폴더·파일 모두) — 서버 `TASK_CODE_NAV.EXCLUDED_DIRS` 와 같은 목록.
pub const CODE_NAV_EXCLUDED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
    "coverage",
    ".openmake",
];

/// code_nav 시간 예산 기본값(ms) — TS 는 `OMK_BRIDGE_CODE_NAV_TIMEOUT_MS || 15000`. 호스트가 `with_tool_timeouts` 로 바꾼다.
/// 실제 예산은 관문 제한의 4/5 이하다([`code_nav_budget_ms`]).
pub const CODE_NAV_TIMEOUT_MS: u64 = 15_000;

/// 실제로 쓰는 code_nav 예산 — 설정한 값은 상한이고, 감싼 관문 제한(`fs_timeout_ms`)의 4/5 이하로 묶는다. 예산이 관문보다
/// 늦게 끝나면 잘린 결과 대신 관문 오류가 먼저 나간다(설계 2026-11-15 D-3, TS `codeNavBudgetMs`). 기본값은 12000ms.
pub fn code_nav_budget_ms(configured: u64, gate_ms: u64) -> u64 {
    configured.min(gate_ms.saturating_mul(4) / 5)
}
/// 1회 요청에서 훑을 최대 파일 수.
pub const CODE_NAV_MAX_FILES: usize = 4000;
/// 내용을 읽을 파일 크기 상한(bytes).
pub const CODE_NAV_MAX_FILE_BYTES: u64 = 512 * 1024;
/// grep 매치 상한.
pub const CODE_NAV_MAX_MATCHES: usize = 400;
/// 한 파일에서 가져올 최대 매치 수.
pub const CODE_NAV_MAX_PER_FILE: usize = 20;
/// 매치 줄 1건 길이 상한(UTF-16 단위).
pub const CODE_NAV_LINE_MAX_CHARS: usize = 300;
/// 정규식 소스 길이 상한(UTF-16 단위).
pub const CODE_NAV_PATTERN_MAX_CHARS: usize = 500;
/// 코어 하나의 code_nav 동시 작업 수 — TS 에는 대응 값이 없다. 느린 판정은 예산까지만 이 칸을 쥔다(설계 D-62).
pub const CODE_NAV_MAX_CONCURRENT: usize = 2;
/// grep 판정 한 번의 역추적 스택 항목 수 상한(regress 사본의 `ExecLimits::max_backtrack`). 2^20−1 — 스택 `Vec` 용량이 2^20 항목,
/// 약 40MB(항목 약 40바이트)를 넘지 않는다. 넘으면 그 요청은 오류다. V8 의 정규식 스택 상한과 같은 종류의 한도다
/// (TS 는 스택 초과를 잡아 같은 문구의 요청 오류로 답한다 — 걸리는 문턱은 엔진마다 다르다).
pub const CODE_NAV_REGEX_MAX_BACKTRACK: usize = 1_048_575;
/// 진단 도구 1회 시간 제한 기본값(ms) — TS 는 `OMK_BRIDGE_DIAG_TIMEOUT_MS || 15000`.
pub const DIAG_TIMEOUT_MS: u64 = 15_000;
/// 파일당 진단 상한.
pub const DIAG_MAX_PER_FILE: usize = 20;
/// 전체 진단 상한(요청 `paths` 도 앞의 이만큼만 본다).
pub const DIAG_MAX_TOTAL: usize = 60;
/// 진단 메시지 1건 길이 상한(UTF-16 단위).
pub const DIAG_MSG_MAX: usize = 300;
/// pytest 탐지 자식 시간 제한(ms) — TS 도 상수다.
pub const TEST_RUNNER_PROBE_TIMEOUT_MS: u64 = 5_000;
/// py_compile 출력의 어떤 줄이 이것으로 시작하면 인터프리터가 못 뜬 것 — 그 파일은 "검사 못 함"(설계 D-21·§9 L1).
pub const PY_FATAL_MARKER: &str = "Fatal Python error:";
/// tsc 가 설정 파일을 못 읽음 — 샌드박스에서 이 출력이 나온 묶음의 진단은 버린다(설계 D-22).
pub const TSC_CONFIG_UNREADABLE: &str = "error TS5083:";
/// tsc 실행 전 `node_modules` 훑기에서 살펴볼 심링크 수 상한(설계 D-22·§9 N2).
pub const TSC_LINK_SCAN_MAX: usize = 2000;
