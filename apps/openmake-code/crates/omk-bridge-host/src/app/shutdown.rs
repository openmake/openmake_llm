//! 종료 정리(D-97) — 입력 끝(stdin 끝·FFI 핸들 놓음·신호)·`quit`·패닉 알림이 같은 길을 탄다. 이미 종료 중이면 무시한다
//! (두 번째 계기가 정리를 끊지 않는다). 신호 처리기는 이 크레이트가 달지 않는다 — 헬퍼가 달아 입력 끝으로 넣는다(PR-3.2 D-228).

use std::time::Duration;

use super::App;
use omk_bridge_core::exec::ConfirmAnswer;

/// 거부 결과가 서버로 나갈 시간(TS `setTimeout 100`).
pub const SHUTDOWN_FLUSH_MS: u64 = 100;

impl App {
    /// 1. 종료 중 표식, 확인 대기 전부 거부 → 2. 100ms 뒤 [`finish_shutdown`]. 그 사이 actor 는 메시지를 계속 처리한다.
    pub(super) fn start_shutdown(&mut self) {
        if self.stopping.is_some() {
            return;
        }
        for (_, reply) in self.confirms.drain() {
            let _ = reply.send(ConfirmAnswer::No);
        }
        self.stopping = Some(Box::pin(tokio::time::sleep(Duration::from_millis(
            SHUTDOWN_FLUSH_MS,
        ))));
    }

    /// 3. 전체 해제(`disconnected`·`autoApprove`·마지막에 `status idle`) → 4. 띄운 Chrome 정리. stdout 비우기는 호출부.
    pub(super) async fn finish_shutdown(&mut self) {
        for (_, reply) in self.confirms.drain() {
            let _ = reply.send(ConfirmAnswer::No);
        }
        self.disconnect(None);
        // 루트를 모두 해제한 **뒤에**. 이 프로세스가 띄운 Chrome 만 끈다(Browser.close 1초 → 종료 5초 대기 → SIGKILL).
        if let Some(core) = self.browser_core.take() {
            core.dispose_browser().await;
        }
    }
}
