//! exec 샌드박스 준비 — TS `sandbox.ts`(`buildSandboxProfile`)와 `constants.ts` `SANDBOX_ENABLED`. git 디렉터리 탐지는 `git_trust`.
//! 프로파일 텍스트는 `sandbox_profile::build_sandbox_profile` 이 만든다(TS 와 바이트 단위로 같다).

use crate::constants::{PATH_PROBE_ENV_EXTRA_POSIX, TOOL_HOME_READ_SUBPATHS};
use crate::exec_path::env_get;
use crate::git_trust::GitPaths;
use crate::node_path;
use crate::platform::Platform;
use crate::sandbox_profile::{
    ReadScope, ToolRead, build_sandbox_profile, build_sandbox_profile_with, link_followable,
    tool_read_scope,
};

/// macOS 에서만, `OMK_BRIDGE_SANDBOX` 가 정확히 `"0"` 일 때만 끈다. 코어는 환경을 읽지 않는다 — 호스트가 이것으로 채운다.
pub fn sandbox_enabled(platform: Platform, env_value: Option<&str>) -> bool {
    platform == Platform::Darwin && env_value != Some("0")
}

/// 프로파일 파일 이름 — **더 쓰지 않는다**(프로파일은 파일 없이 `sandbox-exec -p` 로 넘긴다, 리뷰 F1). 호스트 코드가 부르고
/// 있을 수 있어 남겨 둔다.
pub fn profile_file_name(kind: &str, pid: u32, seq: usize) -> String {
    format!("omk-{kind}-sandbox-{pid}-{seq}.sb")
}

/// 연결 때 만드는 프로파일 텍스트 — 홈 realpath 가 실패하면 `None`(exec·도구는 fail-closed). 파일로 쓰지 않는다 — 파일이면
/// 샌드박스 안의 자식이 고칠 수 있는 자리(CLI 는 임시 폴더 — 프로파일이 쓰기를 연 `/private/var/folders`)에 놓일 때 확인 없는
/// 자식이 `(allow default)` 로 덮어써 다음 실행이 샌드박스 밖에서 돌았다(리뷰 F1). 호스트가 어디를 주든 같다.
/// 블록될 수 있는 FS 호출(홈 realpath)이라 부르는 쪽이 `FsGate` 안에서 부른다.
/// 테스트 전용(제품은 [`sandbox_profiles`] 를 쓴다).
pub fn sandbox_profile(
    root: &str,
    git: Option<&GitPaths>,
    protect: &[GitPaths],
    home: &str,
    tool: bool,
) -> Option<String> {
    let home = std::fs::canonicalize(home).ok()?;
    Some(build_sandbox_profile(
        root,
        git,
        protect,
        &home.to_string_lossy(),
        tool,
    ))
}

/// env 로 옮긴 mise 위치 후보(설계 §8 M2·§9 L5) — `PATH_PROBE_ENV_EXTRA_POSIX` 순서로 `XDG_*` 넷은 값 + `/mise`, `MISE_` 항목은
/// 값 그대로(`MISE_SHARED_INSTALL_DIRS` 는 `:` 로 나눈다). 절대경로만, realpath 전. `ZDOTDIR` 는 넣지 않는다.
pub fn mise_env_dirs(env: &[(String, String)]) -> Vec<String> {
    let mut out = Vec::new();
    for name in PATH_PROBE_ENV_EXTRA_POSIX {
        let Some(v) = env_get(env, name) else {
            continue;
        };
        let values: Vec<&str> = if *name == "MISE_SHARED_INSTALL_DIRS" {
            v.split(':').collect()
        } else {
            vec![v]
        };
        for v in values.into_iter().filter(|v| v.starts_with('/')) {
            if name.starts_with("XDG_") {
                out.push(node_path::join(&[v, "mise"]));
            } else if name.starts_with("MISE_") {
                out.push(node_path::join(&[v]));
            }
        }
    }
    out
}

