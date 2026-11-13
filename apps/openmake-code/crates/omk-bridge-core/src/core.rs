//! 브리지 실행 코어 — TS `core.ts` `BridgeCore` 의 생성자·`capabilities`·`handleExec`.
//!
//! 고정 kind 화이트리스트만 처리한다(임의 RPC 거부). 파일 kind 경로는 연결 폴더 realpath 스코프 안에서만 푼다.
//! 파일 kind·`folders`·`task_end`·`exec`·`worktree` 를 옮겼다. 아직 옮기지 않은 kind 는 TS 의 `default` 가지와 같은
//! "지원하지 않는 kind" 로 거절하고(서버에서 보면 그 kind 를 모르는 옛 기기와 같다), 능력 목록에도 넣지 않는다.
//! exec·worktree 는 호스트가 [`BridgeCore::with_exec_host`] 로 확인 창·환경을 얹어야 실제로 돈다.
//!
//! **런타임**: `handle_exec`·`prepare` 는 시간 + I/O 가 켜진(`enable_all()`) tokio 런타임 안에서 불러야 한다(자식 프로세스). 런타임은 drop 때
//! `spawn_blocking` 작업이 끝나기를 기다리므로, 영영 블록된 FS 호출이 있으면 종료가 멈춘다 — 호스트는
//! `shutdown_background()` 또는 `shutdown_timeout()` 으로 끝낸다.

use std::time::{Duration, Instant};

use crate::code_nav;
use crate::diagnostics;
use crate::constants::{BRIDGE_KINDS, CODE_NAV_MAX_CONCURRENT, CODE_NAV_TIMEOUT_MS, DIAG_TIMEOUT_MS};
use crate::exec::{self, ExecHost, ExecState};
use crate::fs_kinds;
use crate::msg::{BridgeMsg, BridgeResult, Kind};
use crate::node_error;
use crate::scope::safe_from;
use crate::timed_fs::FsGate;
use crate::tool_env::NO_HOST;
use crate::worktree;

/// `task_end` 때 부르는 호스트 정리 훅(데스크톱 = 브라우저 패널 닫기).
pub type TaskEndHook = Box<dyn Fn(Option<&str>) + Send + Sync>;

pub struct BridgeCoreOptions {
    /// 연결 폴더 — 코어가 realpath 로 확정한다.
    pub folder: String,
    /// 파일 kind 시간 제한(ms) — 호스트가 `timed_fs::fs_timeout_from_env` 로 채운다.
    pub fs_timeout_ms: u64,
    pub on_task_end: Option<TaskEndHook>,
}

/// 읽기 전용 도구의 시간 제한(ms) — 호스트가 `timed_fs::ms_from_env` 로 `OMK_BRIDGE_CODE_NAV_TIMEOUT_MS`·
/// `OMK_BRIDGE_DIAG_TIMEOUT_MS` 를 채운다(D-63). 얹지 않으면 둘 다 15000.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolTimeouts {
    /// code_nav 시간 예산 — 요청을 받은 때부터 센다.
    pub code_nav_ms: u64,
    /// tsc·py_compile 자식 1회 시간 제한.
    pub diag_ms: u64,
}

pub struct BridgeCore {
    folder_root: String,
    gate: FsGate,
    /// code_nav 전용 관문(D-62) — 끝나지 않는 정규식 판정은 이 칸만 쥔다. 파일 kind 의 칸은 그대로 돈다.
    nav_gate: FsGate,
    timeouts: ToolTimeouts,
    on_task_end: Option<TaskEndHook>,
    exec: Option<ExecState>,
}

/// 이 크레이트가 처리하는 kind. 와일드카드 없이 적는다 — 종류를 더하면 컴파일이 막힌다.
fn handles(kind: Kind) -> bool {
    match kind {
        Kind::Read
        | Kind::Write
        | Kind::List
        | Kind::ListAll
        | Kind::Delete
        | Kind::TaskEnd
        | Kind::Folders
        | Kind::Exec
        | Kind::Worktree
        | Kind::CodeNav
        | Kind::LspDiagnostics => true,
        Kind::TestRunner | Kind::Browser => false,
    }
}

