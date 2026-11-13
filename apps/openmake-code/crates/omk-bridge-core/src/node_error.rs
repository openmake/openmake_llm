//! `std::io::Error` → Node 형식 오류 문구(설계 D-15).
//!
//! 파일 kind 의 실패 문구는 서버를 거쳐 모델이 읽는다. Rust 기본 표기(`No such file or directory (os error 2)`)를
//! 그대로 내면 같은 실패에 TS 와 다른 글자가 나가므로, Node 가 내는 `CODE: 설명, syscall '경로'` 꼴을 만든다.
//! 설명은 libuv `uv_strerror` 의 글자다(Node 24.22.2 에서 확인).

use std::io;

/// 번호가 macOS·Linux 에서 같은 errno.
const COMMON: [(i32, &str, &str); 13] = [
    (1, "EPERM", "operation not permitted"),
    (2, "ENOENT", "no such file or directory"),
    (5, "EIO", "i/o error"),
    (13, "EACCES", "permission denied"),
    (16, "EBUSY", "resource busy or locked"),
    (17, "EEXIST", "file already exists"),
    (18, "EXDEV", "cross-device link not permitted"),
    (20, "ENOTDIR", "not a directory"),
    (21, "EISDIR", "illegal operation on a directory"),
    (22, "EINVAL", "invalid argument"),
    (24, "EMFILE", "too many open files"),
    (28, "ENOSPC", "no space left on device"),
    (30, "EROFS", "read-only file system"),
];

/// 플랫폼마다 번호가 다른 errno — Linux·Windows 표는 Windows 이전(PR-5.1)에서 더한다.
#[cfg(target_os = "macos")]
const PLATFORM: [(i32, &str, &str); 3] = [
    (62, "ELOOP", "too many symbolic links encountered"),
    (63, "ENAMETOOLONG", "name too long"),
    (66, "ENOTEMPTY", "directory not empty"),
];
#[cfg(not(target_os = "macos"))]
const PLATFORM: [(i32, &str, &str); 0] = [];

/// Node 형식 문구. `path` 가 없는 호출 자리(예: 폴더를 `read`)는 `, syscall` 로 끝난다.
/// 표에 없는 errno 는 Node 가 모르는 errno 에 쓰는 `Unknown system error -N` 꼴이다.
pub fn format(err: &io::Error, syscall: &str, path: Option<&str>) -> String {
    let errno = err.raw_os_error().unwrap_or(0);
    let known = COMMON.iter().chain(PLATFORM.iter()).find(|(n, _, _)| *n == errno);
    let (code, desc) = match known {
        Some((_, code, desc)) => ((*code).to_owned(), (*desc).to_owned()),
        None => {
            let unknown = format!("Unknown system error -{errno}");
            (unknown.clone(), unknown)
        }
    };
    match path {
        Some(p) => format!("{code}: {desc}, {syscall} '{p}'"),
        None => format!("{code}: {desc}, {syscall}"),
    }
}

/// Node 는 NUL 이 든 경로를 시스템 호출 전에 거절한다(`ERR_INVALID_ARG_VALUE`). 그 문구를 만든다.
pub fn null_bytes(path: &str) -> String {
    let mut inspected = inspect_string(path);
    // Node 는 inspect 결과를 UTF-16 128 단위에서 자른다. 대리 쌍 한가운데는 자를 수 없어 그 글자를 뺀다.
    if inspected.encode_utf16().count() > 128 {
        let mut units = 0;
        let cut = inspected
            .char_indices()
            .find(|(_, c)| {
                units += c.len_utf16();
                units > 128
            })
            .map_or(inspected.len(), |(i, _)| i);
        inspected.truncate(cut);
        inspected.push_str("...");
    }
    format!(
        "The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received {inspected}"
    )
}

/// `util.inspect(문자열)` — 따옴표 고르기, 제어 문자 이스케이프, 긴 문자열의 줄 나눔(`+\n  `)까지 Node 와 같게.
fn inspect_string(s: &str) -> String {
    let len = s.encode_utf16().count();
    if len > 16 && len > 76 && s.contains('\n') {
        let mut lines = Vec::new();
        let mut rest = s;
        while let Some(i) = rest.find('\n') {
            lines.push(&rest[..=i]);
            rest = &rest[i + 1..];
        }
        if !rest.is_empty() {
            lines.push(rest);
        }
        return lines
            .iter()
            .map(|l| quote(l))
            .collect::<Vec<_>>()
            .join(" +\n  ");
    }
    quote(s)
}

fn quote(s: &str) -> String {
    let (open, escape_single) = if !s.contains('\'') {
        ('\'', true)
    } else if !s.contains('"') {
        ('"', false)
    } else if !s.contains('`') && !s.contains("${") {
        ('`', false)
    } else {
        ('\'', true)
    };
    let mut out = String::with_capacity(s.len() + 2);
    out.push(open);
    for c in s.chars() {
        match c {
            '\'' if escape_single => out.push_str("\\'"),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 || (0x7f..0xa0).contains(&(c as u32)) => {
                out.push_str(&format!("\\x{:02X}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push(open);
    out
}

#[cfg(test)]
mod tests {
    use super::{format, null_bytes};
    use std::io::Error;

    #[test]
    fn known_errno_with_and_without_path() {
        let e = Error::from_raw_os_error(2);
        assert_eq!(format(&e, "open", Some("/w/a")), "ENOENT: no such file or directory, open '/w/a'");
        let e = Error::from_raw_os_error(21);
        assert_eq!(format(&e, "read", None), "EISDIR: illegal operation on a directory, read");
    }

    #[test]
    fn unknown_errno_uses_node_unknown_form() {
        let e = Error::from_raw_os_error(1000);
        assert_eq!(
            format(&e, "open", Some("/w/a")),
            "Unknown system error -1000: Unknown system error -1000, open '/w/a'"
        );
    }

    /// 기대값은 Node 24.22.2 의 `fs.promises.readFile(<경로>)` 문구다.
    #[test]
    fn null_bytes_matches_node_inspect() {
        let pre = "The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received ";
        assert_eq!(null_bytes("/w/a\0b"), format!("{pre}'/w/a\\x00b'"));
        assert_eq!(null_bytes("/w/it's\0"), format!("{pre}\"/w/it's\\x00\""));
        assert_eq!(null_bytes("/w/a\"b'c\0"), format!("{pre}`/w/a\"b'c\\x00`"));
        assert_eq!(null_bytes("/w/a\"b'c`\0"), format!("{pre}'/w/a\"b\\'c`\\x00'"));
        assert_eq!(null_bytes("/w/\u{1b}\u{7f}\u{85}\\\t\0"), format!("{pre}'/w/\\x1B\\x7F\\x85\\\\\\t\\x00'"));
        let long = format!("/w/{}\0", "x".repeat(150));
        assert_eq!(null_bytes(&long), format!("{pre}'/w/{}...", "x".repeat(124)));
        let lines = format!("/w/{}\n{}\0/q", "y".repeat(40), "z".repeat(40));
        let want = format!("{pre}'/w/{}\\n' +\n  '{}\\x00/q'", "y".repeat(40), "z".repeat(40));
        assert_eq!(null_bytes(&lines), want);
    }
}
