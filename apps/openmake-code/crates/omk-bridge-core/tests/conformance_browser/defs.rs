//! suite `browser-defs` — 요청 도우미(str·스크린샷 이름·키 이벤트·승인된 업로드·페이지 조각·다운로드 귀속·JSON 문자열).

use omk_bridge_core::browser::defs::{
    TabIds, click_point_js, download_task_of, fill_prepare_js, key_event_of,
    parse_approved_uploads, popup_task_of, screenshot_name, str_of,
};
use omk_bridge_core::browser::js_value::json_string;
use serde_json::{Value, json};

use super::{arg, cases, groups, load};

const SUITE: &str = "browser-defs";

fn run(group: &str, i: &Value) -> Value {
    match group {
        "str" => json!(str_of(arg(i, "v"))),
        "screenshotName" => json!(screenshot_name(arg(i, "path"), &i["i"])),
        "keyEventOf" => match key_event_of(i["combo"].as_str().unwrap()) {
            Ok(k) => match k.text {
                Some(t) => json!({"text": t, "common": k.common.to_value()}),
                None => json!({"common": k.common.to_value()}),
            },
            Err(e) => json!({"error": e}),
        },
        "approvedUploads" => Value::Array(
            parse_approved_uploads(arg(i, "raw"))
                .into_iter()
                .map(|u| json!({"host": u.host, "files": u.files}))
                .collect(),
        ),
        "clickPointJs" => json!(click_point_js(i["sel"].as_str().unwrap())),
        "fillPrepareJs" => json!(fill_prepare_js(i["sel"].as_str().unwrap())),
        "downloadTaskOf" => {
            let session = arg(i, "sessionId").map(|s| s.as_str().unwrap());
            json!(download_task_of(
                &tabs_of(i),
                &popups_of(i),
                session,
                i["frameId"].as_str().unwrap()
            ))
        }
        "popupTaskOf" => json!(popup_task_of(
            &tabs_of(i),
            &popups_of(i),
            i["openerId"].as_str().unwrap()
        )),
        "jsonString" => json!(json_string(i["s"].as_str().unwrap())),
        other => panic!("모르는 묶음 {other}"),
    }
}

/// `tabs`: `[키, {targetId, sessionId}]`
fn tabs_of(i: &Value) -> Vec<(String, TabIds)> {
    i["tabs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| {
            let ids = TabIds {
                target_id: t[1]["targetId"].as_str().unwrap().to_owned(),
                session_id: t[1]["sessionId"].as_str().unwrap().to_owned(),
            };
            (t[0].as_str().unwrap().to_owned(), ids)
        })
        .collect()
}

/// `popups`: `[새 창 targetId, 작업 키]`
fn popups_of(i: &Value) -> Vec<(String, String)> {
    i["popups"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p[0].as_str().unwrap().to_owned(),
                p[1].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[test]
fn defs_suite() {
    let doc = load(SUITE);
    let mut failed = Vec::new();
    for group in groups(SUITE) {
        for (ctx, c) in cases(&doc, SUITE, group) {
            let got = run(group, &c["input"]);
            if got != c["expect"] {
                failed.push(format!("{ctx}: 기대 {} 실제 {got}", c["expect"]));
            }
        }
    }
    assert!(
        failed.is_empty(),
        "{}건 실패:\n{}",
        failed.len(),
        failed.join("\n")
    );
}
