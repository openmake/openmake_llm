//! Node `path`(POSIX) 의 어휘적 경로 함수 — Rust std 에 같은 의미의 함수가 없어 직접 둔다.
//! 파일 시스템을 보지 않는다(심링크·실재 여부와 무관). 경로는 `String` 그대로 다룬다 — TS 가 문자열로 비교한다.

/// `path.posix.join` — 빈 인자는 건너뛰고 `/` 로 이은 뒤 정규화한다. 결과가 비면 `"."`.
pub fn join(parts: &[&str]) -> String {
    let joined = parts
        .iter()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("/");
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

/// `path.posix.resolve(base, rel)` — `rel` 이 절대 경로면 그것만, 아니면 `base/rel` 을 정규화하고 끝의 `/` 를 뗀다.
/// `base` 는 절대 경로여야 한다(Node 는 상대 `base` 에 현재 폴더를 붙이지만 코어는 그렇게 부르지 않는다).
pub fn resolve(base: &str, rel: &str) -> String {
    let joined = if rel.starts_with('/') {
        rel.to_owned()
    } else if rel.is_empty() {
        base.to_owned()
    } else {
        format!("{base}/{rel}")
    };
    let mut out = normalize(&joined);
    if out.len() > 1 && out.ends_with('/') {
        out.pop();
    }
    out
}

/// `path.posix.dirname` — 끝의 `/` 들은 무시하고 마지막 구간을 뗀다. `//a` → `//` 처럼 Node 의 글자 처리를 그대로 따른다.
pub fn dirname(path: &str) -> String {
    let b = path.as_bytes();
    if b.is_empty() {
        return ".".to_owned();
    }
    let has_root = b[0] == b'/';
    let mut end = None;
    let mut matched_slash = true;
    for i in (1..b.len()).rev() {
        if b[i] == b'/' {
            if !matched_slash {
                end = Some(i);
                break;
            }
        } else {
            matched_slash = false;
        }
    }
    match end {
        None if has_root => "/".to_owned(),
        None => ".".to_owned(),
        Some(1) if has_root => "//".to_owned(),
        // `/` 는 ASCII 라 UTF-8 글자 경계다.
        Some(e) => path[..e].to_owned(),
    }
}

/// `path.posix.relative(from, to)` — 둘 다 절대 경로여야 한다(`resolve` 와 같은 이유).
pub fn relative(from: &str, to: &str) -> String {
    if from == to {
        return String::new();
    }
    let from = resolve(from, "");
    let to = resolve(to, "");
    if from == to {
        return String::new();
    }
    // 바이트 비교 — 공통 접두와 `/` 위치는 UTF-16 단위로 비교한 Node 와 같다(`/` 는 ASCII).
    let (f, t) = (&from.as_bytes()[1..], &to.as_bytes()[1..]);
    let length = f.len().min(t.len());
    let mut last_common_sep: isize = -1;
    let mut i = 0;
    while i < length {
        if f[i] != t[i] {
            break;
        }
        if f[i] == b'/' {
            last_common_sep = i as isize;
        }
        i += 1;
    }
    if i == length {
        if t.len() > length {
            if t[i] == b'/' {
                return to[1 + i + 1..].to_owned();
            }
            if i == 0 {
                return to[1..].to_owned();
            }
        } else if f.len() > length {
            if f[i] == b'/' {
                last_common_sep = i as isize;
            } else if i == 0 {
                last_common_sep = 0;
            }
        }
    }
    let mut out = String::new();
    let start = (last_common_sep + 1) as usize;
    for j in start..=f.len() {
        if j == f.len() || f[j] == b'/' {
            out.push_str(if out.is_empty() { ".." } else { "/.." });
        }
    }
    let rest_start = (1 + last_common_sep) as usize;
    format!("{out}{}", &to[rest_start..])
}

#[cfg(test)]
mod tests {
    use super::{join, normalize};

    /// 기대값은 Node `path.posix.join`·`normalize` 실행 결과다(sandbox-profile fixture 에 넣기 어려운 경계).
    #[test]
    fn join_matches_node() {
        let cases: [(&[&str], &str); 19] = [
            (&[], "."),
            (&[""], "."),
            (&["", ""], "."),
            (&["a", "b"], "a/b"),
            (&["/a/", "/b/"], "/a/b/"),
            (&["a", ".."], "."),
            (&["a", "..", ".."], ".."),
            (&["../a", "../b"], "../b"),
            (&["/", ".."], "/"),
            (&["/a/b", "../../.."], "/"),
            (&["./"], "./"),
            (&["a/"], "a/"),
            (&["a", "./"], "a/"),
            (&["/"], "/"),
            (&["//"], "/"),
            (&["a//b/./c/"], "a/b/c/"),
            (&[".."], ".."),
            (&["...", "b"], ".../b"),
            (&["a", "..", "/"], "./"),
        ];
        for (parts, want) in cases {
            assert_eq!(join(parts), want, "join {parts:?}");
        }
    }

    #[test]
    fn normalize_matches_node() {
        let cases = [
            ("", "."),
            ("/", "/"),
            ("//a", "/a"),
            ("./", "./"),
            ("a/..", "."),
            ("a/../", "./"),
            ("/..", "/"),
            ("../..", "../.."),
            ("a/./b/.", "a/b"),
        ];
        for (input, want) in cases {
            assert_eq!(normalize(input), want, "normalize {input:?}");
        }
    }
}
