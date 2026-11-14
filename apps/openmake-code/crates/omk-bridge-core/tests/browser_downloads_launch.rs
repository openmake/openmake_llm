//! LocalBrowser 다운로드 — 기동 전 기본값·설정 실패(TS `browser-downloads.test.ts` 의 B-8 묶음). Chrome 이 연결 폴더에 직접
//! 쓰는 상태를 없앤다: 설정이 없을 때(기본값)도 대기 폴더, 설정이 실패하면 실행하지 않는다. 가짜 CDP + 멈춘 시계.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::sync::{Arc, Mutex};

use omk_bridge_core::browser::result::Json;
use serde_json::{Value, json};
use support::browser::paused;
use support::browser_lab::{Lab, begin, opts, place_fn, progress, tick, wait_spec};

type Calls = Arc<Mutex<Vec<(String, String)>>>;

fn prefs_path(lab: &Lab) -> String {
    format!("{}/Default/Preferences", lab.profile)
}

fn prefs(lab: &Lab) -> Value {
    serde_json::from_str(&std::fs::read_to_string(prefs_path(lab)).unwrap()).unwrap()
}

/// 기동 순간의 Preferences 를 적는다.
fn record_at_launch(lab: &Lab) -> Arc<Mutex<Vec<Option<String>>>> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (s, p) = (seen.clone(), prefs_path(lab));
    *lab.host.on_launch.lock().unwrap() = Some(Box::new(move || {
        s.lock().unwrap().push(std::fs::read_to_string(&p).ok());
    }));
    seen
}

fn write_prefs(lab: &Lab, text: &str) {
    std::fs::create_dir_all(format!("{}/Default", lab.profile)).unwrap();
    std::fs::write(prefs_path(lab), text).unwrap();
}

/// Preferences 옆에 남은 파일(임시 파일 잔재).
fn leftovers(lab: &Lab) -> Vec<String> {
    std::fs::read_dir(format!("{}/Default", lab.profile))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n != "Preferences")
        .collect()
}

fn two_keys(lab: &Lab) -> Value {
    json!({"download": {"default_directory": lab.staging, "prompt_for_download": false}})
}

async fn run_a(lab: &Lab) -> omk_bridge_core::browser::result::Obj {
    let calls = Calls::default();
    lab.browser
        .run(
            &wait_spec(),
            &opts("A", Some(place_fn(&calls, |_, _| Ok("x".into())))),
        )
        .await
}

#[test]
fn missing_prefs_new_file_before_launch() {
    paused().block_on(async {
        let lab = Lab::new(true);
        let seen = record_at_launch(&lab);
        run_a(&lab).await;
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 1);
        let at: Value = serde_json::from_str(seen[0].as_deref().unwrap()).unwrap();
        assert_eq!(at, two_keys(&lab));
        assert!(std::fs::metadata(&lab.staging).unwrap().is_dir());
        lab.browser.dispose().await;
    });
}

#[test]
fn existing_prefs_merged_two_keys_only() {
    paused().block_on(async {
        let lab = Lab::new(true);
        write_prefs(
            &lab,
            &json!({"profile": {"name": "p"}, "download": {"default_directory": "/elsewhere", "prompt_for_download": true, "directory_upgrade": true}}).to_string(),
        );
        run_a(&lab).await;
        assert_eq!(
            prefs(&lab),
            json!({"profile": {"name": "p"}, "download": {"default_directory": lab.staging, "prompt_for_download": false, "directory_upgrade": true}})
        );
        lab.browser.dispose().await;
    });
}

#[test]
fn broken_or_non_object_prefs_become_two_keys() {
    for text in [r#"{"download": [broken"#, "[1,2]", "null"] {
        paused().block_on(async {
            let lab = Lab::new(true);
            write_prefs(&lab, text);
            run_a(&lab).await;
            assert_eq!(prefs(&lab), two_keys(&lab), "{text}");
            lab.browser.dispose().await;
        });
    }
}

#[test]
fn replaced_by_rename_without_leftovers() {
    paused().block_on(async {
        let lab = Lab::new(true);
        write_prefs(&lab, &json!({"profile": {"name": "p"}}).to_string());
        let before = std::fs::metadata(prefs_path(&lab)).unwrap().ino();
        run_a(&lab).await;
        assert_ne!(std::fs::metadata(prefs_path(&lab)).unwrap().ino(), before);
        let mut want = two_keys(&lab);
        want["profile"] = json!({"name": "p"});
        assert_eq!(prefs(&lab), want);
        assert!(leftovers(&lab).is_empty());
        lab.browser.dispose().await;
    });
}

#[test]
fn prefs_stay_0600() {
    paused().block_on(async {
        let mut lab = Lab::new(true);
        write_prefs(&lab, &json!({"profile": {"name": "p"}}).to_string());
        std::fs::set_permissions(prefs_path(&lab), std::fs::Permissions::from_mode(0o600)).unwrap();
        run_a(&lab).await;
        let mode = |l: &Lab| {
            std::fs::metadata(prefs_path(l))
                .unwrap()
                .permissions()
                .mode()
                & 0o777
        };
        assert_eq!(mode(&lab), 0o600);
        lab.browser.dispose().await;
        std::fs::remove_file(prefs_path(&lab)).unwrap();
        lab.reopen(true);
        run_a(&lab).await;
        assert_eq!(mode(&lab), 0o600);
        lab.browser.dispose().await;
    });
}

