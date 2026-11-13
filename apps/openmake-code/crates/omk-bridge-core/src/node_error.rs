//! `std::io::Error` → Node 형식 오류 문구(설계 D-15).
//!
//! 파일 kind 의 실패 문구는 서버를 거쳐 모델이 읽는다. Rust 기본 표기(`No such file or directory (os error 2)`)를
//! 그대로 내면 같은 실패에 TS 와 다른 글자가 나가므로, Node 가 내는 `CODE: 설명, syscall '경로'` 꼴을 만든다.
//! 설명은 libuv `uv_strerror` 의 글자다(Node 24.22.2 에서 확인).

use std::io;

/// 번호가 macOS·Linux 에서 같은 errno(1~34, 11 제외 — macOS 는 EDEADLK·Linux 는 EAGAIN).
/// 이름·설명은 Node 24.22.2 `util.getSystemErrorName`·`getSystemErrorMessage` 로 생성해 대조했다(libuv `uv-errno` 가 아는 것만).
const COMMON: [(i32, &str, &str); 30] = [
    (1, "EPERM", "operation not permitted"),
    (2, "ENOENT", "no such file or directory"),
    (3, "ESRCH", "no such process"),
    (4, "EINTR", "interrupted system call"),
    (5, "EIO", "i/o error"),
    (6, "ENXIO", "no such device or address"),
    (7, "E2BIG", "argument list too long"),
    (8, "ENOEXEC", "exec format error"),
    (9, "EBADF", "bad file descriptor"),
    (12, "ENOMEM", "not enough memory"),
    (13, "EACCES", "permission denied"),
    (14, "EFAULT", "bad address in system call argument"),
    (16, "EBUSY", "resource busy or locked"),
    (17, "EEXIST", "file already exists"),
    (18, "EXDEV", "cross-device link not permitted"),
    (19, "ENODEV", "no such device"),
    (20, "ENOTDIR", "not a directory"),
    (21, "EISDIR", "illegal operation on a directory"),
    (22, "EINVAL", "invalid argument"),
    (23, "ENFILE", "file table overflow"),
    (24, "EMFILE", "too many open files"),
    (25, "ENOTTY", "inappropriate ioctl for device"),
    (26, "ETXTBSY", "text file is busy"),
    (27, "EFBIG", "file too large"),
    (28, "ENOSPC", "no space left on device"),
    (29, "ESPIPE", "invalid seek"),
    (30, "EROFS", "read-only file system"),
    (31, "EMLINK", "too many links"),
    (32, "EPIPE", "broken pipe"),
    (34, "ERANGE", "result too large"),
];

/// 플랫폼마다 번호가 다른 errno(macOS 35 이상) — Linux·Windows 표는 Windows 이전(PR-5.1)에서 더한다.
#[cfg(target_os = "macos")]
const PLATFORM: [(i32, &str, &str); 35] = [
    (35, "EAGAIN", "resource temporarily unavailable"),
    (37, "EALREADY", "connection already in progress"),
    (38, "ENOTSOCK", "socket operation on non-socket"),
    (39, "EDESTADDRREQ", "destination address required"),
    (40, "EMSGSIZE", "message too long"),
    (41, "EPROTOTYPE", "protocol wrong type for socket"),
    (42, "ENOPROTOOPT", "protocol not available"),
    (43, "EPROTONOSUPPORT", "protocol not supported"),
    (44, "ESOCKTNOSUPPORT", "socket type not supported"),
    (45, "ENOTSUP", "operation not supported on socket"),
    (47, "EAFNOSUPPORT", "address family not supported"),
    (48, "EADDRINUSE", "address already in use"),
    (49, "EADDRNOTAVAIL", "address not available"),
    (50, "ENETDOWN", "network is down"),
    (51, "ENETUNREACH", "network is unreachable"),
    (53, "ECONNABORTED", "software caused connection abort"),
    (54, "ECONNRESET", "connection reset by peer"),
    (55, "ENOBUFS", "no buffer space available"),
    (56, "EISCONN", "socket is already connected"),
    (57, "ENOTCONN", "socket is not connected"),
    (
        58,
        "ESHUTDOWN",
        "cannot send after transport endpoint shutdown",
    ),
    (60, "ETIMEDOUT", "connection timed out"),
    (61, "ECONNREFUSED", "connection refused"),
    (62, "ELOOP", "too many symbolic links encountered"),
    (63, "ENAMETOOLONG", "name too long"),
    (64, "EHOSTDOWN", "host is down"),
    (65, "EHOSTUNREACH", "host is unreachable"),
    (66, "ENOTEMPTY", "directory not empty"),
    (78, "ENOSYS", "function not implemented"),
    (79, "EFTYPE", "inappropriate file type or format"),
    (84, "EOVERFLOW", "value too large for defined data type"),
    (89, "ECANCELED", "operation canceled"),
    (92, "EILSEQ", "illegal byte sequence"),
    (96, "ENODATA", "no data available"),
    (100, "EPROTO", "protocol error"),
];
#[cfg(not(target_os = "macos"))]
const PLATFORM: [(i32, &str, &str); 0] = [];

