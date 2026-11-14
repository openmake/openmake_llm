//! 프로세스 테스트 공용 — 임시 폴더, 헬퍼 자식, 가짜 브리지 서버(크레이트 사이에 도우미를 나누지 않는다 — 계획 §5).
#![allow(
    dead_code,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::result_large_err
)]

pub mod child;
pub mod flow;
pub mod server;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

/// 조건 대기 한도(하네스와 같은 8초).
pub const WAIT: Duration = Duration::from_secs(8);

pub struct TmpDir(PathBuf);

impl TmpDir {
    pub fn new() -> TmpDir {
        static N: AtomicUsize = AtomicUsize::new(0);
        let p = std::env::temp_dir().join(format!(
            "omk-helper-test-{}-{}",
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

    pub fn join(&self, p: &str) -> String {
        self.0.join(p).to_string_lossy().into_owned()
    }

    /// 폴더를 만들고 그 경로.
    pub fn dir(&self, p: &str) -> String {
        let d = self.join(p);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}

impl Drop for TmpDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
