//! grep 패턴 — TS `new RegExp(src, flags)` + `re.test(줄)` 을 `regress` 로 옮긴다(설계 D-61).
//!
//! 두 가지를 더한다. ① 줄을 UTF-16(UCS-2) 단위로 판정한다 — 기본 API(`find(&str)`)는 글자 단위라 JS 와 갈린다
//! (`^.$` 대 보충 문자 한 글자). ② 패턴 안의 보충 문자를 대리 쌍 두 단위로 풀어 쓴다 — regress 는 패턴을 글자 단위로
//! 읽어 UCS-2 판정에서 보충 문자 리터럴이 무엇에도 맞지 않는다(JS 는 패턴도 단위로 읽는다).
//! 엔진 차이는 남는다: 구문 오류 꼬리 문구, `u` 없는 `\u{61}`, `i` 의 ſ·K 접기(README "fixture 에 넣지 않는 차이").

use std::borrow::Cow;

/// 컴파일 실패 문구의 접두 — 꼬리는 엔진 문구라 TS(V8)와 다르다(fixture 는 `error-prefix` 로 본다).
pub const INVALID_PREFIX: &str = "정규식이 올바르지 않습니다: ";

/// 보충 문자를 범위 끝점으로 쓴 클래스 — JS 는 반쪽 단위로 범위를 만들어 대개 구문 오류다(`[a-😀]` 만 통과). 거절한다.
const ASTRAL_RANGE: &str = "보충 문자는 문자 클래스 범위의 끝점으로 쓸 수 없습니다";

/// 컴파일한 패턴 — 판정은 UTF-16 단위로 한다.
pub struct JsRegex {
    re: regress::Regex,
}

fn hex(u: u16) -> String {
    format!("\\u{u:04X}")
}

/// 보충 문자 하나를 단위 둘로 — 클래스 밖은 `[\uHHHH][\uLLLL]`(수량자는 뒤 단위에만 붙는다 — JS 와 같다),
/// 클래스 안은 `\uLLLL\uHHHH`(뒤 단위를 먼저 — regress 가 두 단위를 한 글자로 합치지 않게).
fn push_units(out: &mut String, c: char, in_class: bool) {
    let mut b = [0u16; 2];
    c.encode_utf16(&mut b);
    if in_class {
        out.push_str(&hex(b[1]));
        out.push_str(&hex(b[0]));
    } else {
        out.push('[');
        out.push_str(&hex(b[0]));
        out.push_str("][");
        out.push_str(&hex(b[1]));
        out.push(']');
    }
}

fn is_astral(c: char) -> bool {
    u32::from(c) > 0xffff
}

/// 패턴 안의 보충 문자(U+10000 이상)를 대리 쌍 두 단위로 풀어 쓴다. `\` 이스케이프와 `[...]` 안팎을 구분하고,
/// `\` 바로 뒤의 보충 문자는 `\` 를 빼고 같은 규칙. 클래스 안에서 `-` 와 맞닿은 보충 문자는 거절한다(Rust 가 더 엄격).
/// 보충 문자가 없는 패턴은 글자 하나 바꾸지 않는다. 실패는 꼬리 문구(접두 없음).
pub fn expand_astral(src: &str) -> Result<Cow<'_, str>, String> {
    if !src.chars().any(is_astral) {
        return Ok(Cow::Borrowed(src));
    }
    let chars: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len() * 2);
    let mut in_class = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        let astral = match (c, next) {
            ('\\', Some(n)) if is_astral(n) => Some((n, 2)),
            (c, _) if is_astral(c) => Some((c, 1)),
            _ => None,
        };
        if let Some((a, width)) = astral {
            let before = i.checked_sub(1).map(|b| chars[b]);
            let after = chars.get(i + width).copied();
            if in_class && (before == Some('-') || after == Some('-')) {
                return Err(ASTRAL_RANGE.to_owned());
            }
            push_units(&mut out, a, in_class);
            i += width;
            continue;
        }
        match c {
            '\\' => {
                out.push(c);
                if let Some(n) = next {
                    out.push(n);
                }
                i += 2;
                continue;
            }
            '[' if !in_class => in_class = true,
            ']' if in_class => in_class = false,
            _ => {}
        }
        out.push(c);
        i += 1;
    }
    Ok(Cow::Owned(out))
}

