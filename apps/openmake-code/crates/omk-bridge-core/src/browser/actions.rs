//! 브라우저 액션 → CDP 명령(TS `local-browser.ts` 의 `runAction`·`uploadFiles`). `run_action` 은 `run.rs` 의 판정
//! (중지 → 실제 탭 주소 → 사이트 정책 → 빈 페이지 → 업로드 검사) 뒤 한 곳에서만 불린다(`pub(super)`). 페이지 도우미는 `page.rs`.

use std::time::Duration;

use serde_json::{Value, json};

use super::constants::{
    BROWSER_EXTRACT_MAX_CHARS, BROWSER_FILL_ECHO_MAX_CHARS, BROWSER_SNAPSHOT_MAX_ELEMENTS,
    BROWSER_WAIT_MAX_MS, FIELD_IS_FORM_JS, FIELD_VALUE_JS, UPLOAD_HOST_CHANGED_ERROR,
};
use super::defs::{click_point_js, fill_prepare_js, screenshot_name};
use super::js_value::{js_number, js_truthy, json_string, str_of};
use super::local_browser::lock_tab;
use super::result::{Json, Obj};
use super::run::{Ctx, head};
use super::site_policy::host_of;
use crate::base64_lenient;
use crate::js_text::utf16_prefix;

use super::page::read_error;
pub(super) use super::page::{current_url, evaluate};

/// 업로드 판정 결과 — 검사를 통과한 실제 경로와 승인 때의 호스트.
pub(super) struct Upload {
    pub paths: Vec<String>,
    pub host: Option<String>,
}

/// 입력 뒤 결과에 실을 값 — 요소에 실제로 들어간 내용(문자열일 때만, 200자). 비밀번호 칸은 조각이 null 을 돌려 싣지 않는다.
fn echoed(r: &mut Obj, value: Option<&Value>) {
    if let Some(s) = value.and_then(Value::as_str) {
        r.set("value", utf16_prefix(s, BROWSER_FILL_ECHO_MAX_CHARS));
    }
}

fn not_found(selector: &str) -> String {
    format!("요소를 찾지 못했습니다: {selector}")
}

