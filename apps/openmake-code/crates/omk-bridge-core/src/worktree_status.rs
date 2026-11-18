//! worktree remove 의 보존 판정 — `git status` 출력만 보는 순수 함수. TS `worktree-status.ts` 와 같은 규칙이고 적합성
//! `worktree.json` `statusVerdict` 가 둘을 묶는다(설계 2026-11-18 ignored-cleanup §2.1).
//!
//! - `--ignored=matching`: 규칙에 걸린 폴더 자신이 보인다(`traditional` 은 추적 안 된 상위 폴더로 접혀 이름 대조가 깨진다).
//! - `--untracked-files=normal`: 사용자 설정 `status.showUntrackedFiles=no` 여도 새 파일을 본다.
//! - `-z`: 한글 경로를 따옴표·8진 이스케이프 없이 원문으로 받는다.

use crate::constants::WORKTREE_DISPOSABLE_DIRS;

pub const REMOVE_STATUS_ARGS: &[&str] = &[
    "status",
    "--porcelain",
    "--ignored=matching",
    "--untracked-files=normal",
    "-z",
];

/// `Changes` = 추적 변경·새 파일, `Ignored` = 버리면 안 되는 무시 항목만, `Clean` = 없음 또는 버려도 되는 폴더뿐.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Changes,
    Ignored,
    Clean,
}

const IGNORED_MARK: &str = "!! ";

/// 무시 항목 경로가 버려도 되는 폴더 안인가 — 끝이 `/` 면 모든 구성 요소, 아니면 파일 이름을 뺀 구성 요소를 글자 그대로 본다.
fn disposable(p: &str) -> bool {
    let parts: Vec<&str> = p.split('/').collect();
    let dirs = if p.ends_with('/') {
        &parts[..]
    } else {
        &parts[..parts.len() - 1]
    };
    dirs.iter().any(|d| WORKTREE_DISPOSABLE_DIRS.contains(d))
}

pub fn remove_verdict(stdout_z: &str) -> Verdict {
    let mut ignored = false;
    for chunk in stdout_z.split('\0').filter(|c| !c.is_empty()) {
        // rename 의 옛 경로도 별도 조각으로 오지만 `!! ` 로 시작하지 않아 Changes 다.
        let Some(p) = chunk.strip_prefix(IGNORED_MARK) else {
            return Verdict::Changes;
        };
        if !disposable(p) {
            ignored = true;
        }
    }
    if ignored {
        Verdict::Ignored
    } else {
        Verdict::Clean
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verdicts() {
        assert_eq!(remove_verdict(""), Verdict::Clean);
        assert_eq!(remove_verdict("\0\0"), Verdict::Clean);
        assert_eq!(remove_verdict("!! x.zip"), Verdict::Ignored);
        assert_eq!(remove_verdict("!! 한글 dir/파일.zip\0"), Verdict::Ignored);
        assert_eq!(remove_verdict("!! pkg/node_modules/\0"), Verdict::Clean);
        assert_eq!(remove_verdict("!! src/.venv\0"), Verdict::Ignored);
        assert_eq!(remove_verdict("?? 새 파일.txt\0"), Verdict::Changes);
        for d in WORKTREE_DISPOSABLE_DIRS {
            assert_eq!(
                remove_verdict(&format!("!! x/{d}/y.bin\0")),
                Verdict::Clean,
                "{d}"
            );
        }
    }
}
