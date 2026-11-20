//! 내보내는 선언과 전달만(PR-3.2 D-220). 명령 7종은 actor 채널에 넣기만 하고, 이벤트 10종 + `Exited` 는 [`HostListener`] 로
//! 차례대로 나간다. 내보내는 것은 모두 `Result` 다 — 비-throwing 이면 Swift 가 `try!` 로 불러 패닉이 앱 크래시가 된다(D-225 ②,
//! T0 U-4).

use std::fmt;
use std::sync::Arc;

use omk_bridge_host::command::Command;
use omk_bridge_host::serve::{Input, Tx};

use crate::{cloexec, convert, run};

/// 앱 설정 — 키는 넣지 않는다(생성된 Swift struct 는 `print`/`dump` 가 모든 필드를 찍는다, D-221).
#[derive(Debug, Clone, uniffi::Record)]
pub struct HostConfig {
    pub server: String,
    pub browser_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ConfirmChoice {
    Yes,
    All,
    No,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Endpoints {
    pub bridge_url: String,
    pub web_url: String,
    pub discovered: bool,
}

/// stdio `ev` 10종 + 프로세스 종료(`Exited` — 언제나 마지막, 헬퍼 종료 코드와 같은 값: 0·1·3·101).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum HostEvent {
    Status {
        folder: Option<String>,
        text: String,
        code: String,
        arg: Option<String>,
    },
    Endpoints {
        bridge_url: String,
        web_url: String,
        discovered: bool,
    },
    Connected {
        folder: String,
    },
    Disconnected {
        folder: String,
    },
    Confirm {
        id: u64,
        command: String,
        task_id: Option<String>,
        base: String,
        folder: String,
        sandbox: bool,
    },
    AutoApprove {
        count: u64,
    },
    TaskEnd {
        task_id: Option<String>,
        folder: String,
    },
    ApprovalPending {
        task_id: String,
        tool_name: String,
        folder: String,
    },
    BrowserControl {
        user: bool,
    },
    BrowserStopped,
    Exited {
        code: i32,
    },
}

/// 시작 거절 — 키 값을 싣지 않는다(D-229).
#[derive(Debug, PartialEq, Eq, uniffi::Error)]
pub enum HostStartError {
    /// 빈 키(헬퍼의 `auth` 없음과 같다).
    ApiKeyRequired,
    /// 환경에 `OMK_COMPANION_API_KEY` 가 있다 — 자식(Chrome)에 넘어가므로 기동하지 않는다(헬퍼 exit 2 와 같은 규칙).
    KeyInEnvironment,
    /// 호스트 스레드를 띄우지 못했다.
    ThreadFailed,
}

impl fmt::Display for HostStartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(self, f)
    }
}

impl std::error::Error for HostStartError {}

#[derive(Debug, PartialEq, Eq, uniffi::Error)]
pub enum HostError {
    /// 호스트가 이미 끝났다(`Exited` 를 냈다).
    Stopped,
    /// 런타임을 만들지 못했다(주소 찾기).
    Internal,
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(self, f)
    }
}

impl std::error::Error for HostError {}

/// 이벤트를 받는 쪽(Swift). 한 디스패처 스레드가 차례로 부른다 — 받는 쪽은 넘기기만 하고 기다리지 않는다(D-226).
#[uniffi::export(callback_interface)]
pub trait HostListener: Send + Sync {
    fn on_event(&self, event: HostEvent);
}

/// 실행 중인 호스트 하나. 놓으면(drop) stdin 끝과 같은 종료를 시작한다 — 끝은 `Exited` 로 안다.
#[derive(uniffi::Object)]
pub struct BridgeHost {
    pub(crate) tx: Tx,
}

impl fmt::Debug for BridgeHost {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BridgeHost")
    }
}

impl BridgeHost {
    fn command(&self, c: Command) -> Result<(), HostError> {
        if self.tx.send(Input::Command(c)) {
            Ok(())
        } else {
            Err(HostError::Stopped)
        }
    }
}

#[uniffi::export]
impl BridgeHost {
    /// 시작(= 기존 헬퍼 spawn + `auth`). 전용 스레드에서 돌고 곧바로 돌아온다. 키는 이 인자로만 받는다(D-221).
    #[uniffi::constructor]
    pub fn start(
        config: HostConfig,
        api_key: String,
        listener: Box<dyn HostListener>,
    ) -> Result<Arc<BridgeHost>, HostStartError> {
        run::check(&api_key)?;
        run::install_panic_hook();
        cloexec::install();
        let home = std::env::home_dir().and_then(|h| h.to_str().map(str::to_owned));
        let tx = run::start_with(config, api_key, listener, home, run::serve_product)?;
        Ok(Arc::new(BridgeHost { tx }))
    }

