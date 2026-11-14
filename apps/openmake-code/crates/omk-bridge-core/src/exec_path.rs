//! exec PATH 계산 — TS `exec-path.ts`.
//!
//! Finder 로 띄운 GUI 앱은 로그인 셸 PATH 를 물려받지 못해 mise·Homebrew 런타임을 못 찾는다. ① 로그인 셸 PATH
//! ② 프로세스 PATH ③ 표준 설치 경로 4곳을 합치고, ④ `mise bin-paths`(cwd = 연결 폴더라 프로젝트 버전 반영)를 앞에 둔다.
//! 단계마다 실패하면 다음 폴백으로 넘어간다. 두 자식에는 exec 와 같은 허용 목록 + 위치 변수만 넘긴다.
//! TS 와 달리 프로세스 환경을 직접 읽지 않고 호스트가 준 사본(`env`·`home`)을 쓴다(D-33), 자식의 stderr 는 버린다(D-35).

use std::collections::BTreeMap;

use crate::constants::{
    FALLBACK_CHILD_PATH, PATH_PROBE_ENV_EXTRA_POSIX, PATH_PROBE_TIMEOUT_MS, SANDBOX_BIN,
};
use crate::exec_env::build_exec_env;
use crate::js_text::js_trim;
use crate::node_path;
use crate::platform::Platform;
use crate::proc::{self, ProcEnd, ProcSpec, Stderr, Stdin};
use crate::tool_env::ToolSandbox;

/// `execFileSync` 의 기본 출력 상한.
const SYNC_MAX_BUFFER: usize = 1024 * 1024;

/// 환경 사본에서 키 하나(첫 값).
pub(crate) fn env_get<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
    env.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

/// 병합(순수) — 로그인 셸 출력(`trim` 후 `:` 로 나눔)·프로세스 PATH·고정 4곳을 처음 나온 순서로 중복 없이 합치고,
/// mise 출력(`trim` 후 줄마다, 줄 안은 다시 `:` 로 나눔, 빈 항목 제외)이 있으면 그것을 앞에 둔다(겹치면 mise 자리가 이긴다).
/// 절대경로 항목만 — 상대 항목(`.`·`bin`)은 자식 cwd(연결 폴더) 기준으로 풀려 폴더의 파일을 고를 수 있다(설계 D-5).
pub fn merge_exec_path(
    login: Option<&str>,
    process_path: &str,
    home: &str,
    mise: Option<&str>,
) -> String {
    let local_bin = node_path::join(&[home, ".local/bin"]);
    let shims = node_path::join(&[home, ".local/share/mise/shims"]);
    let mut parts: Vec<&str> = Vec::new();
    if let Some(out) = login {
        parts.extend(js_trim(out).split(':'));
    }
    parts.extend(process_path.split(':'));
    parts.extend(["/opt/homebrew/bin", "/usr/local/bin", &local_bin, &shims]);
    let base = dedupe(parts.into_iter().filter(|p| is_abs_entry(p)));
    let Some(mise) = mise else {
        return base.join(":");
    };
    // 한 줄 안의 `:` 도 항목 경계다(설계 D-5 보완).
    let mise_paths = js_trim(mise)
        .split('\n')
        .flat_map(|l| l.split(':'))
        .filter(|p| is_abs_entry(p));
    dedupe(mise_paths.chain(base.iter().copied())).join(":")
}

fn is_abs_entry(p: &str) -> bool {
    p.starts_with('/')
}

/// 자식에게 넘길 PATH(`:` 구분)에서 절대경로 항목만 남긴다 — TS `absPathEntries`. 상대 항목은 자식 cwd(연결 폴더) 기준으로
/// 풀려 폴더의 파일을 고를 수 있다(설계 D-5). 호스트 PATH 를 자식 PATH 로 넘기는 자리(git 자식·도구의 PATH 폴백)도 이것을
/// 지난다(설계 D-14). 거른 결과가 비면 `FALLBACK_CHILD_PATH` — 빈 PATH 는 현재 폴더 한 항목이다(설계 D-14 보완).
/// Windows 는 그대로 — exec PATH 의 Windows 갈래와 같다.
pub(crate) fn abs_path_entries(p: &str, platform: Platform) -> String {
    if platform == Platform::Win32 {
        return p.to_owned();
    }
    let kept = p
        .split(':')
        .filter(|e| is_abs_entry(e))
        .collect::<Vec<_>>()
        .join(":");
    if kept.is_empty() {
        FALLBACK_CHILD_PATH.to_owned()
    } else {
        kept
    }
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
    env_get(env, "SHELL")
        .filter(|s| !s.is_empty())
        .unwrap_or("/bin/zsh")
}

