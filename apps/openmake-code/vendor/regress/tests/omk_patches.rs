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
