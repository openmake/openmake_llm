# Third-party notices — OpenMake Code (macOS)

OpenMake Code.app 실행 파일에 정적으로 링크되는 오픈소스 중 **MPL-2.0** 크레이트의 고지다(MPL-2.0 §3.2(a) — 실행 형태로 배포할 때 소스를 얻는 방법을 알린다). 이 크레이트들은 **수정 없이** 그대로 쓴다.

| 크레이트 | 판 | 라이선스 | 소스 |
|---|---|---|---|
| `uniffi` 0.32.2 | 0.32.2 | MPL-2.0 | https://crates.io/crates/uniffi/0.32.2 · https://github.com/mozilla/uniffi-rs |
| `uniffi_core` 0.32.2 | 0.32.2 | MPL-2.0 | https://crates.io/crates/uniffi_core/0.32.2 · https://github.com/mozilla/uniffi-rs |
| `uniffi_pipeline` 0.32.2 | 0.32.2 | MPL-2.0 | https://crates.io/crates/uniffi_pipeline/0.32.2 · https://github.com/mozilla/uniffi-rs |

MPL-2.0 전문: https://www.mozilla.org/en-US/MPL/2.0/

이 목록은 `apps/openmake-code/crates/omk-ffi/tests/ffi_guard.rs`(T-F11)가 `Cargo.lock` 과 대조한다 — 판을 올리면 함께 고친다. 링크 여부는 `cargo tree -p omk-ffi -e normal,no-proc-macro --target aarch64-apple-darwin --prefix none` 로 판정한다(빌드 시점 전용 `uniffi_bindgen`·`uniffi_macros` 등은 앱에 들어가지 않는다).
