//! `std::io::Error` → Node 형식 오류 문구.

/// `CODE: 설명, syscall '경로'`.
pub fn format(_err: &std::io::Error, _syscall: &str, _path: Option<&str>) -> String {
    todo!()
}
