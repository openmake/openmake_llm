//! 브라우저 다운로드 저장(TS `download-place.ts`, 설계 B-2) — Chrome 이 대기 폴더(연결 폴더 밖)에 `<guid>` 이름으로 받은 파일을,
//! 완료 뒤 저장 이름을 `write` 와 **같은 가드**(`scope::safe_from` + `git_trust::assert_git_path_allowed`)로 판정해 연결 폴더로
//! 옮긴다. 제안 이름은 믿지 않는다. 덮어쓰지 않는다 — 대상이 있으면 `이름 (n).확장자` 로 다음 후보, 가드가 거절하면 다른 이름을
//! 찾지 않고 버린다. 옮기기는 `hard_link`(배타적 — 대상 자리의 심링크를 따라가지 않는다), 하드링크가 안 되는 자리
//! (`EXDEV`·`EPERM`·`ENOTSUP`)면 연 대기 파일에서 `create_new` 로 연 대상에 복사. rename 은 대상을 덮어쓰므로 쓰지 않는다. FS 를
//! 보므로 호출부가 관문 안에서 부른다(D-81-4).
//!
//! 대기 자리는 옮기기 전에 `symlink_metadata`(lstat) 한다 — 보통 파일이고 링크 수가 1 일 때만 옮긴다(심링크·폴더·하드링크면 폴더 밖
//! 파일이 같은 inode 로 들어올 수 있다). 옮긴 뒤 대상(link)·연 핸들(복사)이 그때 본 파일(`dev`·`ino`)인지 다시 확인해 검사와 사용
//! 사이 틈을 닫는다 — 검사한 파일이 살아 있는 동안의 바꿔 치기는 거절로 끝난다. inode 번호를 다시 쓰는 파일시스템(Linux ext4
//! 등)에서 지우고 다시 만드는 경우는 남는 한계다(unix 가 아니면 보통 파일 검사만).

use std::io;

use super::constants::{BROWSER_DOWNLOAD_FALLBACK_NAME, BROWSER_DOWNLOAD_NAME_TRIES};
use crate::git_trust::{GitGuard, assert_git_path_allowed};
use crate::node_error;
use crate::node_path;
use crate::scope;

/// link 가 이 코드로 실패하면 복사로 옮긴다 — 다른 볼륨·하드링크 없는 파일시스템
const COPY_FALLBACK_CODES: [&str; 3] = ["EXDEV", "EPERM", "ENOTSUP"];
const NOT_PLAIN: &str =
    "다운로드 대기 파일이 보통 파일이 아니거나 다른 곳에 연결돼 있어 저장하지 않았습니다";
/// 복사 갈래에서 한 번에 읽는 크기(TS 와 같다)
const COPY_CHUNK: usize = 1 << 20;

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

/// 대기 자리를 lstat 에서 본 파일 — `(dev, ino)`. 옮긴 뒤 같은 파일인지 이것으로 확인한다.
#[derive(Clone, Copy, PartialEq, Eq)]
struct StagedId(u64, u64);

#[cfg(unix)]
fn staged_id(m: &std::fs::Metadata) -> StagedId {
    use std::os::unix::fs::MetadataExt;
    StagedId(m.dev(), m.ino())
}
#[cfg(not(unix))]
fn staged_id(_m: &std::fs::Metadata) -> StagedId {
    StagedId(0, 0)
}
#[cfg(unix)]
fn link_count(m: &std::fs::Metadata) -> u64 {
    std::os::unix::fs::MetadataExt::nlink(m)
}
#[cfg(not(unix))]
fn link_count(_m: &std::fs::Metadata) -> u64 {
    1
}

fn same_file(m: &std::fs::Metadata, id: StagedId) -> bool {
    m.file_type().is_file() && staged_id(m) == id
}

