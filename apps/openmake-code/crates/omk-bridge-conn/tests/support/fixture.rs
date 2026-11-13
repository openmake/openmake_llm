//! fixture 파일 찾기·읽기.

use std::path::PathBuf;

use serde_json::Value;

pub const FIXTURE_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../packages/local-bridge-core/conformance"
);

/// 이 러너가 아는 연결 suite — 파일 목록이 이것과 정확히 같아야 한다(TS `KNOWN_CONN_SUITES`).
pub const KNOWN_CONN_SUITES: [&str; 6] = [
    "conn-constants",
    "conn-device-id",
    "conn-endpoints",
    "conn-frames",
    "conn-notice",
    "conn-reconnect-delay",
];

pub fn path_of(suite: &str) -> String {
    format!("{FIXTURE_DIR}/{suite}.json")
}

/// `conn-` 로 시작하는 `.json` 파일(이름순). 나머지는 코어 러너 몫이다.
pub fn conn_files() -> Vec<PathBuf> {
    let dir = std::fs::read_dir(FIXTURE_DIR)
        .unwrap_or_else(|e| panic!("fixture 폴더를 읽지 못함 {FIXTURE_DIR}: {e}"));
    let mut files: Vec<PathBuf> = dir
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("conn-"))
        })
        .collect();
    files.sort();
    files
}

pub fn load(suite: &str) -> Value {
    let path = path_of(suite);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let doc: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
    assert_eq!(doc["suite"], suite, "{path}: suite 이름");
    assert_eq!(doc["version"], 1, "{path}: version");
    doc
}
