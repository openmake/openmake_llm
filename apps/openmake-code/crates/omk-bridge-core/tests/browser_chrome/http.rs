//! 실제 Chrome 테스트의 작은 HTTP 서버(tokio `net`, 손으로 쓴 응답 — `hyper` 를 코어 개발 의존에 넣지 않는다, 계획 §6).
//! 요청마다 `Connection: close`. `Hold` 응답은 앞부분만 보내고 소켓을 끝까지 쥔다(문서가 계속 `loading`).

use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// 받은 요청 — 경로·질의(`?` 포함, 없으면 빈 글자)·Cookie 머리.
pub struct Req {
    pub path: String,
    pub search: String,
    pub cookie: String,
}

impl Req {
    /// 질의 값 하나 — 테스트 이름은 ASCII 뿐이라 퍼센트 풀기는 `+`·`%xx` 만 본다.
    pub fn param(&self, key: &str) -> Option<String> {
        self.search
            .trim_start_matches('?')
            .split('&')
            .filter_map(|kv| kv.split_once('='))
            .find(|(k, _)| *k == key)
            .map(|(_, v)| decode(v))
    }
}

/// 질의·폼 값 풀기 — `+` 는 공백, `%xx` 는 바이트.
pub fn decode(v: &str) -> String {
    let b = v.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                let hex = std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(x) => {
                        out.push(x);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub enum Resp {
    /// 상태·머리(이름, 값)·본문
    Full(u16, Vec<(String, String)>, Vec<u8>),
    /// 앞부분만 보내고 끝내지 않는다
    Hold(String),
}

pub fn html(body: &str) -> Resp {
    let h = vec![("Content-Type".into(), "text/html; charset=utf-8".into())];
    Resp::Full(200, h, body.as_bytes().to_vec())
}

pub fn not_found() -> Resp {
    let h = vec![("Content-Type".into(), "text/html; charset=utf-8".into())];
    Resp::Full(404, h, b"not found".to_vec())
}

pub type Handler = Arc<dyn Fn(&Req) -> Resp + Send + Sync>;

pub struct Server {
    pub port: u16,
    pub hits: Arc<Mutex<Vec<String>>>,
    held: Arc<Mutex<Vec<TcpStream>>>,
}

impl Server {
    pub fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// 같은 서버, 다른 호스트 이름 — 사이트 정책에서는 다른 사이트다.
    pub fn other(&self) -> String {
        format!("http://localhost:{}", self.port)
    }

    /// 쥐고 있던 느린 응답을 끝낸다.
    pub async fn finish_held(&self) {
        let held: Vec<TcpStream> = std::mem::take(&mut *self.held.lock().unwrap());
        for mut s in held {
            let _ = s.write_all(b"</body></html>").await;
            let _ = s.shutdown().await;
        }
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        302 => "Found",
        _ => "Not Found",
    }
}

async fn handle(
    mut s: TcpStream,
    handler: Handler,
    hits: Arc<Mutex<Vec<String>>>,
    held: Arc<Mutex<Vec<TcpStream>>>,
) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        match s.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let head = String::from_utf8_lossy(&buf).into_owned();
    let target = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
    hits.lock().unwrap().push(target.clone());
    let (path, search) = match target.find('?') {
        Some(i) => (target[..i].to_owned(), target[i..].to_owned()),
        None => (target.clone(), String::new()),
    };
    let cookie = head
        .lines()
        .find_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.eq_ignore_ascii_case("cookie")
                .then(|| v.trim().to_owned())
        })
        .unwrap_or_default();
    match handler(&Req {
        path,
        search,
        cookie,
    }) {
        Resp::Full(status, headers, body) => {
            let mut out = format!("HTTP/1.1 {status} {}\r\n", reason(status));
            for (k, v) in headers {
                out.push_str(&format!("{k}: {v}\r\n"));
            }
            out.push_str(&format!(
                "Content-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            ));
            let _ = s.write_all(out.as_bytes()).await;
            let _ = s.write_all(&body).await;
            let _ = s.shutdown().await;
        }
        Resp::Hold(partial) => {
            let out = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n{partial}"
            );
            let _ = s.write_all(out.as_bytes()).await;
            held.lock().unwrap().push(s);
        }
    }
}

/// 루프백에 띄운다 — 런타임 안에서 부른다.
pub async fn serve(handler: Handler) -> Server {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(Mutex::new(Vec::new()));
    let held = Arc::new(Mutex::new(Vec::new()));
    let (h, k) = (hits.clone(), held.clone());
    tokio::spawn(async move {
        while let Ok((s, _)) = listener.accept().await {
            tokio::spawn(handle(s, handler.clone(), h.clone(), k.clone()));
        }
    });
    Server { port, hits, held }
}
