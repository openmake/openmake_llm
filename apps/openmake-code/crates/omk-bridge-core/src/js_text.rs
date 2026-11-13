//! JS 문자열 다듬기 — `String.prototype.trim` 과 UTF-16 단위 `slice(0, n)`. git 출력 다듬기·오류 꼬리 자르기에 쓴다.
//! Rust `str::trim` 은 공백 집합이 다르다(U+0085 는 Rust 만, U+FEFF 는 JS 만) — Node 24.22.2 로 0~U+FFFF 를 훑은 표.

/// JS 의 WhiteSpace + LineTerminator(ECMA-262) — `trim` 이 걷어내는 글자 25개.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// `String.prototype.trim`.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// `s.slice(0, n)` — 길이를 UTF-16 단위로 센다. 끝이 대리 쌍 한가운데면 그 글자를 뺀다
/// (JS 는 짝 없는 반쪽을 남기지만 Rust 문자열은 그것을 담을 수 없다).
pub fn utf16_prefix(s: &str, n: usize) -> &str {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        units += c.len_utf16();
        if units > n {
            return &s[..i];
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::{is_js_whitespace, js_trim, utf16_prefix};

    /// Node 24.22.2 실측: `("a" + String.fromCharCode(c)).trim() === "a"` 인 코드 단위.
    const NODE_WS: [u32; 25] = [
        0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
        0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
        0xfeff,
    ];

    #[test]
    fn whitespace_set_matches_node() {
        let ours: Vec<u32> = (0..=0xffff_u32)
            .filter_map(char::from_u32)
            .filter(|c| is_js_whitespace(*c))
            .map(u32::from)
            .collect();
        assert_eq!(ours, NODE_WS);
        assert_eq!(js_trim("\u{85}x\u{feff}"), "\u{85}x");
        assert_eq!(js_trim(" \t\n x y \r\n"), "x y");
        assert_eq!(js_trim(""), "");
    }

    #[test]
    fn prefix_counts_utf16_units() {
        assert_eq!(utf16_prefix("abc", 2), "ab");
        assert_eq!(utf16_prefix("abc", 9), "abc");
        assert_eq!(utf16_prefix("가나다", 2), "가나");
        // 이모지는 2단위 — 한가운데서 자르면 그 글자를 뺀다(JS 는 반쪽 "\ud83d" 를 남긴다).
        assert_eq!(utf16_prefix("😀abc", 1), "");
        assert_eq!(utf16_prefix("😀abc", 2), "😀");
        assert_eq!(utf16_prefix("x", 0), "");
    }
}
