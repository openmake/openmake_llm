//! OpenMake Companion 헬퍼 — Node 헬퍼(`apps/desktop-native/helper/src/helper.mjs`)와 같은 stdio JSON-lines 계약(PR-1.7).
//! 판정 로직은 없다 — 코어(`omk-bridge-core`)·연결(`omk-bridge-conn`)을 호스트 값으로 잇기만 한다. 계약 대조표는
//! `.superpowers/sdd/2026-11-15-openmake-code-pr1-7/plan-pr1.7.md` §4, Node 와 다른 점은 같은 문서 D-106.
//!
//! 로거는 설치하지 않는다(D-98) — 의존 크레이트의 `log` 기록(핸드셰이크의 Authorization·CDP 프레임)이 찍힐 길이 없다.
//! stderr 에 쓰는 것은 고정 문구 셋뿐이다: 기동 실패, `OMK_COMPANION_API_KEY` 가 환경에 있음, 패닉 위치.

pub mod args;
pub mod commands;
pub mod events;
pub mod stdio;

use std::time::Duration;

use omk_bridge_conn::runtime::host_runtime;
use omk_bridge_host::event::{Emit, Event, INSTANCE_LOCK_FAILED_TEXT};
use omk_bridge_host::host;
use omk_bridge_host::serve::{self, Input, ServeArgs, Tx};
use tokio::signal::unix::{SignalKind, signal};

/// 종료 직전 stdout 을 비우는 한도.
pub const STDOUT_FLUSH_MS: u64 = serve::FLUSH_MS;
/// 종료 때 런타임이 태스크를 버리고 블록된 작업을 기다리는 한도.
pub const RUNTIME_SHUTDOWN_MS: u64 = serve::RUNTIME_SHUTDOWN_MS;
/// 패닉 종료 코드(Rust 기본과 같다).
pub const PANIC_EXIT: i32 = serve::PANIC_EXIT;
/// 잠금을 못 잡아 끝남(`instance_conflict`·`instance_lock_failed`).
pub const INSTANCE_EXIT: i32 = serve::INSTANCE_EXIT;

/// stderr 고정 문구 ① — 입력·경로·오류 원문을 싣지 않는다.
fn start_failed() -> i32 {
    eprintln!("omk-helper: 기동 실패");
    serve::START_FAILED_EXIT
}

/// 패닉 훅 — 기본 훅은 패닉 메시지(값이 섞일 수 있다)를 찍는다. 위치만 찍고 프로세스를 끝낸다(태스크 하나만 죽고 프로세스가
/// 사는 상태를 만들지 않는다 — Node 의 잡히지 않은 예외와 같은 범위).
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let (file, line) = info.location().map_or(("?", 0), |l| (l.file(), l.line()));
        eprintln!("omk-helper: 내부 오류 ({file}:{line})");
        std::process::exit(PANIC_EXIT);
    }));
}

/// SIGTERM·SIGINT → actor 의 입력 끝(stdin 끝과 같은 종료). 처리기를 달지 못하면 그 신호는 기본 동작(죽음)대로 둔다.
/// 신호 처리기는 헬퍼(사이드카 프로세스)만 단다 — 호스트 크레이트는 앱 프로세스 안에서도 돌기 때문이다(PR-3.2 D-228).
fn forward_signals(tx: &Tx) {
    for kind in [SignalKind::terminate(), SignalKind::interrupt()] {
        if let Ok(mut s) = signal(kind) {
            let tx = tx.clone();
            tokio::spawn(async move {
                while s.recv().await.is_some() {
                    if !tx.send(Input::End) {
                        return;
                    }
                }
            });
        }
    }
}

