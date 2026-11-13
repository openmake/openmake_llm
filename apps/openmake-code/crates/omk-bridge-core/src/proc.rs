//! 자식 프로세스 하나 — Node `execFile`·`execFileSync` 에 해당한다. 이 크레이트에서 프로세스를 띄우는 유일한 자리.

use std::collections::BTreeMap;

pub enum Stdin {
    HeldOpen,
    Null,
}

pub enum Stderr {
    Capture,
    Null,
}

pub struct ProcSpec {
    pub file: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: BTreeMap<String, String>,
    pub timeout_ms: u64,
    pub max_buffer: usize,
    pub stdin: Stdin,
    pub stderr: Stderr,
}

#[derive(Debug)]
pub enum ProcEnd {
    Exited(i32),
    Signaled,
    TimedOut,
    Overflow,
    SpawnFailed(std::io::Error),
}

pub struct ProcOutput {
    pub stdout: String,
    pub stderr: String,
    pub end: ProcEnd,
}

pub async fn run(_spec: ProcSpec) -> ProcOutput {
    todo!("PR-1.3 단계 4")
}
