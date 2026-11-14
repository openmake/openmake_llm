//! 브라우저 액션 → CDP 명령(TS `local-browser.ts` 의 `runAction`·페이지 도우미). `run_action` 은 `run.rs` 의 판정 뒤
//! 한 곳에서만 불린다(`pub(super)`).
//!
//! PR-1.6b 1회차: 페이지 평가(`evaluate`·`current_url`)와 CDP 를 쓰지 않는 `wait`·`dialog` 만 옮겼다. 나머지 12종은 2회차.

use std::time::Duration;

use serde_json::{Value, json};

use super::cdp::CdpClient;
use super::constants::BROWSER_WAIT_MAX_MS;
use super::js_value::{js_number, js_string, js_truthy, str_of};
use super::local_browser::lock_tab;
use super::result::Obj;
use super::run::{Ctx, head};

/// 업로드 판정 결과 — 검사를 통과한 실제 경로와 승인 때의 호스트.
// 1회차에는 uploadFile 이 없어 읽는 곳이 없다 — 2회차가 쓴다.
#[allow(dead_code)]
pub(super) struct Upload {
    pub paths: Vec<String>,
    pub host: Option<String>,
}

/// 페이지에서 식을 평가한다 — 예외면 첫 줄 문구로 실패. 값이 없으면(`undefined`) `None`.
pub(super) async fn evaluate(
    cdp: &CdpClient,
    session: &str,
    expression: &str,
) -> Result<Option<Value>, String> {
    let r = cdp
        .send(
            "Runtime.evaluate",
            json!({"expression": expression, "returnByValue": true, "awaitPromise": true}),
            Some(session),
        )
        .await?;
    if js_truthy(r.get("exceptionDetails")) {
        let d = &r["exceptionDetails"];
        let given = |v: Option<&Value>| v.filter(|x| !x.is_null()).map(js_string);
        let msg = given(d.get("exception").and_then(|e| e.get("description")))
            .or_else(|| given(d.get("text")))
            .unwrap_or_else(|| "페이지 스크립트 오류".to_owned());
        return Err(msg.split('\n').next().unwrap_or_default().to_owned());
    }
    Ok(r.get("result").and_then(|x| x.get("value")).cloned())
}

/// 지금 탭의 주소 — 평가가 실패하면 `about:blank`.
pub(super) async fn current_url(cdp: &CdpClient, session: &str) -> Option<Value> {
    evaluate(cdp, session, "location.href")
        .await
        .unwrap_or_else(|_| Some(Value::from("about:blank")))
}

/// 판정을 지난 액션 하나를 실행한다.
pub(super) async fn run_action(
    cx: &Ctx<'_>,
    a: &Value,
    i: usize,
    _upload: Upload,
    _step: Option<&str>,
) -> Result<Obj, String> {
    let ok = || {
        let mut r = head(a, i);
        r.set("ok", true);
        r
    };
    match a.get("type").and_then(Value::as_str) {
        Some("dialog") => {
            let Some(accept) = a.get("accept").and_then(Value::as_bool) else {
                return Err("dialog 액션에는 accept(true/false)가 필요합니다".to_owned());
            };
            let mut t = lock_tab(cx.tab);
            t.accept_dialogs = accept;
            t.prompt_text = match a.get("promptText") {
                Some(p) if accept && !p.is_null() => Some(str_of(Some(p))),
                _ => None,
            };
            Ok(ok())
        }
        Some("wait") => {
            let ms = js_number(a.get("ms"));
            let ms = if ms.is_nan() {
                0.0
            } else {
                ms.clamp(0.0, BROWSER_WAIT_MAX_MS as f64)
            };
            tokio::time::sleep(Duration::from_secs_f64(ms / 1000.0)).await;
            Ok(ok())
        }
        Some(
            t @ ("goto" | "click" | "fill" | "snapshot" | "smartClick" | "smartFill" | "press"
            | "waitFor" | "screenshot" | "extractText" | "extractHtml" | "uploadFile"),
        ) => Err(format!(
            "아직 옮기지 않은 action 입니다(PR-1.6b 2회차): {t}"
        )),
        // 모르는 액션은 사이트 정책에서 쓰기로 분류돼 이미 판정을 거쳤다 — 실행할 수 없으니 실패로 돌린다.
        _ => Err("알 수 없는 action".to_owned()),
    }
}
