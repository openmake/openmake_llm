//! 브라우저 다운로드 저장(TS `download-place.ts`, 설계 B-2) — Chrome 이 대기 폴더(연결 폴더 밖)에 `<guid>` 이름으로 받은 파일을,
//! 완료 뒤 저장 이름을 `write` 와 **같은 가드**(`scope::safe_from` + `git_trust::assert_git_path_allowed`)로 판정해 연결 폴더로
//! 옮긴다. 제안 이름은 믿지 않는다. 덮어쓰지 않는다 — 대상이 있으면 `이름 (n).확장자` 로 다음 후보, 가드가 거절하면 다른 이름을
//! 찾지 않고 버린다. 옮기기는 `hard_link`(배타적 — 대상 자리의 심링크를 따라가지 않는다), 하드링크가 안 되는 자리
//! (`EXDEV`·`EPERM`·`ENOTSUP`)면 `create_new` 로 열어 복사. rename 은 대상을 덮어쓰므로 쓰지 않는다. FS 를 보므로 호출부가
//! 관문 안에서 부른다(D-81-4).

use std::io;

use super::constants::{BROWSER_DOWNLOAD_FALLBACK_NAME, BROWSER_DOWNLOAD_NAME_TRIES};
use crate::git_trust::{GitGuard, assert_git_path_allowed};
use crate::node_error;
use crate::node_path;
use crate::scope;

/// link 가 이 코드로 실패하면 복사로 옮긴다 — 다른 볼륨·하드링크 없는 파일시스템
const COPY_FALLBACK_CODES: [&str; 3] = ["EXDEV", "EPERM", "ENOTSUP"];

/// 저장 실패 — `Rejected` 는 가드 거절(문구는 가드 문구 그대로, 결과의 `rejected`), `Failed` 는 그 밖(Node 문구, `failed`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlaceError {
    Rejected(String),
    Failed(String),
}

/// 제안 이름 — 경로 글자(`/ \ NUL`)가 있거나 빈·점 이름이면 대체 이름. 그 밖의 글자는 그대로 둔다(가드가 판정).
fn download_name(suggested: &str) -> &str {
    if suggested.contains(['/', '\\', '\0']) || matches!(suggested, "" | "." | "..") {
        BROWSER_DOWNLOAD_FALLBACK_NAME
    } else {
        suggested
    }
}

/// n 번째 후보 — 0 이면 이름 그대로, 아니면 확장자(`path.extname`) 앞에 ` (n)`.
fn candidate(name: &str, n: usize) -> String {
    if n == 0 {
        return name.to_owned();
    }
    let ext = node_path::extname(name);
    format!("{} ({n}){ext}", &name[..name.len() - ext.len()])
}

/// Node 의 두 경로 문구 — `CODE: 설명, link 'a' -> 'b'`.
fn two_path_error(e: &io::Error, syscall: &str, from: &str, to: &str) -> String {
    format!("{} -> '{to}'", node_error::format(e, syscall, Some(from)))
}

/// `copyFile(COPYFILE_EXCL)` — 대상이 있으면 EEXIST. 도중에 실패하면 만든 대상을 지운다(libuv 와 같다). 모드는 원본을 따른다.
fn copy_exclusive(staged: &str, dest: &str) -> io::Result<()> {
    let mut from = std::fs::File::open(staged)?;
    let mut to = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dest)?;
    let copied = io::copy(&mut from, &mut to)
        .and_then(|_| from.metadata())
        .and_then(|m| to.set_permissions(m.permissions()));
    if copied.is_err() {
        let _ = std::fs::remove_file(dest);
    }
    copied
}

/// 배타적으로 옮긴다 — 대상이 이미 있으면 `Ok(false)`. `link` 는 테스트가 오류 코드를 주입하는 자리다.
fn move_exclusive(
    staged: &str,
    dest: &str,
    link: &dyn Fn(&str, &str) -> io::Result<()>,
) -> Result<bool, String> {
    let Err(e) = link(staged, dest) else {
        return Ok(true);
    };
    let code = node_error::code(&e);
    if code == Some("EEXIST") {
        return Ok(false);
    }
    if !code.is_some_and(|c| COPY_FALLBACK_CODES.contains(&c)) {
        return Err(two_path_error(&e, "link", staged, dest));
    }
    match copy_exclusive(staged, dest) {
        Ok(()) => Ok(true),
        Err(c) if node_error::code(&c) == Some("EEXIST") => Ok(false),
        Err(c) => Err(two_path_error(&c, "copyfile", staged, dest)),
    }
}

