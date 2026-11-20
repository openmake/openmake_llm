//! 호스트 스레드·디스패처 스레드·패닉 처리(PR-3.2 D-225·D-226).
//!
//! - 호스트 스레드(`omk-ffi-host`) 하나가 `omk_bridge_host::serve` 를 돌린다(런타임 소유 → Swift 가 놓는 스레드에서 런타임이
//!   drop 되지 않는다). 끝나면 런타임 정리·잠금 해제 **뒤** `Exited{code}` 를 마지막으로 넣고 이벤트 채널을 닫는다.
//! - 디스패처 스레드(`omk-ffi-events`) 하나가 이벤트를 차례로 `on_event` 한다 — 헬퍼의 stdout 쓰기 스레드와 같은 한 줄 순서.
//! - 패닉 훅은 프로세스를 끝내지 않는다. 위치만 찍고 살아 있는 모든 호스트에 표식 + `Abort` → 종료 순서 → `Exited{101}`.
//!   tokio 가 삼키는 태스크 패닉도 이 길로 호스트를 내린다(태스크 하나만 죽고 사는 상태를 만들지 않는다 — D-98).
#![forbid(unsafe_code)]

use std::cell::Cell;
use std::ffi::OsString;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc as std_mpsc;
use std::sync::{Arc, Mutex, MutexGuard, Once, PoisonError};
use std::time::Duration;

use omk_bridge_conn::runtime::host_runtime;
use omk_bridge_host::command::Command;
use omk_bridge_host::event::{Emit, Event, INSTANCE_LOCK_FAILED_TEXT};
use omk_bridge_host::host::{API_KEY_ENV, env_snapshot};
use omk_bridge_host::serve::{self, Input, Rx, ServeArgs, Tx};

use crate::convert;
use crate::ffi::{Endpoints, HostConfig, HostEvent, HostListener, HostStartError};

/// 주소 찾기 뒤 런타임 정리 한도(헬퍼 `--resolve` 와 같은 값).
const RESOLVE_SHUTDOWN_MS: u64 = serve::RUNTIME_SHUTDOWN_MS;

/// 환경에 키 이름이 있는가(값이 비어도 있음으로 본다 — 헬퍼 D-95 와 같은 규칙).
pub(crate) fn key_in_env(names: impl IntoIterator<Item = OsString>) -> bool {
    names.into_iter().any(|k| k == API_KEY_ENV)
}

/// 시작 전 거절 — 환경 키(헬퍼 exit 2), 빈 키(헬퍼의 `auth` 없음).
pub(crate) fn check(key: &str) -> Result<(), HostStartError> {
    if key_in_env(std::env::vars_os().map(|(k, _)| k)) {
        return Err(HostStartError::KeyInEnvironment);
    }
    if key.is_empty() {
        return Err(HostStartError::ApiKeyRequired);
    }
    Ok(())
}

/// 제품 serve — 신호·stdin 은 달지 않는다(D-228).
pub(crate) fn serve_product(args: ServeArgs, emit: Emit, tx: Tx, rx: Rx) -> i32 {
    serve::serve(args, emit, tx, rx, |_| {})
}

pub(crate) fn resolve(server: &str) -> Option<Endpoints> {
    let rt = host_runtime().ok()?;
    let e = rt.block_on(omk_bridge_host::discover(server));
    rt.shutdown_timeout(Duration::from_millis(RESOLVE_SHUTDOWN_MS));
    Some(Endpoints {
        bridge_url: e.bridge_url,
        web_url: e.web_url,
        discovered: e.discovered,
    })
}

// ── 살아 있는 호스트 등록표(D-225 ④, 검토 r3 Low-2) ─────────────────────────────────────────────────────────────

struct Entry {
    id: u64,
    tx: Tx,
    panicked: Arc<AtomicBool>,
}

static REGISTRY: Mutex<Vec<Entry>> = Mutex::new(Vec::new());
/// 등록표를 쥔 스레드가 패닉한 경우(훅이 같은 스레드에서 다시 잡으면 교착) — 쥔 쪽이 놓을 때 처리한다.
static PENDING_ABORT: AtomicBool = AtomicBool::new(false);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