/// 판정을 지난 액션 하나를 실행한다.
pub(super) async fn run_action(
    cx: &Ctx<'_>,
    a: &Value,
    i: usize,
    upload: Upload,
    step: Option<&str>,
) -> Result<Obj, String> {
    let selector = str_of(a.get("selector"));
    let sel = json_string(&selector);
    let mut r = head(a, i);
    r.set("ok", true);
    match a.get("type").and_then(Value::as_str) {
        Some("goto") => {
            // 다운로드로 끝났으면(isDownload) 이동 실패가 아니다 — 파일은 다운로드 추적이 가드를 거쳐 저장하고 결과 downloads 에 싣는다
            if cx.goto(&str_of(a.get("url"))).await? {
                r.set("download", true);
            }
            if let Some(u) = cx.url().await {
                r.set("url", u);
            }
        }
        Some("click") => {
            let p = cx
                .poll_eval(&click_point_js(&sel), &not_found(&selector))
                .await?;
            cx.click_at(p.get("x").cloned(), p.get("y").cloned())
                .await?;
        }
        Some("fill") => {
            // 요소에 초점을 주고 기존 내용을 선택한 뒤 입력한다 — input·textarea·contenteditable 공통.
            let kind = cx
                .poll_eval(&fill_prepare_js(&sel), &not_found(&selector))
                .await?;
            if kind.as_str() != Some("ok") {
                return Err(format!("입력할 수 없는 요소입니다: {selector}"));
            }
            cx.type_text(&str_of(a.get("text"))).await?;
            let entered = cx
                .eval(&format!(
                    "({FIELD_VALUE_JS})(document.querySelector({sel}))"
                ))
                .await?;
            echoed(&mut r, entered.as_ref());
        }
        Some("snapshot") => {
            let nodes = cx.interactive_nodes().await?;
            let elements: Vec<Obj> = nodes
                .into_iter()
                .take(BROWSER_SNAPSHOT_MAX_ELEMENTS)
                .enumerate()
                .map(|(index, (role, name, _))| {
                    Obj::of([
                        ("index", index.into()),
                        ("role", role.into()),
                        ("name", name.into()),
                    ])
                })
                .collect();
            r.set("elements", elements);
        }
        Some("smartClick") => {
            let id = cx.find_by_role(a).await?;
            let (x, y) = cx.center_of(&id).await?;
            cx.click_at(Some(x), Some(y)).await?;
        }
        Some("smartFill") => {
            let id = cx.find_by_role(a).await?;
            cx.send("DOM.focus", json!({"backendNodeId": id})).await?;
            let resolved = cx
                .send("DOM.resolveNode", json!({"backendNodeId": id}))
                .await?;
            let object = resolved.get("object");
            let Some(object) = object.filter(|o| !o.is_null()) else {
                return Err(read_error(object, "objectId"));
            };
            let with_object = |decl: String, by_value: bool| {
                let mut p = json!({"functionDeclaration": decl});
                if let Some(id) = object.get("objectId") {
                    p["objectId"] = id.clone();
                }
                if by_value {
                    p["returnByValue"] = Value::Bool(true);
                }
                p
            };
            let select = "function () { if (typeof this.select === \"function\") this.select(); else getSelection().selectAllChildren(this); }";
            cx.send("Runtime.callFunctionOn", with_object(select.into(), false))
                .await?;
            cx.type_text(&str_of(a.get("text"))).await?;
            let value = format!("function () {{ return ({FIELD_VALUE_JS})(this); }}");
            let got = cx
                .send("Runtime.callFunctionOn", with_object(value, true))
                .await?;
            echoed(&mut r, got.get("result").and_then(|x| x.get("value")));
        }
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
        }
        Some("press") => cx.press(&str_of(a.get("key"))).await?,
        Some("wait") => {
            let ms = js_number(a.get("ms"));
            let ms = if ms.is_nan() {
                0.0
            } else {
                ms.clamp(0.0, BROWSER_WAIT_MAX_MS as f64)
            };
            tokio::time::sleep(Duration::from_secs_f64(ms / 1000.0)).await;
        }
        Some("waitFor") => {
            let expr = format!("!!document.querySelector({sel})");
            let message = format!("요소가 나타나지 않았습니다: {selector}");
            let found = || async {
                let v = cx.eval(&expr).await?;
                Ok(js_truthy(v.as_ref()).then_some(()))
            };
            super::page::poll(found, &message, cx.action_timeout()).await?;
        }
        Some("screenshot") => {
            // 중첩 액션은 같은 i 를 공유한다 — 기본 이름은 step 으로 구분
            let at = step.map_or_else(|| Value::from(i), Value::from);
            let name = screenshot_name(a.get("path"), &at);
            let full = js_truthy(a.get("fullPage"));
            let shot = cx
                .send(
                    "Page.captureScreenshot",
                    json!({"format": "png", "captureBeyondViewport": full}),
                )
                .await?;
            let bytes = match shot.get("data").and_then(Value::as_str) {
                Some(d) => base64_lenient::decode(d),
                None => return Err(BUFFER_FROM_UNDEFINED.to_owned()),
            };
            (cx.opts.save_file)(name.clone(), bytes).await?;
            r.set("path", name);
        }
        Some(t @ ("extractText" | "extractHtml")) => {
            // selector 없이 페이지 전체를 읽을 때는 문서가 읽힐 때까지 기다린다 — 로딩 중의 빈 본문을 "성공·빈 문자열"로 보고하지 않게
            let by_selector = js_truthy(a.get("selector"));
            let ready = by_selector || cx.wait_document_ready().await;
            let text = t == "extractText";
            let got = if by_selector {
                let expr = if text {
                    format!(
                        "(() => {{ const el = document.querySelector({sel}); if (!el) return null; const v = ({FIELD_VALUE_JS})(el); return {FIELD_IS_FORM_JS} ? (v ?? '') : el.innerText; }})()"
                    )
                } else {
                    format!(
                        "(() => {{ const el = document.querySelector({sel}); return el ? el.innerHTML : null; }})()"
                    )
                };
                Some(cx.poll_eval(&expr, &not_found(&selector)).await?)
            } else if text {
                cx.eval("document.body ? document.body.innerText : \"\"")
                    .await?
            } else {
                cx.eval("document.documentElement.outerHTML").await?
            };
            let body = str_of(got.as_ref());
            let key = if text { "text" } else { "html" };
            r.set(key, utf16_prefix(&body, BROWSER_EXTRACT_MAX_CHARS));
            if !ready {
                r.set("loading", true);
            }
        }
        Some("uploadFile") => {
            upload_files(cx, &selector, &upload.paths, upload.host.as_deref()).await?;
            if let Some(f) = a.get("files") {
                r.set("files", Json::Value(f.clone()));
            }
        }
        // 모르는 액션은 사이트 정책에서 쓰기로 분류돼 이미 판정을 거쳤다 — 실행할 수 없으니 실패로 돌린다.
        _ => return Err("알 수 없는 action".to_owned()),
    }
    Ok(r)
}

