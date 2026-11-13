//! exec 3단 방어(차단 → 확인 → 샌드박스)와 일괄 승인 — TS `core.ts` 의 `confirmExec`·`case 'exec'`·`prepare`·
//! `clearAutoApprove`·`autoApprovedCount`.
//!
//! - 차단 목록은 확인 없이 즉시 거부한다(가드레일 — 보안 경계 아님).
//! - 나머지는 실행 전 사용자 확인(비우회). 'all' 은 그 작업 동안만 유효하고 `task_end`·해제 때 회수한다. 서버는 켤 수 없다.
//! - macOS 는 sandbox-exec 로 감싼다. 프로파일을 준비하지 못했으면 실행을 거부한다(fail-closed).
//!
//! 코어는 프로세스 환경을 읽지 않는다 — 호스트가 [`ExecHost`] 로 한 번 준다(D-33).

use std::collections::HashSet;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use crate::constants::{MAX_BUFFER, SANDBOX_BIN};
use crate::denylist::match_denylist;
use crate::exec_env::build_exec_env;
use crate::exec_path::resolve_exec_path;
use crate::git_trust::{GitPaths, detect_git};
use crate::msg::{BridgeMsg, BridgeResult};
use crate::node_error;
use crate::node_path;
use crate::platform::{Platform, bulk_approval_allowed, shell_invocation};
use crate::proc::{self, ProcSpec, Stderr, Stdin};
use crate::sandbox::{profile_file_name, write_sandbox_profile};
use crate::timed_fs::FsGate;
use crate::tool_env::{ToolEnv, ToolSandbox};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmAnswer {
    Yes,
    All,
    No,
}

/// 확인 창에 보일 것 — 명령 글자 그대로, 작업, 유효 실행 폴더(어느 폴더에서 도는지 투명하게).
pub struct ConfirmRequest {
    pub command: String,
    pub task_id: Option<String>,
    pub base: String,
}

/// 사용자 확인(비우회 관문)의 호스트 구현. 시간 제한이 없다(사용자가 답할 때까지 기다린다 — TS 와 같다).
/// 돌려준 future 가 panic 하거나 취소되면 거부로 본다.
pub type ConfirmFn = Box<
    dyn Fn(ConfirmRequest) -> Pin<Box<dyn Future<Output = ConfirmAnswer> + Send>> + Send + Sync,
>;

/// exec·worktree 를 처리하는 호스트가 주는 것.
pub struct ExecHost {
    pub confirm: ConfirmFn,
    /// 호스트 프로세스 환경 사본 — 자식에는 허용 목록만 간다(exec_env).
    pub env: Vec<(String, String)>,
    /// `os.homedir()` 에 해당.
    pub home: String,
    pub platform: Platform,
    /// 호스트가 `sandbox::sandbox_enabled(platform, OMK_BRIDGE_SANDBOX)` 로 채운다.
    pub sandbox_enabled: bool,
    pub sandbox_profile_dir: String,
    /// 개발·테스트 훅 — 호스트가 `auto_approve_from_env(OMK_BRIDGE_AUTO_APPROVE) || 자기 옵션` 으로 채운다.
    pub auto_approve_all: bool,
    /// 일괄 승인 집합이 바뀔 때(메뉴 표시용). 자물쇠 밖에서 부른다 — 안에서 `auto_approved_count()` 를 불러도 된다.
    pub on_auto_approve_change: Option<Box<dyn Fn() + Send + Sync>>,
    /// exec·worktree git 1회 시간 제한 — 기본 `EXEC_TIMEOUT_MS`(TS 는 둘 다 이 상수). 테스트가 줄인다.
    pub exec_timeout_ms: u64,
}

/// `OMK_BRIDGE_AUTO_APPROVE` 해석 — 정확히 `"1"` 일 때만.
pub fn auto_approve_from_env(v: Option<&str>) -> bool {
    v == Some("1")
}

pub(crate) const REJECTED: &str = "사용자가 명령 실행을 거부했습니다";
pub(crate) const FAIL_CLOSED: &str = "exec 샌드박스 프로파일을 준비하지 못해 실행을 거부했습니다(폴더 재연결 필요). 비격리 실행이 필요하면 OMK_BRIDGE_SANDBOX=0 으로 실행하세요.";
const EXIT_REFUSED: i32 = 126;

/// 프로파일 파일 일련번호(프로세스 공용, 1부터 — TS 와 같다).
static PROFILE_SEQ: AtomicUsize = AtomicUsize::new(0);

/// 자물쇠가 오염돼도 안쪽 값을 그대로 쓴다 — 집합은 한 줄 연산만 하므로 깨진 상태가 남지 않는다.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn refused(error: impl Into<String>) -> BridgeResult {
    BridgeResult {
        exit_code: Some(EXIT_REFUSED),
        ..BridgeResult::failure(error)
    }
}

