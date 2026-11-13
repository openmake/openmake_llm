//! 파일 kind 시간 제한 — TS `core.ts` `timedFs`.

pub fn fs_timeout_from_env(_v: Option<&str>) -> u64 {
    todo!()
}

pub struct FsGate {
    _timeout_ms: u64,
}

impl FsGate {
    pub fn new(timeout_ms: u64) -> FsGate {
        FsGate {
            _timeout_ms: timeout_ms,
        }
    }

    pub async fn run<T, F>(&self, _label: &str, _f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, String> + Send + 'static,
    {
        todo!()
    }
}
