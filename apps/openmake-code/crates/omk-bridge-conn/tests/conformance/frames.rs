//! `conn-frames` 러너 — 사례마다 임시 폴더·실제 코어·duplex 가짜 서버·연결 하나. 멈춘 시계에서 돈다.
//! 단계·기다림 규칙은 TS 러너(`conformance-conn.test.ts` `runFramesCase`)와 같다(`CONN.md`).

use std::sync::Arc;

use omk_bridge_conn::connection::{BridgeConnection, ConnectionOptions, wall_clock_ms};
use omk_bridge_conn::constants::AUTH_CLOSE_REASONS;
use omk_bridge_core::constants::EXPIRY_SKEW_TOLERANCE_MS;
use serde_json::{Map, Value, json};

use crate::support::fake::{Record, ServerOpts, pair, record_into};
use crate::support::tmp::{TmpDir, apply_setup};
use crate::support::{make_core, paused_runtime};

const SENTINEL_ID: &str = "__conformance_end__";

fn ending(code: &str) -> bool {
    matches!(code, "reconnecting" | "idle" | "closed")
        || AUTH_CLOSE_REASONS.iter().any(|r| r.as_str() == code)
}

fn ended_since(r: &Record, from: usize) -> bool {
    r.statuses[from..].iter().any(|s| ending(s.code.as_str()))
}

/// 서버 프레임 안의 `{"{{NOW}}": 차이}` 를 지금 시각 + 차이로 바꾼다.
fn fill_now(v: &Value, now: u64) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(|x| fill_now(x, now)).collect()),
        Value::Object(o) if o.len() == 1 && o.contains_key("{{NOW}}") => {
            json!(now as i64 + o["{{NOW}}"].as_i64().unwrap())
        }
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), fill_now(x, now)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// 기대값의 자리표시를 채운다 — `{{CAPABILITIES}}` 는 이 구현의 능력 목록, `{{DURATION}}` 은 0 이상의 정수일 때만 그 값.
fn fill_expect(e: &Value, actual: Option<&Value>, caps: &Value) -> Value {
    match e {
        Value::String(s) if s == "{{CAPABILITIES}}" => caps.clone(),
        Value::String(s) if s == "{{DURATION}}" => match actual {
            Some(v) if v.is_u64() => v.clone(),
            _ => json!("{{DURATION}} 이 0 이상의 정수가 아님"),
        },
        Value::Array(a) => Value::Array(
            a.iter()
                .enumerate()
                .map(|(i, x)| fill_expect(x, actual.and_then(|v| v.get(i)), caps))
                .collect(),
        ),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| {
                    (
                        k.clone(),
                        fill_expect(x, actual.and_then(|v| v.get(k)), caps),
                    )
                })
                .collect::<Map<_, _>>(),
        ),
        other => other.clone(),
    }
}

pub fn run_case(c: &Value) {
    let rt = paused_runtime();
    rt.block_on(run(c));
    rt.shutdown_background();
}

