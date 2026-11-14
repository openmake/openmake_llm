//! 실행 조정(TS `local-browser-scheduler.ts`) — 같은 작업 순서·동시 실행 상한·다운로드 폴더·중지 세대·future 를 버려도 자리 반환.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use omk_bridge_core::browser::constants::BROWSER_MAX_CONCURRENT;
use omk_bridge_core::browser::scheduler::BrowserScheduler;
use support::browser::paused;
use tokio::sync::oneshot;

type Log = Arc<Mutex<Vec<String>>>;

/// 시작을 적고 문이 열릴 때까지 기다리는 실행 — 끝나면 이름을 돌려준다.
fn job(
    sched: &Arc<BrowserScheduler>,
    log: &Log,
    key: &str,
    dir: &str,
    name: &str,
) -> (tokio::task::JoinHandle<String>, oneshot::Sender<()>) {
    let (open, gate) = oneshot::channel::<()>();
    let (s, l, k, d, n) = (
        sched.clone(),
        log.clone(),
        key.to_owned(),
        dir.to_owned(),
        name.to_owned(),
    );
    let h = tokio::spawn(async move {
        s.run(&k, &d, async {
            l.lock().unwrap().push(n.clone());
            let _ = gate.await;
            n.clone()
        })
        .await
    });
    (h, open)
}

async fn settle() {
    tokio::time::sleep(Duration::from_millis(1)).await;
}

fn started(log: &Log) -> Vec<String> {
    log.lock().unwrap().clone()
}

#[test]
fn same_task_runs_in_order() {
    paused().block_on(async {
        let (s, log) = (Arc::new(BrowserScheduler::default()), Log::default());
        let (h1, o1) = job(&s, &log, "A", "/d", "a1");
        let (h2, o2) = job(&s, &log, "A", "/d", "a2");
        let (h3, o3) = job(&s, &log, "B", "/d", "b1");
        settle().await;
        assert_eq!(started(&log), ["a1", "b1"], "a2 는 a1 뒤");
        assert!(s.is_running("A") && s.is_running("B"));
        o2.send(()).unwrap(); // 먼저 열어도 차례가 아니면 시작하지 않는다
        settle().await;
        assert_eq!(started(&log), ["a1", "b1"]);
        o1.send(()).unwrap();
        assert_eq!(h1.await.unwrap(), "a1");
        assert_eq!(h2.await.unwrap(), "a2");
        assert_eq!(started(&log), ["a1", "b1", "a2"]);
        o3.send(()).unwrap();
        h3.await.unwrap();
        assert!(!s.is_running("A") && !s.is_running("B"));
    });
}

#[test]
fn at_most_three_at_once() {
    paused().block_on(async {
        let (s, log) = (Arc::new(BrowserScheduler::default()), Log::default());
        let jobs: Vec<_> = ["A", "B", "C", "D"]
            .iter()
            .map(|k| job(&s, &log, k, "/d", k))
            .collect();
        settle().await;
        assert_eq!(started(&log).len(), BROWSER_MAX_CONCURRENT);
        assert!(!s.is_running("D"));
        let mut jobs = jobs.into_iter();
        let (h, o) = jobs.next().unwrap();
        o.send(()).unwrap();
        h.await.unwrap();
        settle().await;
        assert_eq!(started(&log), ["A", "B", "C", "D"]);
        for (h, o) in jobs {
            o.send(()).unwrap();
            h.await.unwrap();
        }
    });
}

#[test]
fn different_download_dirs_do_not_overlap() {
    paused().block_on(async {
        let (s, log) = (Arc::new(BrowserScheduler::default()), Log::default());
        let (ha, oa) = job(&s, &log, "A", "/one", "A");
        settle().await;
        let (hb, ob) = job(&s, &log, "B", "/two", "B");
        let (hc, oc) = job(&s, &log, "C", "/one", "C");
        settle().await;
        // 같은 폴더(C)는 함께, 다른 폴더(B)는 기다린다 — TS 그대로(먼저 온 B 보다 C 가 먼저 돌 수 있다)
        assert_eq!(started(&log), ["A", "C"]);
        oa.send(()).unwrap();
        ha.await.unwrap();
        settle().await;
        assert_eq!(started(&log), ["A", "C"], "C 가 남아 있으면 B 는 아직");
        oc.send(()).unwrap();
        hc.await.unwrap();
        settle().await;
        assert_eq!(started(&log), ["A", "C", "B"]);
        ob.send(()).unwrap();
        hb.await.unwrap();
    });
}

