//! 헬퍼 자식 프로세스 — `HOME=<임시 폴더>` 로 지원 폴더를 떼어 놓고, stdout 줄을 모아 조건으로 기다린다(고정 sleep 없음).

use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::{TmpDir, WAIT};

#[derive(Default)]
pub struct Out {
    /// stdout 원문 바이트 전부(키 검색용)
    pub raw: Vec<u8>,
    pub events: Vec<Value>,
    pub stderr: Vec<u8>,
    pub stdout_closed: bool,
}

pub struct Helper {
    pub child: Child,
    stdin: Option<ChildStdin>,
    pub out: Arc<(Mutex<Out>, Condvar)>,
    pub home: TmpDir,
}

pub fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_omk-helper")
}

/// 기본 환경 — 키 env 는 지우고 HOME 은 임시 폴더.
pub fn command(home: &TmpDir, args: &[&str]) -> Command {
    let mut c = Command::new(bin());
    c.args(args)
        .env("HOME", home.path())
        .env_remove("OMK_COMPANION_API_KEY")
        .env_remove("OMK_COMPANION_BROWSER")
        .env_remove("OMK_BRIDGE_AUTO_APPROVE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    c
}

impl Helper {
    pub fn spawn(server: &str, env: &[(&str, &str)]) -> Helper {
        let home = TmpDir::new();
        let mut c = command(&home, &["--server", server]);
        for (k, v) in env {
            c.env(k, v);
        }
        Helper::start(c, home)
    }

    pub fn start(mut c: Command, home: TmpDir) -> Helper {
        let mut child = c.spawn().unwrap();
        let out = Arc::new((Mutex::new(Out::default()), Condvar::new()));
        let mut so = child.stdout.take().unwrap();
        let o = Arc::clone(&out);
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut pending = Vec::new();
            loop {
                let n = so.read(&mut buf).unwrap_or(0);
                let (m, cv) = &*o;
                let mut g = m.lock().unwrap();
                if n == 0 {
                    g.stdout_closed = true;
                    cv.notify_all();
                    return;
                }
                g.raw.extend_from_slice(&buf[..n]);
                pending.extend_from_slice(&buf[..n]);
                while let Some(i) = pending.iter().position(|b| *b == b'\n') {
                    let line: Vec<u8> = pending.drain(..=i).collect();
                    let v: Value =
                        serde_json::from_slice(&line[..line.len() - 1]).unwrap_or_else(|e| {
                            panic!(
                                "stdout 줄이 JSON 이 아니다: {e} {:?}",
                                String::from_utf8_lossy(&line)
                            )
                        });
                    g.events.push(v);
                }
                cv.notify_all();
            }
        });
        let mut se = child.stderr.take().unwrap();
        let o = Arc::clone(&out);
        std::thread::spawn(move || {
            let mut v = Vec::new();
            let _ = se.read_to_end(&mut v);
            o.0.lock().unwrap().stderr = v;
        });
        let stdin = child.stdin.take();
        Helper {
            child,
            stdin,
            out,
            home,
        }
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn send(&mut self, v: &Value) {
        self.send_raw(format!("{v}\n").as_bytes());
    }

    pub fn send_raw(&mut self, b: &[u8]) {
        let s = self.stdin.as_mut().expect("stdin 이 열려 있다");
        s.write_all(b).unwrap();
        s.flush().unwrap();
    }

    pub fn close_stdin(&mut self) {
        self.stdin = None;
    }

    pub fn auth_connect(&mut self, key: &str, folder: &str) {
        self.send(&serde_json::json!({"cmd": "auth", "apiKey": key}));
        self.send(&serde_json::json!({"cmd": "connect", "folder": folder}));
    }

    pub fn events(&self) -> Vec<Value> {
        self.out.0.lock().unwrap().events.clone()
    }

    pub fn count(&self, pred: impl Fn(&Value) -> bool) -> usize {
        self.events().iter().filter(|e| pred(e)).count()
    }

    /// 조건에 맞는 이벤트가 (이미 있거나) 올 때까지 — 한도를 넘으면 지금까지의 이벤트와 함께 실패.
    pub fn wait_ev(&self, what: &str, pred: impl Fn(&Value) -> bool) -> Value {
        self.wait_n(what, 1, pred)
    }

    /// 조건에 맞는 n번째 이벤트.
    pub fn wait_n(&self, what: &str, n: usize, pred: impl Fn(&Value) -> bool) -> Value {
        let (m, cv) = &*self.out;
        let end = Instant::now() + WAIT;
        let mut g = m.lock().unwrap();
        loop {
            if let Some(e) = g.events.iter().filter(|e| pred(e)).nth(n - 1) {
                return e.clone();
            }
            let left = end.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "이벤트 시간 초과: {what} — {:?}", g.events);
            g = cv.wait_timeout(g, left).unwrap().0;
        }
    }

    pub fn wait_exit(&mut self, limit: Duration) -> ExitStatus {
        let end = Instant::now() + limit;
        loop {
            if let Some(s) = self.child.try_wait().unwrap() {
                return s;
            }
            assert!(Instant::now() < end, "헬퍼가 {limit:?} 안에 끝나지 않았다");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// 종료 뒤 stdout·stderr 를 다 읽을 때까지.
    pub fn finished_output(&self) -> (Vec<u8>, Vec<u8>) {
        let (m, cv) = &*self.out;
        let end = Instant::now() + WAIT;
        let mut g = m.lock().unwrap();
        while !g.stdout_closed && Instant::now() < end {
            g = cv.wait_timeout(g, Duration::from_millis(50)).unwrap().0;
        }
        drop(g);
        // stderr 스레드가 끝나기를 잠깐 기다린다
        std::thread::sleep(Duration::from_millis(50));
        let g = m.lock().unwrap();
        (g.raw.clone(), g.stderr.clone())
    }

    pub fn signal(&self, sig: &str) {
        let ok = Command::new("kill")
            .args([&format!("-{sig}"), &self.pid().to_string()])
            .status()
            .unwrap()
            .success();
        assert!(ok, "kill -{sig}");
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn is(ev: &str) -> impl Fn(&Value) -> bool + '_ {
    move |e| e["ev"] == ev
}
