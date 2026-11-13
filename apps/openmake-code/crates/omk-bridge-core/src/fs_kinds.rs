//! 파일 kind 처리 — TS `core.ts` 의 resolveBase·read·write·list·walk(listAll)·delete·folders.
//!
//! 모두 동기 함수다. 시간 제한과 동시 작업 상한은 `timed_fs` 가 바깥에서 건다.
//! 경로는 `scope::safe_from` 으로 확정한 어휘적 경로를 쓰고, OS 오류는 Node 형식 문구로 낸다(`node_error`).
//! 폴더 항목은 이름(바이트)순이다 — Node 의 `readdir` 는 libuv `scandir` 가 strcmp 로 정렬해 돌려준다.

use std::fs;
use std::io::{ErrorKind, Read, Write};

use crate::constants::{FOLDERS_MAX_ENTRIES, LIST_ALL_MAX};
use crate::scope::safe_from;
use crate::{base64_lenient, node_error, node_path};

/// Node 는 NUL 이 든 경로를 시스템 호출 전에 거절한다 — 호출 자리마다 같은 순서로 본다.
const EEXIST: i32 = 17;
const ENOTDIR: i32 = 20;

fn no_nul(p: &str) -> Result<(), String> {
    if p.contains('\0') {
        return Err(node_error::null_bytes(p));
    }
    Ok(())
}

struct Entry {
    /// UTF-8 이 아닌 이름은 APFS 에서 생기지 않는다.
    name: String,
    is_dir: bool,
    is_symlink: bool,
}

/// `fs.promises.readdir(dir, { withFileTypes: true })` — 심링크는 따라가지 않는다.
fn read_dir_sorted(dir: &str) -> Result<Vec<Entry>, String> {
    let scandir = |e: std::io::Error| node_error::format(&e, "scandir", Some(dir));
    let mut out = Vec::new();
    for e in fs::read_dir(dir).map_err(scandir)? {
        let e = e.map_err(scandir)?;
        let name = e.file_name().to_string_lossy().into_owned();
        let ft = e.file_type().map_err(|err| {
            let p = node_path::join(&[dir, &name]);
            node_error::format(&err, "lstat", Some(&p))
        })?;
        out.push(Entry {
            name,
            is_dir: ft.is_dir(),
            is_symlink: ft.is_symlink(),
        });
    }
    out.sort_by(|a, b| a.name.as_bytes().cmp(b.name.as_bytes()));
    Ok(out)
}

/// 폴더 선택(`folder` 필드) — 루트 기준 상대경로를 스코프 재검증 후 실행 base 로 쓴다.
/// 서버는 기기가 `folders` 로 알린 값만 돌려보내지만 여기서 다시 스코프를 강제한다(2중 방어).
pub fn resolve_base(root: &str, folder: Option<&str>) -> Result<String, String> {
    let Some(folder) = folder else {
        return Ok(root.to_owned());
    };
    let base = safe_from(root, Some(folder))?;
    match fs::metadata(&base) {
        Ok(m) if m.is_dir() => Ok(base),
        _ => Err(format!("실행 폴더가 존재하지 않습니다: {folder}")),
    }
}

/// UTF-8 로 읽는다. 깨진 바이트는 U+FFFD 로 바꾼다(Node `readFile(p, 'utf8')` 와 같은 개수). 크기 상한은 없다(TS 와 같다).
pub fn read(base: &str, path: Option<&str>) -> Result<String, String> {
    let abs = safe_from(base, path)?;
    no_nul(&abs)?;
    let mut f = fs::File::open(&abs).map_err(|e| node_error::format(&e, "open", Some(&abs)))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)
        .map_err(|e| node_error::format(&e, "read", None))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// `fsp.mkdir(dir, { recursive: true })` — Node `MKDirpAsync` 의 순서를 따른다. 문구의 경로는 **실패한 구간**이다.
/// `mkdir` 이 ENOENT 면 부모로 올라갔다 내려온다. EACCES·EPERM·ENOTDIR·ENOSPC 는 바로 실패,
/// 그 밖의 오류는 `stat` 해서 폴더면 통과·폴더가 아니면 EEXIST(아래 구간이 남았으면 ENOTDIR)·`stat` 실패면 그 오류다.
fn mkdir_recursive(dir: &str) -> Result<(), String> {
    let fail = |e: &std::io::Error, p: &str| node_error::format(e, "mkdir", Some(p));
    let mut stack = vec![dir.to_owned()];
    while let Some(next) = stack.pop() {
        let Err(err) = fs::create_dir(&next) else {
            continue;
        };
        match err.kind() {
            ErrorKind::PermissionDenied | ErrorKind::NotADirectory | ErrorKind::StorageFull => {
                return Err(fail(&err, &next));
            }
            ErrorKind::NotFound => {
                let parent = node_path::dirname(&next);
                if parent == next {
                    return Err(fail(&err, &next));
                }
                stack.push(next);
                stack.push(parent);
            }
            _ => match fs::metadata(&next) {
                Ok(m) if m.is_dir() => {}
                Ok(_) => {
                    let code = if err.kind() == ErrorKind::AlreadyExists && !stack.is_empty() {
                        std::io::Error::from_raw_os_error(ENOTDIR)
                    } else {
                        std::io::Error::from_raw_os_error(EEXIST)
                    };
                    return Err(fail(&code, &next));
                }
                Err(e) => return Err(fail(&e, &next)),
            },
        }
    }
    Ok(())
}

