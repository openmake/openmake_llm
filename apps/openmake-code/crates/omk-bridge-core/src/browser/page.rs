//! 페이지 조작 도우미(TS `local-browser.ts` 의 `evaluate`·`currentUrl`·`poll`·`clickAt`·`typeText`·`press`·`goto`·
//! `interactiveNodes`·`findByRole`·`centerOf`·`followPopup`·`waitDocumentReady`). 액션 분기는 `actions.rs` 가 한다 —
//! 여기 함수들은 판정을 지난 `run_action` 안에서만 불린다. 이동·요소 대기·문서 대기는 중지와 겨뤄 끊긴다(`Ctx::stoppable`).

use std::future::Future;
use std::time::Duration;

use serde_json::{Map, Value, json};
use tokio::time::{Instant, sleep};

use super::cdp::CdpClient;
use super::constants::{
    BROWSER_CLICK_SETTLE_MS, BROWSER_INTERACTIVE_ROLES, BROWSER_POLL_MS, BROWSER_SNAPSHOT_NAME_MAX,
};
use super::defs::key_event_of;
use super::js_value::{js_number, js_string, js_to_lower, js_truthy, str_of};
use super::local_browser::lock_tab;
use super::run::Ctx;
use crate::js_text::utf16_prefix;

const READ_TIMEOUT: &str = "페이지 읽기 시간 초과";

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

/// JS 수를 JSON 값으로 — 정수는 소수점 없이(`JSON.stringify` 글자), NaN·무한은 `null`.
pub(super) fn js_num(x: f64) -> Value {
    if !x.is_finite() {
        Value::Null
    } else if x.fract() == 0.0 && x.abs() < 9_007_199_254_740_992.0 {
        Value::from(x as i64)
    } else {
        Value::from(x)
    }
}

/// JS `x.prop` 이 `null`·`undefined` 에서 던지는 TypeError 문구.
pub(super) fn read_error(x: Option<&Value>, prop: &str) -> String {
    let what = if x.is_some() { "null" } else { "undefined" };
    format!("Cannot read properties of {what} (reading '{prop}')")
}

/// `null`·`undefined` 가 아닌 값만 — `poll` 의 "아직" 판정.
pub(super) fn present(v: Option<Value>) -> Option<Value> {
    v.filter(|x| !x.is_null())
}

/// 셀렉터 문법 오류는 기다려도 풀리지 않는다(TS `/is not a valid selector|SyntaxError/i` — ASCII 대소문자만 접는다).
fn is_selector_error(msg: &str) -> bool {
    let l = msg.to_ascii_lowercase();
    l.contains("is not a valid selector") || l.contains("syntaxerror")
}

/// 조건이 참이 될 때까지 폴링 — 평가가 실패하면 다시 시도한다. 시간 초과면 마지막 오류나 `timeout_message`.
pub(super) async fn poll<T, F, Fut>(
    mut f: F,
    timeout_message: &str,
    timeout_ms: u64,
) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<Option<T>, String>>,
{
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut last: Option<String>;
    loop {
        match f().await {
            Ok(Some(v)) => return Ok(v),
            Ok(None) => last = None,
            Err(e) if is_selector_error(&e) => return Err(e),
            Err(e) => last = Some(e),
        }
        if Instant::now() >= deadline {
            return Err(last.unwrap_or_else(|| timeout_message.to_owned()));
        }
        sleep(Duration::from_millis(BROWSER_POLL_MS)).await;
    }
}

