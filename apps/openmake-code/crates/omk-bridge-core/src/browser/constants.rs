//! 브라우저 상수·문구·표 — TS `constants.ts` 의 `BROWSER_*`, `local-browser-defs.ts` 의 문구·표, `@openmake/config` 의
//! 분류표·흐름 상한. 값은 fixture `browser-constants` 가 TS 와 대조한다. 환경으로 바뀌는 다섯 값(시간·크기·화면 없음)은
//! 여기 **기본값**만 두고, 호스트가 환경을 읽어 넘긴다(코어는 환경을 읽지 않는다 — PR-1.6b `BrowserEnv`).

pub use crate::constants::BROWSER_KIND;

/// 한 번의 요청에서 실행하는 액션 수 상한
pub const BROWSER_MAX_ACTIONS: usize = 40;
/// 액션 1개의 대기 상한(ms) 기본값 — 요소 대기·이동 완료. 환경 `OMK_BRIDGE_BROWSER_TIMEOUT_MS`
pub const BROWSER_ACTION_TIMEOUT_MS: u64 = 20_000;
/// selector 없는 추출이 문서 읽기를 기다리는 상한(ms) 기본값 — TS 처럼 액션 상한과 같다. 환경 `OMK_BRIDGE_BROWSER_EXTRACT_READY_MS`
pub const BROWSER_EXTRACT_READY_MS: u64 = BROWSER_ACTION_TIMEOUT_MS;
/// wait 액션의 상한(ms)
pub const BROWSER_WAIT_MAX_MS: u64 = 10_000;
/// 추출 결과(text·html) 길이 상한(UTF-16 단위)
pub const BROWSER_EXTRACT_MAX_CHARS: usize = 8000;
/// snapshot 이 돌려주는 상호작용 요소 수 상한
pub const BROWSER_SNAPSHOT_MAX_ELEMENTS: usize = 100;
/// snapshot 요소 이름 길이 상한
pub const BROWSER_SNAPSHOT_NAME_MAX: usize = 120;
/// 입력 뒤 결과에 되돌려 주는 값의 길이 상한
pub const BROWSER_FILL_ECHO_MAX_CHARS: usize = 200;
/// uploadFile 한 번에 올리는 파일 수 상한
pub const BROWSER_UPLOAD_MAX_FILES: usize = 10;
/// uploadFile 파일 하나의 크기 상한(bytes) 기본값 — 환경 `OMK_BRIDGE_UPLOAD_MAX_FILE_BYTES`
pub const BROWSER_UPLOAD_MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
/// CDP 명령 1회 응답 상한(ms)
pub const BROWSER_CDP_TIMEOUT_MS: u64 = 30_000;
/// Chrome 기동 후 디버깅 포트가 열릴 때까지의 대기 상한(ms)
pub const BROWSER_LAUNCH_TIMEOUT_MS: u64 = 20_000;
/// 정리할 때 Chrome 종료를 기다리는 상한(ms)
pub const BROWSER_EXIT_WAIT_MS: u64 = 5000;
/// 요소·주소 폴링 간격(ms)
pub const BROWSER_POLL_MS: u64 = 100;
/// 누르기 뒤 이동이 시작되는지 지켜보는 시간(ms)
pub const BROWSER_CLICK_SETTLE_MS: u64 = 250;
/// 작업별 탭 수 상한
pub const BROWSER_MAX_TABS: usize = 4;
/// 동시에 실행하는 작업 수 — `BROWSER_MAX_TABS` 보다 작아야 회수할 탭이 남는다
pub const BROWSER_MAX_CONCURRENT: usize = 3;
/// 확인창 기록 문구 길이·개수 상한(한 액션)
pub const BROWSER_DIALOG_MESSAGE_MAX: usize = 300;
pub const BROWSER_DIALOG_RECORD_MAX: usize = 20;
/// 호출이 끝날 때 받는 중인 다운로드를 기다리는 상한(ms) 기본값 — 환경 `OMK_BRIDGE_BROWSER_DOWNLOAD_WAIT_MS`
pub const BROWSER_DOWNLOAD_WAIT_MS: u64 = 5000;
/// 다운로드 귀속용 새 창 표(새 창 targetId → 연 탭의 작업) 크기 상한 — 넘으면 가장 오래된 것부터 버린다
pub const BROWSER_POPUP_TRACK_MAX: usize = 64;
/// 다운로드 저장 이름이 겹칠 때 " (n)" 을 붙여 보는 횟수 상한
pub const BROWSER_DOWNLOAD_NAME_TRIES: usize = 100;
/// 다운로드 대기 폴더 = 전용 프로필 폴더 + 이 접미사
pub const BROWSER_DOWNLOAD_STAGING_SUFFIX: &str = "-downloads";
/// 전용 Chrome 을 띄우는 프로필
pub const BROWSER_PROFILE_DIRECTORY: &str = "Default";
/// 다운로드 제안 이름이 경로 글자를 품거나 빈·점 이름일 때 쓰는 이름
pub const BROWSER_DOWNLOAD_FALLBACK_NAME: &str = "download";
/// 화면 없이 띄울지 기본값 — 환경 `OMK_BRIDGE_BROWSER_HEADLESS` 가 `1` 일 때만 참
pub const BROWSER_HEADLESS: bool = false;
/// 브라우저 업로드 능력 — 요청 종류가 아니라 browser 요청 안의 액션이다
pub const BROWSER_UPLOAD_CAPABILITY: &str = "browser_upload";
/// if·repeat 를 겹칠 수 있는 단계 수(`@openmake/config`)
pub const BROWSER_FLOW_MAX_DEPTH: usize = 2;
/// repeat 의 times 상한(`@openmake/config`)
pub const BROWSER_REPEAT_MAX: u32 = 20;
/// 승인 카드·오류 문구에 싣는 값의 길이 상한(`@openmake/config` `DETAIL_MAX_CHARS`, UTF-16 단위)
pub const BROWSER_DETAIL_MAX_CHARS: usize = 200;

