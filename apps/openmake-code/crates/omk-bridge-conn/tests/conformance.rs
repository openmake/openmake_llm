//! 연결 적합성 fixture Rust 러너 — `packages/local-bridge-core/conformance/conn-*.json` 을 TS 러너
//! (`conformance-conn.test.ts`)와 함께 통과해야 한다. 형식은 `conformance/CONN.md`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};

use omk_bridge_conn::endpoints::{ConfigFetcher, FetchResponse};
use support::fixture::{KNOWN_CONN_SUITES, conn_files, load};
use support::tmp::{TmpDir, apply_setup};

#[test]
fn conn_suites_are_all_known() {
    let names: Vec<String> = conn_files()
        .iter()
        .map(|p| p.file_stem().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        names, KNOWN_CONN_SUITES,
        "모르는 conn suite 또는 빠진 suite"
    );
    for n in KNOWN_CONN_SUITES {
        load(n);
    }
}

/// 키 모양 — `required` 는 모두 있어야 하고, 그 밖의 키는 `optional` 만 쓸 수 있다.
fn shape(v: &Value, required: &[&str], optional: &[&str], at: &str) {
    let o = v.as_object().unwrap_or_else(|| panic!("{at}: 객체 아님"));
    let missing: Vec<&str> = required
        .iter()
        .copied()
        .filter(|k| !o.contains_key(*k))
        .collect();
    let unknown: Vec<&str> = o
        .keys()
        .map(String::as_str)
        .filter(|k| !required.contains(k) && !optional.contains(k))
        .collect();
    assert!(
        missing.is_empty() && unknown.is_empty(),
        "{at}: 빠진 키 {missing:?}, 모르는 키 {unknown:?}"
    );
}

/// 사례·단계 목록 — 0개면 실패한다.
fn non_empty<'a>(v: &'a Value, at: &str) -> &'a Vec<Value> {
    let items = v.as_array().unwrap_or_else(|| panic!("{at}: 배열 아님"));
    assert!(!items.is_empty(), "{at}: 0개");
    items
}

/// 묶음의 사례 — 비어 있지 않고, 키는 정해진 것만, id 는 겹치지 않는다.
fn group<'a>(
    doc: &'a Value,
    suite: &str,
    name: &str,
    required: &[&str],
    optional: &[&str],
) -> &'a Vec<Value> {
    let at = format!("{suite}/{name}");
    let items = non_empty(&doc[name], &at);
    let mut ids: Vec<String> = items.iter().map(|c| c["id"].to_string()).collect();
    ids.sort_unstable();
    if let Some(w) = ids.windows(2).find(|w| w[0] == w[1]) {
        panic!("{at}: 사례 id 중복 {}", w[0]);
    }
    for c in items {
        shape(c, required, optional, &format!("{at}/{}", c["id"]));
    }
    items
}

const CASE: [&str; 3] = ["id", "input", "expect"];

fn inputs(doc: &Value, suite: &str, name: &str, keys: &[&str]) {
    for c in group(doc, suite, name, &CASE, &[]) {
        shape(
            &c["input"],
            keys,
            &[],
            &format!("{suite}/{name}/{}/input", c["id"]),
        );
    }
}

