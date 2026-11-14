//! 루트 표와 connect·disconnect(TS `helper.mjs:96~150`). 루트 하나 = 코어 + 연결 + "살아 있음" 표식.

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use omk_bridge_conn::connection::{BridgeConnection, ConnectionOptions};
use omk_bridge_conn::device_id::node_realpath_sync;
use omk_bridge_conn::status::StatusCode;
use omk_bridge_core::constants::BROWSER_KIND;
use omk_bridge_core::core::BridgeCore;
use omk_bridge_core::exec::{ConfirmAnswer, ConfirmFn};
use omk_bridge_core::node_path;
use tokio::sync::{Notify, oneshot};

use super::{App, Msg};
use crate::events::{self, API_KEY_REQUIRED_TEXT, IDLE_TEXT};

/// 해제한 연결을 닫힘 알림까지 쥐는 한도 — 연결 크레이트의 닫기 한도(30초)보다 조금 길게. 핸들을 바로 버리면 닫기 절차와
/// 늦은 `status closed` 가 사라진다(TS 는 `ws.close()` 뒤에도 그 소켓의 닫힘을 알린다 — §12-4).
const RETIRED_HOLD_MS: u64 = 35_000;

/// API key — 접속할 때마다 연결의 `headers` 가 읽는다(뒤에 온 `auth` 는 다음 접속부터). 어떤 출력에도 싣지 않는다.
#[derive(Default)]
pub(crate) struct Secret(Mutex<String>);

impl Secret {
    pub(crate) fn set(&self, k: String) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = k;
    }

    fn get(&self) -> String {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<가림>)")
    }
}

struct Root {
    core: Arc<BridgeCore>,
    conn: BridgeConnection,
    /// `should_reconnect` 가 읽는다 — 표에서 빼면 false.
    alive: Arc<AtomicBool>,
    /// 닫힘(`closed`·`idle`)을 알렸다.
    ended: Arc<Notify>,
}

impl Root {
    /// 연결을 끝내고 닫힘 알림까지(최대 한도) 핸들을 쥔다.
    fn retire(self) {
        self.alive.store(false, Ordering::SeqCst);
        self.conn.disconnect();
        let (conn, ended) = (self.conn, self.ended);
        tokio::spawn(async move {
            let _keep = conn;
            let _ = tokio::time::timeout(Duration::from_millis(RETIRED_HOLD_MS), ended.notified())
                .await;
        });
    }
}

/// 루트 realpath → 루트. 넣은 순서를 지킨다(JS `Map` — 같은 키를 다시 넣으면 자리는 그대로).
#[derive(Default)]
pub(crate) struct Roots(Vec<(String, Root)>);

