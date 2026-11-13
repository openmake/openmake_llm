//! 읽기 전용 도구가 띄우는 자식 하나의 실행 조건 — TS `diagnostics.ts` `run`·`test-runner.ts` `canImportPytest` 의
//! `execFile` 자리(설계 D-64·D-65).

use crate::platform::Platform;

/// 자식을 감쌀 샌드박스 — 꺼짐, exec 와 같은 프로파일, 켜졌는데 프로파일이 없음(fail-closed).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolSandbox {
    Off,
    Profile(String),
    Missing,
}

pub struct ToolEnv {
    /// 호스트 환경 사본 — 자식에는 허용 목록만 간다.
    pub env: Vec<(String, String)>,
    pub platform: Platform,
    /// exec PATH(로그인 셸·mise 를 합친 값).
    pub exec_path: String,
    pub sandbox: ToolSandbox,
}