/// suite 마다 묶음 이름과 사례 키 — TS 러너 `SHAPES` 와 같은 표다.
fn check_shape(suite: &str, doc: &Value) {
    match suite {
        "conn-constants" => shape(doc, &["suite", "version", "values"], &[], suite),
        "conn-reconnect-delay" => {
            shape(doc, &["suite", "version", "cases"], &[], suite);
            inputs(
                doc,
                suite,
                "cases",
                &["attempt", "baseMs", "maxMs", "random"],
            );
        }
        "conn-notice" => {
            shape(doc, &["suite", "version", "cases", "trim"], &[], suite);
            group(doc, suite, "cases", &CASE, &[]);
            inputs(doc, suite, "trim", &["s"]);
        }
        "conn-endpoints" => {
            let groups = ["normalize", "plainRemoteHttp", "resolve", "discover"];
            shape(
                doc,
                &[&["suite", "version"][..], &groups].concat(),
                &[],
                suite,
            );
            inputs(doc, suite, "normalize", &["address"]);
            inputs(doc, suite, "plainRemoteHttp", &["address"]);
            inputs(doc, suite, "resolve", &["address", "config"]);
            inputs(doc, suite, "discover", &["address", "response"]);
            for c in doc["discover"].as_array().unwrap() {
                let r = &c["input"]["response"];
                let keys: &[&str] = if r.get("fail").is_some() {
                    &["fail"]
                } else {
                    &["status", "body"]
                };
                shape(
                    r,
                    keys,
                    &[],
                    &format!("{suite}/discover/{}/input/response", c["id"]),
                );
            }
        }
        "conn-device-id" => {
            let groups = ["rootDeviceId", "realpathSync", "baseId"];
            shape(
                doc,
                &[&["suite", "version"][..], &groups].concat(),
                &[],
                suite,
            );
            inputs(doc, suite, "rootDeviceId", &["base", "root"]);
            for c in group(
                doc,
                suite,
                "realpathSync",
                &[&CASE[..], &["setup"]].concat(),
                &[],
            ) {
                shape(
                    &c["input"],
                    &["path"],
                    &[],
                    &format!("{suite}/realpathSync/{}/input", c["id"]),
                );
            }
            for c in group(doc, suite, "baseId", &["id", "setup", "expect"], &[]) {
                let e = &c["expect"];
                let keys: &[&str] = if e.get("generated").is_some() {
                    &["generated", "written"]
                } else {
                    &["id"]
                };
                shape(e, keys, &[], &format!("{suite}/baseId/{}/expect", c["id"]));
            }
        }
        "conn-frames" => {
            shape(doc, &["suite", "version", "cases"], &[], suite);
            let cases = group(
                doc,
                suite,
                "cases",
                &["id", "opts", "steps", "expect"],
                &["setup", "root", "after"],
            );
            for c in cases {
                let at = format!("{suite}/cases/{}", c["id"]);
                let opts = [
                    "hostId",
                    "reconnectMs",
                    "authRetryMs",
                    "shouldReconnect",
                    "headersError",
                ];
                shape(
                    &c["opts"],
                    &["deviceId", "label"],
                    &opts,
                    &format!("{at}/opts"),
                );
                let e = ["frames", "statuses", "notices", "delays"];
                shape(&c["expect"], &e, &[], &format!("{at}/expect"));
                for (n, s) in non_empty(&c["steps"], &format!("{at}/steps"))
                    .iter()
                    .enumerate()
                {
                    let at = format!("{at}/steps/{n}");
                    let first = s.as_object().and_then(|o| o.keys().next().cloned());
                    let keys: &[&str] = match (first.as_deref(), s["client"].as_str()) {
                        (Some("client"), Some("browserControl")) => &["client", "user"],
                        (Some("client"), Some("disconnect")) => &["client"],
                        (Some("server"), _) => &["server"],
                        (Some("serverText"), _) => &["serverText"],
                        (Some("serverBinary"), _) => &["serverBinary"],
                        (Some("serverClose"), _) => &["serverClose"],
                        (Some("serverDrop"), _) => &["serverDrop"],
                        _ => panic!("{at}: 모르는 단계 {s}"),
                    };
                    shape(s, keys, &[], &at);
                }
                for a in c["after"].as_array().into_iter().flatten() {
                    let keys: &[&str] = if a.get("absent").is_some() {
                        &["absent"]
                    } else {
                        &["exists", "content"]
                    };
                    shape(a, keys, &[], &format!("{at}/after"));
                }
            }
        }
        other => panic!("모르는 conn suite: {other}"),
    }
}

#[test]
fn fixture_shapes() {
    for suite in KNOWN_CONN_SUITES {
        let path = support::fixture::path_of(suite);
        let text = std::fs::read_to_string(&path).unwrap();
        // 연결 suite 는 알려진 차이를 쓰지 않는다 — 차이는 Rust 단위 테스트로 고정한다(CONN.md).
        assert!(
            !text.contains("\"divergence\"") && !text.contains("\"rustExpect\""),
            "{suite}: divergence·rustExpect 는 연결 suite 에서 쓰지 않는다"
        );
        check_shape(suite, &load(suite));
    }
}

