//! 브라우저 다운로드 추적(TS `downloads.ts`, 설계 B-3·B-4·B-7·B-8·B-9) — 연결 단위로 이벤트를 받는다.
//!
//! Chrome 은 `Browser.setDownloadBehavior({behavior:'allowAndName'})` 로 대기 폴더(연결 폴더 밖)에 `<guid>` 이름으로만 받는다.
//! 이벤트는 두 채널(`Page.*` — 붙은 탭의 sessionId, `Browser.*` — 붙지 않은 새 창)로 오고 guid 로 합친다 — 같은 guid 의 시작은
//! 처음 것만, 완료 처리(옮기기)는 guid 당 한 번. 저장 함수는 작업별로 기억하고(작업 키 → 저장 함수, 호출마다 그 작업의 값만
//! 바꾼다), 시작 순간 귀속 작업을 정해 **그 작업의** 저장 함수를 guid 에 묶는다 — 완료가 호출이 끝난 뒤에 와도 묶인 함수로
//! 옮긴다. 귀속하지 못한 다운로드는 저장 함수가 없어 옮기지 않는다(D-1·D-3). CDP 설정은 연결에 묶여 연결이 닫히면 Chrome 기본값으로 돌아가므로, Chrome 을 새로 띄울 때 프로필
//! (`Default`)의 기본 다운로드 폴더도 대기 폴더로 맞추고 설정이 실패하면 호출을 실행하지 않는다.
//! 대기 폴더·프로필 파일은 연결 폴더 밖(앱 지원 폴더)이라 `FsGate` 밖에서 바로 쓴다(TS 와 같다).

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::{Map, Value, json};
use tokio::sync::watch;

use super::cdp::CdpClient;
use super::constants::BROWSER_PROFILE_DIRECTORY;
use super::download_place::PlaceError;
use super::flow::BoxFut;
use super::js_value::str_of;
use super::result::Obj;
use crate::node_error;
use crate::node_path;

/// 다운로드 저장 — 제안 이름·대기 파일 경로 → 저장된 이름(연결 폴더 기준). 가드 거절은 `PlaceError::Rejected`.
pub type PlaceDownload =
    Arc<dyn Fn(String, String) -> BoxFut<'static, Result<String, PlaceError>> + Send + Sync>;

const NO_PLACE_ERROR: &str = "다운로드를 저장할 곳이 없습니다";
const ABANDONED_ERROR: &str = "브라우저 연결이 끊겨 받지 못했습니다";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DlState {
    Saved,
    Rejected,
    Failed,
    Canceled,
    InProgress,
}

impl DlState {
    fn as_str(self) -> &'static str {
        match self {
            DlState::Saved => "saved",
            DlState::Rejected => "rejected",
            DlState::Failed => "failed",
            DlState::Canceled => "canceled",
            DlState::InProgress => "inProgress",
        }
    }
}

/// 결과에 싣는 다운로드 하나 — saved 면 savedAs, rejected·failed 면 error(가드 문구 그대로). url 은 싣지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadReport {
    pub name: String,
    pub state: DlState,
    pub saved_as: Option<String>,
    pub error: Option<String>,
}

impl DownloadReport {
    fn new(name: String, state: DlState) -> DownloadReport {
        DownloadReport {
            name,
            state,
            saved_as: None,
            error: None,
        }
    }

    /// TS 리터럴 순서 `name, state, savedAs?, error?`.
    pub fn to_obj(&self) -> Obj {
        let mut o = Obj::of([
            ("name", self.name.as_str().into()),
            ("state", self.state.as_str().into()),
        ]);
        if let Some(s) = &self.saved_as {
            o.set("savedAs", s.as_str());
        }
        if let Some(e) = &self.error {
            o.set("error", e.as_str());
        }
        o
    }
}

