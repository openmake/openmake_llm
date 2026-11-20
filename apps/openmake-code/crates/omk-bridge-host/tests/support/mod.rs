//! `serve` 시험 공용 — 임시 홈, 같은 프로세스 안에서 도는 호스트(이벤트를 모아 조건으로 기다린다), 가짜 브리지 서버.
#![allow(
    dead_code,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::result_large_err
)]

pub mod server;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use omk_bridge_host::command::Command;
use omk_bridge_host::event::{Emit, Event};
use omk_bridge_host::host::env_snapshot;
use omk_bridge_host::serve::{Input, ServeArgs, Tx, channel, serve};

/// 조건 대기 한도(하네스와 같은 8초).
pub const WAIT: Duration = Duration::from_secs(8);
/// 시험 키(합성 값).
pub const KEY: &str = "omk_live_host_test";

pub struct TmpDir(PathBuf);

impl TmpDir {
    pub fn new() -> TmpDir {
        static N: AtomicUsize = AtomicUsize::new(0);
        let p = std::env::temp_dir().join(format!(
            "omk-host-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&p).unwrap();
        // macOS 임시 폴더는 /var → /private/var 심링크 — 루트 realpath 와 맞대기 위해 푼 글자를 쓴다.
        TmpDir(std::fs::canonicalize(&p).unwrap())
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    pub fn home(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }

    /// 폴더를 만들고 그 경로.
    pub fn dir(&self, p: &str) -> String {
        let d = self.0.join(p).to_string_lossy().into_owned();
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}

impl Drop for TmpDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

type Events = Arc<(Mutex<Vec<Event>>, Condvar)>;

/// 스레드 하나에서 도는 `serve`.
pub struct Running {
    pub tx: Tx,
    events: Events,
    join: Option<JoinHandle<i32>>,
}

impl Running {
    pub fn start(server: &str, home: &str) -> Running {
        let events: Events = Arc::default();
        let ev = Arc::clone(&events);
        let emit = Emit::new(move |e| {
            let (m, cv) = &*ev;
            m.lock().unwrap().push(e);
            cv.notify_all();
        });
        let (tx, rx) = channel();
        let args = ServeArgs {
            server: server.to_owned(),
            home: home.to_owned(),
            browser_enabled: false,
            env: env_snapshot(),
        };
        let t = tx.clone();
        let join = std::thread::spawn(move || serve(args, emit, t, rx, |_| {}));
        Running {
            tx,
            events,
            join: Some(join),
        }
    }

    pub fn send(&self, c: Command) {
        assert!(self.tx.send(Input::Command(c)));
    }

    pub fn events(&self) -> Vec<Event> {
        self.events.0.lock().unwrap().clone()
    }

    /// 조건에 맞는 이벤트가 올 때까지(최대 [`WAIT`]) — 그 이벤트.
    pub fn wait(&self, what: &str, pred: impl Fn(&Event) -> bool) -> Event {
        let (m, cv) = &*self.events;
        let end = Instant::now() + WAIT;
        let mut g = m.lock().unwrap();
        loop {
            if let Some(e) = g.iter().find(|e| pred(e)) {
                return e.clone();
            }
            let left = end.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "{what} 대기 시간 초과: {:?}", *g);
            g = cv.wait_timeout(g, left).unwrap().0;
        }
    }

    /// 끝날 때까지 기다려 종료 코드.
    pub fn join(mut self) -> i32 {
        self.join.take().unwrap().join().unwrap()
    }

    /// 끝날 때까지 기다려 (종료 코드, 모든 이벤트).
    pub fn join_keep(self) -> (i32, Vec<Event>) {
        let events = Arc::clone(&self.events);
        let code = self.join();
        let evs = events.0.lock().unwrap().clone();
        (code, evs)
    }
}