thread_local! {
    static HOLDING: Cell<bool> = const { Cell::new(false) };
}

/// 등록표 잠금 — 쥔 동안 이 스레드에 표시하고, 놓은 **뒤** 보류된 패닉이 있으면 처리한다(놓기 직전 확인은 다른 스레드의 표식을
/// 놓칠 수 있다 — 검토 r3 Low-2). 다른 스레드의 훅은 잠금을 기다리므로(교착 없음) 보류는 같은 스레드 패닉뿐이다.
struct Held(Option<MutexGuard<'static, Vec<Entry>>>);

fn hold() -> Held {
    let g = REGISTRY.lock().unwrap_or_else(PoisonError::into_inner);
    HOLDING.with(|h| h.set(true));
    Held(Some(g))
}

impl Drop for Held {
    fn drop(&mut self) {
        HOLDING.with(|h| h.set(false));
        drop(self.0.take());
        if PENDING_ABORT.swap(false, Ordering::SeqCst) {
            abort_all();
        }
    }
}

fn abort_all() {
    let mut h = hold();
    for e in h.0.iter_mut().flat_map(|v| v.iter()) {
        e.panicked.store(true, Ordering::SeqCst);
        let _ = e.tx.send(Input::Abort);
    }
}

fn register(tx: Tx, panicked: Arc<AtomicBool>) -> u64 {
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let mut h = hold();
    if let Some(v) = h.0.as_mut() {
        v.push(Entry { id, tx, panicked });
    }
    id
}

fn unregister(id: u64) {
    let mut h = hold();
    if let Some(v) = h.0.as_mut() {
        v.retain(|e| e.id != id);
    }
}

#[cfg(test)]
fn registered() -> usize {
    let h = hold();
    h.0.as_ref().map_or(0, |v| v.len())
}

/// 패닉 훅(프로세스에서 한 번) — stderr 에 위치만(메시지 값 없음, D-98 과 같은 원칙), 프로세스는 끝내지 않는다.
pub(crate) fn install_panic_hook() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            let (file, line) = info.location().map_or(("?", 0), |l| (l.file(), l.line()));
            eprintln!("omk-ffi: 내부 오류 ({file}:{line})");
            // 이 스레드가 등록표를 쥐고 있으면 다시 잡지 않는다(교착) — 놓을 때 처리된다.
            if HOLDING.try_with(Cell::get).unwrap_or(true) {
                PENDING_ABORT.store(true, Ordering::SeqCst);
            } else {
                abort_all();
            }
        }));
    });
}

// ── 시작 ─────────────────────────────────────────────────────────────────────────────────────────────────────

/// 이벤트 보내는 쪽 — 호스트 스레드가 `Exited` 를 넣으며 꺼내 닫는다. 그 뒤(정리 상한을 넘긴 태스크 등)의 이벤트는 버린다
/// (`Exited` 가 언제나 마지막).
type Gate = Arc<Mutex<Option<std_mpsc::Sender<HostEvent>>>>;

fn send_through(gate: &Gate, e: HostEvent) {
    if let Some(s) = gate.lock().unwrap_or_else(PoisonError::into_inner).as_ref() {
        let _ = s.send(e);
    }
}

