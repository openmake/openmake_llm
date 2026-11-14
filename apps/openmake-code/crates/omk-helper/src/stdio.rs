//! stdin 읽기 스레드·stdout 쓰기 스레드(D-92). tokio 의 stdin 은 쓰지 않는다 — 블록된 읽기가 런타임 종료를 붙잡는다.
//! stdout 에 쓰는 곳은 쓰기 스레드 하나뿐이다 — `emit` 은 넣기만 하고 기다리지 않는다(어느 스레드·콜백에서든 부른다).

use std::io::{Read, Write};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

/// stdin 한 줄 또는 끝.
#[derive(Debug, PartialEq, Eq)]
pub enum Input {
    Line(String),
    End,
}

/// 바이트를 `\n` 으로 자른다(앞의 `\r` 하나는 뗀다). 줄은 `from_utf8_lossy` 로 푼다 — 다바이트 글자가 읽기 조각 경계에서
/// 깨지지 않게 줄 전체를 모은 뒤 푼다. Node readline 과 달리 홀로 선 `\r`·U+2028·U+2029 에서는 자르지 않는다(D-106-3).
#[derive(Default)]
pub struct LineSplitter {
    buf: Vec<u8>,
}

fn decode(mut line: &[u8]) -> String {
    if let Some(l) = line.strip_suffix(b"\r") {
        line = l;
    }
    String::from_utf8_lossy(line).into_owned()
}

impl LineSplitter {
    pub fn push(&mut self, chunk: &[u8], out: &mut impl FnMut(String)) {
        self.buf.extend_from_slice(chunk);
        let mut start = 0;
        while let Some(i) = self.buf[start..].iter().position(|b| *b == b'\n') {
            out(decode(&self.buf[start..start + i]));
            start += i + 1;
        }
        self.buf.drain(..start);
    }

    /// 끝 — 줄바꿈 없이 남은 조각도 한 줄로(Node readline 과 같은 순서: 마지막 줄 → 끝).
    pub fn finish(self, out: &mut impl FnMut(String)) {
        if !self.buf.is_empty() {
            out(decode(&self.buf));
        }
    }
}

/// stdin 을 읽는 OS 스레드 — 줄마다 `send(Line)`, 끝·읽기 오류에 `send(End)` 한 번. `send` 가 `false` 면(받는 쪽이 없다) 멈춘다.
pub fn spawn_stdin_reader(send: impl Fn(Input) -> bool + Send + 'static) {
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        let mut split = LineSplitter::default();
        let mut chunk = [0u8; 8192];
        let mut alive = true;
        loop {
            match stdin.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => split.push(&chunk[..n], &mut |l| alive = alive && send(Input::Line(l))),
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
            if !alive {
                return;
            }
        }
        split.finish(&mut |l| alive = alive && send(Input::Line(l)));
        if alive {
            send(Input::End);
        }
    });
}

enum Out {
    Line(String),
    Flushed(std_mpsc::SyncSender<()>),
}

/// stdout 쓰기 핸들 — 복제해 콜백에 넘긴다.
#[derive(Clone)]
pub struct Emitter {
    tx: std_mpsc::Sender<Out>,
}

impl Emitter {
    /// stdout 쓰기 스레드를 띄운다. 줄마다 `write_all` + `flush`. 쓰기 실패(부모가 죽어 EPIPE)는 삼킨다 — 곧 stdin 끝이 온다.
    pub fn spawn() -> Emitter {
        let (tx, rx) = std_mpsc::channel::<Out>();
        std::thread::spawn(move || {
            let mut out = std::io::stdout().lock();
            let mut broken = false;
            for o in rx {
                match o {
                    Out::Line(mut l) => {
                        if broken {
                            continue;
                        }
                        l.push('\n');
                        broken = out
                            .write_all(l.as_bytes())
                            .and_then(|()| out.flush())
                            .is_err();
                    }
                    Out::Flushed(done) => {
                        let _ = done.send(());
                    }
                }
            }
        });
        Emitter { tx }
    }

    /// 한 줄을 넣는다(줄바꿈은 붙여 쓴다). 기다리지 않는다.
    pub fn emit(&self, line: String) {
        let _ = self.tx.send(Out::Line(line));
    }

    /// 지금까지 넣은 줄이 다 쓰일 때까지 최대 `limit` 기다린다(종료 직전).
    pub fn flush(&self, limit: Duration) {
        let (done_tx, done_rx) = std_mpsc::sync_channel(1);
        if self.tx.send(Out::Flushed(done_tx)).is_ok() {
            let _ = done_rx.recv_timeout(limit);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::LineSplitter;

    fn split(chunks: &[&[u8]]) -> Vec<String> {
        let mut s = LineSplitter::default();
        let mut out = Vec::new();
        for c in chunks {
            s.push(c, &mut |l| out.push(l));
        }
        s.finish(&mut |l| out.push(l));
        out
    }

    #[test]
    fn splits_on_newline_only() {
        assert_eq!(split(&[b"a\r\nb\n\nc"]), ["a", "b", "", "c"]);
        // 홀로 선 \r·U+2028 은 줄 안에 남는다(Node 는 자른다 — D-106-3). \r\r\n 은 \r 하나만 뗀다.
        assert_eq!(
            split(&["x\ry\u{2028}z\r\r\n".as_bytes()]),
            ["x\ry\u{2028}z\r"]
        );
        // 끝의 \r 하나는 줄바꿈 없는 끝 조각에서도 뗀다
        assert_eq!(split(&[b"tail\r"]), ["tail"]);
        assert_eq!(split(&[b""]), Vec::<String>::new());
        assert_eq!(split(&[b"\n"]), [""]);
    }

    #[test]
    fn multibyte_across_chunks_and_broken_utf8() {
        let k = "한".as_bytes();
        assert_eq!(split(&[&k[..1], &k[1..], b"\n"]), ["한"]);
        // 깨진 바이트는 U+FFFD 하나씩(Node TextDecoder 와 같은 수 — 단계 0 ④)
        assert_eq!(split(&[b"g\xff\xfeh\n"]), ["g\u{fffd}\u{fffd}h"]);
    }

    #[test]
    fn long_line() {
        let long = "x".repeat(200 * 1024);
        let mut chunks: Vec<&[u8]> = long.as_bytes().chunks(8192).collect();
        chunks.push(b"\n");
        assert_eq!(split(&chunks), [long]);
    }
}
