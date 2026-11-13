//! 읽기 전용 도구가 띄우는 자식 하나의 실행 조건 — TS `diagnostics.ts` `run`·`test-runner.ts` `canImportPytest` 의
//! `execFile` 자리(설계 D-64·D-65).

use crate::constants::{MAX_BUFFER, SANDBOX_BIN};
use crate::exec::FAIL_CLOSED;
use crate::exec_env::build_exec_env;
use crate::exec_path::env_get;
use crate::node_path;
use crate::platform::{Platform, path_list_separator};
use crate::proc::{self, ProcOutput, ProcSpec, Stderr, Stdin};

/// exec 호스트가 없는 코어의 거절 — worktree(D-38)와 같은 문구·같은 이유(자식에 줄 환경 사본이 없다).
pub(crate) const NO_HOST: &str = "exec 호스트가 설정되지 않았습니다";

/// 자식을 감쌀 샌드박스 — 꺼짐, exec 와 같은 프로파일, 켜졌는데 프로파일이 없음(fail-closed).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolSandbox {
    Off,
    Profile(String),
    Missing,
}

#[derive(Debug, Clone)]
pub struct ToolEnv {
    /// 호스트 환경 사본 — 자식에는 허용 목록만 간다.
    pub env: Vec<(String, String)>,
    pub platform: Platform,
    /// exec PATH(로그인 셸·mise 를 합친 값).
    pub exec_path: String,
    pub sandbox: ToolSandbox,
}

impl ToolEnv {
    /// 자식 PATH — exec PATH, 비어 있으면 환경의 `PATH` → `Path` → `""`(TS `extraPath || PATH || Path || ''`).
    fn path_value(&self) -> &str {
        [self.exec_path.as_str()]
            .into_iter()
            .chain(env_get(&self.env, "PATH"))
            .chain(env_get(&self.env, "Path"))
            .find(|p| !p.is_empty())
            .unwrap_or("")
    }

    /// 자식 하나 — 인자·cwd·환경은 TS 와 같고, 샌드박스가 켜졌으면 `sandbox-exec -f <프로파일>` 앞머리만 더한다
    /// (셸을 거치지 않는다). 프로파일이 없으면 exec 와 같은 fail-closed 문구로 거절한다 — 띄워야 할 때만 부른다.
    pub fn spec(
        &self,
        file: &str,
        args: &[&str],
        cwd: &str,
        timeout_ms: u64,
    ) -> Result<ProcSpec, String> {
        let args: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
        let (file, args) = match &self.sandbox {
            ToolSandbox::Missing => return Err(FAIL_CLOSED.to_owned()),
            ToolSandbox::Off => (file.to_owned(), args),
            ToolSandbox::Profile(p) => {
                let mut wrapped = vec!["-f".to_owned(), p.clone(), file.to_owned()];
                wrapped.extend(args);
                (SANDBOX_BIN.to_owned(), wrapped)
            }
        };
        let pairs = self.env.iter().map(|(k, v)| (k.as_str(), v.as_str()));
        Ok(ProcSpec {
            file,
            args,
            cwd: Some(cwd.to_owned()),
            env: build_exec_env(pairs, self.path_value(), self.platform, &[]),
            timeout_ms,
            max_buffer: MAX_BUFFER as usize,
            stdin: Stdin::HeldOpen,
            stderr: Stderr::Capture,
        })
    }

    /// 샌드박스가 켜졌는데 프로파일이 없으면 exec 와 같은 fail-closed 문구 — 자식을 띄울 자리에서 실행 파일을 찾기 **전에**
    /// 부른다(TS 는 감싸기가 PATH 확인보다 먼저 던진다 — 없는 python3 가 "깨끗함/없음"으로 보이지 않게).
    pub fn ensure_profile(&self) -> Result<(), String> {
        match self.sandbox {
            ToolSandbox::Missing => Err(FAIL_CLOSED.to_owned()),
            ToolSandbox::Off | ToolSandbox::Profile(_) => Ok(()),
        }
    }

    /// 자식 하나를 띄운다. 감싼 자식에서 sandbox-exec **자체**가 실패하면(프로파일 파일 유실·문법 오류 65, 실행 파일
    /// execvp 실패 71 — stderr 가 `sandbox-exec:` 로 시작) "진단 없음/none" 으로 삼키지 않고 프로파일 없음과 같이 거절한다
    /// (TS 별건 수정 M1 과 같은 규칙). 이름으로 띄우는 실행 파일은 부르는 쪽이 먼저 찾아 절대경로로 넘긴다(71 과 섞이지 않게).
    pub async fn run(
        &self,
        file: &str,
        args: &[&str],
        cwd: &str,
        timeout_ms: u64,
    ) -> Result<ProcOutput, String> {
        let out = proc::run(self.spec(file, args, cwd, timeout_ms)?).await;
        let wrapped = matches!(self.sandbox, ToolSandbox::Profile(_));
        let code = out.end.exec_file_code();
        if wrapped && (code == 65 || code == 71) && out.stderr.starts_with("sandbox-exec:") {
            return Err(FAIL_CLOSED.to_owned());
        }
        Ok(out)
    }

    /// PATH 에서 실행 파일 찾기 — TS `onPath`(`access(X_OK)`). `unsafe` 없이 부를 수 없어 "모드에 실행 비트가 하나라도
    /// 있다"로 본다(심링크는 따라간다, 폴더도 통과 — D-69). FS 를 보므로 관문 안에서 부른다.
    /// 절대경로 항목만 본다 — 상대 항목(`bin`·`.`)은 자식 cwd(연결 폴더) 기준으로 풀려 폴더의 실행 파일을 고를 수 있다
    /// (도구 샌드박스 리뷰 R2-1, TS 는 아직 본다 — Rust 가 더 엄격). 찾은 절대경로로 띄운다.
    pub fn find_on_path(&self, bin: &str) -> Option<String> {
        let sep = path_list_separator(self.platform);
        self.path_value()
            .split(sep)
            .filter(|d| std::path::Path::new(d).is_absolute())
            .map(|d| node_path::join(&[d, bin]))
            .find(|p| executable(p))
    }
}

