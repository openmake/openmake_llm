//! 파일 kind 처리 — TS `core.ts` 의 read·write·list·listAll·delete·folders·resolveBase·walk. 동기 함수다.

pub fn resolve_base(_root: &str, _folder: Option<&str>) -> Result<String, String> {
    todo!()
}
pub fn read(_base: &str, _path: Option<&str>) -> Result<String, String> {
    todo!()
}
pub fn write(_base: &str, _path: Option<&str>, _content_b64: Option<&str>) -> Result<(), String> {
    todo!()
}
pub fn list(_base: &str, _path: Option<&str>) -> Result<Vec<String>, String> {
    todo!()
}
pub fn list_all(_base: &str) -> Result<Vec<String>, String> {
    todo!()
}
pub fn delete(_base: &str, _path: Option<&str>) -> Result<(), String> {
    todo!()
}
pub fn folders(_root: &str, _path: Option<&str>) -> Result<(Vec<String>, bool), String> {
    todo!()
}
