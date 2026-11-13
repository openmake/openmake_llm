//! 브리지 실행 코어 — TS `core.ts` `BridgeCore` 의 생성자·`capabilities`·`handleExec`.
//!
//! 고정 kind 화이트리스트만 처리한다(임의 RPC 거부). 파일 kind 경로는 연결 폴더 realpath 스코프 안에서만 푼다.
//! 이 PR 은 파일 kind·`folders`·`task_end` 까지 옮겼다. 아직 옮기지 않은 kind 는 TS 의 `default` 가지와 같은
//! "지원하지 않는 kind" 로 거절하고(서버에서 보면 그 kind 를 모르는 옛 기기와 같다), 능력 목록에도 넣지 않는다.
//!
//! **런타임**: `handle_exec` 는 시간 기능이 켜진 tokio 런타임 안에서 불러야 한다. 런타임은 drop 때
//! `spawn_blocking` 작업이 끝나기를 기다리므로, 영영 블록된 FS 호출이 있으면 종료가 멈춘다 — 호스트는
//! `shutdown_background()` 또는 `shutdown_timeout()` 으로 끝낸다.

use crate::constants::BRIDGE_KINDS;
use crate::fs_kinds;
use crate::msg::{BridgeMsg, BridgeResult, Kind};
use crate::node_error;
use crate::timed_fs::FsGate;

/// `task_end` 때 부르는 호스트 정리 훅(데스크톱 = 브라우저 패널 닫기).
pub type TaskEndHook = Box<dyn Fn(Option<&str>) + Send + Sync>;

pub struct BridgeCoreOptions {
    /// 연결 폴더 — 코어가 realpath 로 확정한다.
    pub folder: String,
    /// 파일 kind 시간 제한(ms) — 호스트가 `timed_fs::fs_timeout_from_env` 로 채운다.
    pub fs_timeout_ms: u64,
    pub on_task_end: Option<TaskEndHook>,
}

pub struct BridgeCore {
    folder_root: String,
    gate: FsGate,
    on_task_end: Option<TaskEndHook>,
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
        | Kind::Folders => true,
        Kind::Exec
        | Kind::Worktree
        | Kind::LspDiagnostics
        | Kind::CodeNav
        | Kind::TestRunner
        | Kind::Browser => false,
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
            on_task_end: opts.on_task_end,
        })
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
        if let Some(field) = m.invalid_field {
            return Err(format!("요청 필드 형식이 올바르지 않습니다: {field}"));
        }
        let root = self.folder_root.clone();
        let folder = m.folder.clone();
        let base = self
            .gate
            .run("실행 폴더 확인", move || {
                fs_kinds::resolve_base(&root, folder.as_deref())
            })
            .await?;
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
                // 일괄 승인 회수는 PR-1.3, 브라우저 탭 닫기는 PR-1.6 이 이 가지에 더한다.
                if let Some(hook) = &self.on_task_end {
                    hook(m.task_id.as_deref());
                }
                Ok(ok)
            }
            Kind::Exec
            | Kind::Worktree
            | Kind::LspDiagnostics
            | Kind::CodeNav
            | Kind::TestRunner
            | Kind::Browser => Err(unsupported(kind.as_str())),
        }
    }
}
