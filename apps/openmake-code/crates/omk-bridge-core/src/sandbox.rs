//! exec 샌드박스 준비 — TS `sandbox.ts`(git 디렉터리 탐지·프로파일 파일 쓰기)와 `constants.ts` `SANDBOX_ENABLED`.
//! 프로파일 텍스트는 `sandbox_profile::build_sandbox_profile` 이 만든다(TS 와 바이트 단위로 같다).

use crate::constants::GIT_PROBE_TIMEOUT_MS;
use crate::exec_env::build_exec_env;
use crate::exec_path::env_get;
use crate::js_text::js_trim;
use crate::node_path;
use crate::platform::Platform;
use crate::proc::{self, ProcEnd, ProcSpec, Stderr, Stdin};
use crate::sandbox_profile::build_sandbox_profile;

/// macOS 에서만, `OMK_BRIDGE_SANDBOX` 가 정확히 `"0"` 일 때만 끈다. 코어는 환경을 읽지 않는다 — 호스트가 이것으로 채운다.
pub fn sandbox_enabled(platform: Platform, env_value: Option<&str>) -> bool {
    platform == Platform::Darwin && env_value != Some("0")
}

/// 프로파일 파일 이름 — 코어마다 다르다(D-34). 헬퍼는 모든 코어에 같은 폴더를 넘긴다.
pub fn profile_file_name(pid: u32, seq: usize) -> String {
    format!("omk-exec-sandbox-{pid}-{seq}.sb")
}

/// 연결 폴더가 git 레포(하위 폴더 포함)면 레포 `.git` 의 절대경로. 레포 하위 폴더를 연결하면 `.git` 이 폴더 밖이라
/// 프로파일이 git 쓰기를 열어 줘야 한다. 자식 환경은 exec 와 같은 허용 목록 + 프로세스 PATH, stderr 는 버린다.
pub async fn detect_git_dir(
    root: &str,
    env: &[(String, String)],
    platform: Platform,
) -> Option<String> {
    let pairs = env.iter().map(|(k, v)| (k.as_str(), v.as_str()));
    let spec = ProcSpec {
        file: "git".to_owned(),
        args: vec!["rev-parse".to_owned(), "--absolute-git-dir".to_owned()],
        cwd: Some(root.to_owned()),
        env: build_exec_env(pairs, env_get(env, "PATH").unwrap_or(""), platform, &[]),
        timeout_ms: GIT_PROBE_TIMEOUT_MS,
        max_buffer: 1024 * 1024,
        stdin: Stdin::Null,
        stderr: Stderr::Null,
    };
    let out = proc::run(spec).await;
    if !matches!(out.end, ProcEnd::Exited(0)) {
        return None;
    }
    Some(js_trim(&out.stdout).to_owned()).filter(|g| !g.is_empty())
}

/// 프로파일을 `out_file` 에 쓰고 그 경로를 돌려준다. 홈 realpath·폴더 만들기·쓰기 중 하나라도 실패하면 `None`
/// (exec 는 fail-closed). 블록될 수 있는 FS 호출이라 부르는 쪽이 `FsGate` 안에서 부른다.
pub fn write_sandbox_profile(
    root: &str,
    git_dir: Option<&str>,
    home: &str,
    out_file: &str,
) -> Option<String> {
    let home = std::fs::canonicalize(home).ok()?;
    let profile = build_sandbox_profile(root, git_dir, &home.to_string_lossy());
    std::fs::create_dir_all(node_path::dirname(out_file)).ok()?;
    std::fs::write(out_file, profile).ok()?;
    Some(out_file.to_owned())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::{profile_file_name, write_sandbox_profile};
    use crate::sandbox_profile::build_sandbox_profile;

    fn tmp(name: &str) -> String {
        let p =
            std::env::temp_dir().join(format!("omk-sandbox-unit-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        std::fs::canonicalize(p)
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn writes_build_sandbox_profile_text() {
        let t = tmp("write");
        std::fs::create_dir(format!("{t}/home")).unwrap();
        let out = format!("{t}/deep/dir/{}", profile_file_name(7, 3));
        let got = write_sandbox_profile(
            "/work/repo",
            Some("/work/repo/.git"),
            &format!("{t}/home"),
            &out,
        );
        assert_eq!(got.as_deref(), Some(out.as_str()));
        let want =
            build_sandbox_profile("/work/repo", Some("/work/repo/.git"), &format!("{t}/home"));
        assert_eq!(std::fs::read_to_string(&out).unwrap(), want);
        assert!(out.ends_with("/omk-exec-sandbox-7-3.sb"));
        let _ = std::fs::remove_dir_all(t);
    }

    #[test]
    fn failures_are_none() {
        let t = tmp("fail");
        std::fs::create_dir(format!("{t}/home")).unwrap();
        // 홈 realpath 실패
        assert_eq!(
            write_sandbox_profile("/w", None, &format!("{t}/no-home"), &format!("{t}/p.sb")),
            None
        );
        // 프로파일 폴더 자리에 파일
        std::fs::write(format!("{t}/file"), b"").unwrap();
        assert_eq!(
            write_sandbox_profile("/w", None, &format!("{t}/home"), &format!("{t}/file/p.sb")),
            None
        );
        let _ = std::fs::remove_dir_all(t);
    }
}
