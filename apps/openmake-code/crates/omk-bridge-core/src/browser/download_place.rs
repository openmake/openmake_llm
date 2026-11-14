//! 브라우저 다운로드 저장(TS `download-place.ts`, 설계 B-2) — Chrome 이 대기 폴더(연결 폴더 밖)에 `<guid>` 이름으로 받은 파일을,
//! 완료 뒤 저장 이름을 `write` 와 **같은 가드**(`scope::safe_from` + `git_trust::assert_git_path_allowed`)로 판정해 연결 폴더로
//! 옮긴다. 제안 이름은 믿지 않는다. 덮어쓰지 않는다 — 대상이 있으면 `이름 (n).확장자` 로 다음 후보, 가드가 거절하면 다른 이름을
//! 찾지 않고 버린다. 옮기기는 `hard_link`(배타적 — 대상 자리의 심링크를 따라가지 않는다), 하드링크가 안 되는 자리
//! (`EXDEV`·`EPERM`·`ENOTSUP`)면 `create_new` 로 열어 복사. rename 은 대상을 덮어쓰므로 쓰지 않는다. FS 를 보므로 호출부가
//! 관문 안에서 부른다(D-81-4).
//!
//! 대기 파일 쪽 심링크는 TS `fs.link`(macOS `link(2)` — 원본 심링크를 따라간다)처럼 따라가 **대상 파일**의 하드링크를 만든다.
//! `std::fs::hard_link` 는 `linkat(…, 0)` 이라 심링크 자체를 링크하므로(연결 폴더 안에 심링크가 생긴다) 원본을 먼저
//! `canonicalize` 한다 — 실패(끊긴 링크 `ENOENT`·순환 `ELOOP`)는 `link` 의 실패와 같은 코드다.

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

/// macOS `copyfile(3)`(libuv `copyFile`)가 폴더 원본에 내는 코드 — 대상 EEXIST 판정 뒤에 난다(TS 실측).
#[cfg(target_os = "macos")]
fn reject_dir_source(from: &std::fs::File) -> io::Result<()> {
    const ENOTSUP: i32 = 45;
    if from.metadata()?.is_dir() {
        return Err(io::Error::from_raw_os_error(ENOTSUP));
    }
    Ok(())
}
#[cfg(not(target_os = "macos"))]
fn reject_dir_source(_from: &std::fs::File) -> io::Result<()> {
    Ok(())
}

