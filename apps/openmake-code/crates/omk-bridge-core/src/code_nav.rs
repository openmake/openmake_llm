//! 코드 탐색(code_nav) — TS `code-nav.ts` 의 `isSecretFile`·`walkFiles`·grep·files.
//!
//! 읽기 전용이라 사용자 확인 없이 처리한다 — 폭주를 막는 것은 캡(파일 수·파일 크기·매치 수·시간 예산)뿐이다.
//! 외부 실행 파일을 쓰지 않고, 훑기는 심링크를 따라가지 않는다. 자격증명 이름(파일·폴더)은 훑지 않고 수만 센다.
//! 모두 동기 함수다 — 코어가 code_nav 전용 관문(설계 D-62) 안에서 부른다. 시간 예산은 주입한 "지났나" 함수로 본다.
//! TS 는 예산을 파일 사이에서만 보지만, 여기서는 줄마다(판정 직전)도 본다 — 다항 시간으로 느린 패턴이 예산에서 끝난다.

use std::fs;
use std::sync::LazyLock;

use crate::constants::{
    CODE_NAV_EXCLUDED_DIRS, CODE_NAV_EXCLUDED_FILES, CODE_NAV_LINE_MAX_CHARS,
    CODE_NAV_MAX_FILE_BYTES, CODE_NAV_MAX_FILES, CODE_NAV_MAX_MATCHES, CODE_NAV_MAX_PER_FILE,
    CODE_NAV_PATTERN_MAX_CHARS,
};
use crate::fs_kinds::read_dir_sorted;
use crate::glob::Glob;
use crate::js_regex;
use crate::js_text::{js_trim, utf16_cmp, utf16_prefix};
use crate::msg::{BridgeMsg, CodeNavResult};
use crate::node_path;

/// 바이너리 추정 범위 — 앞부분에 NUL 이 있으면 텍스트가 아니다(grep -I 과 같은 판정).
const BINARY_SNIFF: usize = 8192;

static SECRET_GLOBS: LazyLock<Vec<Glob>> =
    LazyLock::new(|| CODE_NAV_EXCLUDED_FILES.iter().map(|g| Glob::parse(g)).collect());

/// 자격증명 파일인지 — 이름(basename)만 본다. 대소문자는 ASCII 만 무시한다(TS `new RegExp(…, 'i')` 와 같다 — 표가 ASCII 뿐이다).
pub fn is_secret_file(name: &str) -> bool {
    SECRET_GLOBS.iter().any(|g| g.is_match_ascii_icase(name))
}

/// 훑기 결과 — base 기준 상대경로(UTF-16 순 정렬)·잘림·민감 정책으로 건너뛴 수.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Walk {
    pub files: Vec<String>,
    pub truncated: bool,
    pub skipped: usize,
}

fn looks_binary(buf: &[u8]) -> bool {
    buf[..buf.len().min(BINARY_SNIFF)].contains(&0)
}

/// base 아래 파일을 나열한다. TS 반복문 모양 그대로 — 스택에 넣고 뒤에서 꺼낸다, 상한 검사 두 자리, 폴더 읽기 실패는
/// 빈 폴더, 심링크·제외 이름·민감 이름(1건으로 셈)·그 밖의 종류 건너뛰기. 폴더 한 개의 항목은 이름 바이트순이다
/// (TS 는 OS 가 주는 순서 — 상한·예산에 걸렸을 때 남는 집합은 다를 수 있다, D-67). `start` 가 파일이면 그 파일 하나.
pub fn walk_files(base: &str, start: &str, expired: &dyn Fn() -> bool) -> Walk {
    let mut walk = Walk {
        files: Vec::new(),
        truncated: false,
        skipped: 0,
    };
    let Ok(st) = fs::metadata(start) else {
        return walk;
    };
    if st.is_file() {
        if is_secret_file(&node_path::basename(start)) {
            walk.skipped = 1;
        } else {
            walk.files.push(node_path::relative(base, start));
        }
        return walk;
    }
    let mut stack = vec![start.to_owned()];
    while !stack.is_empty() {
        if walk.files.len() >= CODE_NAV_MAX_FILES || expired() {
            walk.truncated = true;
            break;
        }
        let Some(dir) = stack.pop() else { break };
        for e in read_dir_sorted(&dir).unwrap_or_default() {
            if e.is_symlink || CODE_NAV_EXCLUDED_DIRS.contains(&e.name.as_str()) {
                continue;
            }
            if is_secret_file(&e.name) {
                walk.skipped += 1;
                continue;
            }
            let abs = node_path::join(&[&dir, &e.name]);
            if e.is_dir {
                stack.push(abs);
            } else if e.is_file {
                if walk.files.len() >= CODE_NAV_MAX_FILES {
                    walk.truncated = true;
                    break;
                }
                walk.files.push(node_path::relative(base, &abs));
            }
        }
    }
    walk.files.sort_by(|a, b| utf16_cmp(a, b));
    walk
}

/// 매치 상한 — TS `Math.min(유한하고 0 보다 크면 그 값, 400)`. 소수는 `>=` 비교라 올림과 같다.
fn cap_of(v: Option<f64>) -> usize {
    match v {
        Some(n) if n.is_finite() && n > 0.0 => {
            let cap = CODE_NAV_MAX_MATCHES as f64;
            // n 은 (0, 400] 범위로 잘린 뒤라 usize 로 그대로 바뀐다.
            n.ceil().min(cap) as usize
        }
        _ => CODE_NAV_MAX_MATCHES,
    }
}

