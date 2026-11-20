//! OpenMake Code 앱(Swift)이 브리지 호스트를 같은 프로세스 안에서 돌리는 UniFFI 표면(PR-3.2). 표면은 [`ffi`] — stdio 계약과
//! 1:1(설계 D-220), 실행 순서는 `omk_bridge_host::serve`(헬퍼와 같은 actor).
//!
//! unsafe 허용은 이 크레이트의 이 줄과 `cloexec.rs` 뿐이다(D-224): UniFFI 의 scaffolding·export 생성 코드가
//! `extern "C"`·포인터 해제를 낸다. 손으로 쓴 로직 모듈(`run`·`convert`)은 맨 위에서 다시 forbid 한다.
#![allow(unsafe_code)]

uniffi::setup_scaffolding!();

mod cloexec;
mod convert;
mod ffi;
mod run;

pub use ffi::*;