impl Roots {
    fn position(&self, k: &str) -> Option<usize> {
        self.0.iter().position(|(r, _)| r == k)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn keys(&self) -> Vec<String> {
        self.0.iter().map(|(k, _)| k.clone()).collect()
    }

    pub(crate) fn auto_approved_total(&self) -> usize {
        self.0
            .iter()
            .map(|(_, r)| r.core.auto_approved_count())
            .sum()
    }

    pub(crate) fn clear_auto_approve(&self) {
        for (_, r) in &self.0 {
            r.core.clear_auto_approve();
        }
    }

    /// 브라우저는 루트들이 공유한다. 브라우저가 꺼져 있어도 서버에 제어권 프레임을 보낸다(TS 그대로 — §12-7).
    pub(crate) fn browser_control(&self, user: bool) {
        for (_, r) in &self.0 {
            r.core.set_browser_user_control(user);
            r.conn.notify_browser_control(user);
        }
    }

    pub(crate) fn stop_browser(&self) {
        for (_, r) in &self.0 {
            r.core.stop_browser();
        }
    }
}

impl App {
    /// connect — 키 확인 → realpath → (같은 루트면 옛 연결 해제) → 코어·연결 생성 → `connected` → 접속.
    pub(super) fn connect(&mut self, folder: &str) {
        let Some(ready) = &self.ready else { return };
        let (bridge_url, hostname) = (ready.bridge_url.clone(), ready.hostname.clone());
        if self.key.get().is_empty() {
            self.emit.emit(events::status_global(
                API_KEY_REQUIRED_TEXT,
                "api_key_required",
            ));
            return;
        }
        let real = match node_realpath_sync(folder) {
            Ok(r) => r,
            Err(msg) => {
                self.emit.emit(events::status_folder_open_failed(&msg));
                return;
            }
        };
        let connector = match &self.connector {
            Ok(c) => Arc::clone(c),
            Err(msg) => {
                self.emit.emit(events::status_global(
                    &format!("서버 오류: {msg}"),
                    "server_error",
                ));
                return;
            }
        };
        let core = match self.build_core(&real) {
            Ok(c) => Arc::new(c),
            Err(msg) => {
                // TS 는 생성자가 던져 잡히지 않은 거부로 죽는 자리(그 사이 폴더가 사라진 경우) — 폴더 열기 실패로 알린다.
                // 같은 루트의 옛 연결은 그대로 둔다(코어를 먼저 만들고 성공한 뒤에 꺼낸다 — 리뷰 r1 L-2).
                self.emit.emit(events::status_folder_open_failed(&msg));
                return;
            }
        };
        // 같은 루트 재연결 = 세션 갱신. `disconnected` 는 내지 않는다(TS 그대로).
        let prev = self.take_root(&real);
        if core.capabilities().contains(&BROWSER_KIND) && self.browser_core.is_none() {
            self.browser_core = Some(Arc::clone(&core));
        }
        let alive = Arc::new(AtomicBool::new(true));
        let ended = Arc::new(Notify::new());
        let key = Arc::clone(&self.key);
        let mut o = ConnectionOptions::new(
            bridge_url,
            Arc::clone(&core),
            self.host.identity.root_device_id(&real),
            format!("{hostname} · {}", node_path::basename(&real)),
            Box::new(move || {
                Ok(vec![(
                    "Authorization".to_owned(),
                    format!("Bearer {}", key.get()),
                )])
            }),
            connector,
        );
        o.host_id = Some(self.host.identity.base().to_owned());
        let (emit, f, e) = (self.emit.clone(), real.clone(), Arc::clone(&ended));
        o.on_status = Some(Box::new(move |s| {
            emit.emit(events::status_root(&f, s));
            if matches!(s.code, StatusCode::Closed | StatusCode::Idle) {
                e.notify_one();
            }
        }));
        let (emit, f) = (self.emit.clone(), real.clone());
        o.on_notice = Some(Box::new(move |n| {
            emit.emit(events::approval_pending(&n.task_id, &n.tool_name, &f));
        }));
        let a = Arc::clone(&alive);
        o.should_reconnect = Some(Box::new(move || a.load(Ordering::SeqCst)));
        let root = Root {
            core,
            conn: BridgeConnection::new(o),
            alive,
            ended,
        };
        match prev {
            Some((i, p)) => {
                p.retire();
                self.roots.0.insert(i, (real.clone(), root));
            }
            None => self.roots.0.push((real.clone(), root)),
        }
        // `connected` 를 먼저 낸다 — 접속을 먼저 시작하면 연결 태스크의 `연결 중…` 이 앞설 수 있다(TS 순서: connected → connecting).
        self.emit.emit(events::connected(&real));
        if let Some((_, r)) = self.roots.0.iter().find(|(k, _)| *k == real) {
            r.conn.connect();
        }
    }

    fn take_root(&mut self, real: &str) -> Option<(usize, Root)> {
        let i = self.roots.position(real)?;
        Some((i, self.roots.0.remove(i).1))
    }