/// 그 밖의 읽기 실패(폴더 자리·읽기 권한 없음) — 띄우지 않고 기존 내용 그대로, 임시 파일 없음, 액션 0개.
#[test]
fn other_read_failures_do_not_launch() {
    for case in ["EISDIR", "EACCES"] {
        paused().block_on(async {
            let lab = Lab::new(true);
            if case == "EISDIR" {
                std::fs::create_dir_all(format!("{}/keep", prefs_path(&lab))).unwrap();
            } else {
                write_prefs(&lab, &json!({"profile": {"name": "p"}}).to_string());
                std::fs::set_permissions(prefs_path(&lab), std::fs::Permissions::from_mode(0o200))
                    .unwrap();
            }
            let r = run_a(&lab).await;
            assert!(!r.truthy("ok"), "{case}");
            let Some(Json::Value(Value::String(e))) = r.get("error") else {
                panic!("{case}: error 없음")
            };
            assert!(e.contains("다운로드 기본 폴더"), "{case}: {e}");
            assert_eq!(r.get("results"), Some(&Json::Arr(vec![])));
            assert_eq!(lab.host.launch_count(), 0, "{case}");
            assert!(
                lab.host.servers.lock().unwrap().is_empty(),
                "{case}: 브라우저에 붙지 않는다"
            );
            if case == "EISDIR" {
                assert_eq!(std::fs::read_dir(prefs_path(&lab)).unwrap().count(), 1);
            } else {
                std::fs::set_permissions(prefs_path(&lab), std::fs::Permissions::from_mode(0o600))
                    .unwrap();
                assert_eq!(prefs(&lab), json!({"profile": {"name": "p"}}));
            }
            assert!(leftovers(&lab).is_empty(), "{case}");
            lab.browser.dispose().await;
        });
    }
}

#[test]
fn unwritable_prefs_do_not_launch() {
    paused().block_on(async {
        let lab = Lab::new(true);
        std::fs::create_dir_all(&lab.profile).unwrap();
        std::fs::write(format!("{}/Default", lab.profile), "not a dir").unwrap();
        let r = run_a(&lab).await;
        assert!(!r.truthy("ok"));
        let Some(Json::Value(Value::String(e))) = r.get("error") else {
            panic!("error 없음")
        };
        assert!(
            e.starts_with(
                "Chrome 다운로드 기본 폴더를 설정하지 못해 브라우저를 띄우지 않았습니다: "
            ),
            "{e}"
        );
        assert_eq!(lab.host.launch_count(), 0);
        lab.browser.dispose().await;
    });
}

#[test]
fn attaching_does_not_write_prefs() {
    paused().block_on(async {
        let lab = Lab::new(false);
        run_a(&lab).await;
        assert!(!std::path::Path::new(&prefs_path(&lab)).exists());
        lab.browser.dispose().await;
    });
}

/// 설정이 거절되면 오류로 끝내고 액션을 하나도 실행하지 않는다 — 저장 함수도 그대로(그 뒤의 다운로드는 앞 함수로).
#[test]
fn rejected_configure_runs_nothing_and_keeps_place() {
    for (behavior, with_place) in [("allowAndName", true), ("deny", false)] {
        paused().block_on(async {
            let lab = Lab::new(false);
            let (first, second) = (Calls::default(), Calls::default());
            lab.browser
                .run(
                    &wait_spec(),
                    &opts("A", Some(place_fn(&first, |_, _| Ok("first.txt".into())))),
                )
                .await;
            lab.fail.lock().unwrap().push(behavior.to_owned());
            let before = lab.server().log.sent().len();
            let place = with_place.then(|| place_fn(&second, |_, _| Ok("second.txt".into())));
            let r = lab.browser.run(&wait_spec(), &opts("A", place)).await;
            assert!(!r.truthy("ok"), "{behavior}");
            assert_eq!(r.get("results"), Some(&Json::Arr(vec![])));
            let Some(Json::Value(Value::String(e))) = r.get("error") else {
                panic!("error 없음")
            };
            assert_eq!(
                e,
                "다운로드 설정에 실패해 실행하지 않았습니다: CDP 설정 거절"
            );
            let after: Vec<String> = lab.server().log.methods().split_off(before);
            assert_eq!(
                after,
                ["Browser.setDownloadBehavior"],
                "{behavior}: 액션 0개"
            );
            lab.stage("g8");
            let s = lab.server();
            s.emit(
                "Page.downloadWillBegin",
                begin("g8", "f.txt", "target-1"),
                Some("session-target-1"),
            );
            s.emit(
                "Page.downloadProgress",
                progress("g8", "completed"),
                Some("session-target-1"),
            );
            tick().await;
            assert_eq!(
                (first.lock().unwrap().len(), second.lock().unwrap().len()),
                (1, 0),
                "{behavior}"
            );
            lab.browser.dispose().await;
        });
    }
}
