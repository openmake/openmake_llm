//! 코드 탐색(code_nav) — TS `code-nav.ts` 의 `isSecretFile`·`walkFiles`·grep·files.

/// 훑기 결과 — base 기준 상대경로(UTF-16 순 정렬)·잘림·민감 정책으로 건너뛴 수.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Walk {
    pub files: Vec<String>,
    pub truncated: bool,
    pub skipped: usize,
}

pub fn is_secret_file(_name: &str) -> bool {
    false
}

pub fn walk_files(_base: &str, _start: &str, _expired: &dyn Fn() -> bool) -> Walk {
    Walk {
        files: Vec::new(),
        truncated: false,
        skipped: 0,
    }
}
