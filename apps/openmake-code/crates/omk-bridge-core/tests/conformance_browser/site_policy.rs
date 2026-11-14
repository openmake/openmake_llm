//! suite `browser-site-policy` — 사이트 정책 판정과 차단 표식.

use omk_bridge_core::browser::site_policy::{
    SitePolicy, UploadApproval, check_action, classify, host_matches, host_of, is_host_allowed,
    is_navigable, needs_approval, parse_policy, upload_files_of,
};
use serde_json::{Value, json};

use super::{arg, cases, groups, load};

const SUITE: &str = "browser-site-policy";

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_owned())
        .collect()
}

pub fn policy(doc: &Value, name: &Value) -> SitePolicy {
    let p = &doc["policies"][name.as_str().unwrap()];
    assert!(p.is_object(), "모르는 정책 {name}");
    SitePolicy {
        allow: strings(&p["allow"]),
        deny: strings(&p["deny"]),
    }
}

fn host(i: &Value) -> Option<&str> {
    i["host"].as_str()
}

fn policy_json(p: &SitePolicy) -> Value {
    json!({"allow": p.allow, "deny": p.deny})
}

fn run(doc: &Value, group: &str, i: &Value) -> Value {
    match group {
        "classify" => json!(classify(arg(i, "action")).as_str()),
        "hostOf" => json!(host_of(arg(i, "url"))),
        "navigable" => json!(is_navigable(arg(i, "url"))),
        "hostMatches" => json!(host_matches(
            i["host"].as_str().unwrap(),
            i["pattern"].as_str().unwrap()
        )),
        "allowed" => json!(is_host_allowed(host(i), &policy(doc, &i["policy"]))),
        "needsApproval" => json!(needs_approval(
            arg(i, "action"),
            host(i),
            &policy(doc, &i["policy"])
        )),
        "check" => {
            let uploads: Vec<UploadApproval> = arg(i, "approvedUploads")
                .map(|u| {
                    u.as_array()
                        .unwrap()
                        .iter()
                        .map(|x| UploadApproval {
                            host: x["host"].as_str().unwrap().to_owned(),
                            files: strings(&x["files"]),
                        })
                        .collect()
                })
                .unwrap_or_default();
            json!(check_action(
                arg(i, "action"),
                host(i),
                &policy(doc, &i["policy"]),
                &strings(&i["approvedHosts"]),
                &uploads
            ))
        }
        "parsePolicy" => policy_json(&parse_policy(arg(i, "raw"))),
        "uploadFilesOf" => json!(upload_files_of(arg(i, "action"))),
        "policyBlock" => super::site_policy_block::run(doc, i),
        other => panic!("모르는 묶음 {other}"),
    }
}

#[test]
fn site_policy_suite() {
    let doc = load(SUITE);
    let mut failed = Vec::new();
    for group in groups(SUITE) {
        for (ctx, c) in cases(&doc, SUITE, group) {
            let got = run(&doc, group, &c["input"]);
            if got != c["expect"] {
                failed.push(format!("{ctx}: 기대 {} 실제 {got}", c["expect"]));
            }
        }
    }
    assert!(
        failed.is_empty(),
        "{}건 실패:\n{}",
        failed.len(),
        failed.join("\n")
    );
}