/// `new RegExp(src, ignoreCase ? 'i' : '')` — 실패는 `정규식이 올바르지 않습니다: <꼬리>`.
pub fn compile(src: &str, ignore_case: bool) -> Result<JsRegex, String> {
    let expanded = expand_astral(src).map_err(|tail| format!("{INVALID_PREFIX}{tail}"))?;
    let flags = if ignore_case { "i" } else { "" };
    regress::Regex::with_flags(&expanded, flags)
        .map(|re| JsRegex { re })
        .map_err(|e| format!("{INVALID_PREFIX}{e}"))
}

impl JsRegex {
    /// `re.test(줄)` — 줄은 UTF-16 단위 열.
    pub fn test_units(&self, units: &[u16]) -> bool {
        self.re.find_from_ucs2(units, 0).next().is_some()
    }

    /// `re.exec(s)` 의 캡처 — 0 번은 일치 전체. 맞지 않으면 `None`. 단위 범위를 글자로 되돌린다
    /// (대리 쌍 한가운데서 갈리는 캡처는 U+FFFD 가 된다 — 고정 패턴(tsc 줄)에만 쓴다).
    pub fn exec(&self, s: &str) -> Option<Vec<Option<String>>> {
        let units: Vec<u16> = s.encode_utf16().collect();
        let m = self.re.find_from_ucs2(&units, 0).next()?;
        let groups = (0..=m.captures.len())
            .map(|i| m.group(i).map(|r| String::from_utf16_lossy(&units[r])))
            .collect();
        Some(groups)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::{INVALID_PREFIX, compile, expand_astral};

    fn units(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    /// 기대값은 Node 24.22.2 `new RegExp(p, i ? 'i' : '').test(줄)` 실측 — 두 엔진이 같은 것.
    #[test]
    fn judgement_matches_node() {
        let cases: &[(&str, bool, &str, bool)] = &[
            ("^.$", false, "😀", false),
            ("^..$", false, "😀", true),
            ("😀", false, "😀", true),
            ("😀", false, "x😀y", true),
            ("😀+", false, "😀😀", true),
            ("^😀+$", false, "😀😀", false),
            ("^[😀]$", false, "😀", false),
            ("[^😀]", false, "😀", false),
            ("\\😀", false, "😀", true),
            ("a{", false, "a{", true),
            ("]", false, "]", true),
            ("\\c", false, "\\c", true),
            ("\\8", false, "8", true),
            ("\\k", false, "k", true),
            ("(?<=a)b", false, "ab", true),
            ("(?<!a)b", false, "ab", false),
            ("(?<n>a)\\k<n>", false, "aa", true),
            ("[^]", false, "\n", true),
            ("[]", false, "a", false),
            ("[가-힣]+", false, "한글", true),
            ("a|b", false, "b", true),
            ("\\bfoo\\b", false, "a foo b", true),
            ("\\bfoo\\b", false, "afoo", false),
            ("a{1,2}", false, "aa", true),
            ("\\u0061", false, "a", true),
            ("\\x61", false, "a", true),
            ("\\d+", false, "x9", true),
            ("\\w", false, "_", true),
            ("\\s", false, "\u{feff}", true),
            (".", false, "\n", false),
            (".", false, "\u{2028}", false),
            ("^$", false, "", true),
            ("(a)\\1", false, "aa", true),
            ("[\\]]", false, "]", true),
            ("(?:a)", false, "a", true),
            ("a(?=b)", false, "ab", true),
            ("a(?!b)", false, "ab", false),
            ("[\\b]", false, "\u{8}", true),
            ("\\0", false, "\u{0000}", true),
            ("ONE", true, "one", true),
            ("[a-z]", true, "Q", true),
            ("function\\s+\\w+", false, "function foo(", true),
            ("import .* from", false, "import x from 'y'", true),
            ("TODO|FIXME", true, "// fixme", true),
        ];
        for (p, icase, line, want) in cases {
            let re = compile(p, *icase).unwrap();
            assert_eq!(
                re.test_units(&units(line)),
                *want,
                "{p:?} i={icase} {line:?}"
            );
        }
    }

    /// 짝 없는 반쪽 단위가 든 줄(JS 문자열은 담을 수 있다) — Node 실측.
    #[test]
    fn lone_surrogate_lines_match_node() {
        let (hi, lo) = (0xd83d_u16, 0xde00_u16);
        let cases: [(&str, Vec<u16>, bool); 4] = [
            ("^😀+$", vec![hi, lo, lo], true),
            ("[😀]", vec![hi, u16::from(b'x')], true),
            ("[\\😀]", vec![lo], true),
            ("^[😀]$", vec![hi, lo], false),
        ];
        for (p, line, want) in cases {
            assert_eq!(compile(p, false).unwrap().test_units(&line), want, "{p:?}");
        }
    }

    /// fixture 에 넣지 않는 차이(README) — Rust 값으로 고정한다. Node 는 모두 반대다.
    /// `u` 없는 `\u{61}` 를 regress 는 `a` 로 읽고(JS 는 `u` 61번), `i` 에서 ſ(U+017F)를 s 로, 클래스 안의 K(U+212A)를 k 로 접는다.
    #[test]
    fn known_engine_differences_are_pinned() {
        let a = units("a");
        let u61 = units(&"u".repeat(61));
        assert!(compile("\\u{61}", false).unwrap().test_units(&a));
        assert!(!compile("\\u{61}", false).unwrap().test_units(&u61));
        assert!(compile("s", true).unwrap().test_units(&units("\u{17f}")));
        assert!(
            !compile("k", true).unwrap().test_units(&units("\u{212a}")),
            "리터럴 k 는 두 엔진 모두 접지 않는다"
        );
        assert!(
            compile("[a-z]", true)
                .unwrap()
                .test_units(&units("\u{212a}"))
        );
        assert!(compile("\\w", true).unwrap().test_units(&units("\u{17f}")));
    }

    #[test]
    fn expand_astral_rewrites_only_astral() {
        assert!(matches!(
            expand_astral("abc[x]\\d"),
            Ok(std::borrow::Cow::Borrowed(_))
        ));
        let ok = |p: &str| expand_astral(p).unwrap().into_owned();
        assert_eq!(ok("😀+"), "[\\uD83D][\\uDE00]+");
        assert_eq!(ok("[a😀]"), "[a\\uDE00\\uD83D]");
        assert_eq!(ok("\\😀"), "[\\uD83D][\\uDE00]");
        assert_eq!(ok("[\\😀]"), "[\\uDE00\\uD83D]");
        assert_eq!(ok("\\[😀"), "\\[[\\uD83D][\\uDE00]");
        assert_eq!(ok("[\\]😀]"), "[\\]\\uDE00\\uD83D]");
        for p in ["[😀-z]", "[a-😀]", "[😀-😎]"] {
            assert!(expand_astral(p).is_err(), "{p:?}");
        }
    }

    #[test]
    fn errors_keep_prefix_and_engine_text() {
        let e = compile("(", false).err().unwrap();
        assert!(e.starts_with(INVALID_PREFIX), "{e}");
        assert!(e.len() > INVALID_PREFIX.len());
        let e = compile("[😀-z]", false).err().unwrap();
        assert!(e.starts_with(INVALID_PREFIX), "{e}");
    }
}
