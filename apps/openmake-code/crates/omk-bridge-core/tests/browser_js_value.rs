//! JS 값 변환(`browser::js_value`) — D-75 의 규칙과 D-81 의 Rust 전용 사례. 기대값은 Node 24 로 확인한 값이다.
#![allow(clippy::unwrap_used)]

use omk_bridge_core::browser::js_value::{
    js_number, js_string, js_to_lower, js_to_upper, js_truthy, json_string, number_to_string,
    str_of, string_to_number,
};
use serde_json::{Value, json};

#[test]
fn number_to_string_matches_js() {
    let cases: [(f64, &str); 17] = [
        (0.0, "0"),
        (-0.0, "0"),
        (1.5, "1.5"),
        (1e21, "1e+21"),
        (1e-7, "1e-7"),
        (123e-20, "1.23e-18"),
        (0.1, "0.1"),
        (1.0 / 3.0, "0.3333333333333333"),
        (9_007_199_254_740_994.0, "9007199254740994"),
        (-1e-7, "-1e-7"),
        (1e300, "1e+300"),
        // 두 최단 후보가 똑같이 가까우면 짝수 쪽(JS) — Rust 최단 표기는 `…63`
        (-87_375.640_869_140_625, "-87375.64086914062"),
        (2_188_669_443_130_493.25, "2188669443130493.2"),
        (5e-324, "5e-324"),
        (f64::MAX, "1.7976931348623157e+308"),
        (1e20, "100000000000000000000"),
        (0.000_001, "0.000001"),
    ];
    for (x, want) in cases {
        assert_eq!(number_to_string(x), want, "{x:e}");
    }
    assert_eq!(number_to_string(f64::NAN), "NaN");
    assert_eq!(number_to_string(f64::NEG_INFINITY), "-Infinity");
}

#[test]
fn json_floats_parse_exactly() {
    // float_roundtrip — 기본 설정은 `123456789012345680000` 을 1ULP 아래로 읽어 String() 이 갈렸다(단계 0 ②)
    let v: Value = serde_json::from_str("[123456789012345680000, 0.30000000000000004]").unwrap();
    assert_eq!(js_string(&v), "123456789012345680000,0.30000000000000004");
    // 2^53 을 넘는 정수 글자는 JS 처럼 가장 가까운 f64 로
    assert_eq!(
        js_string(&json!(9_007_199_254_740_993_u64)),
        "9007199254740992"
    );
    // D-81-10: 범위 밖 수는 해석 실패(TS 는 Infinity)
    assert!(serde_json::from_str::<Value>("1e999").is_err());
}

#[test]
fn string_to_number_matches_js() {
    let cases = [
        ("", "0"),
        (" 12 ", "12"),
        ("0x1F", "31"),
        ("0b101", "5"),
        ("0o17", "15"),
        ("-0x10", "NaN"),
        ("Infinity", "Infinity"),
        ("-Infinity", "-Infinity"),
        ("inf", "NaN"),
        ("nan", "NaN"),
        ("1e3", "1000"),
        (".5", "0.5"),
        ("5.", "5"),
        ("1_0", "NaN"),
        ("\u{a0}12\u{feff}", "12"),
        ("1e", "NaN"),
        ("+.5e-1", "0.05"),
        ("0x", "NaN"),
        ("12abc", "NaN"),
        ("1e400", "Infinity"),
    ];
    for (s, want) in cases {
        assert_eq!(number_to_string(string_to_number(s)), want, "{s:?}");
    }
}

#[test]
fn js_number_rules() {
    let n = |v: Option<&Value>| number_to_string(js_number(v));
    assert_eq!(n(None), "NaN");
    assert_eq!(n(Some(&Value::Null)), "0");
    assert_eq!(n(Some(&json!(true))), "1");
    assert_eq!(n(Some(&json!(false))), "0");
    assert_eq!(n(Some(&json!("7"))), "7");
    // D-81-1: 배열·객체는 NaN(TS `Number([5])` = 5, `Number([])` = 0)
    assert_eq!(n(Some(&json!([5]))), "NaN");
    assert_eq!(n(Some(&json!([]))), "NaN");
    assert_eq!(n(Some(&json!({}))), "NaN");
}

#[test]
fn truthy_and_strings() {
    for (v, want) in [
        (json!(null), false),
        (json!(0), false),
        (json!(0.0), false),
        (json!(""), false),
        (json!(false), false),
        (json!("0"), true),
        (json!([]), true),
        (json!({}), true),
        (json!(-1), true),
    ] {
        assert_eq!(js_truthy(Some(&v)), want, "{v}");
    }
    assert!(!js_truthy(None));
    assert_eq!(str_of(None), "");
    assert_eq!(str_of(Some(&Value::Null)), "");
    assert_eq!(js_string(&Value::Null), "null");
    assert_eq!(
        js_string(&json!([null, [null, 1], {"a": 1}])),
        ",,1,[object Object]"
    );
    assert_eq!(
        json_string("a\u{2028}\"\\\u{1}\u{7f}"),
        "\"a\u{2028}\\\"\\\\\\u0001\u{7f}\""
    );
}