/// 중간 폴더를 만들고 덮어쓴다. `content_b64` 가 없으면 빈 파일이다.
pub fn write(base: &str, path: Option<&str>, content_b64: Option<&str>) -> Result<(), String> {
    let abs = safe_from(base, path)?;
    let dir = node_path::dirname(&abs);
    no_nul(&dir)?;
    mkdir_recursive(&dir)?;
    let bytes = base64_lenient::decode(content_b64.unwrap_or(""));
    no_nul(&abs)?;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&abs)
        .map_err(|e| node_error::format(&e, "open", Some(&abs)))?;
    f.write_all(&bytes)
        .map_err(|e| node_error::format(&e, "write", None))
}

/// 폴더 항목 — 폴더는 `/` 접미사(모델이 폴더를 파일로 알고 read 하다 실패하지 않게). 폴더 심링크는 접미사가 없다.
pub fn list(base: &str, path: Option<&str>) -> Result<Vec<String>, String> {
    let abs = safe_from(base, path)?;
    no_nul(&abs)?;
    let entries = read_dir_sorted(&abs)?;
    Ok(entries
        .into_iter()
        .map(|e| {
            if e.is_dir {
                format!("{}/", e.name)
            } else {
                e.name
            }
        })
        .collect())
}

/// base 아래 파일 전부(base 기준 상대경로), 깊이 우선. 심링크는 나열하지 않는다.
/// `LIST_ALL_MAX` 에서 조용히 끊긴다(잘렸다는 표시가 없다 — TS 그대로). 재귀 대신 명시적 스택을 쓴다.
pub fn list_all(base: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut stack = vec![(base.to_owned(), read_dir_sorted(base)?.into_iter())];
    while let Some((dir, entries)) = stack.last_mut() {
        let Some(e) = entries.next() else {
            stack.pop();
            continue;
        };
        if e.is_symlink {
            continue;
        }
        let p = node_path::join(&[dir.as_str(), &e.name]);
        if e.is_dir {
            let children = read_dir_sorted(&p)?.into_iter();
            stack.push((p, children));
        } else {
            out.push(node_path::relative(base, &p));
        }
        if out.len() >= LIST_ALL_MAX {
            break;
        }
    }
    Ok(out)
}

/// 파일·폴더(재귀) 삭제. 없는 경로는 성공이다. 연결 폴더 루트(= base)는 지우지 않는다.
/// 심링크는 링크만 지운다 — 밖을 가리키는 링크는 스코프 검사가 대상을 보므로 지울 수 없다(TS 그대로).
pub fn delete(base: &str, path: Option<&str>) -> Result<(), String> {
    let abs = safe_from(base, path)?;
    if abs == base {
        return Err("연결 폴더 루트는 삭제할 수 없습니다".to_owned());
    }
    no_nul(&abs)?;
    let meta = match fs::symlink_metadata(&abs) {
        Ok(m) => m,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(node_error::format(&e, "lstat", Some(&abs))),
    };
    let (removed, syscall) = if meta.is_dir() {
        (fs::remove_dir_all(&abs), "rmdir")
    } else {
        (fs::remove_file(&abs), "unlink")
    };
    match removed {
        Err(e) if e.kind() != ErrorKind::NotFound => {
            Err(node_error::format(&e, syscall, Some(&abs)))
        }
        _ => Ok(()),
    }
}

