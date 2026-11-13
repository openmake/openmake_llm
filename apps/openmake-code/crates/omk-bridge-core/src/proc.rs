//! 자식 프로세스 하나 — Node `execFile`·`execFileSync` 에 해당한다. 이 크레이트에서 프로세스를 띄우는 유일한 자리.
//!
//! 끝나는 조건은 Node 와 같다: 자식이 끝나고 **두 파이프가 모두 닫혀야** 끝난다(뒤에 남긴 프로세스가 stdout 을
//! 쥐고 있으면 그것을 기다린다). 시간 초과·출력 상한이면 직접 자식만 끝내고(SIGKILL — Node 는 SIGTERM, 설계 D-31),
//! 파이프가 닫히기를 기다리지 않고 그때까지 읽은 것으로 답한다. 프로세스 그룹은 건드리지 않는다(TS 와 같다).
//! 판정(종료 코드를 무엇으로 볼지)은 부르는 자리가 한다. tokio 런타임(시간 + I/O)이 켜져 있어야 한다.

use std::collections::BTreeMap;
use std::future::{Future, poll_fn};
use std::pin::{Pin, pin};
use std::process::{ExitStatus, Stdio};
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::io::{AsyncRead, ReadBuf};

/// 자식의 stdin. Node `execFile` 은 쓰지 않는 파이프를 연 채로 두고(입력을 기다리는 명령은 시간 초과까지 멈춘다),
/// `execFileSync` 는 바로 닫는다.
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
    /// 없으면 이 프로세스의 cwd(Node 의 cwd 생략과 같다).
    pub cwd: Option<String>,
    /// 자식의 환경 전체 — 부모 환경은 넘기지 않는다. 실행 파일은 이 맵의 PATH 에서 찾는다.
    pub env: BTreeMap<String, String>,
    pub timeout_ms: u64,
    /// 스트림마다의 바이트 상한(D-32).
    pub max_buffer: usize,
    pub stdin: Stdin,
    pub stderr: Stderr,
}

#[derive(Debug)]
pub enum ProcEnd {
    Exited(i32),
    /// 신호로 끝났거나 종료 상태를 알 수 없다.
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

/// 신호를 보낸 뒤 직접 자식이 끝나기를 기다리는 상한 — 끝낼 수 없는 상태(막힌 볼륨의 D 상태)여도 답은 나간다.
const REAP_WAIT: Duration = Duration::from_secs(1);
const CHUNK: usize = 16 * 1024;

struct Pipe<R> {
    reader: Option<R>,
    buf: Vec<u8>,
}

impl<R: AsyncRead + Unpin> Pipe<R> {
    fn new(reader: Option<R>) -> Pipe<R> {
        Pipe {
            reader,
            buf: Vec::new(),
        }
    }

    /// 지금 읽을 수 있는 것을 모두 읽는다. 상한을 넘으면 `true`.
    fn drain(&mut self, cx: &mut Context<'_>, max: usize) -> bool {
        let mut chunk = [0u8; CHUNK];
        while let Some(r) = self.reader.as_mut() {
            let mut rb = ReadBuf::new(&mut chunk);
            match Pin::new(r).poll_read(cx, &mut rb) {
                Poll::Pending => return false,
                Poll::Ready(Ok(())) if !rb.filled().is_empty() => {
                    self.buf.extend_from_slice(rb.filled());
                    if self.buf.len() > max {
                        return true;
                    }
                }
                // EOF 또는 읽기 오류 — 이 스트림은 닫힌 것으로 본다.
                Poll::Ready(_) => self.reader = None,
            }
        }
        false
    }