/// 코어 하나의 exec 상태.
pub(crate) struct ExecState {
    pub(crate) host: ExecHost,
    auto_tasks: Mutex<HashSet<String>>,
    /// 첫 exec 가 자물쇠를 쥔 채 계산한다 — 동시에 온 요청은 기다렸다가 같은 값을 쓴다(탐지를 두 번 돌리지 않는다).
    path_cache: tokio::sync::Mutex<Option<String>>,
    profile: Mutex<Option<String>>,
    profile_file: String,
    /// 확인 없이 뜨는 자식(worktree git·tsc·py_compile·pytest 탐지)용 도구 프로파일 — exec 프로파일 + 네트워크 차단(D-1).
    tool_profile: Mutex<Option<String>>,
    tool_profile_file: String,
    /// 연결 때 믿기로 한 git 디렉터리(`git_trust`) — 없으면 git 없음(worktree 거절, 파일 kind 가드 없음).
    git: Mutex<Option<GitPaths>>,
}

impl ExecState {
    pub(crate) fn new(host: ExecHost) -> ExecState {
        let seq = PROFILE_SEQ.fetch_add(1, Ordering::Relaxed) + 1;
        let file = |kind: &str| {
            let name = profile_file_name(kind, std::process::id(), seq);
            node_path::join(&[&host.sandbox_profile_dir, &name])
        };
        let (profile_file, tool_profile_file) = (file("exec"), file("tool"));
        ExecState {
            host,
            auto_tasks: Mutex::new(HashSet::new()),
            path_cache: tokio::sync::Mutex::new(None),
            profile: Mutex::new(None),
            profile_file,
            tool_profile: Mutex::new(None),
            tool_profile_file,
            git: Mutex::new(None),
        }
    }

    fn changed(&self) {
        if let Some(hook) = &self.host.on_auto_approve_change {
            hook();
        }
    }

    pub(crate) fn count(&self) -> usize {
        lock(&self.auto_tasks).len()
    }

    /// 전부 회수 — 집합이 비어 있어도 알린다(TS 그대로).
    pub(crate) fn clear(&self) {
        lock(&self.auto_tasks).clear();
        self.changed();
    }

    /// `task_end` — 그 작업의 일괄 승인을 회수한다. 승인하지 않은 작업이면 알리지 않는다.
    pub(crate) fn revoke(&self, task_id: &str) {
        let removed = lock(&self.auto_tasks).remove(task_id);
        if removed {
            self.changed();
        }
    }

    /// 연결 때 — PATH 캐시를 비우고, git 디렉터리를 판정하고(샌드박스가 꺼져도 — worktree 대조·파일 kind 가드),
    /// 프로파일 두 개(exec·도구)를 쓴다. 실패·시간 초과는 프로파일 없음(exec·도구가 fail-closed).
    pub(crate) async fn prepare(&self, root: &str, gate: &FsGate) {
        *self.path_cache.lock().await = None;
        let h = &self.host;
        let git = detect_git(root, &h.env, h.platform, h.sandbox_enabled, gate).await;
        *lock(&self.git) = git.clone();
        let (profile, tool) = if h.sandbox_enabled {
            let (root, home) = (root.to_owned(), h.home.clone());
            let (out, tool_out) = (self.profile_file.clone(), self.tool_profile_file.clone());
            let write = move || {
                let exec = write_sandbox_profile(&root, git.as_ref(), &home, &out, false);
                let tool = write_sandbox_profile(&root, git.as_ref(), &home, &tool_out, true);
                Ok((exec, tool))
            };
            gate.run("샌드박스 준비", write)
                .await
                .unwrap_or((None, None))
        } else {
            (None, None)
        };
        *lock(&self.profile) = profile;
        *lock(&self.tool_profile) = tool;
    }

    /// 연결 때 믿기로 한 git 디렉터리.
    pub(crate) fn git_paths(&self) -> Option<GitPaths> {
        lock(&self.git).clone()
    }

    /// 확인 없이 뜨는 자식을 감쌀 도구 프로파일 — 꺼짐, 프로파일, 켜졌는데 없음(fail-closed).
    pub(crate) fn tool_sandbox(&self) -> ToolSandbox {
        match lock(&self.tool_profile).clone() {
            _ if !self.host.sandbox_enabled => ToolSandbox::Off,
            Some(p) => ToolSandbox::Profile(p),
            None => ToolSandbox::Missing,
        }
    }