#[cfg(unix)]
fn executable(p: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn executable(p: &str) -> bool {
    std::fs::metadata(p).is_ok()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use std::os::unix::fs::PermissionsExt;

    use super::{ToolEnv, ToolSandbox};
    use crate::platform::Platform;

    fn env(exec_path: &str, sandbox: ToolSandbox, extra: &[(&str, &str)]) -> ToolEnv {
        let mut env = vec![
            ("HOME".to_owned(), "/synthetic/home".to_owned()),
            (
                "GITHUB_TOKEN".to_owned(),
                "omk-conformance-secret-2".to_owned(),
            ),
        ];
        env.extend(
            extra
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned())),
        );
        ToolEnv {
            env,
            platform: Platform::Darwin,
            exec_path: exec_path.to_owned(),
            sandbox,
        }
    }

    /// 감싸기 — `-f <프로파일>` 뒤에 실행 파일·인자가 그대로(셸을 거치지 않는다). 환경은 허용 목록 + PATH.
    #[test]
    fn profile_wraps_with_sandbox_exec() {
        let t = env(
            "/work/bin",
            ToolSandbox::Profile("/work/p.sb".to_owned()),
            &[],
        );
        let s = t
            .spec("/work/node_modules/.bin/tsc", &["-p", "a b"], "/work", 900)
            .unwrap();
        assert_eq!(s.file, "/usr/bin/sandbox-exec");
        assert_eq!(
            s.args,
            [
                "-f",
                "/work/p.sb",
                "/work/node_modules/.bin/tsc",
                "-p",
                "a b"
            ]
        );
        assert_eq!(
            (s.cwd.as_deref(), s.timeout_ms, s.max_buffer),
            (Some("/work"), 900, 1024 * 1024)
        );
        assert_eq!(s.env.get("PATH").map(String::as_str), Some("/work/bin"));
        assert_eq!(
            s.env.get("HOME").map(String::as_str),
            Some("/synthetic/home")
        );
        assert!(!s.env.contains_key("GITHUB_TOKEN"));
        let off = env("/work/bin", ToolSandbox::Off, &[])
            .spec("python3", &["-I"], "/work", 1)
            .unwrap();
        assert_eq!(
            (off.file.as_str(), off.args.as_slice()),
            ("python3", ["-I".to_owned()].as_slice())
        );
    }

    #[test]
    fn missing_profile_is_fail_closed() {
        let e = env("/work/bin", ToolSandbox::Missing, &[])
            .spec("python3", &[], "/work", 1)
            .err()
            .unwrap();
        assert!(
            e.starts_with("exec 샌드박스 프로파일을 준비하지 못해 실행을 거부했습니다"),
            "{e}"
        );
    }

    /// TS `extraPath || process.env.PATH || process.env.Path || ''`.
    #[test]
    fn path_falls_back_to_env_path_then_path_case() {
        let path_of = |t: ToolEnv| t.spec("x", &[], "/", 1).unwrap().env["PATH"].clone();
        assert_eq!(
            path_of(env("", ToolSandbox::Off, &[("PATH", "/a"), ("Path", "/b")])),
            "/a"
        );
        assert_eq!(
            path_of(env("", ToolSandbox::Off, &[("PATH", ""), ("Path", "/b")])),
            "/b"
        );
        assert_eq!(path_of(env("", ToolSandbox::Off, &[])), "");
        assert_eq!(
            path_of(env("/e", ToolSandbox::Off, &[("PATH", "/a")])),
            "/e"
        );
    }

    /// 실행 비트(D-69) — 모드에 실행 비트가 하나라도 있으면(심링크는 따라간다), 폴더도 통과. 빈 구간은 건너뛴다.
    #[test]
    fn find_on_path_checks_exec_bits() {
        let raw = std::env::temp_dir().join(format!("omk-tool-env-{}", std::process::id()));
        std::fs::create_dir_all(&raw).unwrap();
        let d = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        for (sub, mode) in [("a", 0o644), ("b", 0o755), ("c", 0o010)] {
            std::fs::create_dir_all(format!("{d}/{sub}")).unwrap();
            let p = format!("{d}/{sub}/go");
            std::fs::write(&p, "").unwrap();
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(mode)).unwrap();
        }
        std::fs::create_dir_all(format!("{d}/dir/go")).unwrap();
        std::fs::create_dir_all(format!("{d}/dangling")).unwrap();
        std::os::unix::fs::symlink(format!("{d}/nope"), format!("{d}/dangling/go")).unwrap();
        let find = |p: &str| env(p, ToolSandbox::Off, &[]).find_on_path("go");
        assert_eq!(find(&format!("{d}/a")), None);
        assert_eq!(find(&format!("{d}/a:{d}/b")), Some(format!("{d}/b/go")));
        assert_eq!(find(&format!("::{d}/c:")), Some(format!("{d}/c/go")));
        assert_eq!(find(&format!("{d}/dir")), Some(format!("{d}/dir/go")));
        assert_eq!(find(&format!("{d}/dangling")), None);
        assert_eq!(find(""), None);
        // 상대 항목은 보지 않는다(이 프로세스 cwd 를 그 폴더로 두지 않아도 같은 결과여야 한다).
        assert_eq!(find("b"), None);
        let _ = std::fs::remove_dir_all(&d);
    }
}