/// 프로그램 이름을 뺀 인자로 실행하고 종료 코드를 돌려준다.
pub fn run(argv: &[String]) -> i32 {
    let args = args::parse(argv);
    // 키를 환경으로 받지 않는다 — 지울 수 없어(`remove_var` 는 unsafe) 자식(Chrome 포함)에 넘어간다(D-95). 조회 전용 실행은
    // 자식을 띄우지 않으므로 보지 않는다.
    if !args.resolve && std::env::var_os(host::API_KEY_ENV).is_some() {
        eprintln!(
            "omk-helper: OMK_COMPANION_API_KEY 는 쓰지 않는다 — 키는 stdin 의 auth 명령으로 준다"
        );
        return 2;
    }
    let out = stdio::Emitter::spawn();
    if args.resolve {
        return resolve(&args.server, &out);
    }
    // 홈을 못 찾으면 지원 폴더를 못 만든 것과 같은 신호(잠금 실패)로 끝난다 — 종전과 같다.
    let Some(home) = std::env::home_dir().and_then(|h| h.to_str().map(str::to_owned)) else {
        out.emit(events::line(&Event::status_global(
            INSTANCE_LOCK_FAILED_TEXT,
            "instance_lock_failed",
        )));
        out.flush(Duration::from_millis(STDOUT_FLUSH_MS));
        return INSTANCE_EXIT;
    };
    let flush_out = out.clone();
    let emit = Emit::new(move |e| out.emit(events::line(&e)))
        .with_flush(move |limit| flush_out.flush(limit));
    let (tx, rx) = serve::channel();
    let code = serve::serve(
        ServeArgs {
            server: args.server,
            home,
            browser_enabled: host::browser_from_env(),
            env: host::env_snapshot(),
        },
        emit,
        tx,
        rx,
        |tx| {
            forward_signals(tx);
            let t = tx.clone();
            // stdin 읽기는 OS 스레드라 런타임 정리가 기다리지 않는다.
            stdio::spawn_stdin_reader(move |i| {
                t.send(match i {
                    stdio::Input::Line(l) => match commands::parse(&l) {
                        Some(c) => Input::Command(c),
                        None => return true,
                    },
                    stdio::Input::End => Input::End,
                })
            });
        },
    );
    if code == serve::START_FAILED_EXIT {
        return start_failed();
    }
    code
}

/// `--resolve` — 한 줄만(`status idle`·`endpoints` 이벤트를 섞지 않는다 — 앱은 stdout 전체를 JSON 하나로 읽는다). stdin 을
/// 읽지 않는다.
fn resolve(server: &str, out: &stdio::Emitter) -> i32 {
    let Ok(rt) = host_runtime() else {
        return start_failed();
    };
    if host::prepare_support_dir().is_none() {
        return start_failed();
    }
    let e = rt.block_on(omk_bridge_host::discover(server));
    out.emit(events::resolve_line(&e));
    out.flush(Duration::from_millis(STDOUT_FLUSH_MS));
    rt.shutdown_timeout(Duration::from_millis(RUNTIME_SHUTDOWN_MS));
    0
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    const CHILD: &str = "OMK_HELPER_PANIC_CHILD";

    /// 자식(이 테스트 바이너리 자신)에서 훅을 달고 값이 섞인 패닉을 낸다.
    #[test]
    #[ignore = "panic_hook_prints_location_only 가 자식으로만 돌린다"]
    fn panic_child() {
        if std::env::var_os(CHILD).is_some() {
            super::install_panic_hook();
            panic!("secret-value omk_live_x");
        }
    }

    /// D-98 — 패닉은 위치 한 줄 + exit 101. 패닉 메시지(값)는 찍지 않는다.
    #[test]
    fn panic_hook_prints_location_only() {
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tests::panic_child",
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(super::PANIC_EXIT));
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(
            err.contains("omk-helper: 내부 오류 (crates/omk-helper/src/lib.rs:"),
            "{err}"
        );
        assert!(
            !err.contains("secret-value")
                && !String::from_utf8_lossy(&out.stdout).contains("secret-value"),
            "{err}"
        );
    }

    /// D-98 — 로거를 설치하지 않는다(의존 크레이트의 `log` 기록이 꺼진 채다).
    #[test]
    fn no_logger_installed() {
        assert_eq!(log::max_level(), log::LevelFilter::Off);
    }
}
