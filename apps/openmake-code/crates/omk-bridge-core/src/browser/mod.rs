//! 로컬 브라우저(Companion P2) — TS `packages/local-bridge-core/src/browser/` 와 `@openmake/config` 의
//! `browser-site-policy.ts`·`browser-flow.ts` 중 **기기 쪽 판정**(PR-1.6a)과, CDP·Chrome 기동·실행 조정·다운로드 추적·
//! `LocalBrowser`·액션 14종(PR-1.6b). 코어는 `BridgeCore::with_browser_profile` 로 얹는다(`core_browser.rs`).
//!
//! 기준은 TS 의 현재 동작이고, `conformance/browser-*.json` 을 두 구현이 함께 통과해야 한다(형식은 `BROWSER.md`).

mod actions;
pub mod cdp;
pub mod chrome;
pub mod constants;
pub mod defs;
pub mod download_place;
pub mod downloads;
pub mod flow;
pub mod host;
pub mod js_value;
pub mod local_browser;
mod page;
pub mod policy_block;
pub mod result;
pub mod run;
pub mod scheduler;
pub mod site_policy;
pub mod upload_files;
