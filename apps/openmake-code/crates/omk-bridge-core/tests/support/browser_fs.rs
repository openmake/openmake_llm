//! 브라우저 파일 suite(`browser-upload-files`·`browser-download-place`)의 setup·after — TS `conformance-browser-support.ts` 와
//! 같은 규칙. setup: `{dir}` · `{file, content}` · `{file, size}`(성긴 파일) · `{symlink, target}` · `{series, from, to, content}`.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::TmpDir;

pub fn fill_str(s: &str, tmp: &TmpDir) -> String {
    s.replace("{{TMP}}", &tmp.path)
}

fn mkparent(p: &str) {
    if let Some(parent) = std::path::Path::new(p).parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
}

pub fn apply_fs_setup(tmp: &TmpDir, setup: &Value) {
    for s in setup.as_array().expect("setup 배열") {
        if let Some(d) = s["dir"].as_str() {
            std::fs::create_dir_all(tmp.join(d)).unwrap();
        } else if let Some(link) = s["symlink"].as_str() {
            let target = fill_str(s["target"].as_str().unwrap(), tmp);
            std::os::unix::fs::symlink(target, tmp.join(link)).unwrap();
        } else if let Some(series) = s["series"].as_str() {
            for n in s["from"].as_u64().unwrap()..=s["to"].as_u64().unwrap() {
                let p = tmp.join(&series.replace("{n}", &n.to_string()));
                std::fs::write(p, s["content"].as_str().unwrap()).unwrap();
            }
        } else {
            let p = tmp.join(s["file"].as_str().unwrap());
            mkparent(&p);
            match s["size"].as_u64() {
                Some(size) => std::fs::File::create(&p).unwrap().set_len(size).unwrap(),
                None => std::fs::write(&p, s["content"].as_str().unwrap()).unwrap(),
            }
        }
    }
}

/// 임시 폴더 전체 — 경로(`{{TMP}}` 기준) → 글(UTF-8) · `{symlink: 대상}` · `{dir: true}`. 이름 순(UTF-16 이 아니라 바이트순 —
/// fixture 의 이름은 ASCII·한글이라 순서가 같다. 비교는 값으로 한다).
pub fn walk(tmp: &TmpDir) -> Value {
    let mut out = BTreeMap::new();
    let mut stack = vec![String::new()];
    while let Some(rel) = stack.pop() {
        let dir = if rel.is_empty() {
            tmp.path.clone()
        } else {
            tmp.join(&rel)
        };
        for e in std::fs::read_dir(dir).unwrap() {
            let name = e.unwrap().file_name().to_string_lossy().into_owned();
            let r = if rel.is_empty() {
                name
            } else {
                format!("{rel}/{name}")
            };
            let p = tmp.join(&r);
            let md = std::fs::symlink_metadata(&p).unwrap();
            let v = if md.file_type().is_symlink() {
                let t = std::fs::read_link(&p)
                    .unwrap()
                    .to_string_lossy()
                    .replace(&tmp.path, "{{TMP}}");
                json!({"symlink": t})
            } else if md.is_dir() {
                stack.push(r.clone());
                json!({"dir": true})
            } else {
                json!(String::from_utf8_lossy(&std::fs::read(&p).unwrap()))
            };
            out.insert(r, v);
        }
    }
    json!(out)
}