    fn text(mut self, max: usize) -> String {
        cut_at_char_boundary(&mut self.buf, max);
        String::from_utf8_lossy(&self.buf).into_owned()
    }
}

/// 상한 이하에서 가장 긴 UTF-8 글자 경계까지 남긴다. 상한 자리가 글자 한가운데면 그 글자의 첫 바이트까지 물러난다
/// (UTF-8 글자는 4바이트 이하 — 3번까지만). 깨진 바이트 열이면 상한 그대로 자른다.
fn cut_at_char_boundary(buf: &mut Vec<u8>, max: usize) {
    if buf.len() <= max {
        return;
    }
    let is_cont = |b: u8| b & 0xC0 == 0x80;
    let mut end = max;
    while end > 0 && max - end < 3 && is_cont(buf[end]) {
        end -= 1;
    }
    if is_cont(buf[end]) {
        end = max;
    }
    buf.truncate(end);
}

enum Outcome {
    Done(std::io::Result<ExitStatus>),
    TimedOut,
    Overflow,
}

fn exit_end(status: std::io::Result<ExitStatus>) -> ProcEnd {
    match status.ok().and_then(|s| s.code()) {
        Some(n) => ProcEnd::Exited(n),
        None => ProcEnd::Signaled,
    }
}

pub async fn run(spec: ProcSpec) -> ProcOutput {
    let mut cmd = tokio::process::Command::new(&spec.file);
    cmd.args(&spec.args)
        .env_clear()
        .envs(&spec.env)
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stdin(match spec.stdin {
            Stdin::HeldOpen => Stdio::piped(),
            Stdin::Null => Stdio::null(),
        })
        .stderr(match spec.stderr {
            Stderr::Capture => Stdio::piped(),
            Stderr::Null => Stdio::null(),
        });
    if let Some(cwd) = &spec.cwd {
        cmd.current_dir(cwd);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return ProcOutput {
                stdout: String::new(),
                stderr: String::new(),
                end: ProcEnd::SpawnFailed(e),
            };
        }
    };
    // 자식이 끝날 때까지 쥔다 — 쓰지 않는다.
    let held_stdin = child.stdin.take();
    let mut out = Pipe::new(child.stdout.take());
    let mut err = Pipe::new(child.stderr.take());
    let max = spec.max_buffer;
    let outcome = {
        let mut wait = pin!(child.wait());
        let mut timer = pin!(tokio::time::sleep(Duration::from_millis(spec.timeout_ms)));
        let mut status = None;
        poll_fn(|cx| {
            if out.drain(cx, max) || err.drain(cx, max) {
                return Poll::Ready(Outcome::Overflow);
            }
            if status.is_none()
                && let Poll::Ready(s) = wait.as_mut().poll(cx)
            {
                status = Some(s);
            }
            if out.reader.is_none() && err.reader.is_none()
                && let Some(s) = status.take()
            {
                return Poll::Ready(Outcome::Done(s));
            }
            if timer.as_mut().poll(cx).is_ready() {
                return Poll::Ready(Outcome::TimedOut);
            }
            Poll::Pending
        })
        .await
    };
    let end = match outcome {
        Outcome::Done(s) => exit_end(s),
        cut_short => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(REAP_WAIT, child.wait()).await;
            if matches!(cut_short, Outcome::TimedOut) {
                ProcEnd::TimedOut
            } else {
                ProcEnd::Overflow
            }
        }
    };
    drop(held_stdin);
    ProcOutput {
        stdout: out.text(max),
        stderr: err.text(max),
        end,
    }
}

#[cfg(test)]
mod tests {
    use super::cut_at_char_boundary;

    #[test]
    fn cut_backs_off_to_char_start() {
        let cut = |s: &[u8], max| {
            let mut b = s.to_vec();
            cut_at_char_boundary(&mut b, max);
            b
        };
        assert_eq!(cut("가나".as_bytes(), 4), "가".as_bytes());
        assert_eq!(cut("가나".as_bytes(), 3), "가".as_bytes());
        assert_eq!(cut("가나".as_bytes(), 2), b"");
        assert_eq!(cut(b"abc", 2), b"ab");
        assert_eq!(cut(b"abc", 5), b"abc");
        // 깨진 열(이어지는 바이트만 이어짐) — 상한 그대로.
        assert_eq!(cut(&[b'a', 0x80, 0x80, 0x80, 0x80, 0x80], 5), [b'a', 0x80, 0x80, 0x80, 0x80]);
    }
}
