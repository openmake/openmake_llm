//! 경로 스코프 가드 — TS `scope.ts` `safeFromAsync`. base 밖 경로·심링크 탈출을 막는다.
//!
//! 컨테이너 없는 로컬에서는 심링크가 유일한 탈출로라, 존재하는 최근접 조상의 realpath 까지 본다.
//! 경로는 문자열로 비교한다(`abs == base || abs.starts_with(base + "/")`) — TS 와 같다.
//! base 끝에 `/` 가 붙으면 하위 경로가 전부 거부되는 것도 TS 그대로다.

use crate::node_error;
use crate::node_path::{dirname, resolve};

/// 거부 문구에 넣는 `rel` 표기 — TS 의 `${rel}` 이라 없으면 `undefined` 다.
fn rel_text(rel: Option<&str>) -> &str {
    rel.unwrap_or("undefined")
}

fn within(abs: &str, base: &str) -> bool {
    abs == base
        || abs
            .strip_prefix(base)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// 어휘 검사만 한다(파일 시스템을 보지 않는다). 통과하면 어휘적 절대 경로를 돌려준다.
pub fn lexical_resolve(base: &str, rel: Option<&str>) -> Result<String, String> {
    let abs = resolve(base, rel.filter(|r| !r.is_empty()).unwrap_or("."));
    if !within(&abs, base) {
        return Err(format!("폴더 스코프 밖 경로 거부: {}", rel_text(rel)));
    }
    Ok(abs)
}

fn realpath(p: &str) -> Result<String, String> {
    match std::fs::canonicalize(p) {
        // UTF-8 이 아닌 이름은 APFS 에서 생기지 않는다.
        Ok(real) => Ok(real.to_string_lossy().into_owned()),
        Err(e) => Err(node_error::format(&e, "realpath", Some(p))),
    }
}

/// 어휘 검사 + 최근접 조상 realpath 검사. 돌려주는 값은 어휘적 경로다(realpath 가 아니다 — 안쪽 심링크는 링크 경로 그대로).
///
/// 조상 탐색은 `lstat` 이 실패하는 동안 위로 올라간다. TS 와 같이 **어떤 오류든** "없음"으로 본다.
/// 대상이 없는 심링크(dangling)는 `lstat` 은 성공하고 realpath 가 실패해 거부된다(fail-closed).
pub fn safe_from(base: &str, rel: Option<&str>) -> Result<String, String> {
    let abs = lexical_resolve(base, rel)?;
    let mut probe = abs.clone();
    while std::fs::symlink_metadata(&probe).is_err() {
        probe = dirname(&probe);
    }
    let real = realpath(&probe)?;
    let base_real = realpath(base)?;
    if !within(&real, &base_real) {
        return Err(format!("심링크 스코프 탈출 거부: {}", rel_text(rel)));
    }
    Ok(abs)
}