/// 하위 폴더 열거(폴더 선택). `path` 는 **연결 루트 기준**이고 결과도 루트 기준 상대경로다.
/// 숨김·심링크·파일은 빼고, `FOLDERS_MAX_ENTRIES` 를 넘는 폴더가 있으면 `truncated`.
pub fn folders(root: &str, path: Option<&str>) -> Result<(Vec<String>, bool), String> {
    let dir_abs = safe_from(root, path)?;
    no_nul(&dir_abs)?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for e in read_dir_sorted(&dir_abs)? {
        if !e.is_dir || e.name.starts_with('.') {
            continue;
        }
        if entries.len() >= FOLDERS_MAX_ENTRIES {
            truncated = true;
            break;
        }
        entries.push(node_path::relative(
            root,
            &node_path::join(&[&dir_abs, &e.name]),
        ));
    }
    Ok((entries, truncated))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::{folders, list, list_all, mkdir_recursive, write};
    use std::os::unix::fs::PermissionsExt;

    struct Tmp(String);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn tmp(tag: &str) -> Tmp {
        let raw = std::env::temp_dir().join(format!("omk-fs-kinds-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&raw).unwrap();
        Tmp(std::fs::canonicalize(raw)
            .unwrap()
            .to_string_lossy()
            .into_owned())
    }

    /// Node readdir 와 같이 이름 바이트순 — 만든 순서와 무관하다.
    #[test]
    fn entries_are_name_sorted_and_list_all_is_depth_first() {
        let t = tmp("order");
        for d in ["b", "a/z", "a/c"] {
            std::fs::create_dir_all(format!("{}/{d}", t.0)).unwrap();
        }
        for f in ["c.txt", "B.txt", "a/z/2", "a/c/1", "a/0", "b/9"] {
            std::fs::write(format!("{}/{f}", t.0), b"").unwrap();
        }
        assert_eq!(list(&t.0, None).unwrap(), ["B.txt", "a/", "b/", "c.txt"]);
        assert_eq!(
            list_all(&t.0).unwrap(),
            ["B.txt", "a/0", "a/c/1", "a/z/2", "b/9", "c.txt"]
        );
    }

    /// 상한을 넘으면 이름순으로 앞의 것만 남는다(TS 와 같은 항목).
    #[test]
    fn caps_keep_the_first_entries_by_name() {
        let t = tmp("cap");
        for i in 0..201 {
            std::fs::create_dir(format!("{}/d{i:03}", t.0)).unwrap();
        }
        let (entries, truncated) = folders(&t.0, None).unwrap();
        assert!(truncated);
        assert_eq!(entries.first().map(String::as_str), Some("d000"));
        assert_eq!(entries.last().map(String::as_str), Some("d199"));
        let t2 = tmp("cap-all");
        for i in 0..1001 {
            std::fs::write(format!("{}/f{i:04}", t2.0), b"").unwrap();
        }
        let all = list_all(&t2.0).unwrap();
        assert_eq!(
            (all.len(), all.last().map(String::as_str)),
            (1000, Some("f0999"))
        );
    }

    /// 기대값은 Node 24.22.2 `fsp.mkdir(<T>/<경로>, { recursive: true })` 실측 — 실패한 **구간** 경로를 적는다.
    #[test]
    fn mkdir_recursive_reports_failed_segment_like_node() {
        let t = tmp("mkdirp");
        let ro = format!("{}/ro", t.0);
        std::fs::create_dir_all(format!("{ro}/ex")).unwrap();
        std::fs::write(format!("{}/f", t.0), b"").unwrap();
        std::fs::create_dir(format!("{}/d", t.0)).unwrap();
        std::os::unix::fs::symlink(format!("{}/loop", t.0), format!("{}/loop", t.0)).unwrap();
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o555)).unwrap();
        let long = "y".repeat(300);
        let cases: [(String, Option<String>); 9] = [
            (
                "ro/a/b".into(),
                Some("EACCES: permission denied, mkdir '<T>/ro/a'".into()),
            ),
            (
                "ro/a".into(),
                Some("EACCES: permission denied, mkdir '<T>/ro/a'".into()),
            ),
            ("ro/ex".into(), None),
            (
                "f".into(),
                Some("EEXIST: file already exists, mkdir '<T>/f'".into()),
            ),
            (
                "f/x/y".into(),
                Some("ENOTDIR: not a directory, mkdir '<T>/f/x/y'".into()),
            ),
            ("d/x/y".into(), None),
            (
                "loop".into(),
                Some("ELOOP: too many symbolic links encountered, mkdir '<T>/loop'".into()),
            ),
            (
                "loop/x".into(),
                Some("ELOOP: too many symbolic links encountered, mkdir '<T>/loop/x'".into()),
            ),
            (
                format!("x/{long}/z"),
                Some(format!("ENAMETOOLONG: name too long, mkdir '<T>/x/{long}'")),
            ),
        ];
        let got: Vec<_> = cases
            .iter()
            .map(|(rel, _)| {
                mkdir_recursive(&format!("{}/{rel}", t.0))
                    .map_err(|e| e.replace(&t.0, "<T>"))
                    .err()
            })
            .collect();
        let ro_write = write(&t.0, Some("ro/a/b/x.txt"), None).map_err(|e| e.replace(&t.0, "<T>"));
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o755)).unwrap();
        let want: Vec<_> = cases.into_iter().map(|(_, w)| w).collect();
        assert_eq!(got, want);
        assert_eq!(
            ro_write,
            Err("EACCES: permission denied, mkdir '<T>/ro/a'".to_owned())
        );
    }
}