/// Node 형식 문구. `path` 가 없는 호출 자리(예: 폴더를 `read`)는 `, syscall` 로 끝난다.
/// 표에 없는 errno 는 Node 가 모르는 errno 에 쓰는 `Unknown system error -N` 꼴이다.
pub fn format(err: &io::Error, syscall: &str, path: Option<&str>) -> String {
    let errno = err.raw_os_error().unwrap_or(0);
    let known = COMMON
        .iter()
        .chain(PLATFORM.iter())
        .find(|(n, _, _)| *n == errno);
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
    // Node: 길이 > kMinLineWidth(16) 이고 > breakLength(80) - 4 일 때 줄마다 나눈다 — 뒤 조건이 앞을 포함한다.
    if s.encode_utf16().count() > 76 && s.contains('\n') {
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
        assert_eq!(
            format(&e, "open", Some("/w/a")),
            "ENOENT: no such file or directory, open '/w/a'"
        );
        let e = Error::from_raw_os_error(21);
        assert_eq!(
            format(&e, "read", None),
            "EISDIR: illegal operation on a directory, read"
        );
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
        assert_eq!(
            null_bytes("/w/a\"b'c`\0"),
            format!("{pre}'/w/a\"b\\'c`\\x00'")
        );
        assert_eq!(
            null_bytes("/w/\u{1b}\u{7f}\u{85}\\\t\0"),
            format!("{pre}'/w/\\x1B\\x7F\\x85\\\\\\t\\x00'")
        );
        let long = format!("/w/{}\0", "x".repeat(150));
        assert_eq!(
            null_bytes(&long),
            format!("{pre}'/w/{}...", "x".repeat(124))
        );
        let lines = format!("/w/{}\n{}\0/q", "y".repeat(40), "z".repeat(40));
        let want = format!(
            "{pre}'/w/{}\\n' +\n  '{}\\x00/q'",
            "y".repeat(40),
            "z".repeat(40)
        );
        assert_eq!(null_bytes(&lines), want);
    }

    /// Node 24.22.2(macOS)에서 `util.getSystemErrorName(-n)` 이 이름을 아는 errno 전부(1..=200 을 훑어 얻음).
    #[cfg(target_os = "macos")]
    const NODE_KNOWN_MACOS: [i32; 65] = [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
        29, 30, 31, 32, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 47, 48, 49, 50, 51, 53, 54, 55,
        56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 78, 79, 84, 89, 92, 96, 100,
    ];

    /// Node 가 이름을 아는 errno 는 `Unknown system error` 가 나오지 않고, 모르는 번호는 Node 와 같이 그 꼴이다.
    #[cfg(target_os = "macos")]
    #[test]
    fn table_matches_node_known_errno_on_macos() {
        let unknown =
            |n: i32| format(&Error::from_raw_os_error(n), "x", None).starts_with("Unknown");
        let missing: Vec<i32> = NODE_KNOWN_MACOS
            .iter()
            .copied()
            .filter(|n| unknown(*n))
            .collect();
        assert_eq!(missing, Vec::<i32>::new());
        let extra: Vec<i32> = (1..=200)
            .filter(|n| !NODE_KNOWN_MACOS.contains(n) && !unknown(*n))
            .collect();
        assert_eq!(extra, Vec::<i32>::new());
        // 글자 대조(Node 24.22.2 `util.getSystemErrorName`·`getSystemErrorMessage`).
        for (n, want) in [
            (35, "EAGAIN: resource temporarily unavailable, x"),
            (45, "ENOTSUP: operation not supported on socket, x"),
            (19, "ENODEV: no such device, x"),
            (60, "ETIMEDOUT: connection timed out, x"),
            (79, "EFTYPE: inappropriate file type or format, x"),
            (100, "EPROTO: protocol error, x"),
            (11, "Unknown system error -11: Unknown system error -11, x"),
            (70, "Unknown system error -70: Unknown system error -70, x"),
            (
                102,
                "Unknown system error -102: Unknown system error -102, x",
            ),
        ] {
            assert_eq!(format(&Error::from_raw_os_error(n), "x", None), want);
        }
    }
}