fn unsupported(kind_text: &str) -> String {
    format!("지원하지 않는 kind: {kind_text}")
}

impl BridgeCore {
    pub fn new(opts: BridgeCoreOptions) -> Result<BridgeCore, String> {
        let root = std::fs::canonicalize(&opts.folder)
            .map_err(|e| node_error::format(&e, "realpath", Some(&opts.folder)))?;
        Ok(BridgeCore {
            // UTF-8 이 아닌 이름은 APFS 에서 생기지 않는다.
            folder_root: root.to_string_lossy().into_owned(),
            gate: FsGate::new(opts.fs_timeout_ms),
            nav_gate: FsGate::with_permits(opts.fs_timeout_ms, CODE_NAV_MAX_CONCURRENT),
            timeouts: ToolTimeouts {
                code_nav_ms: CODE_NAV_TIMEOUT_MS,
                diag_ms: DIAG_TIMEOUT_MS,
            },
            on_task_end: opts.on_task_end,
            exec: None,
        })
    }

    /// exec·worktree 를 처리하는 호스트를 얹는다(D-33·D-37). 없으면 exec 는 거부, worktree 는 거절한다.
    /// `BridgeCoreOptions` 는 그대로 두고 얹는다 — 병행 PR 의 구조체 리터럴이 어느 쪽이 먼저 머지돼도 컴파일된다(§10-3).
    pub fn with_exec_host(mut self, host: ExecHost) -> BridgeCore {
        self.exec = Some(ExecState::new(host));
        self
    }

    /// 읽기 전용 도구의 시간 제한을 얹는다 — `with_exec_host` 와 같은 방식(`BridgeCoreOptions` 는 그대로).
    pub fn with_tool_timeouts(mut self, timeouts: ToolTimeouts) -> BridgeCore {
        self.timeouts = timeouts;
        self
    }

    /// 연결할 때마다 — PATH 캐시를 비우고(폴더가 바뀌면 mise 프로젝트 버전도 바뀐다) 샌드박스 프로파일을 쓴다(D-35).
    /// TS 는 동기라 그동안 프로세스 전체가 멈췄다. 부르는 쪽은 소켓을 열기 전에 기다린다.
    pub async fn prepare(&self) {
        if let Some(e) = &self.exec {
            e.prepare(&self.folder_root, &self.gate).await;
        }
    }

    /// 일괄 승인 전체 회수 — 연결 해제·사용자 명시 해제 때. 집합이 비어 있어도 변화를 알린다(TS 그대로).
    pub fn clear_auto_approve(&self) {
        if let Some(e) = &self.exec {
            e.clear();
        }
    }

    /// 일괄 승인 중인 작업 수 — 호스트 UI 표시용.
    pub fn auto_approved_count(&self) -> usize {
        self.exec.as_ref().map_or(0, ExecState::count)
    }

    pub fn folder_root(&self) -> &str {
        &self.folder_root
    }