#[test]
fn case_mapping_special_rules() {
    assert_eq!(js_to_lower("İ"), "i\u{307}");
    assert_eq!(js_to_lower("ΟΔΟΣ"), "οδος");
    assert_eq!(js_to_lower("ǅ"), "ǆ");
    assert_eq!(js_to_upper("ß"), "SS");
    assert_eq!(js_to_upper("ǆ"), "Ǆ");
}

/// 완료 기준 4 — 판정 함수는 어떤 JSON 이 와도 답을 낸다(패닉 없음). 모르면 막는 쪽: 허용 목록 밖 호스트·승인 없음에서
/// 읽기로 분류되지 않은 액션은 모두 막힌다.
#[test]
fn any_json_shape_gets_an_answer() {
    use omk_bridge_core::browser::constants::ActionClass;
    use omk_bridge_core::browser::flow::{cond_expression, flatten, validate};
    use omk_bridge_core::browser::policy_block::policy_block_of;
    use omk_bridge_core::browser::site_policy::{
        SitePolicy, check_action, classify, host_of, is_navigable, needs_approval, parse_policy,
        upload_files_of,
    };
    let shapes = [
        json!(null),
        json!(true),
        json!(0),
        json!(-1.5),
        json!(1e300),
        json!(""),
        json!("x"),
        json!("goto"),
        json!([]),
        json!([1, null]),
        json!({}),
        json!({"a": {"b": []}}),
    ];
    let policy = SitePolicy {
        allow: vec!["groupware.example.com".to_owned()],
        deny: vec![],
    };
    for key in ["type", "url", "files", "accept", "selector"] {
        for base in [
            json!({}),
            json!({"type": "goto"}),
            json!({"type": "uploadFile"}),
            json!({"type": "dialog"}),
        ] {
            for v in &shapes {
                let mut a = base.clone();
                a[key] = v.clone();
                for host in [
                    None,
                    Some(""),
                    Some("www.example.org"),
                    Some("groupware.example.com"),
                ] {
                    let _ = needs_approval(Some(&a), host, &policy);
                    let _ = policy_block_of(Some(&a), host, &policy);
                    let blocked = check_action(Some(&a), host, &policy, &[], &[]);
                    if host != Some("groupware.example.com")
                        && classify(Some(&a)) != ActionClass::Observe
                    {
                        assert!(blocked.is_some(), "{a} @ {host:?} 가 막히지 않았다");
                    }
                }
                let _ = (
                    upload_files_of(Some(&a)),
                    host_of(Some(v)),
                    is_navigable(Some(v)),
                    parse_policy(Some(v)),
                );
                let _ = (validate(Some(&a)), flatten(Some(&a)), validate(Some(v)));
            }
        }
    }
    // 액션 자체가 임의 값
    for v in &shapes {
        assert!(
            check_action(Some(v), Some("www.example.org"), &policy, &[], &[]).is_some(),
            "{v}"
        );
        let _ = cond_expression(v);
    }
    assert!(check_action(None, None, &policy, &[], &[]).is_some());
}

/// D-81-2 — 조합 키·키 이름이 객체 프로토타입 이름이면 거절(TS 는 표 조회가 참이 돼 통과하거나 `key: undefined`).
#[test]
fn prototype_names_are_not_keys() {
    use omk_bridge_core::browser::defs::key_event_of;
    assert_eq!(
        key_event_of("constructor+a").unwrap_err(),
        "지원하지 않는 조합 키: constructor"
    );
    assert_eq!(
        key_event_of("toString").unwrap_err(),
        "지원하지 않는 키: toString"
    );
    assert_eq!(
        key_event_of("__proto__").unwrap_err(),
        "지원하지 않는 키: __proto__"
    );
}

/// D-81-9 — 잘못된 punycode 호스트는 주소 오류(TS `URL` 은 받는다) → 쓰기는 호스트 모름으로 승인 대상, 이동은 막힘.
#[test]
fn bad_punycode_host_is_unknown() {
    use omk_bridge_core::browser::site_policy::{SitePolicy, check_action, host_of, is_navigable};
    let url = json!("https://xn--a.example.com/?q=1");
    assert_eq!(host_of(Some(&url)), None);
    assert!(!is_navigable(Some(&url)));
    let star = SitePolicy {
        allow: vec!["*".to_owned()],
        deny: vec![],
    };
    let goto = json!({"type": "goto", "url": url});
    assert!(
        check_action(Some(&goto), None, &star, &[], &[])
            .unwrap()
            .starts_with("이동할 수 없는 주소입니다")
    );
}

/// clip 이 대리 쌍 한가운데서 자르면 TS 는 짝 없는 반쪽을 남기고 Rust 는 그 글자를 뺀다(BROWSER.md "fixture 에 넣지 않는 차이" 4).
#[test]
fn clip_drops_split_surrogate_pair() {
    use omk_bridge_core::browser::site_policy::clip;
    let s = format!("x{}", "😀".repeat(150)); // 1 + 199 단위에서 이모지 한가운데
    let c = clip(Some(&json!(s)));
    assert_eq!(c, format!("x{}…", "😀".repeat(99)));
}
