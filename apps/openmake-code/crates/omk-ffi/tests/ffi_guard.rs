//! 가드(PR-3.2) — T-F9 unsafe 예외 범위(D-224 (r3)), T-F11 링크되는 MPL-2.0 크레이트의 배포 고지(D-244 / 검토 r3 L-C).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

/// 주석 줄을 뺀 코드 줄.
fn code_lines(src: &str) -> impl Iterator<Item = &str> {
    src.lines().filter(|l| !l.trim_start().starts_with("//"))
}

/// 식별자 경계로 떨어진 `unsafe` 가 있는가(`unsafe_code` 는 아니다).
fn has_unsafe_token(line: &str) -> bool {
    let ident = |c: char| c.is_alphanumeric() || c == '_';
    line.match_indices("unsafe").any(|(i, w)| {
        let before = line[..i].chars().next_back().is_none_or(|c| !ident(c));
        let after = line[i + w.len()..].chars().next().is_none_or(|c| !ident(c));
        before && after
    })
}

/// `[표]` 의 `키 = 값` 줄들(주석·빈 줄 제외).
fn toml_table(src: &str, table: &str) -> BTreeSet<String> {
    let mut on = false;
    let mut out = BTreeSet::new();
    for l in src.lines().map(str::trim) {
        if l.starts_with('[') {
            on = l == format!("[{table}]");
            continue;
        }
        if on && !l.is_empty() && !l.starts_with('#') {
            out.insert(l.replace(' ', ""));
        }
    }
    out
}

/// T-F9 — unsafe 는 lib.rs 의 허용 한 줄(생성 코드)과 cloexec.rs 뿐. 그 밖의 손 모듈은 맨 위 forbid. lints 표는 워크스페이스
/// clippy 값과 같고 unsafe 만 deny.
#[test]
fn unsafe_stays_in_its_two_places() {
    let src = crate_dir().join("src");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&src)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    files.sort();
    let names: Vec<String> = files
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        names,
        ["cloexec.rs", "convert.rs", "ffi.rs", "lib.rs", "run.rs"],
        "새 모듈이면 이 가드의 규칙을 정한다"
    );
    for (p, name) in files.iter().zip(&names) {
        let s = read(p);
        let allow = s.matches("allow(unsafe_code)").count();
        assert_eq!(
            allow,
            usize::from(name == "lib.rs"),
            "{name}: allow(unsafe_code)"
        );
        let tokens = code_lines(&s).filter(|l| has_unsafe_token(l)).count();
        if name == "cloexec.rs" {
            assert!(
                tokens > 0,
                "cloexec.rs 에 unsafe 블록이 있어야 한다(없으면 이 예외를 지운다)"
            );
        } else {
            assert_eq!(tokens, 0, "{name}: unsafe 토큰");
        }
        let exempt = ["lib.rs", "ffi.rs", "cloexec.rs"].contains(&name.as_str());
        assert_eq!(
            s.contains("#![forbid(unsafe_code)]"),
            !exempt,
            "{name}: #![forbid(unsafe_code)]"
        );
    }
    let ours = read(&crate_dir().join("Cargo.toml"));
    let ws = read(&crate_dir().join("../../Cargo.toml"));
    assert_eq!(
        toml_table(&ours, "lints.clippy"),
        toml_table(&ws, "workspace.lints.clippy")
    );
    assert_eq!(
        toml_table(&ours, "lints.rust"),
        BTreeSet::from(["unsafe_code=\"deny\"".to_owned()])
    );
    assert!(!ours.contains("[lints]\nworkspace = true"));
}

/// T0-d 로 정한 집합 — `cargo tree -p omk-ffi -e normal,no-proc-macro --target aarch64-apple-darwin --prefix none` 에
/// 있는(앱에 링크되는) MPL-2.0 크레이트.
const LINKED_MPL: &[&str] = &["uniffi", "uniffi_core", "uniffi_pipeline"];
/// 같은 명령 출력에 없는(빌드 시점 전용 — proc-macro·생성기) uniffi 크레이트.
const BUILD_ONLY_UNIFFI: &[&str] = &[
    "uniffi_bindgen",
    "uniffi_internal_macros",
    "uniffi_macros",
    "uniffi_meta",
    "uniffi_udl",
];

/// `Cargo.lock` 의 (이름, 판).
fn lock_packages() -> Vec<(String, String)> {
    let lock = read(&crate_dir().join("../../Cargo.lock"));
    let mut out = Vec::new();
    let mut name = None;
    for l in lock.lines() {
        if let Some(n) = l.strip_prefix("name = ") {
            name = Some(n.trim_matches('"').to_owned());
        } else if let (Some(v), Some(n)) = (l.strip_prefix("version = "), name.take()) {
            out.push((n, v.trim_matches('"').to_owned()));
        }
    }
    out
}

/// T-F11 — (가) `Cargo.lock` 의 `uniffi*` 집합이 두 상수의 합과 같다(목록 밖이 생기면 M-B 명령으로 다시 판정해 상수와 고지를
/// 고친다). (나) 링크되는 것마다 이름·판 글자가 고지 파일에 있다(판을 올리고 고지를 안 고치면 실패).
#[test]
fn linked_mpl_crates_are_noticed() {
    let pkgs = lock_packages();
    let in_lock: BTreeSet<&str> = pkgs
        .iter()
        .map(|(n, _)| n.as_str())
        .filter(|n| n.starts_with("uniffi"))
        .collect();
    let known: BTreeSet<&str> = LINKED_MPL
        .iter()
        .chain(BUILD_ONLY_UNIFFI)
        .copied()
        .collect();
    assert_eq!(in_lock, known);
    let notices = read(&crate_dir().join("../../../desktop-native/THIRD_PARTY_NOTICES.md"));
    for name in LINKED_MPL {
        let (_, ver) = pkgs.iter().find(|(n, _)| n == name).unwrap();
        assert!(
            notices.contains(&format!("`{name}` {ver}")),
            "THIRD_PARTY_NOTICES.md 에 `{name}` {ver} 없음"
        );
    }
}
