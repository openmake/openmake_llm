//! LocalBrowser 의 실행 조정(TS `local-browser-scheduler.ts`) — 작업별 실행 줄·동시 실행 자리·중지 요청.
//!
//! 같은 작업의 요청은 순서대로, 다른 작업은 `BROWSER_MAX_CONCURRENT` 까지 동시에 실행한다. 다운로드 폴더는 브라우저 전역 설정이라
//! 다운로드 폴더가 다른 작업끼리는 동시에 돌리지 않는다. 줄의 차례·실행 자리는 `Drop` 가드로 돌려준다 — 호출부가 `run` 의 future
//! 를 버려도 새지 않는다(TS `finally`, D-73).

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};

use tokio::sync::Notify;
use tokio::sync::futures::Notified;

use super::constants::BROWSER_MAX_CONCURRENT;

#[derive(Default)]
struct State {
    /// 중지 요청마다 오른다 — 실행 중인 요청이 시작 때의 값과 달라지면 멈춘다(전체 중지·제어권)
    stop_generation: u64,
    /// 작업별 중지
    task_stops: HashMap<String, u64>,
    /// 작업별 실행 줄 — 앞에 선 차례표가 실행할 차례다
    queues: HashMap<String, VecDeque<u64>>,
    next_ticket: u64,
    /// 지금 실행 중인 작업과 그 다운로드 폴더
    running: Vec<(String, String)>,
}

#[derive(Default)]
pub struct BrowserScheduler {
    state: Mutex<State>,
    /// 실행이 끝날 때(또는 줄의 차례표가 빠질 때)마다 기다리는 모두를 깨운다 — 깨어난 쪽이 조건을 다시 본다
    released: Notify,
}

/// 요청을 시작할 때의 중지 값 — 그 뒤 전체 중지·제어권이나 그 작업의 중지가 있었는지 본다.
pub struct StopCheck {
    sched: Arc<BrowserScheduler>,
    key: String,
    generation: u64,
    task_generation: u64,
}

impl StopCheck {
    pub fn stopped(&self) -> bool {
        let s = self.sched.lock();
        s.stop_generation != self.generation
            || s.task_stops.get(&self.key).copied().unwrap_or(0) != self.task_generation
    }
}

/// 줄의 차례표와 실행 자리 — 버려지면(끝남·취소) 돌려준다.
struct Turn<'a> {
    sched: &'a BrowserScheduler,
    key: &'a str,
    ticket: u64,
}

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        {
            let mut s = self.sched.lock();
            if let Some(q) = s.queues.get_mut(self.key) {
                let mine = q.front() == Some(&self.ticket);
                q.retain(|t| *t != self.ticket);
                if q.is_empty() {
                    s.queues.remove(self.key);
                }
                if mine {
                    s.running.retain(|(k, _)| k != self.key);
                }
            }
        }
        self.sched.released.notify_waiters();
    }
}

impl BrowserScheduler {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// 실행 중인 요청을 멈춘다(다음 액션부터 실행하지 않는다). 작업을 주면 그 작업만, 없으면 모두.
    pub fn request_stop(&self, task: Option<&str>) {
        let mut s = self.lock();
        match task {
            None => s.stop_generation += 1,
            Some(k) => *s.task_stops.entry(k.to_owned()).or_insert(0) += 1,
        }
    }

    /// 지금 시작하는 요청의 중지 확인.
    pub fn stop_check(self: &Arc<Self>, key: &str) -> StopCheck {
        let s = self.lock();
        StopCheck {
            sched: self.clone(),
            key: key.to_owned(),
            generation: s.stop_generation,
            task_generation: s.task_stops.get(key).copied().unwrap_or(0),
        }
    }

    /// 작업이 끝났다 — 그 작업의 중지 기록을 지운다.
    pub fn forget_task(&self, key: &str) {
        self.lock().task_stops.remove(key);
    }

    pub fn is_running(&self, key: &str) -> bool {
        self.lock().running.iter().any(|(k, _)| k == key)
    }

    /// 다음 실행이 끝날 때까지 기다린다(실행 자리·탭 자리 공용). **부르는 순간 등록한다** — 조건을 본 뒤 기다리면 그 사이의
    /// 끝남을 놓치므로, 먼저 부르고 조건을 본 다음 기다린다.
    pub fn next_release(&self) -> Pin<Box<Notified<'_>>> {
        let mut n = Box::pin(self.released.notified());
        n.as_mut().enable();
        n
    }

    /// 요청 1건 실행 — 같은 작업은 순서대로, 다른 작업은 동시 실행 상한까지 함께.
    pub async fn run<F: Future>(&self, key: &str, download_dir: &str, f: F) -> F::Output {
        let ticket = {
            let mut s = self.lock();
            let t = s.next_ticket;
            s.next_ticket += 1;
            s.queues.entry(key.to_owned()).or_default().push_back(t);
            t
        };
        let _turn = Turn {
            sched: self,
            key,
            ticket,
        };
        loop {
            let wake = self.next_release();
            let my_turn = self.lock().queues.get(key).and_then(|q| q.front()) == Some(&ticket);
            if my_turn {
                break;
            }
            wake.await;
        }
        // 실행 자리 — 상한 안이고, 실행 중인 작업이 모두 같은 다운로드 폴더일 때
        loop {
            let wake = self.next_release();
            {
                let mut s = self.lock();
                if s.running.len() < BROWSER_MAX_CONCURRENT
                    && s.running.iter().all(|(_, d)| d == download_dir)
                {
                    s.running.push((key.to_owned(), download_dir.to_owned()));
                    break;
                }
            }
            wake.await;
        }
        f.await
    }
}
