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

/// `path.posix.extname` — 마지막 구간의 마지막 `.` 부터 끝까지. 구간이 `.` 로 시작하고 다른 `.` 가 없으면(`.env`) 빈 글자,
/// `..` 도 빈 글자. 끝의 `/` 는 무시한다.
pub fn extname(path: &str) -> String {
    // Node 의 뒤에서 훑는 상태 기계 그대로 — `/`·`.` 는 ASCII 라 바이트로 본다.
    let p = path.as_bytes();
    let (mut start_dot, mut start_part, mut end) = (None, 0, None);
    let mut matched_slash = true;
    // 0 = 아직 `.` 앞 글자 없음, 1 = `.` 가 연달아 둘 이상, -1 = `.` 앞에 다른 글자가 있다.
    let mut pre_dot_state = 0;
    for i in (0..p.len()).rev() {
        if p[i] == b'/' {
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            continue;
        }
        if end.is_none() {
            matched_slash = false;
            end = Some(i + 1);
        }
        if p[i] == b'.' {
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if pre_dot_state != 1 {
                pre_dot_state = 1;
            }
        } else if start_dot.is_some() {
            pre_dot_state = -1;
        }
    }
    match (start_dot, end) {
        (Some(dot), Some(end))
            if pre_dot_state != 0
                && !(pre_dot_state == 1 && dot + 1 == end && dot == start_part + 1) =>
        {
            path[dot..end].to_owned()
        }
        _ => String::new(),
    }
}

/// `path.posix.basename(p)` — 끝의 `/` 를 무시한 마지막 구간.
pub fn basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(i) => trimmed[i + 1..].to_owned(),
        None => trimmed.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{basename, extname, join, normalize};

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

    /// 기대값은 Node 24.22.2 `path.posix.extname`·`basename` 실행 결과다(PR-1.4 단계 0 ⑤).
    #[test]
    fn extname_and_basename_match_node() {
        let cases = [
            (".ts", "", ".ts"),
            ("a.", ".", "a."),
            ("a..ts", ".ts", "a..ts"),
            ("a.ts/", ".ts", "a.ts"),
            ("..", "", ".."),
            (".", "", "."),
            ("a.b.c", ".c", "a.b.c"),
            ("/x/.env", "", ".env"),
            ("a/b.TS", ".TS", "b.TS"),
            ("", "", ""),
            (".a.b", ".b", ".a.b"),
            ("x/..ts", ".ts", "..ts"),
            ("a.d.ts", ".ts", "a.d.ts"),
            ("/", "", ""),
            ("a//", "", "a"),
            ("a/b//", "", "b"),
            ("/a.ts", ".ts", "a.ts"),
            ("..ts", ".ts", "..ts"),
            ("...", ".", "..."),
            ("a.ts.", ".", "a.ts."),
            ("x/.", "", "."),
            ("x/..", "", ".."),
            (".a", "", ".a"),
            ("..a", ".a", "..a"),
            ("a/.b.c", ".c", ".b.c"),
            ("한글.파일", ".파일", "한글.파일"),
            ("😀.ts", ".ts", "😀.ts"),
        ];
        for (input, ext, base) in cases {
            assert_eq!(
                (extname(input), basename(input)),
                (ext.to_owned(), base.to_owned()),
                "{input:?}"
            );
        }
    }
}