impl Ctx<'_> {
    pub(super) async fn eval(&self, expression: &str) -> Result<Option<Value>, String> {
        evaluate(self.cdp, &self.session(), expression).await
    }

    pub(super) async fn url(&self) -> Option<Value> {
        current_url(self.cdp, &self.session()).await
    }

    /// 탭 세션으로 명령 하나.
    pub(super) async fn send(&self, method: &str, params: Value) -> Result<Value, String> {
        self.cdp.send(method, params, Some(&self.session())).await
    }

    pub(super) fn action_timeout(&self) -> u64 {
        self.browser.env.action_timeout_ms
    }

    /// 식의 값이 `null`·`undefined` 가 아닐 때까지.
    pub(super) async fn poll_eval(&self, expression: &str, message: &str) -> Result<Value, String> {
        let t = self.action_timeout();
        self.stoppable(poll(
            || async { self.eval(expression).await.map(present) },
            message,
            t,
        ))
        .await?
    }

    async fn ready_once(&self) -> Result<Option<bool>, String> {
        let v = self.eval("document.readyState").await?;
        Ok((v.as_ref().and_then(Value::as_str) != Some("loading")).then_some(true))
    }

    async fn wait_ready(&self, timeout_ms: u64) -> Result<bool, String> {
        self.stoppable(poll(|| self.ready_once(), READ_TIMEOUT, timeout_ms))
            .await?
    }

    /// 문서가 읽힐 때까지 — 시간 안에 읽혔으면 참. 시간 초과는 실패가 아니라 거짓. 중지로 끊기면 실패.
    pub(super) async fn wait_document_ready(&self) -> Result<bool, String> {
        match self.wait_ready(self.browser.env.extract_ready_ms).await {
            Ok(_) => Ok(true),
            Err(e) if self.was_cut() => Err(e),
            Err(_) => Ok(false),
        }
    }

    pub(super) async fn click_at(&self, x: Option<Value>, y: Option<Value>) -> Result<(), String> {
        let mut base = Map::new();
        if let Some(x) = x {
            base.insert("x".into(), x);
        }
        if let Some(y) = y {
            base.insert("y".into(), y);
        }
        let event = |ty: &str, press: bool| {
            let mut p = Map::new();
            p.insert("type".into(), Value::from(ty));
            p.extend(base.clone());
            if press {
                p.insert("button".into(), Value::from("left"));
                p.insert("clickCount".into(), Value::from(1));
            }
            Value::Object(p)
        };
        self.send("Input.dispatchMouseEvent", event("mouseMoved", false))
            .await?;
        self.send("Input.dispatchMouseEvent", event("mousePressed", true))
            .await?;
        self.send("Input.dispatchMouseEvent", event("mouseReleased", true))
            .await?;
        // 누르기로 이동이 시작됐으면 문서가 읽힐 때까지 기다린다 — 다음 액션이 옛 페이지에서 돌지 않게. 중지는 마지막 문서 대기만 끊는다.
        sleep(Duration::from_millis(BROWSER_CLICK_SETTLE_MS)).await;
        self.follow_popup().await?;
        self.wait_ready(self.action_timeout()).await.map(|_| ())
    }

    pub(super) async fn type_text(&self, text: &str) -> Result<(), String> {
        if text.is_empty() {
            // 선택된 내용을 지운다(입력 비우기)
            for ty in ["rawKeyDown", "keyUp"] {
                let p = json!({"type": ty, "key": "Backspace", "code": "Backspace", "windowsVirtualKeyCode": 8});
                self.send("Input.dispatchKeyEvent", p).await?;
            }
            return Ok(());
        }
        self.send("Input.insertText", json!({"text": text})).await?;
        Ok(())
    }

    pub(super) async fn press(&self, combo: &str) -> Result<(), String> {
        let k = key_event_of(combo)?;
        let common = k.common.to_value();
        let text = k.text.filter(|t| !t.is_empty());
        let mut down = Map::new();
        let ty = if text.is_some() {
            "keyDown"
        } else {
            "rawKeyDown"
        };
        down.insert("type".into(), Value::from(ty));
        down.extend(common.as_object().cloned().unwrap_or_default());
        if let Some(t) = text {
            down.insert("text".into(), Value::from(t));
        }
        self.send("Input.dispatchKeyEvent", Value::Object(down))
            .await?;
        let mut up = Map::new();
        up.insert("type".into(), Value::from("keyUp"));
        up.extend(common.as_object().cloned().unwrap_or_default());
        self.send("Input.dispatchKeyEvent", Value::Object(up))
            .await?;
        // Enter 로 제출되는 폼 — 이동이 시작될 틈을 준다
        sleep(Duration::from_millis(BROWSER_CLICK_SETTLE_MS)).await;
        self.wait_ready(self.action_timeout()).await.map(|_| ())
    }

    /// 이동 — 다운로드로 끝났으면(isDownload, 문서는 그대로) 참. 대기는 보내기 전에 등록한다(답보다 먼저 온 이벤트를 놓치지 않게).
    /// 답·이동 완료를 기다리는 동안 중지되면 끊는다.
    pub(super) async fn goto(&self, url: &str) -> Result<bool, String> {
        self.stoppable(self.navigate(url)).await?
    }

    async fn navigate(&self, url: &str) -> Result<bool, String> {
        let sid = self.session();
        let mine = sid.clone();
        let loaded = self.cdp.wait_for(
            "Page.domContentEventFired",
            move |_, s| s == Some(mine.as_str()),
            self.action_timeout(),
        );
        let r = self
            .cdp
            .send("Page.navigate", json!({"url": url}), Some(&sid))
            .await?;
        let error = r.get("errorText");
        if js_truthy(error) && js_truthy(r.get("isDownload")) {
            return Ok(true);
        }
        if let Some(e) = error.filter(|e| js_truthy(Some(e))) {
            return Err(format!("이동하지 못했습니다: {}", js_string(e)));
        }
        if !js_truthy(r.get("loaderId")) {
            return Ok(false); // 같은 문서 안 이동(#anchor)
        }
        match loaded.await {
            Some(_) => Ok(false),
            None => Err("페이지 이동 시간 초과".to_owned()),
        }
    }

    /// 접근성 트리의 상호작용 요소 — `(role, name, backendNodeId)`. snapshot·smartClick·smartFill 공용.
    pub(super) async fn interactive_nodes(&self) -> Result<Vec<(String, String, Value)>, String> {
        let r = self.send("Accessibility.getFullAXTree", json!({})).await?;
        let Some(nodes) = r.get("nodes").and_then(Value::as_array) else {
            return Err("nodes is not iterable".to_owned());
        };
        let mut out = Vec::new();
        for n in nodes {
            if n.is_null() {
                return Err("Cannot read properties of null (reading 'role')".to_owned());
            }
            let role = str_of(n.get("role").and_then(|r| r.get("value")));
            let id = n.get("backendDOMNodeId").filter(|v| v.is_number());
            let interactive = BROWSER_INTERACTIVE_ROLES.contains(&role.as_str());
            let (Some(id), false, true) = (id, js_truthy(n.get("ignored")), interactive) else {
                continue;
            };
            let name = str_of(n.get("name").and_then(|x| x.get("value")));
            let name = utf16_prefix(&name, BROWSER_SNAPSHOT_NAME_MAX).to_owned();
            out.push((role, name, id.clone()));
        }
        Ok(out)
    }

    /// role·name(대소문자 무시 부분 일치)·nth 로 요소를 찾는다 — 나타날 때까지 기다린다.
    pub(super) async fn find_by_role(&self, a: &Value) -> Result<Value, String> {
        let role = str_of(a.get("role"));
        let name = js_to_lower(&str_of(a.get("name")));
        let nth = js_number(a.get("nth"));
        let nth = if nth.is_nan() { 0.0 } else { nth };
        let message = format!(
            "요소를 찾지 못했습니다: {role} \"{}\"",
            str_of(a.get("name"))
        );
        let found = || async {
            let nodes = self.interactive_nodes().await?;
            let matches: Vec<Value> = nodes
                .into_iter()
                .filter(|(r, n, _)| *r == role && js_to_lower(n).contains(&name))
                .map(|(_, _, id)| id)
                .collect();
            // 음수·소수 nth 는 배열 자리가 아니다(TS `matches[nth]` 가 undefined)
            let at = (nth >= 0.0 && nth.fract() == 0.0 && nth < matches.len() as f64)
                .then(|| matches[nth as usize].clone());
            Ok(at)
        };
        self.stoppable(poll(found, &message, self.action_timeout()))
            .await?
    }

    pub(super) async fn center_of(&self, id: &Value) -> Result<(Value, Value), String> {
        let _ = self
            .send("DOM.scrollIntoViewIfNeeded", json!({"backendNodeId": id}))
            .await;
        let r = self
            .send("DOM.getBoxModel", json!({"backendNodeId": id}))
            .await?;
        let model = r.get("model");
        let Some(model) = model.filter(|m| !m.is_null()) else {
            return Err(read_error(model, "content"));
        };
        let q = |n: usize| {
            model
                .get("content")
                .and_then(|c| c.get(n))
                .and_then(Value::as_f64)
                .unwrap_or(f64::NAN)
        };
        let x = (q(0) + q(2) + q(4) + q(6)) / 4.0;
        let y = (q(1) + q(3) + q(5) + q(7)) / 4.0;
        Ok((js_num(x), js_num(y)))
    }

    /// 페이지가 새 창을 열었으면(target=_blank 등) 그 창으로 옮겨 간다 — 이후 액션과 사이트 판정이 실제로 보이는 페이지를 따른다.
    async fn follow_popup(&self) -> Result<(), String> {
        let r = self.cdp.send("Target.getTargets", json!({}), None).await?;
        let Some(infos) = r.get("targetInfos").and_then(Value::as_array) else {
            return Err("Cannot read properties of undefined (reading 'find')".to_owned());
        };
        let old = lock_tab(self.tab).target_id.clone();
        let popup = infos.iter().find(|t| {
            t.get("type").and_then(Value::as_str) == Some("page")
                && t.get("openerId").and_then(Value::as_str) == Some(old.as_str())
        });
        let Some(popup) = popup else { return Ok(()) };
        let target = str_of(popup.get("targetId"));
        let session = self.browser.attach(self.cdp, &target).await?;
        {
            let mut t = lock_tab(self.tab);
            t.session_id = session;
            t.target_id = target;
        }
        let _ = self
            .cdp
            .send("Target.closeTarget", json!({"targetId": old}), None)
            .await;
        Ok(())
    }
}
