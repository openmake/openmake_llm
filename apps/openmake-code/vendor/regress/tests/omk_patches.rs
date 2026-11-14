//! [omk] 저장소 사본 패치 테스트 — `OMK-PATCHES.md` 의 패치 ①②③.
//!
//! 기대값은 Node(V8) `new RegExp(패턴, 플래그).test(줄)` 실측이다.
//! 패치 전 엔진에서는 ①의 일부 사례가 메모리를 빠르게 먹으므로, 원본 대조는 상한을 둔 판정기로 한 건씩만 한다.
#![cfg(feature = "utf16")]

use regress::Regex;

fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn is_match(pattern: &str, flags: &str, line: &str) -> bool {
    let re = Regex::with_flags(pattern, flags).unwrap();
    re.find_from_ucs2(&units(line), 0).next().is_some()
}

// ① EnterLoop — 바깥 반복이 안쪽 루프에 다시 들어올 때 앞 회차의 횟수를 역추적으로 되돌린다.

#[test]
fn patch1_inner_loop_count_is_restored_on_backtrack() {
    assert!(is_match(r"((?:x{1,2})+){2}", "", "xx"));
}

#[test]
fn patch1_empty_iterations_do_not_pile_up() {
    let line = format!("{}b", "/".repeat(20));
    assert!(!is_match(r"((/*){1,2}){1,2}a{2}", "", &line));
}

#[test]
fn patch1_nested_empty_loop_then_word_boundary() {
    assert!(is_match(r"(?:( *){1,2})+(\ba+?)", "", "  a"));
}

// ② EndCaptureGroup — 그룹 안으로 역추적해 돌아가면 그룹 끝도 되돌린다(자기 그룹 역참조).

#[test]
fn patch2_self_backreference_after_backtrack_into_group() {
    assert!(is_match(r"(x{1,2}\1){2}", "", "xx"));
}

#[test]
fn patch2_self_backreference_with_lazy_inner_loop() {
    assert!(is_match(r"((.(/??)*)\1){2}", "", "_//"));
}

// ③ 실행 한도 — 역추적 스택 상한과 중단 콜백. 넘은 판정은 Ok 로 새지 않는다.

use regress::{ExecLimits, LimitExceeded};
use std::cell::Cell;

fn never() -> bool {
    false
}

fn limited(
    pattern: &str,
    line: &str,
    max_backtrack: usize,
    stop: &dyn Fn() -> bool,
) -> Result<bool, LimitExceeded> {
    let re = Regex::with_flags(pattern, "").unwrap();
    re.is_match_ucs2_limited(
        &units(line),
        ExecLimits {
            max_backtrack,
            stop,
        },
    )
}

#[test]
fn patch3_stack_limit_stops_deep_nesting() {
    assert_eq!(
        limited(r"((a?){9999}){9999}", "", 4096, &never),
        Err(LimitExceeded::Backtrack)
    );
}

#[test]
fn patch3_stop_callback_is_polled_and_honoured() {
    let asked = Cell::new(0u32);
    let stop = || {
        asked.set(asked.get() + 1);
        asked.get() >= 3
    };
    let line = format!("{}!", "a".repeat(40));
    assert_eq!(
        limited(r"(a+)+$", &line, usize::MAX, &stop),
        Err(LimitExceeded::Stopped)
    );
    assert_eq!(asked.get(), 3);
}

#[test]
fn patch3_limits_inside_lookaround_do_not_leak_as_ok() {
    let asked = Cell::new(0u32);
    let stop = || {
        asked.set(asked.get() + 1);
        asked.get() >= 3
    };
    let line = format!("{}!", "a".repeat(40));
    // 부정 둘러보기 안에서 멈춰도 "안 맞음 → 성공"으로 치지 않는다.
    assert_eq!(
        limited(r"(?!(a+)+$)a", &line, usize::MAX, &stop),
        Err(LimitExceeded::Stopped)
    );
    assert_eq!(
        limited(r"(?=((a?){9999}){9999})", "", 4096, &never),
        Err(LimitExceeded::Backtrack)
    );
    assert_eq!(
        limited(r"(?!((a?){9999}){9999})", "", 4096, &never),
        Err(LimitExceeded::Backtrack)
    );
    assert_eq!(
        limited(r"(?<!((a?){9999}){9999})", "", 4096, &never),
        Err(LimitExceeded::Backtrack)
    );
}

#[test]
fn patch3_generous_limits_agree_with_find() {
    let cases: &[(&str, &str, &str)] = &[
        (r"abc", "", "xxabcxx"),
        (r"abc", "", "xxabxx"),
        (r"^\s*fn\s+(\w+)\s*\(", "", "  fn main() {"),
        (r"((\w+)\.)+(\w+)\(", "", "foo.bar.baz(1)"),
        (r"(?<=a)b", "", "ab"),
        (r"(?<!a)b", "", "ab"),
        (r"(a|b)*c", "", "ababababd"),
        (r"(x{1,2}\1){2}", "", "xx"),
        (r"((?:x{1,2})+){2}", "", "xx"),
        (r"STRUCT", "i", "pub struct Foo;"),
        (r"가+나", "", "가가가나"),
        (r"", "", ""),
    ];
    for &(pattern, flags, line) in cases {
        let re = Regex::with_flags(pattern, flags).unwrap();
        let text = units(line);
        let want = re.find_from_ucs2(&text, 0).next().is_some();
        let got = re.is_match_ucs2_limited(
            &text,
            ExecLimits {
                max_backtrack: 1 << 20,
                stop: &never,
            },
        );
        assert_eq!(got, Ok(want), "{pattern:?} 대 {line:?}");
    }
}
