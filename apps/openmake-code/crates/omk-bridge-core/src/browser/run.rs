//! LocalBrowser 의 요청 1건 실행 흐름(TS `local-browser.ts` `run`·`runNow`) — 제어권 → 액션 자르기 → 흐름 형태 검사 → 연결·탭·
//! 다운로드 설정 → 흐름 해석(단순 액션마다 중지 → 실제 탭 주소 → 사이트 정책 → 빈 페이지 → 업로드 검사 → 실행) → 다운로드 보고.
//! 결과는 TS 객체 리터럴의 키 순서로 만든다(D-76).

use std::sync::{Arc, Mutex};

use serde_json::Value;

use super::actions::{self, Upload, current_url, evaluate};
use super::cdp::CdpClient;
use super::constants::{
    BLANK_PAGE_ERROR, BROWSER_MAX_ACTIONS, BROWSER_USER_CONTROL_ERROR, PAGE_ACTIONS, STOPPED_ERROR,
    UPLOAD_UNSUPPORTED_ERROR,
};
use super::defs::parse_approved_uploads;
use super::downloads::PlaceDownload;
use super::flow::{self, BoxFut, FlowHooks, run_flow};
use super::js_value::{js_truthy, str_of};
use super::local_browser::{LocalBrowser, TabRef, lock_tab, task_key};
use super::policy_block::{
    PolicyBlock, policy_block_of, upload_rejected_block, user_control_block,
};
use super::result::{Json, Obj};
use super::scheduler::StopCheck;
use super::site_policy::{SitePolicy, UploadApproval, check_action, host_of, parse_policy};

/// 스크린샷 저장 — 이름(연결 폴더 기준)·PNG 바이트. 스코프·가드 판정은 호출부 책임.
pub type SaveFile =
    Arc<dyn Fn(String, Vec<u8>) -> BoxFut<'static, Result<(), String>> + Send + Sync>;
/// 업로드할 파일 검사 — 액션의 `files` → 검사를 통과한 실제 경로. 걸리면 그 문구로 실패.
pub type ResolveUploadFiles =
    Arc<dyn Fn(Value) -> BoxFut<'static, Result<Vec<String>, String>> + Send + Sync>;

/// 서버가 보내는 브라우저 요청 본문 — 모두 임의 JSON(안에서 고른다).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BrowserSpec {
    pub actions: Option<Value>,
    pub site_policy: Option<Value>,
    pub approved_hosts: Option<Value>,
    pub approved_uploads: Option<Value>,
}

/// 실행 옵션 — 저장 함수들은 호출부(코어)가 같은 가드로 준다.
#[derive(Clone)]
pub struct BrowserRunOptions {
    /// 작업 id — 작업마다 탭을 따로 쓴다. 없으면 공용 탭
    pub task_id: Option<String>,
    pub save_file: SaveFile,
    /// 다운로드가 떨어질 폴더(연결 폴더) — 다른 작업과 함께 돌 수 있는지 가른다
    pub download_dir: String,
    /// 없으면 다운로드를 받지 않는다(deny)
    pub place_download: Option<PlaceDownload>,
    /// 없으면 업로드를 실행하지 않는다
    pub resolve_upload_files: Option<ResolveUploadFiles>,
}

/// 차단 표식 — TS 리터럴 순서 `kind, host, action`.
pub fn policy_block_obj(b: &PolicyBlock) -> Obj {
    Obj::of([
        ("kind", b.kind.into()),
        (
            "host",
            b.host.clone().map_or(Json::Value(Value::Null), Json::from),
        ),
        ("action", b.action.as_str().into()),
    ])
}

fn failed(error: &str) -> Obj {
    Obj::of([
        ("ok", false.into()),
        ("results", Json::Arr(Vec::new())),
        ("error", error.into()),
    ])
}

/// 단순 액션의 결과 머리 `i, type` — `type` 이 없으면 키도 없다(JSON.stringify 가 undefined 를 뺀다).
pub(super) fn head(a: &Value, i: usize) -> Obj {
    let mut r = Obj::of([("i", i.into())]);
    if let Some(t) = a.get("type") {
        r.set("type", t.clone());
    }
    r
}

/// 한 요청 동안의 실행 문맥.
pub(super) struct Ctx<'a> {
    pub browser: &'a LocalBrowser,
    pub cdp: &'a CdpClient,
    pub tab: &'a TabRef,
    pub opts: &'a BrowserRunOptions,
    policy: SitePolicy,
    approved_hosts: Vec<String>,
    approved_uploads: Vec<UploadApproval>,
    stopped: StopCheck,
    policy_block: Mutex<Option<PolicyBlock>>,
}