/// Node `Buffer.from(undefined, 'base64')` 의 문구 — Chrome 은 data 를 늘 문자열로 준다.
const BUFFER_FROM_UNDEFINED: &str = "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received undefined";

/// 파일 선택 칸(input[type=file])에 파일을 넣는다 — 페이지에는 사용자가 고른 것처럼 input·change 가 일어난다.
/// 요소를 기다리는 동안 다른 사이트로 넘어갔으면 넣지 않는다(승인은 판정 때의 호스트에 묶였다). 요소를 잡은 뒤의 이동은 그 요소를 무효로 만든다.
async fn upload_files(
    cx: &Ctx<'_>,
    selector: &str,
    paths: &[String],
    approved_host: Option<&str>,
) -> Result<(), String> {
    let sel = json_string(selector);
    cx.poll_eval(
        &format!("!!document.querySelector({sel}) || null"),
        &not_found(selector),
    )
    .await?;
    let found = cx
        .send(
            "Runtime.evaluate",
            json!({"expression": format!("document.querySelector({sel})")}),
        )
        .await?;
    let object_id = found
        .get("result")
        .and_then(|r| r.get("objectId"))
        .filter(|id| js_truthy(Some(id)))
        .cloned()
        .ok_or_else(|| not_found(selector))?;
    if host_of(cx.url().await.as_ref()).as_deref() != approved_host {
        return Err(UPLOAD_HOST_CHANGED_ERROR.to_owned());
    }
    let kind = cx
        .send(
            "Runtime.callFunctionOn",
            json!({
                "objectId": object_id, "returnByValue": true,
                "functionDeclaration": "function () { return this instanceof HTMLInputElement && this.type === \"file\" ? (this.multiple ? \"multiple\" : \"single\") : \"other\"; }",
            }),
        )
        .await?;
    let kind = kind.get("result").and_then(|r| r.get("value"));
    let kind = kind.and_then(Value::as_str);
    if kind == Some("other") {
        return Err(format!(
            "파일 선택 칸(input[type=file])이 아닙니다: {selector}"
        ));
    }
    if kind == Some("single") && paths.len() > 1 {
        return Err(format!(
            "여러 파일을 받지 않는 칸입니다(multiple 아님): {selector}"
        ));
    }
    cx.send(
        "DOM.setFileInputFiles",
        json!({"files": paths, "objectId": object_id}),
    )
    .await?;
    Ok(())
}
