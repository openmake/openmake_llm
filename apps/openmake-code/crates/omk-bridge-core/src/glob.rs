//! 글롭 판정 — TS `code-nav.ts` `globToRegExp` 의 뜻을 정규식 엔진 없이 옮긴다(설계 D-60).

/// 글롭 하나.
pub struct Glob {
    basename_only: bool,
}

impl Glob {
    pub fn parse(glob: &str) -> Glob {
        Glob {
            basename_only: !glob.contains('/'),
        }
    }

    pub fn basename_only(&self) -> bool {
        self.basename_only
    }

    pub fn is_match(&self, _text: &str) -> bool {
        false
    }

    pub fn is_match_ascii_icase(&self, _text: &str) -> bool {
        false
    }
}