#[test]
fn conn_constants() {
    use omk_bridge_conn::constants as c;
    let reasons: Vec<&str> = c::AUTH_CLOSE_REASONS.iter().map(|r| r.as_str()).collect();
    let texts: serde_json::Map<String, Value> = c::AUTH_CLOSE_REASONS
        .iter()
        .map(|r| (r.as_str().to_owned(), json!(r.text())))
        .collect();
    let actual = json!({
        "RECONNECT_MS": c::RECONNECT_MS,
        "RECONNECT_MAX_MS": c::RECONNECT_MAX_MS,
        "HANDSHAKE_TIMEOUT_MS": c::HANDSHAKE_TIMEOUT_MS,
        "HELLO_DELAY_MS": c::HELLO_DELAY_MS,
        "LIVENESS_PING_MS": c::LIVENESS_PING_MS,
        "LIVENESS_TIMEOUT_MS": c::LIVENESS_TIMEOUT_MS,
        "AUTH_RETRY_MS": c::AUTH_RETRY_MS,
        "AUTH_CLOSE_REASONS": reasons,
        "AUTH_CLOSE_TEXT": texts,
        "NOTICE_KINDS": c::NOTICE_KINDS,
        "NOTICE_TOOL_NAME_MAX": c::NOTICE_TOOL_NAME_MAX,
        "TASK_ID_RE": {"source": c::TASK_ID_RE_SOURCE, "flags": c::TASK_ID_RE_FLAGS},
        "DESKTOP_CONFIG_PATH": c::DESKTOP_CONFIG_PATH,
        "DESKTOP_CONFIG_TIMEOUT_MS": c::DESKTOP_CONFIG_TIMEOUT_MS,
    });
    let doc = load("conn-constants");
    let expected = doc["values"].as_object().unwrap();
    let actual = actual.as_object().unwrap();
    for (k, v) in expected {
        assert_eq!(actual.get(k), Some(v), "conn-constants/values/{k}");
    }
    let extra: Vec<&String> = actual
        .keys()
        .filter(|k| !expected.contains_key(*k))
        .collect();
    assert!(extra.is_empty(), "fixture 에 없는 상수 {extra:?}");
    for r in c::AUTH_CLOSE_REASONS {
        assert_eq!(c::AuthCloseReason::parse(r.as_str()), Some(r));
    }
}

#[test]
fn conn_reconnect_delay() {
    let doc = load("conn-reconnect-delay");
    for c in doc["cases"].as_array().unwrap() {
        let i = &c["input"];
        let ms = omk_bridge_conn::reconnect::reconnect_delay_ms(
            u32::try_from(i["attempt"].as_u64().unwrap()).unwrap(),
            i["baseMs"].as_u64().unwrap(),
            i["maxMs"].as_u64().unwrap(),
            i["random"].as_f64().unwrap(),
        );
        assert_eq!(
            json!({ "ms": ms }),
            c["expect"],
            "conn-reconnect-delay/cases/{}",
            c["id"]
        );
    }
}

#[test]
fn conn_notice_trim() {
    let doc = load("conn-notice");
    for c in doc["trim"].as_array().unwrap() {
        let s = omk_bridge_conn::js_string::trim(c["input"]["s"].as_str().unwrap());
        assert_eq!(
            json!({ "s": s }),
            c["expect"],
            "conn-notice/trim/{}",
            c["id"]
        );
    }
}

#[test]
fn conn_notice_cases() {
    let doc = load("conn-notice");
    for c in doc["cases"].as_array().unwrap() {
        let got = omk_bridge_conn::notice::parse_notice(&c["input"]).map(|n| n.to_json());
        assert_eq!(
            got.unwrap_or(Value::Null),
            c["expect"],
            "conn-notice/cases/{}",
            c["id"]
        );
    }
}

/// 가짜 조회기 — 요청 주소를 기록하고 fixture 의 응답을 준다.
struct FakeFetcher {
    response: Value,
    url: std::sync::Mutex<Option<String>>,
}

impl ConfigFetcher for FakeFetcher {
    fn get(
        &self,
        url: &str,
    ) -> impl std::future::Future<Output = Result<FetchResponse, String>> + Send {
        *self.url.lock().unwrap() = Some(url.to_owned());
        let r = &self.response;
        let out = if r.get("fail").is_some() {
            Err("ECONNREFUSED".to_owned())
        } else {
            Ok(FetchResponse {
                status: u16::try_from(r["status"].as_u64().unwrap()).unwrap(),
                body: r["body"].as_str().unwrap().as_bytes().to_vec(),
            })
        };
        std::future::ready(out)
    }
}

