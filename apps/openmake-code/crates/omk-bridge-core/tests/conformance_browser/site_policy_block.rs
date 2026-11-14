//! suite `browser-site-policy` 의 `policyBlock` 묶음 — 차단 표식 3종.

use omk_bridge_core::browser::policy_block::{
    policy_block_of, upload_rejected_block, user_control_block,
};
use serde_json::Value;

use super::arg;
use super::site_policy::policy;

pub fn run(doc: &Value, i: &Value) -> Value {
    let host = i["host"].as_str();
    match i["fn"].as_str().unwrap() {
        "of" => policy_block_of(arg(i, "action"), host, &policy(doc, &i["policy"])),
        "userControl" => user_control_block(arg(i, "action")),
        "uploadRejected" => upload_rejected_block(host),
        other => panic!("모르는 fn {other}"),
    }
    .to_value()
}
