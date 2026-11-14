//! 인자 — `--server <주소>`·`--resolve`(TS `helper.mjs:43~46,57`).

/// `--server` 가 없을 때의 주소 — TS 기본값과 같은 글자.
pub const DEFAULT_SERVER: &str = "http://localhost:52416";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Args {
    pub server: String,
    /// 주소만 찾아 한 줄로 내고 끝낸다.
    pub resolve: bool,
}

/// 프로그램 이름을 뺀 인자. 처음 나온 `--server` 의 다음 인자를 (무엇이든) 주소로 쓴다 — TS `argv.indexOf`.
/// `--server` 가 마지막이라 값이 없으면 기본 주소(TS 는 `undefined` 로 깨진 결과 — D-106-6).
pub fn parse(argv: &[String]) -> Args {
    let server = argv
        .iter()
        .position(|a| a == "--server")
        .and_then(|i| argv.get(i + 1))
        .map_or_else(|| DEFAULT_SERVER.to_owned(), Clone::clone);
    Args {
        server,
        resolve: argv.iter().any(|a| a == "--resolve"),
    }
}

#[cfg(test)]
mod tests {
    use super::{Args, DEFAULT_SERVER, parse};

    fn p(a: &[&str]) -> Args {
        parse(&a.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn server_and_resolve() {
        assert_eq!(
            p(&[]),
            Args {
                server: DEFAULT_SERVER.to_owned(),
                resolve: false
            }
        );
        assert_eq!(
            p(&["--server", "http://127.0.0.1:9"]).server,
            "http://127.0.0.1:9"
        );
        assert!(p(&["--server", "http://x", "--resolve"]).resolve);
        assert!(p(&["--resolve", "--server", "http://x"]).resolve);
        // 처음 나온 것만
        assert_eq!(p(&["--server", "a", "--server", "b"]).server, "a");
        // 다음 인자는 무엇이든 값이다(TS 그대로) — 그래서 이 경우 resolve 도 켜진다
        assert_eq!(
            p(&["--server", "--resolve"]),
            Args {
                server: "--resolve".to_owned(),
                resolve: true
            }
        );
        // 값 없는 --server 는 기본 주소
        assert_eq!(p(&["--server"]).server, DEFAULT_SERVER);
        // 모르는 인자는 무시
        assert_eq!(p(&["--x", "y"]).server, DEFAULT_SERVER);
        // 빈 값도 값이다(TS 그대로 — 주소 찾기가 잘못된 주소로 본다)
        assert_eq!(p(&["--server", ""]).server, "");
    }
}
