//! suite `browser-download-place` — `place_download(root, {root, dirs: []}, name, staged)` 결과와 호출 뒤 `{{TMP}}` 전체.

use omk_bridge_core::browser::download_place::{PlaceError, place_download};
use omk_bridge_core::git_trust::GitGuard;
use serde_json::{Value, json};

use super::{cases, load};
use crate::support::browser_fs::{apply_fs_setup, walk};
use crate::support::{TmpDir, fill_tmp};

const SUITE: &str = "browser-download-place";

#[test]
fn download_place_suite() {
    let doc = load(SUITE);
    let mut failed = Vec::new();
    for (ctx, c) in cases(&doc, SUITE, "cases") {
        let tmp = TmpDir::new();
        for d in ["root", "staging", "outside"] {
            std::fs::create_dir_all(tmp.join(d)).unwrap();
        }
        apply_fs_setup(&tmp, &c["setup"]);
        let staged = tmp.join("staging/guid-1");
        if let Some(content) = c["input"]["staged"].as_str() {
            std::fs::write(&staged, content).unwrap();
        }
        let root = tmp.join("root");
        let guard = GitGuard {
            root: root.clone(),
            dirs: vec![],
        };
        let got: Value =
            match place_download(&root, &guard, c["input"]["name"].as_str().unwrap(), &staged) {
                Ok(saved) => json!({"savedAs": saved}),
                Err(PlaceError::Rejected(e)) => json!({"rejected": e}),
                Err(PlaceError::Failed(e)) => json!({"failed": e}),
            };
        let want = fill_tmp(&c["expect"], &tmp.path);
        if got != want {
            failed.push(format!("{ctx}: 기대 {want} 실제 {got}"));
        }
        let after = walk(&tmp);
        if after != c["after"] {
            failed.push(format!("{ctx}/after: 기대 {} 실제 {after}", c["after"]));
        }
    }
    assert!(
        failed.is_empty(),
        "{}건 실패:\n{}",
        failed.len(),
        failed.join("\n")
    );
}
