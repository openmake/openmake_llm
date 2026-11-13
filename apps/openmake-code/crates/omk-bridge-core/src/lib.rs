//! OpenMake 로컬 브리지 보안 코어.
//!
//! TS `packages/local-bridge-core` 의 판정과 파일 kind 처리를 옮긴다. 기준은 TS 의 현재 동작이며,
//! `packages/local-bridge-core/conformance` 의 fixture 를 두 구현이 함께 통과해야 한다.

pub mod base64_lenient;
pub mod constants;
pub mod core;
pub mod denylist;
pub mod exec;
pub mod exec_env;
pub mod exec_path;
pub mod fs_kinds;
pub mod js_text;
pub mod msg;
pub mod node_error;
pub mod node_path;
pub mod platform;
pub mod proc;
pub mod request_guard;
pub mod sandbox;
pub mod sandbox_profile;
pub mod scope;
pub mod timed_fs;
pub mod worktree;
// 읽기 전용 도구 (PR-1.4)
pub mod code_nav;
pub mod diagnostics;
pub mod glob;
pub mod js_regex;
pub mod test_runner;
pub mod tool_env;