/// 파일 내용 — 크기 상한을 넘거나 읽지 못하거나 바이너리면 `None`.
fn read_text(abs: &str) -> Option<String> {
    let md = fs::metadata(abs).ok()?;
    if md.len() > CODE_NAV_MAX_FILE_BYTES {
        return None;
    }
    let buf = fs::read(abs).ok()?;
    if looks_binary(&buf) {
        return None;
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

fn grep(
    base: &str,
    start: &str,
    m: &BridgeMsg,
    expired: &dyn Fn() -> bool,
) -> Result<CodeNavResult, String> {
    let src = m.pattern.as_str();
    if js_trim(src).is_empty() {
        return Err("pattern 이 필요합니다".to_owned());
    }
    if src.encode_utf16().count() > CODE_NAV_PATTERN_MAX_CHARS {
        return Err(format!(
            "pattern 이 너무 깁니다 ({CODE_NAV_PATTERN_MAX_CHARS}자 이하)"
        ));
    }
    let re = js_regex::compile(src, m.ignore_case)?;
    let glob = m.glob.as_deref().map(Glob::parse);
    let cap = cap_of(m.max_results);
    let walked = walk_files(base, start, expired);
    let mut matches: Vec<String> = Vec::new();
    let mut truncated = walked.truncated;
    let mut units: Vec<u16> = Vec::new();
    for rel in &walked.files {
        if matches.len() >= cap || expired() {
            truncated = true;
            break;
        }
        if let Some(g) = &glob {
            let target = if g.basename_only() {
                node_path::basename(rel)
            } else {
                rel.clone()
            };
            if !g.is_match(&target) {
                continue;
            }
        }
        let Some(text) = read_text(&node_path::join(&[base, rel])) else {
            continue;
        };
        let mut per_file = 0;
        // `split('\n')` 그대로 — 마지막 개행 뒤의 빈 줄도 한 줄로 판정한다. CRLF 의 `\r` 은 판정 때 붙어 있다.
        for (i, line) in text.split('\n').enumerate() {
            if per_file >= CODE_NAV_MAX_PER_FILE || matches.len() >= cap {
                truncated = true;
                break;
            }
            // 줄 단위 시간 검사(Rust 만) — 멈추면 바깥 반복 맨 위에서 다시 걸려 끝난다.
            if expired() {
                truncated = true;
                break;
            }
            units.clear();
            units.extend(line.encode_utf16());
            if !re.test_units(&units) {
                continue;
            }
            let shown = line.strip_suffix('\r').unwrap_or(line);
            let shown = if shown.encode_utf16().count() > CODE_NAV_LINE_MAX_CHARS {
                format!("{}…", utf16_prefix(shown, CODE_NAV_LINE_MAX_CHARS))
            } else {
                shown.to_owned()
            };
            matches.push(format!("{rel}:{}:{shown}", i + 1));
            per_file += 1;
        }
    }
    Ok(CodeNavResult::Grep {
        matches,
        truncated,
        skipped: walked.skipped,
    })
}

/// 줄 수 — 빈 파일 0, 끝 개행은 줄을 늘리지 않는다. 크기 초과·읽기 실패·바이너리도 0(빈 파일과 구분되지 않는다 — TS 그대로).
fn files(base: &str, start: &str, expired: &dyn Fn() -> bool) -> CodeNavResult {
    let walked = walk_files(base, start, expired);
    let mut out = Vec::new();
    let mut truncated = walked.truncated;
    for rel in walked.files {
        if expired() {
            truncated = true;
            break;
        }
        let abs = node_path::join(&[base, &rel]);
        if fs::metadata(&abs).is_err() {
            continue;
        }
        let lines = match read_text(&abs) {
            Some(t) if !t.is_empty() => t.split('\n').count() - usize::from(t.ends_with('\n')),
            _ => 0,
        };
        out.push((rel, lines));
    }
    CodeNavResult::Files {
        files: out,
        truncated,
        skipped: walked.skipped,
    }
}

/// code_nav 진입점. `start` 는 부르는 쪽이 스코프를 확정한 절대경로여야 한다. 연산은 `grep`·`files` 만.
pub fn run(
    base: &str,
    start: &str,
    m: &BridgeMsg,
    expired: &dyn Fn() -> bool,
) -> Result<CodeNavResult, String> {
    match m.op.as_deref() {
        Some("grep") => grep(base, start, m, expired),
        Some("files") => Ok(files(base, start, expired)),
        _ => Err(format!("지원하지 않는 code_nav op: {}", m.op_text)),
    }
}

#[cfg(test)]
mod tests {
    use super::cap_of;

    #[test]
    fn cap_follows_ts_min_and_ge() {
        for (v, want) in [
            (Some(2.0), 2),
            (Some(1.5), 2),
            (Some(0.1), 1),
            (Some(401.0), 400),
            (Some(-1.0), 400),
            (Some(f64::INFINITY), 400),
            (None, 400),
        ] {
            assert_eq!(cap_of(v), want, "{v:?}");
        }
    }
}
