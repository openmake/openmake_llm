//! exec PATH 계산 — TS `exec-path.ts`.
//!
//! Finder 로 띄운 GUI 앱은 로그인 셸 PATH 를 물려받지 못해 mise·Homebrew 런타임을 못 찾는다. ① 로그인 셸 PATH
//! ② 프로세스 PATH ③ 표준 설치 경로 4곳을 합치고, ④ `mise bin-paths`(cwd = 연결 폴더라 프로젝트 버전 반영)를 앞에 둔다.
//! 단계마다 실패하면 다음 폴백으로 넘어간다. 두 자식에는 exec 와 같은 허용 목록 + 위치 변수만 넘긴다.
//! TS 와 달리 프로세스 환경을 직접 읽지 않고 호스트가 준 사본(`env`·`home`)을 쓴다(D-33), 자식의 stderr 는 버린다(D-35).

use std::collections::BTreeMap;

use crate::constants::{PATH_PROBE_ENV_EXTRA_POSIX, PATH_PROBE_TIMEOUT_MS};
use crate::exec_env::build_exec_env;
use crate::js_text::js_trim;
use crate::node_path;
use crate::platform::Platform;
use crate::proc::{self, ProcEnd, ProcSpec, Stderr, Stdin};

/// `execFileSync` 의 기본 출력 상한.
const SYNC_MAX_BUFFER: usize = 1024 * 1024;

/// 환경 사본에서 키 하나(첫 값).
pub(crate) fn env_get<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
    env.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

/// 병합(순수) — 로그인 셸 출력(`trim` 후 `:` 로 나눔)·프로세스 PATH·고정 4곳을 처음 나온 순서로 중복 없이 합치고,
/// mise 출력(`trim` 후 줄마다, 빈 줄 제외)이 있으면 그것을 앞에 둔다(겹치면 mise 자리가 이긴다).
pub fn merge_exec_path(login: Option<&str>, process_path: &str, home: &str, mise: Option<&str>) -> String {
    let local_bin = node_path::join(&[home, ".local/bin"]);
    let shims = node_path::join(&[home, ".local/share/mise/shims"]);
    let mut parts: Vec<&str> = Vec::new();
    if let Some(out) = login {
        parts.extend(js_trim(out).split(':'));
    }
    parts.extend(process_path.split(':'));
    parts.extend(["/opt/homebrew/bin", "/usr/local/bin", &local_bin, &shims]);
    let base = dedupe(parts.into_iter().filter(|p| !p.is_empty()));
    let Some(mise) = mise else {
        return base.join(":");
    };
    let mise_paths = js_trim(mise).split('\n').filter(|p| !p.is_empty());
    dedupe(mise_paths.chain(base.iter().copied())).join(":")
}

fn dedupe<'a>(items: impl Iterator<Item = &'a str>) -> Vec<&'a str> {
    let mut out: Vec<&str> = Vec::new();
    for p in items {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

fn probe(file: &str, args: &[&str], cwd: Option<&str>, env: BTreeMap<String, String>) -> ProcSpec {
    ProcSpec {
        file: file.to_owned(),
        args: args.iter().map(|a| (*a).to_owned()).collect(),
        cwd: cwd.map(str::to_owned),
        env,
        timeout_ms: PATH_PROBE_TIMEOUT_MS,
        max_buffer: SYNC_MAX_BUFFER,
        stdin: Stdin::Null,
        stderr: Stderr::Null,
    }
}

/// 로그인 셸 — `SHELL` 이 없거나 비면 `/bin/zsh`(TS `process.env.SHELL || '/bin/zsh'`).
fn login_shell(env: &[(String, String)]) -> &str {
    env_get(env, "SHELL").filter(|s| !s.is_empty()).unwrap_or("/bin/zsh")
}

/// 성공(코드 0)일 때만 출력 — `execFileSync` 는 그 밖(코드·신호·시간 초과·상한·띄우기 실패)에 던진다.
async fn run_ok(spec: ProcSpec) -> Option<String> {
    let out = proc::run(spec).await;
    matches!(out.end, ProcEnd::Exited(0)).then_some(out.stdout)
}

/// exec PATH. `folder_root` 가 없으면 mise 는 홈에서 돈다. Windows 는 로그인 셸·mise 관행이 없어 프로세스 PATH 그대로.
pub async fn resolve_exec_path(
    env: &[(String, String)],
    home: &str,
    platform: Platform,
    folder_root: Option<&str>,
) -> String {
    if platform == Platform::Win32 {
        let pick = |k| env_get(env, k).filter(|v| !v.is_empty());
        return pick("PATH").or_else(|| pick("Path")).unwrap_or("").to_owned();
    }
    let process_path = env_get(env, "PATH").unwrap_or("");
    let probe_env = |path: &str| {
        let pairs = env.iter().map(|(k, v)| (k.as_str(), v.as_str()));
        build_exec_env(pairs, path, platform, PATH_PROBE_ENV_EXTRA_POSIX)
    };
    let login = probe(login_shell(env), &["-lc", "echo -n \"$PATH\""], None, probe_env(process_path));
    let login = run_ok(login).await;
    let base = merge_exec_path(login.as_deref(), process_path, home, None);
    let mise_cwd = folder_root.unwrap_or(home);
    let mise = probe("mise", &["bin-paths"], Some(mise_cwd), probe_env(&base));
    match run_ok(mise).await {
        Some(out) => merge_exec_path(login.as_deref(), process_path, home, Some(&out)),
        None => base,
    }
}

#[cfg(test)]
mod tests {
    use super::{login_shell, merge_exec_path};

    /// fixture 에 넣지 않는다 — macOS 는 실제 zsh 가 돌고 Linux CI 에는 없다.
    #[test]
    fn shell_falls_back_to_zsh() {
        let env = |v: Option<&str>| v.map(|v| vec![("SHELL".to_owned(), v.to_owned())]).unwrap_or_default();
        assert_eq!(login_shell(&env(None)), "/bin/zsh");
        assert_eq!(login_shell(&env(Some(""))), "/bin/zsh");
        assert_eq!(login_shell(&env(Some("/bin/fish"))), "/bin/fish");
    }

    #[test]
    fn merge_order_dedupe_and_mise_first() {
        let fixed = "/opt/homebrew/bin:/usr/local/bin:/h/.local/bin:/h/.local/share/mise/shims";
        assert_eq!(merge_exec_path(None, "", "/h", None), fixed);
        assert_eq!(
            merge_exec_path(Some(" /a::/b\n"), "/b:/c", "/h", None),
            format!("/a:/b:/c:{fixed}")
        );
        assert_eq!(
            merge_exec_path(Some("/a"), "/c", "/h", Some("\n/m\n\n/c\n")),
            format!("/m:/c:/a:{fixed}")
        );
        // 홈 끝 `/` 는 path.join 이 정리한다.
        assert!(merge_exec_path(None, "", "/h/", None).contains(":/h/.local/bin:"));
    }
}