fn place_with(
    base: &str,
    guard: &GitGuard,
    suggested: &str,
    staged: &str,
    link: &dyn Fn(&str, &str) -> io::Result<()>,
) -> Result<String, PlaceError> {
    let name = download_name(suggested);
    for n in 0..BROWSER_DOWNLOAD_NAME_TRIES {
        let rel = candidate(name, n);
        let abs = scope::safe_from(base, Some(&rel))
            .and_then(|abs| assert_git_path_allowed(guard, &abs, Some(&rel), false).map(|()| abs))
            .map_err(PlaceError::Rejected)?;
        if move_exclusive(staged, &abs, link).map_err(PlaceError::Failed)? {
            return Ok(rel);
        }
    }
    Err(PlaceError::Failed(format!(
        "같은 이름의 파일이 너무 많아 저장하지 않았습니다: {name}"
    )))
}

/// 대기 파일을 연결 폴더(`base`)로 옮기고 저장된 이름(`base` 기준)을 돌려준다. 어느 결과든 대기 파일은 지운다.
pub fn place_download(
    base: &str,
    guard: &GitGuard,
    suggested: &str,
    staged: &str,
) -> Result<String, PlaceError> {
    let out = place_with(base, guard, suggested, staged, &|a, b| {
        std::fs::hard_link(a, b)
    });
    let _ = std::fs::remove_file(staged);
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use std::cell::Cell;
    use std::io;

    use super::{PlaceError, candidate, place_with};
    use crate::git_trust::GitGuard;

    struct Tmp(String);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn tmp(tag: &str) -> Tmp {
        let raw = std::env::temp_dir().join(format!("omk-dlplace-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&raw);
        std::fs::create_dir_all(raw.join("root")).unwrap();
        std::fs::create_dir_all(raw.join("staging")).unwrap();
        Tmp(std::fs::canonicalize(raw)
            .unwrap()
            .to_string_lossy()
            .into_owned())
    }
    fn errno(n: i32) -> io::Error {
        io::Error::from_raw_os_error(n)
    }

    /// TS `download-place.test.ts` 의 EXDEV 두 건 — link 가 EXDEV 면 복사로 옮기고, 복사도 덮어쓰지 않는다.
    #[test]
    fn copy_branch_on_exdev_and_no_overwrite() {
        let t = tmp("exdev");
        let (root, staged) = (format!("{}/root", t.0), format!("{}/staging/guid-1", t.0));
        let guard = GitGuard {
            root: root.clone(),
            dirs: vec![],
        };
        let calls = Cell::new(0);
        let exdev = |_: &str, _: &str| {
            calls.set(calls.get() + 1);
            Err(errno(18))
        };
        std::fs::write(&staged, "copied").unwrap();
        assert_eq!(
            place_with(&root, &guard, "report.txt", &staged, &exdev),
            Ok("report.txt".to_owned())
        );
        assert_eq!(calls.get(), 1);
        assert_eq!(
            std::fs::read_to_string(format!("{root}/report.txt")).unwrap(),
            "copied"
        );
        std::fs::write(&staged, "second").unwrap();
        assert_eq!(
            place_with(&root, &guard, "report.txt", &staged, &exdev),
            Ok("report (1).txt".to_owned())
        );
        assert_eq!(
            std::fs::read_to_string(format!("{root}/report.txt")).unwrap(),
            "copied"
        );
        assert_eq!(
            std::fs::read_to_string(format!("{root}/report (1).txt")).unwrap(),
            "second"
        );
    }

    /// 세 코드(EXDEV·EPERM·ENOTSUP)만 복사로 — EACCES(같은 ErrorKind 의 다른 코드)·ENOSPC 는 link 문구로 실패.
    #[test]
    fn only_three_codes_fall_back_to_copy() {
        let t = tmp("codes");
        let (root, staged) = (format!("{}/root", t.0), format!("{}/staging/guid-1", t.0));
        let guard = GitGuard {
            root: root.clone(),
            dirs: vec![],
        };
        std::fs::write(&staged, "x").unwrap();
        let mut copied = vec![];
        for (n, name) in [(18, "a"), (1, "b"), (45, "c")] {
            let r = place_with(&root, &guard, name, &staged, &move |_: &str, _: &str| {
                Err(errno(n))
            });
            copied.push(r);
        }
        assert_eq!(
            copied,
            [Ok("a".to_owned()), Ok("b".to_owned()), Ok("c".to_owned())]
        );
        let eacces = place_with(&root, &guard, "d", &staged, &|_: &str, _: &str| {
            Err(errno(13))
        });
        assert_eq!(
            eacces,
            Err(PlaceError::Failed(format!(
                "EACCES: permission denied, link '{staged}' -> '{root}/d'"
            )))
        );
        assert!(std::fs::symlink_metadata(format!("{root}/d")).is_err());
    }

    #[test]
    fn candidate_names() {
        assert_eq!(candidate("a.tar.gz", 1), "a.tar (1).gz");
        assert_eq!(candidate(".bashrc", 2), ".bashrc (2)");
        assert_eq!(candidate("noext", 3), "noext (3)");
        assert_eq!(candidate("a.", 1), "a (1).");
    }
}