    async fn confirm(&self, command: &str, task_id: Option<&str>, base: &str) -> bool {
        if self.host.auto_approve_all {
            return true;
        }
        if task_id.is_some_and(|t| lock(&self.auto_tasks).contains(t)) {
            return true;
        }
        let req = ConfirmRequest {
            command: command.to_owned(),
            task_id: task_id.map(str::to_owned),
            base: base.to_owned(),
        };
        let answer = match std::panic::catch_unwind(AssertUnwindSafe(|| (self.host.confirm)(req))) {
            // 따로 돌려 panic·취소를 거부로 바꾼다.
            Ok(fut) => tokio::spawn(fut).await.unwrap_or(ConfirmAnswer::No),
            Err(_) => ConfirmAnswer::No,
        };
        match (answer, task_id) {
            // 일괄 승인은 명령을 샌드박스로 가둘 수 있는 OS 에서만 — Windows 는 이번 명령만 허용으로 낮춘다.
            (ConfirmAnswer::All, _) if !bulk_approval_allowed(self.host.platform) => true,
            (ConfirmAnswer::All, Some(t)) => {
                lock(&self.auto_tasks).insert(t.to_owned());
                self.changed();
                true
            }
            // 'all' 인데 작업이 없으면 TS 는 거부로 끝난다(`ans === 'yes'` 만 남는다) — 그대로 옮긴다.
            (ConfirmAnswer::All, None) | (ConfirmAnswer::No, _) => false,
            (ConfirmAnswer::Yes, _) => true,
        }
    }

    /// 읽기 전용 도구 자식의 실행 조건 — exec 와 같은 PATH 캐시, 도구 프로파일(D-64·D-65, 설계 2026-11-14 D-1).
    pub(crate) async fn tool_env(&self, root: &str) -> ToolEnv {
        let exec_path = self.exec_path(root).await;
        let sandbox = self.tool_sandbox();
        ToolEnv {
            env: self.host.env.clone(),
            platform: self.host.platform,
            exec_path,
            sandbox,
        }
    }

    pub(crate) async fn exec_path(&self, root: &str) -> String {
        let mut cache = self.path_cache.lock().await;
        if let Some(p) = cache.as_ref().filter(|p| !p.is_empty()) {
            return p.clone();
        }
        let h = &self.host;
        let p = resolve_exec_path(&h.env, &h.home, h.platform, Some(root)).await;
        *cache = Some(p.clone());
        p
    }
}

impl Drop for ExecState {
    /// 자기 프로파일 파일을 지운다(실행 중인 sandbox-exec 는 시작할 때 이미 읽었다). 실패는 무시한다.
    fn drop(&mut self) {
        if lock(&self.profile).is_some() {
            let _ = std::fs::remove_file(&self.profile_file);
        }
        if lock(&self.tool_profile).is_some() {
            let _ = std::fs::remove_file(&self.tool_profile_file);
        }
    }
}

/// exec 요청 하나 — 순서: (폴더는 코어가 먼저) → 차단 → 확인 → fail-closed → PATH → 실행.
/// 호스트가 없는 코어는 확인을 "거부"로 본다(D-37, 비대화형 fail-safe). 실행 결과는 언제나 `ok: true` 이고
/// 종료 코드로만 성패를 알린다(띄우기 실패·시간 초과·상한 초과·신호는 1 — TS 그대로).
pub(crate) async fn run_exec(
    state: Option<&ExecState>,
    root: &str,
    base: &str,
    m: &BridgeMsg,
) -> Result<BridgeResult, String> {
    let shown = m.command.as_deref().unwrap_or("");
    if let Some(why) = match_denylist(shown) {
        return Ok(refused(format!("위험 명령으로 차단됨: {why}")));
    }
    let Some(st) = state else {
        return Ok(refused(REJECTED));
    };
    if !st.confirm(shown, m.task_id.as_deref(), base).await {
        return Ok(refused(REJECTED));
    }
    let profile = lock(&st.profile).clone();
    if st.host.sandbox_enabled && profile.is_none() {
        return Ok(refused(FAIL_CLOSED));
    }
    let path = st.exec_path(root).await;
    let h = &st.host;
    let command = m.command_text.clone();
    let (file, args) = match profile.filter(|_| h.sandbox_enabled) {
        Some(p) => {
            let args = ["-f", &p, "/bin/bash", "-c", &command]
                .map(str::to_owned)
                .to_vec();
            (SANDBOX_BIN.to_owned(), args)
        }
        None => {
            let com_spec = h
                .env
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("ComSpec"))
                .map(|(_, v)| v.as_str());
            let sh = shell_invocation(&command, h.platform, com_spec);
            (sh.file, sh.args)
        }
    };
    // Node 는 인자에 NUL 이 있으면 띄우기 전에 던진다(확인은 이미 받았다 — TS 순서 그대로). 명령은 늘 마지막 인자다.
    if command.contains('\0') {
        let arg = format!("args[{}]", args.len() - 1);
        return Err(node_error::null_bytes_arg(&arg, &command));
    }
    let pairs = h.env.iter().map(|(k, v)| (k.as_str(), v.as_str()));
    let out = proc::run(ProcSpec {
        file,
        args,
        cwd: Some(base.to_owned()),
        env: build_exec_env(pairs, &path, h.platform, &[]),
        timeout_ms: h.exec_timeout_ms,
        max_buffer: MAX_BUFFER as usize,
        stdin: Stdin::HeldOpen,
        stderr: Stderr::Capture,
    })
    .await;
    let exit_code = out.end.exec_file_code();
    Ok(BridgeResult {
        stdout: Some(out.stdout),
        stderr: Some(out.stderr),
        exit_code: Some(exit_code),
        ..BridgeResult::success()
    })
}