impl Ctx<'_> {
    pub(super) fn session(&self) -> String {
        lock_tab(self.tab).session_id.clone()
    }

    fn stop_error(&self) -> &'static str {
        if self.browser.is_user_control() {
            BROWSER_USER_CONTROL_ERROR
        } else {
            STOPPED_ERROR
        }
    }

    fn block(&self, b: PolicyBlock) {
        *self
            .policy_block
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(b);
    }

    /// 판정을 지난 뒤에만 `actions::run_action` 에 닿는다 — 액션을 CDP 로 보내는 길은 여기 하나다.
    async fn checked(&self, a: &Value, i: usize, step: Option<&str>) -> Result<Obj, String> {
        if self.stopped.stopped() {
            if self.browser.is_user_control() {
                self.block(user_control_block(Some(a)));
            }
            return Err(self.stop_error().to_owned());
        }
        let url = current_url(self.cdp, &self.session()).await;
        // 사이트 정책 — 실제 탭의 주소로 판정한다. 통과하지 못하면 실행하지 않는다.
        let host = host_of(url.as_ref());
        if let Some(denied) = check_action(
            Some(a),
            host.as_deref(),
            &self.policy,
            &self.approved_hosts,
            &self.approved_uploads,
        ) {
            self.block(policy_block_of(Some(a), host.as_deref(), &self.policy));
            return Err(denied);
        }
        let blank = url.as_ref().and_then(Value::as_str) == Some("about:blank");
        if blank && PAGE_ACTIONS.contains(&str_of(a.get("type")).as_str()) {
            return Err(BLANK_PAGE_ERROR.to_owned());
        }
        // 업로드 — 승인을 통과한 뒤 파일을 검사한다(폴더 밖·숨김·크기·개수). 걸리면 감사 기록용 표식을 남긴다.
        let mut upload = Upload {
            paths: Vec::new(),
            host: host.clone(),
        };
        if a.get("type").and_then(Value::as_str) == Some("uploadFile") {
            let resolve = self
                .opts
                .resolve_upload_files
                .as_ref()
                .ok_or(UPLOAD_UNSUPPORTED_ERROR)?;
            match resolve(a.get("files").cloned().unwrap_or(Value::Null)).await {
                Ok(p) => upload.paths = p,
                Err(e) => {
                    self.block(upload_rejected_block(host.as_deref()));
                    return Err(e);
                }
            }
        }
        actions::run_action(self, a, i, upload, step).await
    }

    /// 단순 액션 하나 — 실패도 `{i, type, ok:false, error}` 결과로. 그 액션 동안 뜬 확인창을 싣는다.
    async fn run_simple(&self, a: Value, i: usize, step: Option<String>) -> Obj {
        lock_tab(self.tab).dialogs.clear();
        let mut r = match self.checked(&a, i, step.as_deref()).await {
            Ok(r) => r,
            Err(e) => {
                let mut r = head(&a, i);
                r.set("ok", false);
                r.set("error", e);
                r
            }
        };
        let dialogs = std::mem::take(&mut lock_tab(self.tab).dialogs);
        if !dialogs.is_empty() {
            r.set("dialogs", dialogs);
        }
        r
    }

    /// 조건 판정 — 읽기 전용 고정 조각이라 사이트 정책 판정 대상이 아니다(TS 그대로).
    async fn eval_cond(&self, c: Value) -> Result<bool, String> {
        if self.stopped.stopped() {
            return Err(self.stop_error().to_owned());
        }
        let v = evaluate(self.cdp, &self.session(), &flow::cond_expression(&c)).await?;
        Ok(js_truthy(v.as_ref()))
    }
}

impl LocalBrowser {
    /// 요청 1건 실행 — 같은 작업은 순서대로(같은 탭에 두 실행 주체가 명령을 보내지 않는다), 다른 작업은 동시 실행 상한까지 함께.
    pub async fn run(&self, spec: &BrowserSpec, opts: &BrowserRunOptions) -> Obj {
        let key = task_key(opts.task_id.as_deref());
        self.scheduler
            .run(&key, &opts.download_dir, self.run_now(spec, opts, &key))
            .await
    }

    async fn run_now(&self, spec: &BrowserSpec, opts: &BrowserRunOptions, key: &str) -> Obj {
        let list = spec.actions.as_ref().and_then(Value::as_array);
        if self.is_user_control() {
            let mut r = failed(BROWSER_USER_CONTROL_ERROR);
            r.set("userControl", true);
            r.set(
                "policyBlock",
                policy_block_obj(&user_control_block(list.and_then(|a| a.first()))),
            );
            return r;
        }
        let actions: Vec<Value> = list
            .map(|a| a.iter().take(BROWSER_MAX_ACTIONS).cloned().collect())
            .unwrap_or_default();
        let stopped = self.scheduler.stop_check(key);
        // 제어 흐름(if·repeat) 형태가 어긋나면 브라우저에 붙지 않고 이유를 돌려준다.
        if let Some(e) = flow::validate(Some(&Value::Array(actions.clone()))) {
            return failed(&e);
        }
        let prepared = async {
            let cdp = self.connect().await?;
            let tab = self.tab_for(&cdp, key).await?;
            // 대기 폴더에 guid 이름으로만 받는다(저장 함수가 없으면 받지 않는다)
            self.downloads
                .configure(&cdp, key, opts.place_download.clone())
                .await?;
            Ok::<_, String>((cdp, tab))
        };
        let (cdp, tab) = match prepared.await {
            Ok(x) => x,
            Err(e) => return failed(&e),
        };
        let approved_hosts = spec
            .approved_hosts
            .as_ref()
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|h| h.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let ctx = Ctx {
            browser: self,
            cdp: &cdp,
            tab: &tab,
            opts,
            policy: parse_policy(spec.site_policy.as_ref()),
            approved_hosts,
            approved_uploads: parse_approved_uploads(spec.approved_uploads.as_ref()),
            stopped,
            policy_block: Mutex::new(None),
        };
        let c = &ctx;
        let mut hooks = FlowHooks {
            run_simple: Box::new(move |a, i, step| Box::pin(c.run_simple(a, i, step))),
            eval_cond: Box::new(move |cond| Box::pin(c.eval_cond(cond))),
        };
        let results = run_flow(&actions, &mut hooks, BROWSER_MAX_ACTIONS).await;
        let ok = results.iter().all(|r| r.truthy("ok"));
        let mut r = Obj::of([("ok", ok.into())]);
        if let Some(u) = current_url(&cdp, &ctx.session()).await {
            r.set("finalUrl", u);
        }
        r.set("results", results);
        let block = ctx
            .policy_block
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(b) = block {
            r.set("policyBlock", policy_block_obj(&b));
        }
        let downloads = self.downloads.report(key, self.env.download_wait_ms).await;
        if !downloads.is_empty() {
            r.set("downloads", downloads);
        }
        r
    }
}
