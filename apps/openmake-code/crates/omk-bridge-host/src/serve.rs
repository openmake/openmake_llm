//! 실행 순서(PR-3.2 D-223) — 런타임 → 지원 폴더 → 잠금 → id → 호스트 → actor → 비우기 → 런타임 정리 → 잠금 해제.
//! 헬퍼(`omk-helper`)와 FFI(`omk-ffi`)가 이 함수 하나를 부른다.

use std::future::Future;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::time::Duration;

use omk_bridge_conn::device_id::DeviceIdentity;
use omk_bridge_conn::runtime::host_runtime;
use tokio::sync::mpsc;

use crate::app::{self, Msg};
use crate::command::Command;
use crate::event::{
    Emit, Event, INSTANCE_CONFLICT_TEXT, INSTANCE_LOCK_FAILED_TEXT, LOCK_WAIT_TEXT,
};
use crate::host::{Host, support_dir};
use crate::instance;

/// 종료 직전 이벤트를 비우는 한도.
pub const FLUSH_MS: u64 = 500;
/// 종료 때 런타임이 태스크를 버리고 블록된 작업을 기다리는 한도.
pub const RUNTIME_SHUTDOWN_MS: u64 = 1000;
/// 정상 종료.
pub const OK_EXIT: i32 = 0;
/// 기동 실패(런타임·지원 폴더 id).
pub const START_FAILED_EXIT: i32 = 1;
/// 잠금을 못 잡아 끝남(`instance_conflict`·`instance_lock_failed`).
pub const INSTANCE_EXIT: i32 = 3;
/// 패닉 종료 코드(Rust 기본과 같다).
pub const PANIC_EXIT: i32 = 101;

/// actor 로 들어가는 입력 — 명령, 입력 끝(stdin EOF·FFI 핸들 놓음·신호), 패닉 알림.
#[derive(Debug, PartialEq, Eq)]
pub enum Input {
    Command(Command),
    End,
    Abort,
}

/// actor 로 보내는 쪽 — 복제해 어댑터(stdin 읽기·신호·FFI 메서드)에 나눈다.
#[derive(Clone, Debug)]
pub struct Tx(pub(crate) mpsc::UnboundedSender<Msg>);

impl Tx {
    /// 받는 쪽(actor)이 끝났으면 `false`.
    pub fn send(&self, i: Input) -> bool {
        self.0.send(Msg::Input(i)).is_ok()
    }
}

/// actor 가 받는 쪽.
#[derive(Debug)]
pub struct Rx(pub(crate) mpsc::UnboundedReceiver<Msg>);

impl Rx {
    /// 시험·가짜 actor 용 — 쌓인 입력 하나(입력 아닌 내부 메시지는 건너뛴다).
    pub fn try_recv(&mut self) -> Option<Input> {
        while let Ok(m) = self.0.try_recv() {
            if let Msg::Input(i) = m {
                return Some(i);
            }
        }
        None
    }
}

/// actor 채널 — `serve` 전에 만들어 두면 기동 중에 온 명령도 잃지 않는다(actor 가 돌면 차례로 처리한다).
pub fn channel() -> (Tx, Rx) {
    let (tx, rx) = mpsc::unbounded_channel();
    (Tx(tx), Rx(rx))
}

pub struct ServeArgs {
    /// 앱 설정의 서버 주소(주소 찾기 전 글자).
    pub server: String,
    /// 지원 폴더(`<홈>/Library/Application Support/OpenMakeCompanion`)의 홈.
    pub home: String,
    /// 앱 설정 "브라우저 사용 허용".
    pub browser_enabled: bool,
    /// exec·도구 자식 환경의 원본(코어가 허용 목록으로 거른다).
    pub env: Vec<(String, String)>,
}

/// 끝날 때까지 돌고 종료 코드를 돌려준다(0 정상, 1 기동 실패, 3 잠금, 101 actor 패닉). `on_runtime` 은 잠금·id 를 잡은 뒤
/// actor 직전에 런타임 문맥 안에서 한 번 불린다(헬퍼가 신호 처리기·stdin 읽기를 단다).
pub fn serve(args: ServeArgs, emit: Emit, tx: Tx, rx: Rx, on_runtime: impl FnOnce(&Tx)) -> i32 {
    serve_with(args, emit, tx, rx, on_runtime, app::run)
}