struct Download {
    /// 귀속 작업 — 없으면 보고하지 않는다(시작 때 없었으면 저장 함수도 없다, `forget` 으로 풀렸으면 옮기기는 그대로 한다)
    task: Option<String>,
    place: Option<PlaceDownload>,
    report: DownloadReport,
    /// 마지막으로 결과에 실은 상태 — 같은 상태를 두 번 싣지 않는다
    reported: Option<DlState>,
    /// 완료·취소 처리를 시작했다 — guid 당 한 번
    finishing: bool,
    done: watch::Sender<bool>,
}

#[derive(Default)]
struct Inner {
    /// 작업 키 → 그 작업의 마지막 호출이 준 저장 함수(없음도 기록 — 그 작업은 받지 않는다)
    places: Vec<(String, Option<PlaceDownload>)>,
    /// guid → 기록(시작 순서 — 보고 순서)
    items: Vec<(String, Download)>,
}

pub struct DownloadTracker {
    dir: String,
    inner: Mutex<Inner>,
}

#[cfg(unix)]
fn mkdir_private(dir: &str) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
}

#[cfg(not(unix))]
fn mkdir_private(dir: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

fn write_private(path: &str, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o.open(path)?.write_all(data)
}

impl DownloadTracker {
    pub fn new(dir: String) -> DownloadTracker {
        DownloadTracker {
            dir,
            inner: Mutex::default(),
        }
    }

    pub fn dir(&self) -> &str {
        &self.dir
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn staged(&self, guid: &str) -> String {
        node_path::join(&[&self.dir, guid])
    }

    /// 호출마다 — 저장 함수가 있으면 대기 폴더(0700)에 guid 이름으로만(allowAndName), 없으면 받지 않게(deny). 설정이 거절·
    /// 시간 초과면 오류 — 호출부는 액션을 하나도 실행하지 않는다. 그 작업(`task`)의 저장 함수는 설정에 성공한 뒤에만 바꾼다.
    /// Chrome 쪽 설정은 브라우저 전역이고 값은 늘 같은 대기 폴더다.
    pub async fn configure(
        &self,
        cdp: &CdpClient,
        task: &str,
        place: Option<PlaceDownload>,
    ) -> Result<(), String> {
        if place.is_some() {
            mkdir_private(&self.dir)
                .map_err(|e| node_error::format(&e, "mkdir", Some(&self.dir)))?;
        }
        let params = if place.is_some() {
            json!({"behavior": "allowAndName", "downloadPath": self.dir, "eventsEnabled": true})
        } else {
            json!({"behavior": "deny"})
        };
        cdp.send("Browser.setDownloadBehavior", params, None)
            .await
            .map_err(|e| format!("다운로드 설정에 실패해 실행하지 않았습니다: {e}"))?;
        let mut g = self.lock();
        g.places.retain(|(k, _)| k != task);
        g.places.push((task.to_owned(), place));
        Ok(())
    }

    /// Chrome 을 새로 띄우기 직전 — 프로필의 기본 다운로드 폴더를 대기 폴더로, 저장 위치 묻기를 끄게 맞춘다. 두 키만 바꾸고
    /// (다른 키 보존), 없거나 깨졌거나 객체가 아니면 두 키만 든 새 파일. 그 밖의 읽기 실패·쓰기 실패면 오류 — 호출부는 띄우지 않는다.
    /// 같은 폴더 임시 파일(0600) + rename — 쓰는 도중 죽어도 잘린 파일이 남지 않는다.
    pub fn set_launch_defaults(&self, profile_dir: &str) -> Result<(), String> {
        let file = node_path::join(&[profile_dir, BROWSER_PROFILE_DIRECTORY, "Preferences"]);
        let fmt =
            |e: &std::io::Error, syscall: &str, p: Option<&str>| node_error::format(e, syscall, p);
        let run = || -> Result<(), String> {
            // 기본 폴더가 없으면 Chrome 이 다른 폴더로 대신 받을 수 있다
            mkdir_private(&self.dir).map_err(|e| fmt(&e, "mkdir", Some(&self.dir)))?;
            let parent = node_path::dirname(&file);
            std::fs::create_dir_all(&parent).map_err(|e| fmt(&e, "mkdir", Some(&parent)))?;
            let text = match std::fs::read(&file) {
                Ok(b) => Some(String::from_utf8_lossy(&b).into_owned()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                // 일시 오류 등 — 멀쩡한 설정을 두 키로 덮지 않는다
                Err(e) if e.kind() == std::io::ErrorKind::IsADirectory => {
                    return Err(fmt(&e, "read", None));
                }
                Err(e) => return Err(fmt(&e, "open", Some(&file))),
            };
            let mut prefs: Map<String, Value> = text
                .and_then(|t| super::cdp::parse_lenient(&t))
                .and_then(|v| match v {
                    Value::Object(m) => Some(m),
                    _ => None,
                })
                .unwrap_or_default();
            let mut download = match prefs.remove("download") {
                Some(Value::Object(m)) => m,
                _ => Map::new(),
            };
            download.insert("default_directory".into(), Value::from(self.dir.as_str()));
            download.insert("prompt_for_download".into(), Value::Bool(false));
            prefs.insert("download".into(), Value::Object(download));
            let tmp = format!("{file}.omk-{}", std::process::id());
            let body = Value::Object(prefs).to_string();
            let written = write_private(&tmp, body.as_bytes())
                .map_err(|e| fmt(&e, "open", Some(&tmp)))
                .and_then(|()| {
                    std::fs::rename(&tmp, &file)
                        .map_err(|e| format!("{} -> '{file}'", fmt(&e, "rename", Some(&tmp))))
                });
            if written.is_err() {
                let _ = std::fs::remove_file(&tmp);
            }
            written
        };
        run().map_err(|m| {
            format!("Chrome 다운로드 기본 폴더를 설정하지 못해 브라우저를 띄우지 않았습니다: {m}")
        })
    }

    /// 대기 폴더를 비운다 — Chrome 을 새로 띄울 때만(이전 실행이 남긴 미완료분).
    pub fn clear(&self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }

    /// 연결을 새로 열 때 — 옛 연결의 받는 중 기록은 완료 이벤트가 더는 오지 않는다. failed 로 끝내고 대기 파일을 지운다.
    pub fn abandon(&self) {
        let mut g = self.lock();
        let mut keep = Vec::with_capacity(g.items.len());
        for (guid, mut d) in std::mem::take(&mut g.items) {
            if !d.finishing && d.report.state == DlState::InProgress {
                d.finishing = true;
                let _ = std::fs::remove_file(self.staged(&guid));
                d.report = DownloadReport {
                    error: Some(ABANDONED_ERROR.to_owned()),
                    ..DownloadReport::new(d.report.name.clone(), DlState::Failed)
                };
                d.done.send_replace(true);
                if d.task.is_none() {
                    continue;
                }
            }
            keep.push((guid, d));
        }
        g.items = keep;
    }

    /// 작업이 끝났다 — 저장 함수와 끝난 기록은 버리고, 받는 중인 것은 귀속만 푼다(옮기기는 묶인 함수로 그대로).
    pub fn forget(&self, task: &str) {
        let mut g = self.lock();
        g.places.retain(|(k, _)| k != task);
        g.items.retain_mut(|(_, d)| {
            if d.task.as_deref() != Some(task) {
                return true;
            }
            if d.report.state == DlState::InProgress {
                d.task = None;
                return true;
            }
            false
        });
    }

    /// 시작 이벤트 — guid 가 없거나 이미 있으면 버린다. 귀속 작업과 그 작업의 저장 함수를 묶는다(작업이 없으면 저장 함수도 없다).
    pub fn begin(&self, params: &Value, task: Option<String>) {
        let guid = str_of(params.get("guid"));
        let mut g = self.lock();
        if guid.is_empty() || g.items.iter().any(|(k, _)| *k == guid) {
            return;
        }
        let place = task.as_deref().and_then(|t| {
            g.places
                .iter()
                .find(|(k, _)| k == t)
                .and_then(|(_, p)| p.clone())
        });
        let name = str_of(params.get("suggestedFilename"));
        g.items.push((
            guid,
            Download {
                task,
                place,
                report: DownloadReport::new(name, DlState::InProgress),
                reported: None,
                finishing: false,
                done: watch::channel(false).0,
            },
        ));
    }

    /// 진행 이벤트 — 완료·취소면 마무리를 돌려준다(호출부가 태스크로 띄운다 — 옮기기를 그 자리에서 기다리지 않는다).
    pub fn progress(self: &Arc<Self>, params: &Value) -> Option<BoxFut<'static, ()>> {
        let guid = str_of(params.get("guid"));
        let state = params.get("state").and_then(Value::as_str);
        let completed = match state {
            Some("completed") => true,
            Some("canceled") => false,
            _ => return None,
        };
        {
            let mut g = self.lock();
            let d = g
                .items
                .iter_mut()
                .find(|(k, _)| *k == guid)
                .map(|(_, d)| d)?;
            if d.finishing {
                return None;
            }
            d.finishing = true;
        }
        let me = self.clone();
        Some(Box::pin(async move { me.finish(guid, completed).await }))
    }

    async fn finish(&self, guid: String, completed: bool) {
        let staged = self.staged(&guid);
        let (name, place) = {
            let g = self.lock();
            let Some((_, d)) = g.items.iter().find(|(k, _)| *k == guid) else {
                return;
            };
            (d.report.name.clone(), d.place.clone())
        };
        let report = if !completed {
            let _ = std::fs::remove_file(&staged);
            DownloadReport::new(name, DlState::Canceled)
        } else {
            let placed = match place {
                None => Err(PlaceError::Failed(NO_PLACE_ERROR.to_owned())),
                Some(p) => p(name.clone(), staged.clone()).await,
            };
            match placed {
                Ok(saved) => DownloadReport {
                    saved_as: Some(saved),
                    ..DownloadReport::new(name, DlState::Saved)
                },
                Err(e) => {
                    let _ = std::fs::remove_file(&staged);
                    let (state, msg) = match e {
                        PlaceError::Rejected(m) => (DlState::Rejected, m),
                        PlaceError::Failed(m) => (DlState::Failed, m),
                    };
                    DownloadReport {
                        error: Some(msg),
                        ..DownloadReport::new(name, state)
                    }
                }
            }
        };
        let mut g = self.lock();
        let Some(n) = g.items.iter().position(|(k, _)| *k == guid) else {
            return;
        };
        let d = &mut g.items[n].1;
        d.report = report;
        d.done.send_replace(true);
        if d.task.is_none() {
            g.items.remove(n);
        }
    }

    /// 이 작업의 아직 보고하지 않은 다운로드 — 받는 중인 것이 있으면 `wait_ms` 까지 기다린다. 넘으면 inProgress 로 싣고, 끝난
    /// 결과는 다음 호출에 싣는다(이미 inProgress 로 실은 것은 다시 기다리지 않는다). 끝난 상태를 실은 기록은 버린다.
    pub async fn report(&self, task: &str, wait_ms: u64) -> Vec<Obj> {
        let pending: Vec<watch::Receiver<bool>> = self
            .lock()
            .items
            .iter()
            .filter(|(_, d)| {
                d.task.as_deref() == Some(task)
                    && d.report.state == DlState::InProgress
                    && d.reported != Some(DlState::InProgress)
            })
            .map(|(_, d)| d.done.subscribe())
            .collect();
        if !pending.is_empty() {
            let all =
                futures_util::future::join_all(pending.into_iter().map(|mut rx| async move {
                    let _ = rx.wait_for(|done| *done).await;
                }));
            let _ = tokio::time::timeout(Duration::from_millis(wait_ms), all).await;
        }
        let mut g = self.lock();
        let mut out = Vec::new();
        g.items.retain_mut(|(_, d)| {
            if d.task.as_deref() != Some(task) || d.reported == Some(d.report.state) {
                return true;
            }
            out.push(d.report.to_obj());
            d.reported = Some(d.report.state);
            d.report.state == DlState::InProgress
        });
        out
    }
}
