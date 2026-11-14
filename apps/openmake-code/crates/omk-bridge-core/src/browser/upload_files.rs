//! 업로드할 파일 검사 — uploadFile 이 사이트로 내보낼 수 있는 파일은 그 작업의 연결 폴더 안에 있는 보통 파일뿐이다
//! (TS `upload-files.ts`).
//!
//! 거절: 상대 경로가 아닌 것(절대 경로·`\` 시작·드라이브 문자), `..` 구간, 숨김 파일·숨김 폴더 안(이름이 `.` 으로 시작),
//! 심볼릭 링크로 폴더 밖이나 숨김 파일로 나가는 것, 폴더·없는 파일, 크기 상한 초과, 파일 수 상한 초과. 통과한 파일은
//! realpath 로 돌려준다 — 브라우저에는 검사한 그 파일을 넘긴다. FS 를 보므로 호출부가 관문 안에서 부른다.

use serde_json::Value;

use super::constants::BROWSER_UPLOAD_MAX_FILES;
use crate::js_text::js_trim;
use crate::node_error;
use crate::node_path;
use crate::scope;

/// 경로 구간 — `/` 와 `\` 를 모두 구분으로 본다(서버·모델은 `/`, Windows 표기도 같은 규칙).
fn segments(s: &str) -> impl Iterator<Item = &str> {
    s.split(['/', '\\'])
}

fn is_hidden<'a>(mut segs: impl Iterator<Item = &'a str>) -> bool {
    segs.any(|s| s.starts_with('.'))
}

/// TS `path.isAbsolute || path.win32.isAbsolute || /^[A-Za-z]:/` — `/`·`\` 로 시작하거나 드라이브 문자.
fn not_relative(rel: &str) -> bool {
    let b = rel.as_bytes();
    rel.starts_with(['/', '\\']) || (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':')
}

fn realpath(p: &str) -> Result<String, std::io::Error> {
    std::fs::canonicalize(p).map(|r| r.to_string_lossy().into_owned())
}

fn resolve_one(base_real: &str, rel: &Value, max_file_bytes: u64) -> Result<String, String> {
    let Some(rel) = rel.as_str().filter(|s| !js_trim(s).is_empty()) else {
        return Err("업로드할 파일 이름이 비어 있습니다".to_owned());
    };
    if not_relative(rel) {
        return Err(format!("폴더 기준 상대 경로만 올릴 수 있습니다: {rel}"));
    }
    let segs: Vec<&str> = segments(rel)
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();
    if segs.contains(&"..") {
        return Err(format!("폴더 밖 파일은 올릴 수 없습니다: {rel}"));
    }
    if is_hidden(segs.iter().copied()) {
        return Err(format!("숨김 파일은 올릴 수 없습니다: {rel}"));
    }
    let abs = scope::safe_from(base_real, Some(&segs.join("/")))?;
    let real = realpath(&abs).map_err(|_| format!("파일이 없습니다: {rel}"))?;
    let inside = node_path::relative(base_real, &real);
    // TS `inside.startsWith('..')` — `..a` 같은 이름도 밖으로 본다(글자 비교 그대로)
    if inside.is_empty() || inside.starts_with("..") || inside.starts_with('/') {
        return Err(format!("폴더 밖 파일은 올릴 수 없습니다: {rel}"));
    }
    if is_hidden(segments(&inside)) {
        return Err(format!("숨김 파일은 올릴 수 없습니다: {rel}"));
    }
    let st = std::fs::metadata(&real).map_err(|e| node_error::format(&e, "stat", Some(&real)))?;
    if !st.is_file() {
        return Err(format!("파일이 아닙니다: {rel}"));
    }
    if st.len() > max_file_bytes {
        return Err(format!(
            "파일이 너무 큽니다({}b > {max_file_bytes}b): {rel}",
            st.len()
        ));
    }
    Ok(real)
}

/// 연결 폴더(`base_abs`) 기준 상대 경로 목록 → 검사를 통과한 실제 경로 목록. 하나라도 걸리면 그 사유(앞의 것부터).
/// `max_file_bytes` 는 호스트가 환경으로 정한 상한(기본 `BROWSER_UPLOAD_MAX_FILE_BYTES`).
pub fn resolve_upload_files(
    base_abs: &str,
    files: Option<&Value>,
    max_file_bytes: u64,
) -> Result<Vec<String>, String> {
    let Some(list) = files.and_then(Value::as_array).filter(|a| !a.is_empty()) else {
        return Err("uploadFile 액션에는 files(폴더 기준 상대 경로 배열)가 필요합니다".to_owned());
    };
    if list.len() > BROWSER_UPLOAD_MAX_FILES {
        return Err(format!(
            "한 번에 올릴 수 있는 파일은 {BROWSER_UPLOAD_MAX_FILES}개까지입니다({}개)",
            list.len()
        ));
    }
    let base_real =
        realpath(base_abs).map_err(|e| node_error::format(&e, "realpath", Some(base_abs)))?;
    list.iter()
        .map(|rel| resolve_one(&base_real, rel, max_file_bytes))
        .collect()
}