/// 호스트를 띄우고 actor 채널의 보내는 쪽을 돌려준다. 키는 첫 입력(`Auth`)으로 넣는다. `home` 이 없으면 지원 폴더를 못 만든
/// 것과 같은 잠금 실패(헬퍼와 같다). `serve_fn` 은 제품에선 [`serve_product`], 시험에선 패닉하는 함수.
pub(crate) fn start_with<S>(
    config: HostConfig,
    key: String,
    listener: Box<dyn HostListener>,
    home: Option<String>,
    serve_fn: S,
) -> Result<Tx, HostStartError>
where
    S: FnOnce(ServeArgs, Emit, Tx, Rx) -> i32 + Send + 'static,
{
    let (tx, rx) = serve::channel();
    let _ = tx.send(Input::Command(Command::Auth(key)));
    let (ev_tx, ev_rx) = std_mpsc::channel::<HostEvent>();
    std::thread::Builder::new()
        .name("omk-ffi-events".into())
        .spawn(move || {
            for e in ev_rx {
                listener.on_event(e);
            }
        })
        .map_err(|_| HostStartError::ThreadFailed)?;
    let gate: Gate = Arc::new(Mutex::new(Some(ev_tx)));
    let g = Arc::clone(&gate);
    let emit = Emit::new(move |e: Event| send_through(&g, convert::event(e)));
    let panicked = Arc::new(AtomicBool::new(false));
    let id = register(tx.clone(), Arc::clone(&panicked));
    let t = tx.clone();
    let spawned = std::thread::Builder::new()
        .name("omk-ffi-host".into())
        .spawn(move || {
            // 마지막 보장 — `block_on` 밖(지원 폴더·잠금·id) 패닉이어도 `Exited{101}` 이 나간다. actor 패닉은 serve 안에서
            // 잡혀 정상 정리 순서를 밟는다(D-225(r2) ③).
            let code = catch_unwind(AssertUnwindSafe(|| match home {
                Some(home) => serve_fn(
                    ServeArgs {
                        server: config.server,
                        home,
                        browser_enabled: config.browser_enabled,
                        env: env_snapshot(),
                    },
                    emit,
                    t,
                    rx,
                ),
                None => {
                    emit.emit(Event::status_global(
                        INSTANCE_LOCK_FAILED_TEXT,
                        "instance_lock_failed",
                    ));
                    serve::INSTANCE_EXIT
                }
            }))
            .unwrap_or(serve::PANIC_EXIT);
            let code = if panicked.load(Ordering::SeqCst) {
                serve::PANIC_EXIT
            } else {
                code
            };
            unregister(id);
            let last = gate.lock().unwrap_or_else(PoisonError::into_inner).take();
            if let Some(s) = last {
                let _ = s.send(HostEvent::Exited { code });
            }
        });
    if spawned.is_err() {
        unregister(id);
        return Err(HostStartError::ThreadFailed);
    }
    Ok(tx)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use std::ffi::OsString;
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};

    use omk_bridge_host::event::{Emit, Event};
    use omk_bridge_host::serve::{self, Rx, ServeArgs, Tx};

    use super::{install_panic_hook, key_in_env, registered, serve_product, start_with};
    use crate::ffi::{BridgeHost, HostConfig, HostEvent, HostListener};

    type Seen = Arc<(Mutex<Vec<HostEvent>>, Condvar)>;

    struct Collect(Seen);

    impl HostListener for Collect {
        fn on_event(&self, e: HostEvent) {
            let (m, cv) = &*self.0;
            m.lock().unwrap().push(e);
            cv.notify_all();
        }
    }

    fn wait(seen: &Seen, pred: impl Fn(&[HostEvent]) -> bool) -> Vec<HostEvent> {
        let (m, cv) = &**seen;
        let end = Instant::now() + Duration::from_secs(8);
        let mut g = m.lock().unwrap();
        while !pred(&g) {
            let left = end.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "{:?}", *g);
            g = cv.wait_timeout(g, left).unwrap().0;
        }
        g.clone()
    }

    fn exited(evs: &[HostEvent]) -> bool {
        evs.iter().any(|e| matches!(e, HostEvent::Exited { .. }))
    }

    fn config() -> HostConfig {
        HostConfig {
            server: "http://127.0.0.1:9".into(),
            browser_enabled: false,
        }
    }

    struct Home(std::path::PathBuf);

    impl Home {
        fn new(tag: &str) -> Home {
            let p = std::env::temp_dir().join(format!("omk-ffi-{tag}-{}", std::process::id()));
            std::fs::create_dir_all(&p).unwrap();
            Home(std::fs::canonicalize(&p).unwrap())
        }

        fn s(&self) -> Option<String> {
            Some(self.0.to_string_lossy().into_owned())
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 자식 프로세스(이 테스트 바이너리 재실행)에서 시험 하나를 돌린다 — 패닉 훅·패닉 출력 격리.
    fn in_child(name: &str, marker: &str) -> String {
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", name, "--test-threads=1", "--nocapture"])
            .env(marker, "1")
            .output()
            .unwrap();
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(out.status.success() && text.contains("1 passed"), "{text}");
        text
    }

    /// T-F2 — 환경 키 판정은 이름으로(빈 값도 있음).
    #[test]
    fn key_in_env_by_name() {
        let n = |v: &[&str]| v.iter().map(OsString::from).collect::<Vec<_>>();
        assert!(key_in_env(n(&["PATH", "OMK_COMPANION_API_KEY"])));
        assert!(!key_in_env(n(&[
            "PATH",
            "OMK_COMPANION_API_KEY_X",
            "omk_companion_api_key"
        ])));
        assert!(!key_in_env(n(&[])));
    }

    /// T-F3 — 시작 → idle·endpoints → connect → connected → shutdown → … → `Exited{0}` 가 마지막, 그 뒤 이벤트 0.
    #[test]
    fn events_in_order_and_exited_last() {
        let home = Home::new("order");
        let root = home.0.join("root");
        std::fs::create_dir_all(&root).unwrap();
        let root = root.to_string_lossy().into_owned();
        let seen: Seen = Arc::default();
        let tx = start_with(
            config(),
            "omk_live_ffi_test".into(),
            Box::new(Collect(Arc::clone(&seen))),
            home.s(),
            serve_product,
        )
        .unwrap();
        let h = BridgeHost { tx };
        h.connect(root.clone()).unwrap();
        wait(&seen, |e| {
            e.iter().any(|x| matches!(x, HostEvent::Connected { .. }))
        });
        h.shutdown().unwrap();
        let evs = wait(&seen, exited);
        std::thread::sleep(Duration::from_millis(300));
        let after = seen.0.lock().unwrap().clone();
        assert_eq!(after.len(), evs.len(), "Exited 뒤 이벤트 없음: {after:?}");
        let ordered: Vec<&HostEvent> = after
            .iter()
            .filter(|e| {
                !matches!(
                    e,
                    HostEvent::Status {
                        folder: Some(_),
                        ..
                    }
                )
            })
            .collect();
        let idle = HostEvent::Status {
            folder: None,
            text: omk_bridge_host::event::IDLE_TEXT.into(),
            code: "idle".into(),
            arg: None,
        };
        assert_eq!(
            ordered,
            [
                &idle,
                &HostEvent::Endpoints {
                    bridge_url: "http://127.0.0.1:9".into(),
                    web_url: "http://127.0.0.1:9".into(),
                    discovered: false
                },
                &HostEvent::Connected {
                    folder: root.clone()
                },
                &HostEvent::Disconnected { folder: root },
                &HostEvent::AutoApprove { count: 0 },
                &idle,
                &HostEvent::Exited { code: 0 },
            ]
        );
        drop(h);
    }

    /// T-F5 — `shutdown` 없이 놓기만 해도 입력 끝과 같은 종료 → `Exited{0}`.
    #[test]
    fn drop_ends_like_eof() {
        let home = Home::new("drop");
        let seen: Seen = Arc::default();
        let tx = start_with(
            config(),
            "omk_live_ffi_test".into(),
            Box::new(Collect(Arc::clone(&seen))),
            home.s(),
            serve_product,
        )
        .unwrap();
        wait(&seen, |e| {
            e.iter().any(|x| matches!(x, HostEvent::Endpoints { .. }))
        });
        drop(BridgeHost { tx });
        let evs = wait(&seen, exited);
        assert_eq!(evs.last(), Some(&HostEvent::Exited { code: 0 }));
    }

    /// 홈이 없으면 잠금 실패와 같은 신호 → `Exited{3}`.
    #[test]
    fn no_home_is_lock_failure() {
        let seen: Seen = Arc::default();
        let _tx = start_with(
            config(),
            "omk_live_ffi_test".into(),
            Box::new(Collect(Arc::clone(&seen))),
            None,
            serve_product,
        )
        .unwrap();
        let evs = wait(&seen, exited);
        assert!(
            matches!(&evs[0], HostEvent::Status { code, .. } if code == "instance_lock_failed")
        );
        assert_eq!(evs.last(), Some(&HostEvent::Exited { code: 3 }));
    }

    const F6: &str = "OMK_FFI_F6_CHILD";

    /// T-F6 — serve 패닉(값이 섞인 메시지) → 앞선 이벤트 뒤 `Exited{101}`, ≤3초, 프로세스 생존, stderr 에 메시지 값 없음.
    #[test]
    fn serve_panic_exits_101() {
        if std::env::var_os(F6).is_none() {
            let text = in_child("run::tests::serve_panic_exits_101", F6);
            assert!(text.contains("omk-ffi: 내부 오류 ("), "{text}");
            assert!(!text.contains("omk_live_secret"), "{text}");
            return;
        }
        install_panic_hook();
        let seen: Seen = Arc::default();
        let t = Instant::now();
        let _tx = start_with(
            config(),
            "omk_live_ffi_test".into(),
            Box::new(Collect(Arc::clone(&seen))),
            Some("/nonexistent".into()),
            |_: ServeArgs, emit: Emit, _: Tx, _: Rx| -> i32 {
                emit.emit(Event::status_global("앞", "idle"));
                panic!("secret omk_live_secret");
            },
        )
        .unwrap();
        let evs = wait(&seen, exited);
        assert!(t.elapsed() <= Duration::from_secs(3), "{:?}", t.elapsed());
        assert_eq!(evs.len(), 2, "{evs:?}");
        assert!(matches!(&evs[0], HostEvent::Status { text, .. } if text == "앞"));
        assert_eq!(evs[1], HostEvent::Exited { code: 101 });
        assert_eq!(registered(), 0);
    }

    const F7: &str = "OMK_FFI_F7_CHILD";

    /// T-F7 — 호스트 런타임의 태스크 패닉(tokio 가 삼킨다) → 훅 → 살아 있는 호스트 **둘 다** 종료 순서 → `Exited{101}`,
    /// 등록표가 빈다.
    #[test]
    fn task_panic_takes_all_hosts_down() {
        if std::env::var_os(F7).is_none() {
            in_child("run::tests::task_panic_takes_all_hosts_down", F7);
            return;
        }
        install_panic_hook();
        let (h1, h2) = (Home::new("f7a"), Home::new("f7b"));
        let (s1, s2): (Seen, Seen) = (Arc::default(), Arc::default());
        let _a = start_with(
            config(),
            "omk_live_ffi_test".into(),
            Box::new(Collect(Arc::clone(&s1))),
            h1.s(),
            serve_product,
        )
        .unwrap();
        wait(&s1, |e| {
            e.iter().any(|x| matches!(x, HostEvent::Endpoints { .. }))
        });
        let _b = start_with(
            config(),
            "omk_live_ffi_test".into(),
            Box::new(Collect(Arc::clone(&s2))),
            h2.s(),
            |a: ServeArgs, e: Emit, t: Tx, r: Rx| {
                serve::serve(a, e, t, r, |_| {
                    tokio::spawn(async {
                        tokio::time::sleep(Duration::from_millis(300)).await;
                        panic!("태스크 패닉");
                    });
                })
            },
        )
        .unwrap();
        let e1 = wait(&s1, exited);
        let e2 = wait(&s2, exited);
        assert_eq!(e1.last(), Some(&HostEvent::Exited { code: 101 }));
        assert_eq!(e2.last(), Some(&HostEvent::Exited { code: 101 }));
        assert_eq!(registered(), 0);
    }
}
