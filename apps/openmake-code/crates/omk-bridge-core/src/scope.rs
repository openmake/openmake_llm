//! 경로 스코프 가드 — TS `scope.ts` `safeFromAsync`.

/// 어휘 검사만 한다(파일 시스템을 보지 않는다).
pub fn lexical_resolve(_base: &str, _rel: Option<&str>) -> Result<String, String> {
    todo!()
}

/// 어휘 검사 + 최근접 조상 realpath 검사.
pub fn safe_from(_base: &str, _rel: Option<&str>) -> Result<String, String> {
    todo!()
}