/// [`serve`] 본문 — actor 를 인자로 받는다(시험이 패닉하는 actor 를 넣는다, PR-3.2 T-H8).
pub(crate) fn serve_with<F, Fut>(
    args: ServeArgs,
    emit: Emit,
    tx: Tx,
    rx: Rx,
    on_runtime: impl FnOnce(&Tx),
    actor: F,
) -> i32
where
    F: FnOnce(String, Host, Emit, Tx, Rx) -> Fut,
    Fut: Future<Output = i32>,
{
    let Ok(rt) = host_runtime() else {
        return START_FAILED_EXIT;
    };
    let support = support_dir(&args.home);
    // 잠금은 런타임 정리가 끝난 뒤에 푼다 — 정리 중인 Chrome·exec 자식·FS 작업이 남은 동안 다음 호스트가 같은 id·프로필을 잡지 않게.
    let mut held_lock = None;
    // 잠금 → id → 호스트 → 연결(설계 §3.3). 잠그기 전에는 id 파일·브라우저 프로필을 읽지도 쓰지도 않는다. 지원 폴더를
    // 못 만들면 잠금 실패와 같은 신호로 끝난다(앱이 안내와 "다시 시도" 를 보인다).
    let outcome = if std::fs::create_dir_all(&support).is_ok() {
        instance::acquire(&support, || {
            emit.emit(Event::status_global(LOCK_WAIT_TEXT, "connecting"));
        })
    } else {
        instance::Outcome::Failed
    };
    let code = match outcome {
        instance::Outcome::Held(lock) => {
            held_lock = Some(lock);
            match DeviceIdentity::load_or_create(&support) {
                Ok(identity) => {
                    let host = Host::new(
                        args.home,
                        &support,
                        identity,
                        args.browser_enabled,
                        args.env,
                    );
                    {
                        let _ctx = rt.enter();
                        on_runtime(&tx);
                    }
                    // 패닉은 `block_on` 만 감싸 잡는다(PR-3.2 D-225(r2) ③) — 그 뒤도 정상과 같은 순서(비우기 → 1초 상한 런타임
                    // 정리 → 잠금 해제)를 밟는다. 헬퍼는 패닉 훅이 먼저 프로세스를 끝내므로 여기 닿지 않는다.
                    let run = actor(args.server, host, emit.clone(), tx, rx);
                    catch_unwind(AssertUnwindSafe(|| rt.block_on(run))).unwrap_or(PANIC_EXIT)
                }
                Err(_) => START_FAILED_EXIT,
            }
        }
        instance::Outcome::Conflict(owner) => {
            emit.emit(Event::status_global_arg(
                INSTANCE_CONFLICT_TEXT,
                "instance_conflict",
                &owner,
            ));
            INSTANCE_EXIT
        }
        instance::Outcome::Failed => {
            emit.emit(Event::status_global(
                INSTANCE_LOCK_FAILED_TEXT,
                "instance_lock_failed",
            ));
            INSTANCE_EXIT
        }
    };
    emit.flush(Duration::from_millis(FLUSH_MS));
    // 남은 태스크를 버린다 — 띄우는 중인 Chrome·실행 중인 exec 자식은 `kill_on_drop` 으로 꺼진다. `shutdown_background` 는
    // 버리기 전에 프로세스가 끝나 경주였다(리뷰 r1 M-1). 블록된 FS 호출은 상한에서 포기한다.
    rt.shutdown_timeout(Duration::from_millis(RUNTIME_SHUTDOWN_MS));
    drop(held_lock);
    code
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use super::{Input, PANIC_EXIT, ServeArgs, channel, serve, serve_with};
    use crate::event::{Emit, Event, LOCK_WAIT_TEXT};

    const CHILD: &str = "OMK_HOST_PANIC_ACTOR_CHILD";

    fn args(home: &str) -> ServeArgs {
        ServeArgs {
            server: "http://127.0.0.1:9".into(),
            home: home.into(),
            browser_enabled: false,
            env: Vec::new(),
        }
    }

    /// T-H8(PR-3.2 D-225(r2) ③) — actor 패닉은 `block_on` 만 감싸 잡는다 → 101. 그 뒤는 정상 순서(비우기 → 런타임 정리 1초
    /// → 잠금 해제)라 반환 시점에 같은 홈의 둘째 `serve` 가 잠금 대기 없이 잡고, 반환까지 상한이 있다. 패닉 출력은 자식 프로세스로 격리.
    #[test]
    fn panicking_actor_returns_101_after_ordered_cleanup() {
        if std::env::var_os(CHILD).is_none() {
            let out = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "serve::tests::panicking_actor_returns_101_after_ordered_cleanup",
                    "--test-threads=1",
                ])
                .env(CHILD, "1")
                .output()
                .unwrap();
            let text = String::from_utf8_lossy(&out.stdout).into_owned();
            assert!(out.status.success() && text.contains("1 passed"), "{text}");
            return;
        }
        let home = std::env::temp_dir().join(format!("omk-host-panic-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        let home = home.to_string_lossy().into_owned();
        let (tx, rx) = channel();
        let t = Instant::now();
        let code = serve_with(
            args(&home),
            Emit::new(|_| {}),
            tx,
            rx,
            |_| {},
            |_, _, _, _, _| async {
                if t.elapsed() < Duration::from_secs(60) {
                    panic!("actor 패닉");
                }
                0
            },
        );
        assert_eq!(code, PANIC_EXIT);
        let took = t.elapsed();
        assert!(took <= Duration::from_millis(2500), "{took:?}");
        // 둘째 — 잠금이 이미 풀려 대기 문구 없이 잡는다.
        let seen: Arc<Mutex<Vec<Event>>> = Arc::default();
        let s = Arc::clone(&seen);
        let (tx, rx) = channel();
        assert!(tx.send(Input::End));
        let code = serve(
            args(&home),
            Emit::new(move |e| s.lock().unwrap().push(e)),
            tx,
            rx,
            |_| {},
        );
        assert_eq!(code, 0);
        let seen = seen.lock().unwrap();
        assert!(
            !seen
                .iter()
                .any(|e| matches!(e, Event::Status { text, .. } if text == LOCK_WAIT_TEXT)),
            "{seen:?}"
        );
        let _ = std::fs::remove_dir_all(&home);
    }
}
