//! Node `path`(POSIX) 의 어휘적 경로 함수 — Rust std 에 같은 의미의 함수가 없어 직접 둔다.
//! 파일 시스템을 보지 않는다(심링크·실재 여부와 무관). 이 PR 은 `join` 만 쓴다.

/// `path.posix.join` — 빈 인자는 건너뛰고 `/` 로 이은 뒤 정규화한다. 결과가 비면 `"."`.
pub fn join(parts: &[&str]) -> String {
    let joined = parts.iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("/");
    if joined.is_empty() {
        return ".".to_owned();
    }
    normalize(&joined)
}

/// `path.posix.normalize` — 중복 `/`·`.` 를 지우고 `..` 를 앞 구간과 상쇄한다. 끝의 `/` 는 유지한다.
/// 절대 경로는 루트 위로 올라가지 않고, 상대 경로는 남는 `..` 를 앞에 둔다.
pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_owned();
    }
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut segs: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if segs.last().is_some_and(|s| *s != "..") {
                    segs.pop();
                } else if !absolute {
                    segs.push("..");
                }
            }
            s => segs.push(s),
        }
    }
    let body = segs.join("/");
    if body.is_empty() {
        return match (absolute, trailing) {
            (true, _) => "/".to_owned(),
            (false, true) => "./".to_owned(),
            (false, false) => ".".to_owned(),
        };
    }
    let mut out = if absolute { format!("/{body}") } else { body };
    if trailing {
        out.push('/');
    }
    out
}
