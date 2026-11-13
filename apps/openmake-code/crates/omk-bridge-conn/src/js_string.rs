//! JS 문자열 연산 중 연결부가 쓰는 것 — `String.prototype.trim` 과 UTF-16 단위 `slice(0, n)`.
//! Rust `str::trim` 은 공백 집합이 달라(U+FEFF 는 JS 만, U+0085 는 Rust 만) 따로 둔다.

/// JS 의 WhiteSpace + LineTerminator(ECMA-262) — `trim` 이 걷어내는 글자.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// `String.prototype.trim`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// `s.slice(0, max)` — 길이를 UTF-16 단위로 센다. 끝이 대리 쌍 한가운데면 그 글자를 뺀다
/// (JS 는 짝 없는 반쪽을 남기지만 Rust 문자열은 그것을 담을 수 없다).
pub fn slice_utf16(s: &str, max: usize) -> &str {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        units += c.len_utf16();
        if units > max {
            return &s[..i];
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::{slice_utf16, trim};

    #[test]
    fn trim_uses_js_whitespace_set() {
        assert_eq!(trim("\u{FEFF}\u{3000} a \u{2029}"), "a");
        assert_eq!(trim("\u{0085}a\u{200B}"), "\u{0085}a\u{200B}");
    }

    #[test]
    fn slice_counts_utf16_units_and_drops_split_pair() {
        assert_eq!(slice_utf16("한글abc", 3), "한글a");
        assert_eq!(slice_utf16("ab\u{1F600}", 4), "ab\u{1F600}");
        // 100 단위 경계가 이모지 한가운데 — JS 는 반쪽(\ud83d)을 남기고, Rust 는 그 글자를 뺀다(D-49-4).
        let s = format!("x{}", "\u{1F600}".repeat(50));
        let cut = slice_utf16(&s, 100);
        assert_eq!(cut.encode_utf16().count(), 99);
        assert_eq!(cut, format!("x{}", "\u{1F600}".repeat(49)));
        assert_eq!(slice_utf16("abc", 0), "");
    }
}