/// snapshot·smartClick 이 다루는 상호작용 역할
pub const BROWSER_INTERACTIVE_ROLES: [&str; 13] = [
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "menuitem",
    "tab",
    "switch",
    "searchbox",
    "slider",
    "spinbutton",
    "option",
];

/// 페이지가 있어야 하는 액션(빈 페이지에서는 실행하지 않는다)
pub const PAGE_ACTIONS: [&str; 11] = [
    "click",
    "fill",
    "snapshot",
    "smartClick",
    "smartFill",
    "press",
    "waitFor",
    "screenshot",
    "extractText",
    "extractHtml",
    "uploadFile",
];

/// 액션 분류 — observe: 읽기, navigate: 주소 이동, write: 입력·키·확인창 수락, click: 누르기, upload: PC 파일 올리기
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionClass {
    Observe,
    Navigate,
    Write,
    Click,
    Upload,
}

impl ActionClass {
    pub fn as_str(self) -> &'static str {
        match self {
            ActionClass::Observe => "observe",
            ActionClass::Navigate => "navigate",
            ActionClass::Write => "write",
            ActionClass::Click => "click",
            ActionClass::Upload => "upload",
        }
    }
}

/// 분류표(`dialog` 는 표 밖 — accept 로 가른다). 표에 없는 종류는 쓰기(TS 는 프로토타입 이름에 함수를 돌려받지만 결과가 같다, D-75).
pub const ACTION_CLASS: [(&str, ActionClass); 13] = [
    ("goto", ActionClass::Navigate),
    ("click", ActionClass::Click),
    ("smartClick", ActionClass::Click),
    ("fill", ActionClass::Write),
    ("smartFill", ActionClass::Write),
    ("press", ActionClass::Write),
    ("snapshot", ActionClass::Observe),
    ("wait", ActionClass::Observe),
    ("waitFor", ActionClass::Observe),
    ("screenshot", ActionClass::Observe),
    ("extractText", ActionClass::Observe),
    ("extractHtml", ActionClass::Observe),
    ("uploadFile", ActionClass::Upload),
];

/// press 의 키 표 — (이름, key, code, keyCode, text)
pub const KEYS: [(&str, &str, &str, u32, Option<&str>); 14] = [
    ("Enter", "Enter", "Enter", 13, Some("\r")),
    ("Tab", "Tab", "Tab", 9, None),
    ("Escape", "Escape", "Escape", 27, None),
    ("Backspace", "Backspace", "Backspace", 8, None),
    ("Delete", "Delete", "Delete", 46, None),
    ("ArrowLeft", "ArrowLeft", "ArrowLeft", 37, None),
    ("ArrowUp", "ArrowUp", "ArrowUp", 38, None),
    ("ArrowRight", "ArrowRight", "ArrowRight", 39, None),
    ("ArrowDown", "ArrowDown", "ArrowDown", 40, None),
    ("Home", "Home", "Home", 36, None),
    ("End", "End", "End", 35, None),
    ("PageUp", "PageUp", "PageUp", 33, None),
    ("PageDown", "PageDown", "PageDown", 34, None),
    ("Space", " ", "Space", 32, Some(" ")),
];

/// 조합 키 — 이름 → CDP modifiers 비트
pub const MODIFIERS: [(&str, u32); 6] = [
    ("Alt", 1),
    ("Control", 2),
    ("Ctrl", 2),
    ("Meta", 4),
    ("Command", 4),
    ("Shift", 8),
];
/// Control·Meta 조합은 글자를 넣지 않는다(단축키)
pub const MODIFIER_NO_TEXT: u32 = 2 | 4;

/// 차단 표식 종류(`types.ts` `BrowserPolicyBlockKind`)
pub const POLICY_BLOCK_KINDS: [&str; 6] = [
    "site_off_list",
    "site_denied",
    "blocked_url",
    "user_control",
    "upload_unapproved",
    "upload_rejected",
];

pub const UPLOAD_UNSUPPORTED_ERROR: &str = "이 실행 위치에서는 파일 업로드를 할 수 없습니다";
pub const UPLOAD_HOST_CHANGED_ERROR: &str = "파일 칸을 기다리는 동안 다른 사이트로 이동해 업로드하지 않았습니다 — 현재 페이지를 다시 확인한 뒤 요청하세요";
pub const BLANK_PAGE_ERROR: &str =
    "빈 페이지(about:blank)에서 실행됨 — 먼저 goto 로 페이지를 여세요";
/// 페이지 안에서 도는 조각 — 요소의 현재 값. 비밀번호 칸과 없는 요소는 null.
pub const FIELD_VALUE_JS: &str = "(el) => { if (!el) return null; if (el instanceof HTMLInputElement && el.type === 'password') return null; return 'value' in el && typeof el.value === 'string' ? el.value : (el.isContentEditable ? el.innerText : null); }";
/// 페이지 안에서 도는 조각 — el 이 값(value)을 가진 양식 요소인가
pub const FIELD_IS_FORM_JS: &str = "(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)";
pub const BROWSER_USER_CONTROL_ERROR: &str = "사용자가 브라우저를 직접 조작하는 중이라 실행하지 않았습니다. 사용자가 제어권을 돌려주면 현재 페이지를 다시 관찰(snapshot·extractText)한 뒤 이어가세요.";
pub const STOPPED_ERROR: &str = "사용자가 브라우저 작업을 중지했습니다";
/// taskId 없는 요청의 공용 탭 키
pub const DEFAULT_TAB: &str = "_default";
