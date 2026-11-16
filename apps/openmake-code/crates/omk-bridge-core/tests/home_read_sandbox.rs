//! 홈 읽기 좁히기 실측(설계 2026-11-16 §5) — 연결 때 만든 실제 프로파일 텍스트로 `sandbox-exec` 를 띄워 읽기·stat 의
//! 허용·거절을 본다. 홈은 가짜 홈(realpath)이다.
#![cfg(target_os = "macos")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

use omk_bridge_core::git_trust::{GitPaths, git_config_reads};
use omk_bridge_core::platform::Platform;
use omk_bridge_core::sandbox::{Profiles, ReadInputs, sandbox_profiles};
use support::runtime;

static SEQ: AtomicUsize = AtomicUsize::new(0);

struct Work {
    path: String,
}

impl Work {
    fn new() -> Work {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let raw = format!(
            "{}/omk-home-read-{}-{n}",
            env!("CARGO_TARGET_TMPDIR"),
            std::process::id()
        );
        let _ = std::fs::remove_dir_all(&raw);
        std::fs::create_dir_all(format!("{raw}/home")).unwrap();
        let path = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        Work { path }
    }
    fn join(&self, rel: &str) -> String {
        format!("{}/{rel}", self.path)
    }
    fn home(&self) -> String {
        self.join("home")
    }
    fn file(&self, rel: &str, text: &str) {
        let p = self.join(rel);
        std::fs::create_dir_all(std::path::Path::new(&p).parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    fn profiles(&self, root: &str, git: Option<&GitPaths>, inputs: &ReadInputs) -> Profiles {
        std::fs::create_dir_all(root).unwrap();
        let protect: Vec<GitPaths> = git.cloned().into_iter().collect();
        sandbox_profiles(root, git, &protect, &self.home(), inputs).unwrap()
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// 프로파일 안에서 명령 하나 — 성공 여부.
fn ok(profile: &str, cmd: &[&str]) -> bool {
    Command::new("/usr/bin/sandbox-exec")
        .arg("-p")
        .arg(profile)
        .args(cmd)
        .output()
        .unwrap()
        .status
        .success()
}

fn cat(profile: &str, p: &str) -> bool {
    ok(profile, &["/bin/cat", p])
}

fn stat(profile: &str, p: &str) -> bool {
    ok(profile, &["/usr/bin/stat", p])
}

fn none() -> ReadInputs {
    ReadInputs::default()
}

/// D-15·D-16·D-17 — 도구 프로파일은 홈을 허용 목록만 읽고, exec 프로파일은 개인 폴더만 막는다.
#[test]
fn tool_profile_reads_only_the_allowlist_and_exec_only_loses_privacy_folders() {
    let w = Work::new();
    w.file("home/notes.txt", "n");
    w.file("home/.gitconfig", "[user]\n");
    w.file("home/Desktop/x", "d");
    w.file("home/.ssh/x", "s");
    w.file("home/.npmrc", "t");
    let site = "home/Library/Python/3.9/lib/python/site-packages/pytest/__init__.py";
    w.file(site, "");
    let h = w.home();
    let p = w.profiles(&w.join("root"), None, &none());
    // pytest 탐지가 붙이는 사용자 site(`site.getusersitepackages()`)는 허용 목록에 있다.
    assert!(cat(&p.tool, &w.join(site)));
    // 도구 프로파일
    assert!(!cat(&p.tool, &format!("{h}/notes.txt")));
    assert!(!ok(&p.tool, &["/bin/ls", &h]));
    assert!(stat(&p.tool, &format!("{h}/notes.txt")));
    assert!(cat(&p.tool, &format!("{h}/.gitconfig")));
    assert!(!stat(&p.tool, &format!("{h}/.ssh/x")));
    assert!(!stat(&p.tool, &format!("{h}/.npmrc")));
    assert!(!cat(&p.tool, &format!("{h}/Desktop/x")));
    // exec 프로파일 — 홈 일반 파일은 종전대로, 개인 폴더는 내용만 거절
    assert!(cat(&p.exec, &format!("{h}/notes.txt")));
    assert!(cat(&p.exec, &format!("{h}/.npmrc")));
    assert!(!cat(&p.exec, &format!("{h}/Desktop/x")));
    assert!(stat(&p.exec, &format!("{h}/Desktop")));
    assert!(!cat(&p.exec, &format!("{h}/.ssh/x")));
}

/// D-16·D-19 — 연결 폴더가 개인 폴더 안이면 그 안은 읽히고 형제는 거절(두 프로파일).
#[test]
fn root_inside_privacy_folder_is_reopened_but_siblings_stay_closed() {
    let w = Work::new();
    w.file("home/Documents/proj/a.txt", "a");
    w.file("home/Documents/other.txt", "o");
    let h = w.home();
    let p = w.profiles(&format!("{h}/Documents/proj"), None, &none());
    for prof in [&p.exec, &p.tool] {
        assert!(cat(prof, &format!("{h}/Documents/proj/a.txt")));
        assert!(!cat(prof, &format!("{h}/Documents/other.txt")));
    }
}

/// D-17·D-19 — 연결 폴더가 홈 자신이어도 비밀은 읽기·stat 모두 거절(두 프로파일).
#[test]
fn root_is_home_still_hides_secrets() {
    let w = Work::new();
    w.file("home/.ssh/x", "s");
    w.file("home/notes.txt", "n");
    let h = w.home();
    let p = w.profiles(&h, None, &none());
    for prof in [&p.exec, &p.tool] {
        assert!(!cat(prof, &format!("{h}/.ssh/x")));
        assert!(!stat(prof, &format!("{h}/.ssh/x")));
        assert!(cat(prof, &format!("{h}/notes.txt")));
    }
}

/// D-19·§8 M1 — 하위 폴더 연결은 top 이 있어야 상위 설정을 읽는다. 가드에 걸린 top(홈)은 버린다.
#[test]
fn top_reopens_the_work_tree_and_the_guard_drops_home() {
    let w = Work::new();
    w.file("home/work/repo/tsconfig.base.json", "{}");
    w.file("home/work/repo/packages/app/a.ts", "");
    w.file("home/notes.txt", "n");
    let h = w.home();
    let root = format!("{h}/work/repo/packages/app");
    let base = format!("{h}/work/repo/tsconfig.base.json");
    let without = w.profiles(&root, None, &none());
    assert!(!cat(&without.tool, &base));
    let top = ReadInputs {
        top: Some(format!("{h}/work/repo")),
        ..none()
    };
    let with = w.profiles(&root, None, &top);
    assert!(cat(&with.tool, &base));
    assert!(with.scope.allow.contains(&format!("{h}/work/repo")));
    let home_top = ReadInputs {
        top: Some(h.clone()),
        ..none()
    };
    let guarded = w.profiles(&root, None, &home_top);
    assert!(!cat(&guarded.tool, &format!("{h}/notes.txt")));
}

/// §8 M2 — 연결 폴더와 홈 사이 조상의 버전 파일은 읽힌다(조상 이름 줄). 같은 자리의 다른 파일은 거절.
#[test]
fn ancestor_version_files_are_readable() {
    let w = Work::new();
    w.file("home/work/.tool-versions", "node 22\n");
    w.file("home/work/notes.txt", "n");
    let h = w.home();
    let p = w.profiles(&format!("{h}/work/proj"), None, &none());
    assert!(cat(&p.tool, &format!("{h}/work/.tool-versions")));
    assert!(!cat(&p.tool, &format!("{h}/work/notes.txt")));
}

/// D-15 심링크·§8 M2 env 위치 — realpath 가 홈의 엄격한 하위면 허용에 들어가고, 홈 자신·홈 밖·개인 폴더 안이면 안 들어간다.
#[test]
fn symlinked_entries_and_env_locations_follow_the_guard() {
    let w = Work::new();
    w.file("home/dot/mise/config.toml", "");
    w.file("outside/mise/config.toml", "");
    w.file("home/Documents/mise-data/x", "");
    w.file("home/xdg/mise/config.toml", "");
    let h = w.home();
    std::fs::create_dir_all(format!("{h}/.config")).unwrap();
    std::os::unix::fs::symlink(format!("{h}/dot/mise"), format!("{h}/.config/mise")).unwrap();
    std::os::unix::fs::symlink(w.join("outside/mise"), format!("{h}/.mise")).unwrap();
    std::os::unix::fs::symlink(&h, format!("{h}/mise")).unwrap();
    let inputs = ReadInputs {
        env_dirs: vec![
            format!("{h}/xdg/mise"),
            format!("{h}/Documents/mise-data"),
            format!("{h}/missing"),
        ],
        ..none()
    };
    let p = w.profiles(&w.join("root"), None, &inputs);
    let allow = &p.scope.allow;
    assert!(allow.contains(&format!("{h}/dot/mise")));
    assert!(allow.contains(&format!("{h}/xdg/mise")));
    assert!(!allow.contains(&w.join("outside/mise")));
    assert!(!allow.contains(&format!("{h}/Documents/mise-data")));
    assert!(!allow.contains(&h));
    assert!(cat(&p.tool, &format!("{h}/dot/mise/config.toml")));
}

/// D-18·§8 M4 — 전역 git 설정의 include·excludesFile 은 literal 이 있어야 도구 git 이 읽는다.
#[test]
fn git_config_literals_keep_tool_git_working() {
    let w = Work::new();
    let h = w.home();
    w.file(
        "home/.gitconfig",
        "[include]\n\tpath = ~/.gitconfig.local\n[core]\n\texcludesFile = ~/.gitignore_global\n",
    );
    w.file("home/.gitconfig.local", "[user]\n\tname = t\n");
    w.file("home/.gitignore_global", "ignored.txt\n");
    let root = w.join("repo");
    std::fs::create_dir_all(&root).unwrap();
    let env: Vec<(String, String)> = vec![
        ("HOME".to_owned(), h.clone()),
        (
            "PATH".to_owned(),
            "/usr/bin:/bin:/opt/homebrew/bin".to_owned(),
        ),
        ("GIT_CONFIG_NOSYSTEM".to_owned(), "1".to_owned()),
    ];
    let git = |profile: Option<&str>, args: &[&str]| {
        let mut c = match profile {
            Some(p) => {
                let mut c = Command::new("/usr/bin/sandbox-exec");
                c.args(["-p", p, "git"]);
                c
            }
            None => Command::new("git"),
        };
        c.env_clear()
            .envs(env.clone())
            .current_dir(&root)
            .args(args);
        c.output().unwrap()
    };
    assert!(git(None, &["init", "-q"]).status.success());
    w.file("repo/ignored.txt", "x");
    w.file("repo/kept.txt", "x");
    let g = GitPaths {
        git_dir: format!("{root}/.git"),
        common_dir: format!("{root}/.git"),
    };
    let without = w.profiles(&root, Some(&g), &none());
    assert!(
        !git(Some(&without.tool), &["status", "--porcelain"])
            .status
            .success()
    );
    let found = runtime().block_on(git_config_reads(&root, &env, Platform::Darwin, true, &h));
    assert!(
        found.contains(&format!("{h}/.gitconfig.local")),
        "{found:?}"
    );
    let inputs = ReadInputs {
        git_config: found,
        ..none()
    };
    let with = w.profiles(&root, Some(&g), &inputs);
    let out = git(Some(&with.tool), &["status", "--porcelain"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("kept.txt") && !text.contains("ignored.txt"),
        "{text}"
    );
}