#[test]
fn conn_endpoints() {
    use omk_bridge_conn::endpoints as e;
    let doc = load("conn-endpoints");
    for c in doc["normalize"].as_array().unwrap() {
        let got = e::normalize_server_address(c["input"]["address"].as_str().unwrap());
        let got = got.map_or(Value::Null, |o| json!({ "origin": o }));
        assert_eq!(got, c["expect"], "conn-endpoints/normalize/{}", c["id"]);
    }
    for c in doc["plainRemoteHttp"].as_array().unwrap() {
        let got = e::is_plain_remote_http(c["input"]["address"].as_str().unwrap());
        assert_eq!(
            json!({ "value": got }),
            c["expect"],
            "conn-endpoints/plainRemoteHttp/{}",
            c["id"]
        );
    }
    for c in doc["resolve"].as_array().unwrap() {
        let i = &c["input"];
        let got = match e::resolve_endpoints(i["address"].as_str().unwrap(), &i["config"]) {
            Ok(r) => r.to_json(),
            Err(msg) => json!({ "error": msg }),
        };
        assert_eq!(got, c["expect"], "conn-endpoints/resolve/{}", c["id"]);
    }
    let rt = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    for c in doc["discover"].as_array().unwrap() {
        let i = &c["input"];
        let fetcher = FakeFetcher {
            response: i["response"].clone(),
            url: std::sync::Mutex::new(None),
        };
        let got = match rt.block_on(e::discover_endpoints(
            i["address"].as_str().unwrap(),
            &fetcher,
        )) {
            Ok(r) => json!({ "url": *fetcher.url.lock().unwrap(), "result": r.to_json() }),
            Err(msg) => json!({ "error": msg }),
        };
        assert_eq!(got, c["expect"], "conn-endpoints/discover/{}", c["id"]);
    }
}

fn is_uuid_v4(s: &str) -> bool {
    let b = s.as_bytes();
    s.len() == 36
        && s.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_digit() || ('a'..='f').contains(&c),
        })
        && b[14] == b'4'
        && matches!(b[19], b'8' | b'9' | b'a' | b'b')
}

#[test]
fn conn_device_id() {
    use omk_bridge_conn::device_id::{DeviceIdentity, node_realpath_sync, root_device_id};
    let doc = load("conn-device-id");
    for c in doc["rootDeviceId"].as_array().unwrap() {
        let i = &c["input"];
        let got = root_device_id(i["base"].as_str().unwrap(), i["root"].as_str().unwrap());
        assert_eq!(
            json!({ "deviceId": got }),
            c["expect"],
            "conn-device-id/rootDeviceId/{}",
            c["id"]
        );
    }
    for c in doc["realpathSync"].as_array().unwrap() {
        let tmp = TmpDir::new();
        apply_setup(&tmp, &c["setup"]);
        let got = match node_realpath_sync(&tmp.fill(c["input"]["path"].as_str().unwrap())) {
            Ok(p) => json!({ "path": tmp.unfill(&p) }),
            Err(e) => json!({ "error": tmp.unfill(&e) }),
        };
        assert_eq!(got, c["expect"], "conn-device-id/realpathSync/{}", c["id"]);
    }
    for c in doc["baseId"].as_array().unwrap() {
        let tmp = TmpDir::new();
        apply_setup(&tmp, &c["setup"]);
        let dir = std::path::PathBuf::from(tmp.join("support"));
        let base = DeviceIdentity::load_or_create(&dir)
            .unwrap()
            .base()
            .to_owned();
        let at = format!("conn-device-id/baseId/{}", c["id"]);
        if c["expect"].get("generated").is_some() {
            assert!(is_uuid_v4(&base), "{at}: UUID v4 꼴이 아님 {base}");
            let written = std::fs::read_to_string(dir.join("device-id"))
                .ok()
                .as_deref()
                == Some(base.as_str());
            assert_eq!(
                json!({ "generated": true, "written": written }),
                c["expect"],
                "{at}"
            );
        } else {
            assert_eq!(json!({ "id": base }), c["expect"], "{at}");
        }
    }
}

#[test]
fn conn_frames() {
    panic!("미구현: conn-frames");
}
