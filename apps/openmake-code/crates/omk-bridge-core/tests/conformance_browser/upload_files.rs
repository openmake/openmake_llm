//! suite `browser-upload-files` — `resolve_upload_files(base, files)`, 상한은 기본값.

use omk_bridge_core::browser::constants::BROWSER_UPLOAD_MAX_FILE_BYTES;
use omk_bridge_core::browser::upload_files::resolve_upload_files;
use serde_json::{Value, json};

use super::{cases, load};
use crate::support::browser_fs::{apply_fs_setup, fill_str};
use crate::support::{TmpDir, fill_tmp};

const SUITE: &str = "browser-upload-files";

#[test]
fn upload_files_suite() {
    let doc = load(SUITE);
    let mut failed = Vec::new();
    for (ctx, c) in cases(&doc, SUITE, "cases") {
        let tmp = TmpDir::new();
        apply_fs_setup(&tmp, &doc["baseSetup"]);
        apply_fs_setup(&tmp, &c["setup"]);
        let i = &c["input"];
        let base = fill_str(i["base"].as_str().unwrap(), &tmp);
        let got: Value =
            match resolve_upload_files(&base, Some(&i["files"]), BROWSER_UPLOAD_MAX_FILE_BYTES) {
                Ok(paths) => json!({"paths": paths}),
                Err(e) => json!({"error": e}),
            };
        let want = fill_tmp(&c["expect"], &tmp.path);
        if got != want {
            failed.push(format!("{ctx}: 기대 {want} 실제 {got}"));
        }
    }
    assert!(
        failed.is_empty(),
        "{}건 실패:\n{}",
        failed.len(),
        failed.join("\n")
    );
}