/// 연 대기 파일이 검사한 파일이면 그 핸들에서 배타적으로 만든 대상으로 복사한다 — 대상이 이미 있으면 `Ok(false)`. 도중에
/// 실패하면 만든 대상을 지운다. 모드는 원본을 따른다. 문구는 TS(`FileHandle` 의 `open`·`read`·`write`·`fchmod`)와 같다.
fn copy_exclusive(staged: &str, dest: &str, id: StagedId) -> Result<bool, String> {
    use std::io::{Read, Write};
    let mut from =
        std::fs::File::open(staged).map_err(|e| node_error::format(&e, "open", Some(staged)))?;
    let meta = from
        .metadata()
        .map_err(|e| node_error::format(&e, "fstat", None))?;
    if !same_file(&meta, id) {
        return Err(NOT_PLAIN.to_owned());
    }
    let mut to = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dest)
    {
        Ok(f) => f,
        Err(e) if node_error::code(&e) == Some("EEXIST") => return Ok(false),
        Err(e) => return Err(node_error::format(&e, "open", Some(dest))),
    };
    let mut buf = vec![0u8; COPY_CHUNK];
    let copied = (|| loop {
        let n = from
            .read(&mut buf)
            .map_err(|e| node_error::format(&e, "read", None))?;
        if n == 0 {
            return to
                .set_permissions(meta.permissions())
                .map_err(|e| node_error::format(&e, "fchmod", None));
        }
        to.write_all(buf.get(..n).unwrap_or_default())
            .map_err(|e| node_error::format(&e, "write", None))?;
    })();
    if let Err(e) = copied {
        drop(to);
        let _ = std::fs::remove_file(dest);
        return Err(e);
    }
    Ok(true)
}

/// 배타적으로 옮긴다 — 대상이 이미 있으면 `Ok(false)`. 옮긴 대상이 검사한 파일이 아니면 지우고 실패한다. `link` 는 테스트가
/// 오류 코드·바꿔 치기를 주입하는 자리다.
fn move_exclusive(
    staged: &str,
    dest: &str,
    id: StagedId,
    link: &dyn Fn(&str, &str) -> io::Result<()>,
) -> Result<bool, String> {
    if let Err(e) = link(staged, dest) {
        let code = node_error::code(&e);
        if code == Some("EEXIST") {
            return Ok(false);
        }
        if !code.is_some_and(|c| COPY_FALLBACK_CODES.contains(&c)) {
            return Err(two_path_error(&e, "link", staged, dest));
        }
        return copy_exclusive(staged, dest, id);
    }
    let placed =
        std::fs::symlink_metadata(dest).map_err(|e| node_error::format(&e, "lstat", Some(dest)))?;
    if !same_file(&placed, id) {
        let _ = std::fs::remove_file(dest);
        return Err(NOT_PLAIN.to_owned());
    }
    Ok(true)
}