/// 연결 때 도구 프로파일 홈 읽기 입력(FS 를 보기 전) — top, env 위치 후보, git 설정이 가리키는 파일.
#[derive(Debug, Clone, Default)]
pub struct ReadInputs {
    pub top: Option<String>,
    pub env_dirs: Vec<String>,
    pub git_config: Vec<String>,
}

/// 연결 때 만든 두 프로파일 텍스트와 도구 프로파일의 읽기 범위.
#[derive(Debug, Clone)]
pub struct Profiles {
    pub exec: String,
    pub tool: String,
    pub scope: ReadScope,
}

fn real(p: &str) -> Option<String> {
    std::fs::canonicalize(p)
        .ok()
        .map(|r| r.to_string_lossy().into_owned())
}

/// 입력을 realpath 로 — env 위치(없으면 버림), 허용 항목 가운데 realpath 가 다른 것(심링크 dotfiles), git 설정 파일. 가드는 순수 함수가 건다.
/// env 위치·허용 항목은 샌드박스 자식이 쓸 수 있는 자리 안이면 따라가지 않는다([`link_followable`], 코드 검증 R1 A1).
fn tool_read(home: &str, root: &str, inputs: &ReadInputs) -> ToolRead {
    let mut extra: Vec<String> = inputs
        .env_dirs
        .iter()
        .filter(|p| link_followable(home, root, p))
        .filter_map(|p| real(p))
        .collect();
    for d in TOOL_HOME_READ_SUBPATHS {
        let p = node_path::join(&[home, d]);
        if !link_followable(home, root, &p) || std::fs::symlink_metadata(&p).is_err() {
            continue;
        }
        if let Some(r) = real(&p).filter(|r| *r != p) {
            extra.push(r);
        }
    }
    ToolRead {
        top: inputs.top.clone(),
        extra,
        literals: inputs.git_config.iter().filter_map(|p| real(p)).collect(),
    }
}

/// 연결 때 프로파일 두 개(exec·도구)와 읽기 범위 — 홈 realpath 가 실패하면 `None`(fail-closed). FS 를 보므로 관문 안에서 부른다.
pub fn sandbox_profiles(
    root: &str,
    git: Option<&GitPaths>,
    protect: &[GitPaths],
    home: &str,
    inputs: &ReadInputs,
) -> Option<Profiles> {
    let home = real(home)?;
    let read = tool_read(&home, root, inputs);
    let text = |tool| build_sandbox_profile_with(root, git, protect, &home, tool, &read);
    Some(Profiles {
        exec: text(false),
        tool: text(true),
        scope: tool_read_scope(root, git, &home, &read),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::{profile_file_name, sandbox_profile};
    use crate::git_trust::GitPaths;
    use crate::sandbox_profile::build_sandbox_profile;

    #[test]
    fn profile_text_uses_real_home_and_fails_without_it() {
        let raw = std::env::temp_dir().join(format!("omk-sandbox-unit-{}", std::process::id()));
        std::fs::create_dir_all(raw.join("home")).unwrap();
        let t = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let git = GitPaths {
            git_dir: "/work/repo/.git".to_owned(),
            common_dir: "/work/repo/.git".to_owned(),
        };
        let got = sandbox_profile(
            "/work/repo",
            Some(&git),
            std::slice::from_ref(&git),
            &format!("{t}/home"),
            true,
        );
        let want = build_sandbox_profile(
            "/work/repo",
            Some(&git),
            std::slice::from_ref(&git),
            &format!("{t}/home"),
            true,
        );
        assert_eq!(got.as_deref(), Some(want.as_str()));
        assert_eq!(
            sandbox_profile("/w", None, &[], &format!("{t}/no-home"), false),
            None
        );
        assert!(profile_file_name("tool", 7, 3).ends_with("omk-tool-sandbox-7-3.sb"));
        let _ = std::fs::remove_dir_all(t);
    }
}