async fn run(c: &Value) {
    let id = c["id"].as_str().unwrap();
    let tmp = TmpDir::new();
    let root_rel = c["root"].as_str().unwrap_or("root");
    std::fs::create_dir_all(tmp.join(root_rel)).unwrap();
    if let Some(setup) = c.get("setup") {
        apply_setup(&tmp, setup);
    }
    let core = make_core(&tmp.join(root_rel));
    let caps = json!(core.capabilities());
    let (connector, server) = pair(ServerOpts::default());
    let o = &c["opts"];
    let headers_error = o["headersError"].as_str().map(str::to_owned);
    let he = headers_error.clone();
    let mut opts = ConnectionOptions::new(
        "http://127.0.0.1:52416",
        Arc::clone(&core),
        o["deviceId"].as_str().unwrap(),
        o["label"].as_str().unwrap(),
        Box::new(move || match &he {
            Some(msg) => Err(msg.clone()),
            None => Ok(vec![(
                "Authorization".to_owned(),
                "Bearer omk_test".to_owned(),
            )]),
        }),
        connector,
    );
    opts.host_id = o["hostId"].as_str().map(str::to_owned);
    if o["shouldReconnect"] == json!(false) {
        opts.should_reconnect = Some(Box::new(|| false));
    }
    if let Some(ms) = o["reconnectMs"].as_u64() {
        opts.reconnect_ms = ms;
    }
    if let Some(ms) = o["authRetryMs"].as_u64() {
        opts.auth_retry_ms = ms;
    }
    opts.random = Box::new(|| 1.0);
    let rec = record_into(&mut opts);
    let conn = BridgeConnection::new(opts);
    conn.connect();
    let mut live = headers_error.is_none();
    if live {
        rec.until(&format!("{id}: 연결됨"), |r| r.has_code("connected"))
            .await;
    } else {
        rec.until(&format!("{id}: 헤더 실패 상태"), |r| {
            !r.statuses.is_empty()
        })
        .await;
    }
    let st = &server.state;
    for s in c["steps"].as_array().unwrap() {
        let now = wall_clock_ms();
        if let Some(f) = s.get("server") {
            let f = fill_now(f, now);
            let before = st.read(|x| x.count("bridge_result"));
            server.send_text(f.to_string());
            if f["type"] == "bridge_exec" && live {
                st.until(&format!("{id}: 결과 {}", f["reqId"]), |x| {
                    x.count("bridge_result") > before
                })
                .await;
            }
        } else if let Some(t) = s.get("serverText") {
            server.send_text(t.as_str().unwrap());
        } else if let Some(t) = s.get("serverBinary") {
            let t = t.as_str().unwrap();
            let before = st.read(|x| x.count("bridge_result"));
            server.send_binary(t.as_bytes().to_vec());
            if serde_json::from_str::<Value>(t).unwrap()["type"] == "bridge_exec" {
                st.until(&format!("{id}: 바이너리 결과"), |x| {
                    x.count("bridge_result") > before
                })
                .await;
            }
        } else if let Some(sc) = s.get("serverClose") {
            let from = rec.read(|r| r.statuses.len());
            let code = sc["code"].as_u64().map(|n| u16::try_from(n).unwrap());
            server.close_all(code, sc["reason"].as_str().unwrap_or(""));
            rec.until(&format!("{id}: 닫힘 처리"), |r| ended_since(r, from))
                .await;
            live = false;
        } else if s.get("serverDrop").is_some() {
            let from = rec.read(|r| r.statuses.len());
            server.drop_all();
            rec.until(&format!("{id}: 끊김 처리"), |r| ended_since(r, from))
                .await;
            live = false;
        } else if s["client"] == "browserControl" {
            let before = st.read(|x| x.count("bridge_event"));
            conn.notify_browser_control(s["user"].as_bool().unwrap());
            if live {
                st.until(&format!("{id}: bridge_event"), |x| {
                    x.count("bridge_event") > before
                })
                .await;
            }
        } else if s["client"] == "disconnect" {
            let from = rec.read(|r| r.statuses.len());
            conn.disconnect();
            if live {
                rec.until(&format!("{id}: 종료"), |r| ended_since(r, from))
                    .await;
                live = false;
            }
        } else {
            panic!("{id}: 모르는 단계 {s}");
        }
    }
    if live && st.read(|x| x.any_open()) {
        // 끝 표지 — 만료된 요청은 코어 없이 바로 거절되므로, 그 응답이 오면 앞 프레임의 처리가 끝났다.
        let expired = wall_clock_ms() - EXPIRY_SKEW_TOLERANCE_MS - 60_000;
        let sentinel = json!({"type": "bridge_exec", "kind": "read", "path": "x", "reqId": SENTINEL_ID, "expiresAt": expired});
        server.send_text(sentinel.to_string());
        st.until(&format!("{id}: 끝 표지 응답"), |x| {
            x.frames.iter().any(|f| f["reqId"] == SENTINEL_ID)
        })
        .await;
    }
    let frames: Vec<Value> = st.read(|x| {
        x.frames
            .iter()
            .filter(|f| f["reqId"] != SENTINEL_ID)
            .cloned()
            .collect()
    });
    let actual = rec.read(|r| {
        let statuses: Vec<Value> = r
            .statuses
            .iter()
            .map(|s| json!([s.text, s.code.as_str(), s.arg]))
            .collect();
        json!({"frames": frames, "statuses": statuses, "notices": r.notices, "delays": r.delays})
    });
    let expected = fill_expect(&c["expect"], Some(&actual), &caps);
    assert_eq!(actual, expected, "conn-frames/cases/{id}");
    if headers_error.is_some() {
        assert_eq!(
            st.read(|x| x.attempts),
            0,
            "{id}: 헤더 실패면 접속하지 않는다"
        );
    }
    for a in c["after"].as_array().into_iter().flatten() {
        if let Some(p) = a["absent"].as_str() {
            assert!(
                !std::path::Path::new(&tmp.join(p)).exists(),
                "{id}: {p} 가 있으면 안 된다"
            );
        } else {
            let p = a["exists"].as_str().unwrap();
            assert_eq!(
                std::fs::read_to_string(tmp.join(p)).unwrap(),
                a["content"].as_str().unwrap(),
                "{id}: {p}"
            );
        }
    }
    drop(conn);
}
