//! 브리지 호스트(PR-3.2 D-223) — 주 actor(루트 표·확인 대기·종료 순서), 잠금, 호스트 값, 실행 순서([`serve::serve`]).
//! 판정 로직은 없다 — 코어(`omk-bridge-core`)·연결(`omk-bridge-conn`)을 호스트 값으로 잇기만 한다.
//!
//! 어댑터 둘이 이 크레이트를 쓴다: `omk-helper`(stdio JSON-lines — 하네스·Windows 사이드카)와 `omk-ffi`(같은 프로세스 안
//! Swift). 입력은 타입 있는 [`command::Command`], 출력은 타입 있는 [`event::Event`] 다. 신호 처리기·stdin·stdout·패닉 훅은
//! 어댑터 몫이다 — 이 크레이트는 프로세스 전역 상태를 바꾸지 않는다(앱 프로세스 안에서 돈다).

mod app;
pub mod command;
pub mod event;
pub mod host;
pub mod instance;
pub mod serve;

pub use app::discover;