/// 성공(코드 0)일 때만 출력 — `execFileSync` 는 그 밖(코드·신호·시간 초과·상한·띄우기 실패)에 던진다.
async fn run_ok(spec: ProcSpec) -> Option<String> {
    let out = proc::run(spec).await;
    matches!(out.end, ProcEnd::Exited(0)).then_some(out.stdout)
}

/// exec PATH. `folder_root` 가 없으면 mise 는 홈에서 돈다. Windows 는 로그인 셸·mise 관행이 없어 프로세스 PATH 그대로.
/// `sandbox`: mise 를 감쌀 도구 프로파일 — `Off` 는 감싸지 않음, `Missing`(켜졌는데 프로파일 없음)은 mise 를 건너뛴다.
/// 신뢰된 경로의 mise 설정은 에이전트가 파일 쓰기로 고칠 수 있어, 그 `exec()` 가 샌드박스 밖에서 돌지 않게 한다(설계 D-6).
pub async fn resolve_exec_path(
    env: &[(String, String)],
    home: &str,
    platform: Platform,
    folder_root: Option<&str>,
    sandbox: &ToolSandbox,
) -> String {
    if platform == Platform::Win32 {
        let pick = |k| env_get(env, k).filter(|v| !v.is_empty());
        return pick("PATH")
            .or_else(|| pick("Path"))
            .unwrap_or("")
            .to_owned();
    }
    let process_path = env_get(env, "PATH").unwrap_or("");
    let probe_env = |path: &str| {
        let pairs = env.iter().map(|(k, v)| (k.as_str(), v.as_str()));
        build_exec_env(pairs, path, platform, PATH_PROBE_ENV_EXTRA_POSIX)
    };
    // 홈에서 띄운다 — 사용자 로그인 rc 의 cwd 훅(mise activate·direnv)이 연결 폴더 설정을 샌드박스 밖에서 돌리지 않게(설계 D-13).
    let login = probe(
        login_shell(env),
        &["-lc", "echo -n \"$PATH\""],
        Some(home),
        probe_env(&abs_path_entries(process_path, platform)),
    );
    let login = run_ok(login).await;
    let base = merge_exec_path(login.as_deref(), process_path, home, None);
    let mise_cwd = folder_root.unwrap_or(home);
    // 감싼 mise 가 실패하면(65·71 포함) 종전처럼 기본 PATH 만 쓴다. PATH 계산은 exec 를 막지 않는다 — 프로파일이 없으면
    // 그 exec·도구는 뒤에서 126 으로 거절된다.
    let mise = match sandbox {
        ToolSandbox::Missing => return base,
        ToolSandbox::Off => probe("mise", &["bin-paths"], Some(mise_cwd), probe_env(&base)),
        ToolSandbox::Profile(p) => probe(
            SANDBOX_BIN,
            &["-p", p, "mise", "bin-paths"],
            Some(mise_cwd),
            probe_env(&base),
        ),
    };
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
        let env = |v: Option<&str>| {
            v.map(|v| vec![("SHELL".to_owned(), v.to_owned())])
                .unwrap_or_default()
        };
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

    /// 설계 D-5 — 상대 항목(`.`·`bin`·`./x`)은 자식 cwd(연결 폴더) 기준으로 풀리므로 세 입력 모두에서 버린다.
    #[test]
    fn merge_drops_relative_segments() {
        let fixed = "/opt/homebrew/bin:/usr/local/bin:/h/.local/bin:/h/.local/share/mise/shims";
        assert_eq!(
            merge_exec_path(Some(".:/a:bin:./x"), ".:/c:lib/bin:", "/h", None),
            format!("/a:/c:{fixed}")
        );
        assert_eq!(
            merge_exec_path(Some("/a"), "/c", "/h", Some("bin\n/m\n.\n./x")),
            format!("/m:/a:/c:{fixed}")
        );
    }
}