fn place_with(
    base: &str,
    guard: &GitGuard,
    suggested: &str,
    staged: &str,
    link: &dyn Fn(&str, &str) -> io::Result<()>,
) -> Result<String, PlaceError> {
    let name = download_name(suggested);
    let st = std::fs::symlink_metadata(staged)
        .map_err(|e| PlaceError::Failed(node_error::format(&e, "lstat", Some(staged))))?;
    if !st.file_type().is_file() || link_count(&st) != 1 {
        return Err(PlaceError::Failed(NOT_PLAIN.to_owned()));
    }
    let id = staged_id(&st);
    for n in 0..BROWSER_DOWNLOAD_NAME_TRIES {
        let rel = candidate(name, n);
        let abs = scope::safe_from(base, Some(&rel))
            .and_then(|abs| assert_git_path_allowed(guard, &abs, Some(&rel), false).map(|()| abs))
            .map_err(PlaceError::Rejected)?;
        if move_exclusive(staged, &abs, id, link).map_err(PlaceError::Failed)? {
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

    const NOT_PLAIN: &str =
        "다운로드 대기 파일이 보통 파일이 아니거나 다른 곳에 연결돼 있어 저장하지 않았습니다";

    /// 대기 자리가 심링크면(폴더 밖 파일·상대 경로·링크의 링크) 옮기지 않는다 — 링크만 지우고 대상 파일은 그대로(D-5).
    #[test]
    fn staged_symlink_is_not_placed() {
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
                Err(PlaceError::Failed(NOT_PLAIN.to_owned())),
                "{target}"
            );
            assert!(std::fs::symlink_metadata(&staged).is_err());
            assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        }
        assert_eq!(
            std::fs::read_to_string(format!("{}/outside/s", t.0)).unwrap(),
            "secret"
        );
    }

    /// 끊긴·순환 심링크도 같은 문구로 실패하고 아무것도 만들지 않는다.
    #[test]
    fn staged_symlink_dangling_or_loop_is_not_placed() {
        let t = tmp("stbad");
        let (root, staged) = (format!("{}/root", t.0), format!("{}/staging/guid-1", t.0));
        let guard = GitGuard {
            root: root.clone(),
            dirs: vec![],
        };
        for target in [format!("{}/outside-none", t.0), staged.clone()] {
            std::os::unix::fs::symlink(&target, &staged).unwrap();
            assert_eq!(
                place_download(&root, &guard, "got.txt", &staged),
                Err(PlaceError::Failed(NOT_PLAIN.to_owned()))
            );
            assert!(std::fs::symlink_metadata(&staged).is_err());
            assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        }
    }

    /// 대기 자리가 폴더(또는 폴더로 가는 심링크)면 같은 문구로 실패한다 — 대상이 있어도 다음 이름을 보지 않는다. 폴더는 남는다.
    #[test]
    fn staged_dir_is_not_placed() {
        let t = tmp("stdir");
        let (root, staged) = (format!("{}/root", t.0), format!("{}/staging/guid-1", t.0));
        let guard = GitGuard {
            root: root.clone(),
            dirs: vec![],
        };
        let not_plain = Err(PlaceError::Failed(NOT_PLAIN.to_owned()));
        std::fs::create_dir_all(format!("{}/outside", t.0)).unwrap();
        std::os::unix::fs::symlink(format!("{}/outside", t.0), &staged).unwrap();
        assert_eq!(place_download(&root, &guard, "got.txt", &staged), not_plain);
        assert!(std::fs::symlink_metadata(&staged).is_err());
        std::fs::create_dir(&staged).unwrap();
        std::fs::write(format!("{root}/got.txt"), "old").unwrap();
        assert_eq!(place_download(&root, &guard, "got.txt", &staged), not_plain);
        assert!(std::fs::symlink_metadata(&staged).unwrap().is_dir());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
    }

    /// 검사 뒤 link 가 대기 자리 대신 폴더 밖 파일을 링크하면(바꿔 치기) 만든 대상을 지우고 실패한다(D-6).
    #[test]
    fn swapped_after_check_link_is_undone() {
        let t = tmp("swaplink");
        let (root, staged) = (format!("{}/root", t.0), format!("{}/staging/guid-1", t.0));
        let victim = format!("{}/staging/victim", t.0);
        let guard = GitGuard {
            root: root.clone(),
            dirs: vec![],
        };
        std::fs::write(&victim, "keep").unwrap();
        std::fs::write(&staged, "mine").unwrap();
        let other = |_: &str, dest: &str| std::fs::hard_link(&victim, dest);
        assert_eq!(
            place_with(&root, &guard, "report.txt", &staged, &other),
            Err(PlaceError::Failed(NOT_PLAIN.to_owned()))
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "keep");
    }

    /// 복사 갈래에서 연 대기 파일이 검사한 파일과 다르면(EXDEV 직전 바꿔 치기) 대상을 만들지 않는다(D-7).
    #[test]
    fn swapped_before_copy_is_not_copied() {
        let t = tmp("swapcopy");
        let (root, staged) = (format!("{}/root", t.0), format!("{}/staging/guid-1", t.0));
        let guard = GitGuard {
            root: root.clone(),
            dirs: vec![],
        };
        std::fs::write(&staged, "mine").unwrap();
        let swap = |from: &str, _: &str| {
            // 원본을 살려 둔다 — 지우면 Linux 는 같은 inode 번호를 새 파일에 다시 준다
            std::fs::rename(from, format!("{from}.orig"))?;
            std::fs::write(from, "swapped")?;
            Err(errno(18))
        };
        assert_eq!(
            place_with(&root, &guard, "report.txt", &staged, &swap),
            Err(PlaceError::Failed(NOT_PLAIN.to_owned()))
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    }

    #[test]
    fn candidate_names() {
        assert_eq!(candidate("a.tar.gz", 1), "a.tar (1).gz");
        assert_eq!(candidate(".bashrc", 2), ".bashrc (2)");
        assert_eq!(candidate("noext", 3), "noext (3)");
        assert_eq!(candidate("a.", 1), "a (1).");
    }
}
