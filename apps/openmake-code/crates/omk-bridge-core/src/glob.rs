//! 글롭 판정 — TS `code-nav.ts` `globToRegExp` 의 뜻을 정규식 엔진 없이 옮긴다(설계 D-60).
//!
//! TS 는 글롭을 정규식 글자로 바꿔 `new RegExp` 에 넘긴다. 글롭은 서버(모델)가 주는 길이 제한 없는 값이라
//! 역추적 엔진에서는 `*a*a*a…b` 꼴이 이름 길이의 거듭제곱으로 느려진다. 여기서는 토큰 열 × UTF-16 단위 열의
//! 표를 채워 같은 정규 언어를 판정한다(시간은 곱에 비례, 메모리는 이름 길이의 두 행).
//! 뜻은 TS 정규식과 단위까지 같다: `*` = `/` 가 아닌 단위 0개 이상(`[^/]*`), `**` = 줄 끝 문자가 아닌 단위 0개 이상
//! (JS `.*`), `?` = `/` 가 아닌 단위 하나(`[^/]` — 보충 문자는 단위 둘이다), 나머지는 글자 그대로.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tok {
    Star,
    DoubleStar,
    Question,
    Unit(u16),
}

const SLASH: u16 = b'/' as u16;

/// JS 정규식 `.` 가 맞지 않는 줄 끝 문자.
fn is_line_terminator(u: u16) -> bool {
    matches!(u, 0x0a | 0x0d | 0x2028 | 0x2029)
}

fn ascii_lower(u: u16) -> u16 {
    if (u16::from(b'A')..=u16::from(b'Z')).contains(&u) {
        u + 32
    } else {
        u
    }
}

/// 글롭 하나.
#[derive(Debug, Clone)]
pub struct Glob {
    tokens: Vec<Tok>,
    basename_only: bool,
}

impl Glob {
    /// TS 의 `for` 문과 같은 순서로 읽는다 — `**` 바로 뒤의 `/` 는 먹는다(`a**/b` = `a` `**` `b`), `***` = `**` + `*`.
    pub fn parse(glob: &str) -> Glob {
        let units: Vec<u16> = glob.encode_utf16().collect();
        let star = u16::from(b'*');
        let mut tokens = Vec::with_capacity(units.len());
        let mut i = 0;
        while i < units.len() {
            let c = units[i];
            if c == star {
                if units.get(i + 1) == Some(&star) {
                    tokens.push(Tok::DoubleStar);
                    i += 1;
                    if units.get(i + 1) == Some(&SLASH) {
                        i += 1;
                    }
                } else {
                    tokens.push(Tok::Star);
                }
            } else if c == u16::from(b'?') {
                tokens.push(Tok::Question);
            } else {
                tokens.push(Tok::Unit(c));
            }
            i += 1;
        }
        Glob {
            tokens,
            basename_only: !glob.contains('/'),
        }
    }

    /// 글롭에 `/` 가 없으면 파일 이름(마지막 구간)에만 적용한다.
    pub fn basename_only(&self) -> bool {
        self.basename_only
    }

    /// 이름 전체가 글롭에 맞는가(`^…$`) — 대소문자를 가린다.
    pub fn is_match(&self, text: &str) -> bool {
        self.matches(text, |a, b| a == b)
    }

    /// ASCII 대소문자만 무시한다 — 민감 파일 표(모두 ASCII)의 판정. JS `u` 없는 `i` 와 같다(비ASCII 를 ASCII 로 접지 않는다).
    pub fn is_match_ascii_icase(&self, text: &str) -> bool {
        self.matches(text, |a, b| ascii_lower(a) == ascii_lower(b))
    }

    fn matches(&self, text: &str, eq: impl Fn(u16, u16) -> bool) -> bool {
        let t: Vec<u16> = text.encode_utf16().collect();
        let n = t.len();
        // prev[j] = 앞의 토큰들이 t[..j] 전체에 맞는가.
        let mut prev = vec![false; n + 1];
        let mut cur = vec![false; n + 1];
        prev[0] = true;
        for tok in &self.tokens {
            match *tok {
                Tok::Star | Tok::DoubleStar => {
                    let ok = |u: u16| match *tok {
                        Tok::Star => u != SLASH,
                        _ => !is_line_terminator(u),
                    };
                    cur[0] = prev[0];
                    for j in 1..=n {
                        cur[j] = prev[j] || (cur[j - 1] && ok(t[j - 1]));
                    }
                }
                Tok::Question => {
                    cur[0] = false;
                    for j in 1..=n {
                        cur[j] = prev[j - 1] && t[j - 1] != SLASH;
                    }
                }
                Tok::Unit(u) => {
                    cur[0] = false;
                    for j in 1..=n {
                        cur[j] = prev[j - 1] && eq(t[j - 1], u);
                    }
                }
            }
            std::mem::swap(&mut prev, &mut cur);
            if !prev.iter().any(|&b| b) {
                return false;
            }
        }
        prev[n]
    }
}

#[cfg(test)]
mod tests {
    use super::Glob;

    /// 별이 많은 글롭도 표 채우기라 이름 길이에 비례한다(역추적 없음, D-60).
    #[test]
    fn many_stars_against_long_name_is_fast() {
        let g = Glob::parse(&"*a".repeat(20));
        let name = "a".repeat(999) + "b";
        let t = std::time::Instant::now();
        assert!(!g.is_match(&name));
        assert!(g.is_match(&"a".repeat(1000)));
        assert!(t.elapsed().as_millis() < 50, "{:?}", t.elapsed());
    }

    /// 기대값은 Node 24.22.2 `globToRegExp(g).re.test(t)` 실측.
    #[test]
    fn tokens_follow_ts_loop() {
        for (glob, text, want) in [
            ("***", "a\n", true),
            ("***", "\n/a", false),
            ("a**/b", "axb", true),
            ("a**/b", "a/b/", false),
            ("**/", "", true),
            ("**/", "a/", true),
            ("*/", "a/", true),
            ("?", "\u{ff21}", true),
            ("?", "😀", false),
            ("??", "😀", true),
            ("😀", "😀", true),
            ("**", "a\u{85}b", true),
            ("**", "a\u{2028}b", false),
        ] {
            assert_eq!(Glob::parse(glob).is_match(text), want, "{glob:?} {text:?}");
        }
    }

    /// 민감 파일 표의 비교 — ASCII 만 접는다(JS 의 u 없는 i 와 같다: ſ·K 는 접히지 않는다).
    #[test]
    fn ascii_icase_folds_only_ascii() {
        let g = Glob::parse("*.key");
        assert!(g.is_match_ascii_icase("A.KEY"));
        assert!(!g.is_match("A.KEY"));
        assert!(!g.is_match_ascii_icase("a.\u{212a}ey"));
        assert!(!Glob::parse("credentials").is_match_ascii_icase("credential\u{17f}"));
        assert!(Glob::parse("credentials").is_match_ascii_icase("CREDENTIALS"));
    }
}
