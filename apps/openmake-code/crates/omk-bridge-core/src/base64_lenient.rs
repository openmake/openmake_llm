//! Node `Buffer.from(s, 'base64')` 와 같은 관대한 base64 해석(설계 D-20).
//!
//! 엄격한 해석기를 쓰면 같은 입력에 한쪽만 실패한다. 규칙은 Node 24.22.2 를 돌려 확인했다.
//! - 문자열은 UTF-16 단위로 읽고 각 단위의 **하위 바이트**만 본다(Node 가 두 바이트 문자열을 그렇게 읽는다 — `Ł`(U+0141)는 `A`).
//! - 표준(`+` `/`)과 URL 안전(`-` `_`) 문자를 모두 받는다. 그 밖의 바이트(공백·개행·잘못된 문자)는 건너뛴다.
//! - 첫 `=` 에서 멈춘다(뒤에 무엇이 있든).
//! - 남은 글자 2개는 1바이트, 3개는 2바이트, 1개는 버린다. 남는 비트가 0 이 아니어도 버린다.

fn sextet(b: u8) -> Option<u32> {
    let v = match b {
        b'A'..=b'Z' => b - b'A',
        b'a'..=b'z' => b - b'a' + 26,
        b'0'..=b'9' => b - b'0' + 52,
        b'+' | b'-' => 62,
        b'/' | b'_' => 63,
        _ => return None,
    };
    Some(u32::from(v))
}

pub fn decode(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3 + 2);
    let mut acc: u32 = 0;
    let mut n = 0;
    for unit in s.encode_utf16() {
        let b = (unit & 0xff) as u8;
        if b == b'=' {
            break;
        }
        let Some(v) = sextet(b) else { continue };
        acc = (acc << 6) | v;
        n += 1;
        if n == 4 {
            out.extend([(acc >> 16) as u8, (acc >> 8) as u8, acc as u8]);
            acc = 0;
            n = 0;
        }
    }
    match n {
        2 => out.push((acc >> 4) as u8),
        3 => out.extend([(acc >> 10) as u8, (acc >> 2) as u8]),
        _ => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::decode;

    /// 기대값은 Node 24.22.2 `[...Buffer.from(s, 'base64')]` 결과다.
    #[test]
    fn matches_node() {
        let cases: [(&str, &[u8]); 16] = [
            ("", &[]),
            ("aGVsbG8=", b"hello"),
            ("aGVsbG8", b"hello"),
            ("-_-_", &[251, 255, 191]),
            ("aGVs=bG8", b"hel"),
            ("a", &[]),
            ("abc", &[105, 183]),
            ("=abc", &[]),
            ("Zh==", &[102]),
            ("Łł", &[0]),
            ("YWŁJj", &[97, 96, 9]),
            ("한글YWJj", b"abc"),
            ("\u{1F600}YWJj", &[]),
            ("AĀBC", &[0, 16]),
            ("QＡJD", &[64, 144]),
            ("YQ\u{a0}==", b"a"),
        ];
        for (input, want) in cases {
            assert_eq!(decode(input), want, "{input:?}");
        }
    }
}