/// `copyFile(COPYFILE_EXCL)` — 대상이 있으면 EEXIST. 도중에 실패하면 만든 대상을 지운다(libuv 와 같다). 모드는 원본을 따른다.
fn copy_exclusive(staged: &str, dest: &str) -> io::Result<()> {
    let mut from = std::fs::File::open(staged)?;
    let mut to = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dest)?;
    let copied = reject_dir_source(&from)
        .and_then(|()| io::copy(&mut from, &mut to))
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
        std::fs::hard_link(std::fs::canonicalize(a)?, b)
    });
    let _ = std::fs::remove_file(staged);
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use std::cell::Cell;
    use std::io;

    use super::{PlaceError, candidate, place_download, place_with};
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

    /// 대기 파일이 심링크면 따라가 대상 파일을 링크한다 — 연결 폴더에 심링크가 생기지 않는다(리뷰 L1). 기대값은 TS `placeDownload`
    /// 를 macOS Node 24 에서 돌린 값(`link(2)` 가 원본 심링크를 따라간다 — Linux 의 `link(2)` 는 따라가지 않아 TS 결과가 OS 마다
    /// 달라 fixture 에 넣지 못한다, `conformance/BROWSER.md`).
    #[test]
    fn staged_symlink_links_target_file() {
        let t = tmp("stlink");
        let (root, staged) = (format!("{}/root", t.0), format!("{}/staging/guid-1", t.0));
        let guard = GitGuard {
            root: root.clone(),
            dirs: vec![],
        };
        std::fs::create_dir_all(format!("{}/outside", t.0)).unwrap();
        std::fs::write(format!("{}/outside/s", t.0), "secret").unwrap();
        std::os::unix::fs::symlink(format!("{}/outside/s", t.0), format!("{}/outside/l", t.0))
            .unwrap();
        for target in [
            format!("{}/outside/s", t.0),
            "../outside/s".to_owned(),
            format!("{}/outside/l", t.0),
        ] {
            std::os::unix::fs::symlink(&target, &staged).unwrap();
            assert_eq!(
                place_download(&root, &guard, "got.txt", &staged),
                Ok("got.txt".to_owned()),
                "{target}"
            );
            let got = format!("{root}/got.txt");
            assert!(
                std::fs::symlink_metadata(&got).unwrap().is_file(),
                "{target}"
            );
            assert_eq!(std::fs::read_to_string(&got).unwrap(), "secret");
            assert!(std::fs::symlink_metadata(&staged).is_err());
            std::fs::remove_file(got).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(format!("{}/outside/s", t.0)).unwrap(),
            "secret"
        );
    }

    /// 끊긴·순환 심링크는 `link` 문구로 실패하고 아무것도 만들지 않는다(TS macOS 실측과 같은 글자).
    #[test]
    fn staged_symlink_dangling_or_loop_fails_like_link() {
        let t = tmp("stbad");
        let (root, staged) = (format!("{}/root", t.0), format!("{}/staging/guid-1", t.0));
        let guard = GitGuard {
            root: root.clone(),
            dirs: vec![],
        };
        for (target, err) in [
            (
                format!("{}/outside-none", t.0),
                "ENOENT: no such file or directory",
            ),
            (staged.clone(), "ELOOP: too many symbolic links encountered"),
        ] {
            std::os::unix::fs::symlink(&target, &staged).unwrap();
            assert_eq!(
                place_download(&root, &guard, "got.txt", &staged),
                Err(PlaceError::Failed(format!(
                    "{err}, link '{staged}' -> '{root}/got.txt'"
                )))
            );
            assert!(std::fs::symlink_metadata(&staged).is_err());
            assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        }
    }

    /// 대기 자리가 폴더(또는 폴더로 가는 심링크)면 link 는 EPERM → 복사 갈래에서 macOS `copyfile(3)` 처럼 ENOTSUP. 대상이 있으면
    /// EEXIST 가 먼저라 다음 이름으로 넘어간 뒤 실패한다(TS macOS 실측). 폴더는 지우지 못하고 남는다.
    #[cfg(target_os = "macos")]
    #[test]
    fn staged_dir_fails_enotsup_after_eexist() {
        let t = tmp("stdir");
        let (root, staged) = (format!("{}/root", t.0), format!("{}/staging/guid-1", t.0));
        let guard = GitGuard {
            root: root.clone(),
            dirs: vec![],
        };
        let enotsup = |dest: &str| {
            Err(PlaceError::Failed(format!(
                "ENOTSUP: operation not supported on socket, copyfile '{staged}' -> '{root}/{dest}'"
            )))
        };
        std::fs::create_dir_all(format!("{}/outside", t.0)).unwrap();
        std::os::unix::fs::symlink(format!("{}/outside", t.0), &staged).unwrap();
        assert_eq!(
            place_download(&root, &guard, "got.txt", &staged),
            enotsup("got.txt")
        );
        assert!(std::fs::symlink_metadata(&staged).is_err());
        std::fs::create_dir(&staged).unwrap();
        assert_eq!(
            place_download(&root, &guard, "got.txt", &staged),
            enotsup("got.txt")
        );
        std::fs::write(format!("{root}/got.txt"), "old").unwrap();
        assert_eq!(
            place_download(&root, &guard, "got.txt", &staged),
            enotsup("got (1).txt")
        );
        assert!(std::fs::symlink_metadata(&staged).unwrap().is_dir());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        assert_eq!(
            std::fs::read_to_string(format!("{root}/got.txt")).unwrap(),
            "old"
        );
    }

    #[test]
    fn candidate_names() {
        assert_eq!(candidate("a.tar.gz", 1), "a.tar (1).gz");
        assert_eq!(candidate(".bashrc", 2), ".bashrc (2)");
        assert_eq!(candidate("noext", 3), "noext (3)");
        assert_eq!(candidate("a.", 1), "a (1).");
    }
}
