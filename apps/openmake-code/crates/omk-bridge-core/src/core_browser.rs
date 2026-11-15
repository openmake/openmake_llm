//! 코어의 브라우저 가지(TS `core.ts` 의 `browser` 요청·`task_end` 탭 닫기·제어권, PR-1.6 D-83). 사이트 정책 판정·제어권·중지는
//! `LocalBrowser` 가 맡고, 여기서는 저장 함수 셋을 write 와 같은 가드(`safe_from` + `assert_git_path_allowed`)와 관문(`FsGate`)으로 준다.

use std::io::Write as _;
use std::sync::Arc;

use serde_json::Value;

use super::BridgeCore;
use crate::browser::chrome::find_chrome;
use crate::browser::download_place::{PlaceError, place_download};
use crate::browser::downloads::PlaceDownload;
use crate::browser::host::BrowserEnv;
use crate::browser::local_browser::LocalBrowser;
use crate::browser::result::Json;
use crate::browser::run::{BrowserRunOptions, ResolveUploadFiles, SaveFile};
use crate::browser::upload_files::resolve_upload_files;
use crate::git_trust::assert_git_path_allowed;
use crate::msg::{BridgeMsg, BridgeResult};
use crate::node_error;
use crate::scope::safe_from;

pub(super) const NO_BROWSER_ERROR: &str =
    "이 디바이스는 브라우저를 쓸 수 없습니다(전용 프로필 미설정 또는 Chrome 없음)";

fn json_value(j: &Json) -> Value {
    match j {
        Json::Value(v) => v.clone(),
        Json::Obj(o) => o.to_value(),
        Json::Arr(a) => Value::Array(a.iter().map(json_value).collect()),
    }
}

impl BridgeCore {
    /// 전용 프로필 브라우저를 얹는다 — Chrome 을 찾았을 때만(TS 생성자와 같은 조건). 프로필마다 인스턴스 하나라 여러 연결 폴더의
    /// 코어가 같은 브라우저를 쓴다. `BridgeCoreOptions` 는 그대로 두고 얹는다(`with_exec_host` 와 같은 방식).
    pub fn with_browser_profile(mut self, profile_dir: String, env: BrowserEnv) -> BridgeCore {
        if find_chrome(&env).is_some() {
            self.browser = Some(LocalBrowser::for_profile(&profile_dir, env));
        }
        self
    }

    /// 제어권 전환 — 넘겨받을 때는 실행 중인 요청도 멈춘다. 브라우저가 없으면 아무것도 하지 않는다.
    pub fn set_browser_user_control(&self, on: bool) {
        if let Some(b) = &self.browser {
            b.set_user_control(on);
        }
    }

    pub fn browser_user_control(&self) -> bool {
        self.browser.as_ref().is_some_and(|b| b.is_user_control())
    }

    /// 실행 중인 모든 브라우저 요청을 멈춘다(다음 액션부터).
    pub fn stop_browser(&self) {
        if let Some(b) = &self.browser {
            b.request_stop(None);
        }
    }

    /// 호스트 종료 정리(PR-1.7 D-100) — 이 프로세스가 띄운 Chrome 을 끄고(붙기만 한 Chrome 은 그대로) 인스턴스를 표에서 뺀다
    /// ([`LocalBrowser::dispose`]). 인스턴스 표가 `static` 이라 `Drop` 이 돌지 않는다 — 호스트가 끝낼 때 불러야 한다. 브라우저가
    /// 없으면 아무것도 하지 않는다.
    pub async fn dispose_browser(&self) {
        if let Some(b) = &self.browser {
            b.dispose().await;
        }
    }

    /// 작업이 끝났다 — 그 작업의 탭 닫기를 띄우고 기다리지 않는다(TS `void closeTask`).
    pub(super) fn close_browser_task(&self, task: Option<&str>) {
        if let Some(b) = &self.browser {
            let (b, task) = (b.clone(), task.map(str::to_owned));
            tokio::spawn(async move { b.close_task(task.as_deref()).await });
        }
    }

    /// browser 요청 — 결과는 서버 샌드박스 러너와 같은 JSON 을 stdout 에 싣는다(서버의 browser 도구가 그대로 읽는다).
    /// 넘겨받아 실행하지 않았으면 `userControl`, 정책으로 막았으면 `policyBlock` 을 결과 맨 위에도 싣는다(서버 감사 기록).
    pub(super) async fn handle_browser(
        &self,
        m: &BridgeMsg,
        base: String,
    ) -> Result<BridgeResult, String> {
        let Some(browser) = &self.browser else {
            return Err(NO_BROWSER_ERROR.to_owned());
        };
        let opts = BrowserRunOptions {
            task_id: m.task_id.clone(),
            save_file: self.save_file(&base),
            place_download: Some(self.place_download(&base)),
            resolve_upload_files: Some(self.resolve_upload(&base, browser.upload_max_file_bytes())),
        };
        let r = browser.run(&m.browser, &opts).await;
        let ok = r.truthy("ok");
        Ok(BridgeResult {
            ok: true,
            stdout: Some(r.to_json_string()),
            exit_code: Some(if ok { 0 } else { 1 }),
            user_control: r.truthy("userControl").then_some(true),
            policy_block: r.get("policyBlock").map(|b| Box::new(json_value(b))),
            ..BridgeResult::default()
        })
    }

    /// 스크린샷 저장 — 폴더 안 심링크로 `.git/config` 를 가리켜 두면 덮어쓰므로 write 와 같은 git 가드를 지난다(리뷰 F7).
    fn save_file(&self, base: &str) -> SaveFile {
        let (gate, git, base) = (self.gate.clone(), self.git_guard(), base.to_owned());
        Arc::new(move |name: String, data: Vec<u8>| {
            let (gate, git, base) = (gate.clone(), git.clone(), base.clone());
            Box::pin(async move {
                gate.run("screenshot", move || {
                    let abs = safe_from(&base, Some(&name))?;
                    assert_git_path_allowed(&git, &abs, Some(&name), false)?;
                    let mut f = std::fs::File::create(&abs)
                        .map_err(|e| node_error::format(&e, "open", Some(&abs)))?;
                    f.write_all(&data)
                        .map_err(|e| node_error::format(&e, "write", None))
                })
                .await
            })
        })
    }

    /// 다운로드도 같은 가드 — Chrome 은 폴더 밖 대기 폴더에 guid 이름으로 받고, 완료 뒤 이 함수가 이름을 판정해 옮긴다(덮어쓰지 않는다).
    fn place_download(&self, base: &str) -> PlaceDownload {
        let (gate, git, base) = (self.gate.clone(), self.git_guard(), base.to_owned());
        Arc::new(move |name: String, staged: String| {
            let (gate, git, base) = (gate.clone(), git.clone(), base.clone());
            Box::pin(async move {
                let placed = gate
                    .run("download", move || {
                        Ok(place_download(&base, &git, &name, &staged))
                    })
                    .await;
                placed.unwrap_or_else(|e| Err(PlaceError::Failed(e)))
            })
        })
    }

    /// 업로드는 실행 폴더 안의 파일만(폴더 밖·숨김·크기·개수 거절).
    fn resolve_upload(&self, base: &str, max_bytes: u64) -> ResolveUploadFiles {
        let (gate, base) = (self.gate.clone(), base.to_owned());
        Arc::new(move |files: Value| {
            let (gate, base) = (gate.clone(), base.clone());
            Box::pin(async move {
                gate.run("uploadFile", move || {
                    resolve_upload_files(&base, Some(&files), max_bytes)
                })
                .await
            })
        })
    }
}