    fn build_core(&self, real: &str) -> Result<BridgeCore, String> {
        #[cfg(test)]
        if let Some(msg) = &self.fail_core {
            return Err(msg.clone());
        }
        let tx = self.tx.clone();
        let folder = real.to_owned();
        let confirm: ConfirmFn = Box::new(move |req| {
            let (reply, rx) = oneshot::channel();
            let sent = tx.send(Msg::Confirm {
                req,
                folder: folder.clone(),
                reply,
            });
            Box::pin(async move {
                if sent.is_err() {
                    return ConfirmAnswer::No;
                }
                // 답 채널이 버려지면(종료·actor 끝) 거부 — fail-safe.
                rx.await.unwrap_or(ConfirmAnswer::No)
            })
        });
        let tx = self.tx.clone();
        let on_change = Box::new(move || {
            let _ = tx.send(Msg::AutoApproveChanged);
        });
        let (emit, folder) = (self.emit.clone(), real.to_owned());
        let on_task_end = Box::new(move |task: Option<&str>| {
            emit.emit(events::task_end(task, &folder));
        });
        self.host.build_core(real, confirm, on_change, on_task_end)
    }

    /// disconnect — 폴더가 있으면 그 루트(realpath 가 되면 그 글자로, 안 되면 준 글자로 — 이미 지워진 폴더도 해제한다),
    /// 없으면 전체. 없는 루트는 조용히 무시. 마지막 루트면 `status idle`.
    pub(super) fn disconnect(&mut self, folder: Option<&str>) {
        let Some(folder) = folder else {
            for k in self.roots.keys() {
                self.disconnect(Some(&k));
            }
            return;
        };
        let real = node_realpath_sync(folder).unwrap_or_else(|_| folder.to_owned());
        let Some(i) = self
            .roots
            .position(&real)
            .or_else(|| self.roots.position(folder))
        else {
            return;
        };
        let (key, root) = self.roots.0.remove(i);
        root.retire();
        self.emit.emit(events::disconnected(&key));
        self.emit_auto_approve();
        if self.roots.is_empty() {
            self.emit.emit(events::status_global(IDLE_TEXT, "idle"));
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use omk_bridge_conn::device_id::DeviceIdentity;
    use tokio::sync::mpsc;

    use super::super::{App, Ready};
    use crate::host::Host;
    use crate::stdio::Emitter;

    /// 리뷰 r1 L-2 — 같은 루트 재연결에서 코어 생성이 실패하면 옛 루트는 표에 남는다(조용히 해제하지 않는다 — 부모는 연결된 줄 안다).
    /// 실패는 폴더 열기 실패로만 알리고 `disconnected`·`idle` 은 내지 않는다.
    #[test]
    fn failed_core_on_same_root_reconnect_keeps_the_old_root() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let tmp = std::env::temp_dir().join(format!("omk-helper-roots-{}", std::process::id()));
        let (root, support) = (tmp.join("root"), tmp.join("support"));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&support).unwrap();
        let real = std::fs::canonicalize(&root)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        rt.block_on(async {
            let identity = DeviceIdentity::load_or_create(&support).unwrap();
            let host = Host::from_env(tmp.to_string_lossy().into_owned(), &support, identity);
            let (emit, lines) = Emitter::capture();
            let (tx, _rx) = mpsc::unbounded_channel();
            let mut app = App::new(emit, tx, host);
            app.ready = Some(Ready {
                bridge_url: "ws://127.0.0.1:9".into(),
                hostname: "h".into(),
            });
            app.key.set("omk_live_unit".into());
            app.connect(&real);
            assert_eq!(app.roots.keys(), [real.clone()]);
            app.fail_core = Some("ENOENT: 사라짐".into());
            app.connect(&real);
            assert_eq!(app.roots.keys(), [real.clone()], "옛 루트가 남는다");
            let (_, old) = &app.roots.0[0];
            assert!(old.alive.load(std::sync::atomic::Ordering::SeqCst));
            // 쓰기 스레드가 따로 돈다 — 폴더 열기 실패 줄이 올 때까지 받는다
            let mut evs = Vec::new();
            while let Ok(l) = lines.recv_timeout(std::time::Duration::from_secs(2)) {
                let done = l.contains("folder_open_failed");
                evs.push(l);
                if done {
                    break;
                }
            }
            assert!(
                evs.last().is_some_and(|l| l.contains("folder_open_failed")),
                "{evs:?}"
            );
            assert!(
                !evs.iter()
                    .any(|e| e.contains("\"disconnected\"") || e.contains("\"idle\"")),
                "{evs:?}"
            );
            app.disconnect(None);
        });
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