#[test]
fn stop_generations() {
    let s = Arc::new(BrowserScheduler::default());
    let a = s.stop_check("A");
    let b = s.stop_check("B");
    s.request_stop(Some("B"));
    assert!(!a.stopped() && b.stopped(), "작업별 중지는 그 작업만");
    let a2 = s.stop_check("A");
    s.request_stop(Some("A"));
    assert!(a.stopped() && a2.stopped());
    let a3 = s.stop_check("A");
    assert!(!a3.stopped(), "중지 뒤 새로 시작한 요청은 멈추지 않는다");
    // forget 은 기록을 지운다 — 기록이 있던 때 시작한 요청은 값이 달라져 멈춘 것으로 본다(TS 그대로)
    s.forget_task("A");
    assert!(a3.stopped());
    let a4 = s.stop_check("A");
    let c = s.stop_check("C");
    s.request_stop(None);
    assert!(a4.stopped() && c.stopped(), "전체 중지는 모두");
    assert!(!s.stop_check("C").stopped());
}

/// 실행 중인 future 를 버려도(호출부 취소) 실행 자리와 줄의 차례가 돌아온다. 기다리던 차례표를 버려도 줄이 이어진다.
#[test]
fn dropped_futures_return_their_place() {
    paused().block_on(async {
        let (s, log) = (Arc::new(BrowserScheduler::default()), Log::default());
        let (h1, _o1) = job(&s, &log, "A", "/d", "a1");
        let (h2, _o2) = job(&s, &log, "A", "/d", "a2");
        let (h3, o3) = job(&s, &log, "A", "/d", "a3");
        settle().await;
        assert_eq!(started(&log), ["a1"]);
        h2.abort(); // 줄에서 기다리던 것
        settle().await;
        h1.abort(); // 실행 중이던 것
        settle().await;
        assert_eq!(started(&log), ["a1", "a3"]);
        assert!(s.is_running("A"));
        o3.send(()).unwrap();
        h3.await.unwrap();
        assert!(!s.is_running("A"));
        // 상한도 새지 않았다 — 셋이 다시 함께 돈다
        let more: Vec<_> = ["X", "Y", "Z"]
            .iter()
            .map(|k| job(&s, &log, k, "/d", k))
            .collect();
        settle().await;
        assert_eq!(started(&log).len(), 5);
        for (h, o) in more {
            o.send(()).unwrap();
            h.await.unwrap();
        }
    });
}

#[test]
fn failed_request_keeps_the_chain() {
    paused().block_on(async {
        let s = Arc::new(BrowserScheduler::default());
        let r1: Result<(), String> = s.run("A", "/d", async { Err("실패".to_owned()) }).await;
        assert!(r1.is_err());
        let r2: Result<u8, String> = s.run("A", "/d", async { Ok(2) }).await;
        assert_eq!(r2, Ok(2));
    });
}

#[test]
fn next_release_wakes_after_a_run_ends() {
    paused().block_on(async {
        let (s, log) = (Arc::new(BrowserScheduler::default()), Log::default());
        let (h, o) = job(&s, &log, "A", "/d", "a");
        settle().await;
        let wake = s.next_release();
        let woke = Arc::new(Mutex::new(false));
        let w = woke.clone();
        let waiter = async move {
            wake.await;
            *w.lock().unwrap() = true;
        };
        let opener = async {
            settle().await;
            assert!(!*woke.lock().unwrap());
            o.send(()).unwrap();
        };
        futures_util::future::join(waiter, opener).await;
        assert!(*woke.lock().unwrap());
        h.await.unwrap();
    });
}
