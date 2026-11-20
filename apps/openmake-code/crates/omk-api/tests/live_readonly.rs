//! 운영 read-only 보조 스모크 — 기본 ignored. 자동 검사가 아니며 EGO 라이브를 대신하지 않는다(PR-3.1 계획 §7).
//!
//! 저장소 밖 설정 파일 경로만 환경변수 `OMK_API_SMOKE_CONFIG` 로 받는다. 파일은 `{"serverUrl": "...", "apiKey": "..."}`.
//! 키·URL·응답 전문은 출력하지 않고 operation 성공 여부와 작업 ID 만 남긴다.
//!
//! ```sh
//! OMK_API_SMOKE_CONFIG=/absolute/path/outside/repository/smoke.json \
//!   cargo test --locked -j 2 -p omk-api --test live_readonly -- --ignored
//! ```
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::time::Duration;

use omk_api::{ApiClient, ApiKey, RequestLimits};

#[test]
#[ignore = "운영 보조 스모크 — 사용자/조율이 저장소 밖 설정 파일로만 실행"]
fn live_readonly_smoke() {
    let path = std::env::var("OMK_API_SMOKE_CONFIG").expect("OMK_API_SMOKE_CONFIG 필요");
    let manifest = env!("CARGO_MANIFEST_DIR");
    let repo_root = std::path::Path::new(manifest).join("../../../..");
    let repo_root = repo_root.canonicalize().expect("저장소 경로");
    let cfg_path = std::path::Path::new(&path)
        .canonicalize()
        .expect("설정 파일 경로");
    assert!(
        !cfg_path.starts_with(&repo_root),
        "설정 파일은 저장소 밖에 둔다"
    );
    let text = std::fs::read_to_string(&cfg_path).expect("설정 파일 읽기");
    let cfg: serde_json::Value = serde_json::from_str(&text).expect("설정 JSON");
    let url = cfg["serverUrl"].as_str().expect("serverUrl").to_owned();
    let key = ApiKey::new(cfg["apiKey"].as_str().expect("apiKey")).expect("apiKey 형식");
    drop(text);

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async move {
        let limits = RequestLimits {
            timeout: Duration::from_secs(20),
            body_max_bytes: 8 * 1024 * 1024,
        };
        let c = ApiClient::new(&url, key, limits).expect("클라이언트");
        let b = c.bridge_status().await;
        println!("bridge_status: {}", if b.is_ok() { "ok" } else { "실패" });
        if let Err(e) = &b {
            println!("  오류 범주: {e:?}");
        }
        let l = c.list_tasks(None, None).await;
        println!("list_tasks: {}", if l.is_ok() { "ok" } else { "실패" });
        let first = match &l {
            Ok(list) => list.tasks.first().map(|t| t.id.clone()),
            Err(e) => {
                println!("  오류 범주: {e:?}");
                None
            }
        };
        if let Some(id) = first {
            let d = c.get_task(&id).await;
            println!("get_task({id}): {}", if d.is_ok() { "ok" } else { "실패" });
            if let Err(e) = &d {
                println!("  오류 범주: {e:?}");
            }
            assert!(d.is_ok());
        } else {
            println!("get_task: 작업 없음 — 생략");
        }
        assert!(b.is_ok() && l.is_ok());
    });
}