    pub fn connect(&self, folder: String) -> Result<(), HostError> {
        self.command(Command::Connect(folder))
    }

    /// `None` 이면 전체.
    pub fn disconnect(&self, folder: Option<String>) -> Result<(), HostError> {
        self.command(Command::Disconnect(folder))
    }

    pub fn answer_confirm(&self, id: u64, choice: ConfirmChoice) -> Result<(), HostError> {
        self.command(Command::Confirm {
            id,
            answer: convert::answer(choice),
        })
    }

    pub fn clear_auto_approve(&self) -> Result<(), HostError> {
        self.command(Command::ClearAutoApprove)
    }

    pub fn set_browser_user_control(&self, user: bool) -> Result<(), HostError> {
        self.command(Command::BrowserControl(user))
    }

    pub fn stop_browser(&self) -> Result<(), HostError> {
        self.command(Command::BrowserStop)
    }

    /// 종료 시작(`quit`). 끝은 `Exited`.
    pub fn shutdown(&self) -> Result<(), HostError> {
        self.command(Command::Quit)
    }
}

impl Drop for BridgeHost {
    fn drop(&mut self) {
        let _ = self.tx.send(Input::End);
    }
}

/// 기존 `--resolve` — 넣은 주소에서 연결·웹 주소를 정한다(블로킹, 5초 제한 — Swift 는 백그라운드 큐에서 부른다).
#[uniffi::export]
pub fn resolve_endpoints(server: String) -> Result<Endpoints, HostError> {
    run::install_panic_hook();
    run::resolve(&server).ok_or(HostError::Internal)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use omk_bridge_core::exec::ConfirmAnswer;
    use omk_bridge_host::command::Command;
    use omk_bridge_host::serve::{Input, channel};

    use super::{BridgeHost, ConfirmChoice, HostError, HostStartError};

    /// T-F4 — 메서드 7종 → 채널의 대응 명령(D-220 표), drop → 입력 끝(T-F5 의 앞 절반).
    #[test]
    fn methods_map_to_commands() {
        let (tx, mut rx) = channel();
        let h = BridgeHost { tx };
        h.connect("/a".into()).unwrap();
        h.disconnect(Some("/a".into())).unwrap();
        h.disconnect(None).unwrap();
        h.answer_confirm(7, ConfirmChoice::Yes).unwrap();
        h.answer_confirm(8, ConfirmChoice::All).unwrap();
        h.answer_confirm(9, ConfirmChoice::No).unwrap();
        h.clear_auto_approve().unwrap();
        h.set_browser_user_control(true).unwrap();
        h.stop_browser().unwrap();
        h.shutdown().unwrap();
        drop(h);
        let got: Vec<Input> = std::iter::from_fn(|| rx.try_recv()).collect();
        let c = Input::Command;
        assert_eq!(
            got,
            [
                c(Command::Connect("/a".into())),
                c(Command::Disconnect(Some("/a".into()))),
                c(Command::Disconnect(None)),
                c(Command::Confirm {
                    id: 7,
                    answer: ConfirmAnswer::Yes
                }),
                c(Command::Confirm {
                    id: 8,
                    answer: ConfirmAnswer::All
                }),
                c(Command::Confirm {
                    id: 9,
                    answer: ConfirmAnswer::No
                }),
                c(Command::ClearAutoApprove),
                c(Command::BrowserControl(true)),
                c(Command::BrowserStop),
                c(Command::Quit),
                Input::End,
            ]
        );
    }

    /// 끝난 호스트에 보내면 `Stopped`.
    #[test]
    fn stopped_host_reports_stopped() {
        let (tx, rx) = channel();
        drop(rx);
        let h = BridgeHost { tx };
        assert_eq!(h.connect("/a".into()), Err(HostError::Stopped));
    }

    /// T-F8 — Debug 에 키 글자가 없다(키는 BridgeHost 에 남지 않는다).
    #[test]
    fn debug_has_no_key() {
        let (tx, _rx) = channel();
        let h = BridgeHost { tx };
        assert_eq!(format!("{h:?}"), "BridgeHost");
        for e in [
            HostStartError::ApiKeyRequired,
            HostStartError::KeyInEnvironment,
            HostStartError::ThreadFailed,
        ] {
            assert!(!format!("{e:?}{e}").contains("omk_live_"));
        }
    }
}