    /// 서버에 알리는 능력 목록 — 실제로 처리하는 kind 만, `BRIDGE_KINDS` 순서로.
    /// 서버는 목록에 없는 종류를 보내지 않는다는 계약을 옮기는 도중에도 지킨다.
    pub fn capabilities(&self) -> Vec<&'static str> {
        BRIDGE_KINDS
            .iter()
            .copied()
            .filter(|k| Kind::parse(k).is_some_and(handles))
            .collect()
    }

    /// 요청 하나를 처리해 결과 하나를 돌려준다. TS 가 예외로 내던 실패도 연결부가 바꾸던 모양
    /// `{ok:false, error}` 로 돌려준다(D-19). 어떤 kind 든 먼저 `folder` 를 푼다(TS 와 같은 순서).
    pub async fn handle_exec(&self, m: &BridgeMsg) -> BridgeResult {
        self.dispatch(m).await.unwrap_or_else(BridgeResult::failure)
    }

    async fn dispatch(&self, m: &BridgeMsg) -> Result<BridgeResult, String> {
        // code_nav 시간 예산의 시작점 — TS 와 같이 요청을 받은 때(관문 자리를 기다린 시간도 센다).
        let received = Instant::now();
        if let Some(field) = m.invalid_field {
            return Err(format!("요청 필드 형식이 올바르지 않습니다: {field}"));
        }
        // folder 가 없으면 TS 는 FS 를 건드리지 않고 루트를 쓴다 — 관문(허가)도 거치지 않는다.
        let base = match m.folder.clone() {
            None => self.folder_root.clone(),
            Some(folder) => {
                let root = self.folder_root.clone();
                self.gate
                    .run("실행 폴더 확인", move || {
                        fs_kinds::resolve_base(&root, Some(&folder))
                    })
                    .await?
            }
        };
        let Some(kind) = m.kind else {
            return Err(unsupported(&m.kind_text));
        };
        let path = m.path.clone();
        let ok = BridgeResult::success();
        match kind {
            Kind::Read => {
                let content = self
                    .gate
                    .run("read", move || fs_kinds::read(&base, path.as_deref()))
                    .await?;
                Ok(BridgeResult {
                    content: Some(content),
                    ..ok
                })
            }
            Kind::Write => {
                let b64 = m.content_b64.clone();
                self.gate
                    .run("write", move || {
                        fs_kinds::write(&base, path.as_deref(), b64.as_deref())
                    })
                    .await?;
                Ok(ok)
            }
            Kind::List => {
                let entries = self
                    .gate
                    .run("list", move || fs_kinds::list(&base, path.as_deref()))
                    .await?;
                Ok(BridgeResult {
                    entries: Some(entries),
                    ..ok
                })
            }
            Kind::ListAll => {
                let entries = self
                    .gate
                    .run("listAll", move || fs_kinds::list_all(&base))
                    .await?;
                Ok(BridgeResult {
                    entries: Some(entries),
                    ..ok
                })
            }
            Kind::Delete => {
                self.gate
                    .run("delete", move || fs_kinds::delete(&base, path.as_deref()))
                    .await?;
                Ok(ok)
            }
            Kind::Folders => {
                // folder 는 위에서 검증만 하고, 열거는 연결 루트 기준이다(TS 그대로).
                let root = self.folder_root.clone();
                let (entries, truncated) = self
                    .gate
                    .run("folders", move || fs_kinds::folders(&root, path.as_deref()))
                    .await?;
                Ok(BridgeResult {
                    entries: Some(entries),
                    truncated: Some(truncated),
                    ..ok
                })
            }
            Kind::TaskEnd => {
                // 호스트 정리를 먼저, 그다음 그 작업의 일괄 승인 회수. 브라우저 탭 닫기는 PR-1.6 이 더한다.
                if let Some(hook) = &self.on_task_end {
                    hook(m.task_id.as_deref());
                }
                if let (Some(e), Some(t)) = (&self.exec, &m.task_id) {
                    e.revoke(t);
                }
                Ok(ok)
            }
            Kind::Exec => exec::run_exec(self.exec.as_ref(), &self.folder_root, &base, m).await,
            Kind::Worktree => Ok(worktree::handle(self.exec.as_ref(), &base, m, &self.gate).await),
            Kind::CodeNav => {
                // 예산이 Instant 범위를 넘으면 끝나지 않는 예산이다.
                let deadline = received.checked_add(Duration::from_millis(self.timeouts.code_nav_ms));
                let req = m.clone();
                let nav = self
                    .nav_gate
                    .run("code_nav", move || {
                        let start = safe_from(&base, req.path.as_deref())?;
                        let expired = || deadline.is_some_and(|d| Instant::now() >= d);
                        code_nav::run(&base, &start, &req, &expired)
                    })
                    .await?;
                Ok(BridgeResult {
                    code_nav: Some(nav),
                    ..ok
                })
            }
            Kind::LspDiagnostics => {
                // 자식에 줄 환경 사본이 없는 코어는 거절한다(worktree 와 같은 이유). 폴더 확인 뒤, 스코프 확인 앞.
                let Some(st) = self.exec.as_ref() else {
                    return Err(NO_HOST.to_owned());
                };
                let (b, rels) = (base.clone(), m.paths.clone());
                let abs = self
                    .gate
                    .run("lsp_diagnostics", move || {
                        rels.iter()
                            .map(|r| safe_from(&b, r.as_deref()))
                            .collect::<Result<Vec<_>, _>>()
                    })
                    .await?;
                let tool = st.tool_env(&self.folder_root).await;
                let ms = self.timeouts.diag_ms;
                let r = diagnostics::collect(&base, &abs, &tool, ms, &self.gate).await?;
                Ok(BridgeResult {
                    diagnostics: Some(r.diagnostics),
                    truncated: Some(r.truncated),
                    server_kind: Some(r.server_kind),
                    ..ok
                })
            }
            Kind::TestRunner | Kind::Browser => Err(unsupported(kind.as_str())),
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use std::sync::{Arc, Mutex};

    use super::{BridgeCore, BridgeCoreOptions, handles};
    use crate::constants::BRIDGE_KINDS;
    use crate::msg::{BridgeMsg, Kind};
    use serde_json::json;

    fn core(hook: Option<super::TaskEndHook>) -> BridgeCore {
        let dir = std::env::temp_dir().to_string_lossy().into_owned();
        let opts = BridgeCoreOptions {
            folder: dir,
            fs_timeout_ms: 15_000,
            on_task_end: hook,
        };
        BridgeCore::new(opts).unwrap()
    }

    fn run(c: &BridgeCore, v: serde_json::Value) -> serde_json::Value {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(c.handle_exec(&BridgeMsg::from_json(&v)))
            .to_json()
    }

    /// 아직 옮기지 않은 kind — 뒤 PR 이 kind 를 옮길 때 이 목록을 줄이지 않으면 실패한다.
    /// 목록이 비는 PR(1.4)에서 `capabilities() == BRIDGE_KINDS` 로 바꾼다.
    const NOT_PORTED: [&str; 1] = ["test_runner"];

    #[test]
    fn capabilities_lists_only_handled_kinds_in_bridge_kinds_order() {
        let c = core(None);
        let caps = c.capabilities();
        assert_eq!(
            caps,
            [
                "exec", "read", "write", "list", "listAll", "delete", "task_end", "worktree",
                "folders", "lsp_diagnostics", "code_nav"
            ]
        );
        let missing: Vec<&str> = BRIDGE_KINDS
            .iter()
            .copied()
            .filter(|k| !caps.contains(k))
            .collect();
        assert_eq!(missing, NOT_PORTED);
        assert!(!handles(Kind::Browser));
    }

    /// 미구현 kind 는 TS 의 default 가지와 같은 글자로 거절한다(브라우저 포함 4종).
    #[test]
    fn unported_kinds_are_rejected_as_unsupported() {
        let c = core(None);
        for kind in NOT_PORTED.iter().chain(["browser"].iter()) {
            let got = run(
                &c,
                json!({"kind": kind, "command": "touch should-not-exist"}),
            );
            assert_eq!(
                got,
                json!({"ok": false, "error": format!("지원하지 않는 kind: {kind}")})
            );
        }
        for k in Kind::ALL {
            let got = run(&c, json!({"kind": k.as_str(), "folder": "../.."}));
            assert_eq!(
                got["error"], "폴더 스코프 밖 경로 거부: ../..",
                "{k:?}: folder 를 먼저 푼다"
            );
        }
    }

    #[test]
    fn task_end_calls_host_hook_with_task_id() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let hook = Box::new(move |t: Option<&str>| sink.lock().unwrap().push(t.map(str::to_owned)));
        let c = core(Some(hook));
        assert_eq!(
            run(&c, json!({"kind": "task_end", "taskId": "t-1"})),
            json!({"ok": true})
        );
        assert_eq!(run(&c, json!({"kind": "task_end"})), json!({"ok": true}));
        assert_eq!(*seen.lock().unwrap(), [Some("t-1".to_owned()), None]);
    }
}
