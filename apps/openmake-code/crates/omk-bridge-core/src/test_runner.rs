//! 테스트 러너 탐지(test_runner) — TS `test-runner.ts`.
//!
//! 서버의 완료 관문이 "이 폴더에 돌릴 테스트가 있는가"를 묻는다. 읽기 전용이라 확인 없이 처리한다 — 서버 문자열을
//! 실행하지 않고, 파일 확인 + 고정 인자의 `python3` 탐지 한 번뿐이다(테스트 실행은 종전대로 exec 가 확인을 거친다).
//! 판정 순서는 TS 그대로: npm → pytest 표식 **그리고** 탐지 성공 → go.mod **그리고** PATH 의 go → none.
//! TS 는 표식을 게으르게 읽지만 여기서는 세 표식을 관문 안에서 한 번에 읽는다(읽기뿐이라 결과가 같다, D-64).
//! pytest 탐지는 `import` 대신 `find_spec` 으로 — 폴더의 `pytest.py` 를 실행하지 않는다. `-I` 로 cwd·환경 변수를 무시하고
//! 사용자 site 만 찾는 대상으로 더한다(pip --user 설치). 자식은 exec 와 같은 샌드박스 안에서 돈다(D-65).

use std::fs;

use serde_json::Value;

use crate::constants::TEST_RUNNER_PROBE_TIMEOUT_MS;
use crate::node_path;
use crate::timed_fs::FsGate;
use crate::tool_env::ToolEnv;

const LABEL: &str = "test_runner";

/// pytest 탐지 코드 — 별건 TS 수정과 같은 글자(설계 변경 이력 2026-11-13).
pub const PYTEST_PROBE: &str = "import importlib.util,site,sys; sys.path.append(site.getusersitepackages()); sys.exit(0 if importlib.util.find_spec('pytest') else 1)";

fn exists(p: &str) -> bool {
    fs::metadata(p).is_ok()
}

/// `readFileSync(p, 'utf8')` — 깨진 바이트는 U+FFFD.
fn read_lossy(p: &str) -> Option<String> {
    fs::read(p)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// `/^node\b/` — `node` 다음 단위가 `[A-Za-z0-9_]` 가 아니거나 끝.
fn starts_with_node_word(script: &str) -> bool {
    script.strip_prefix("node").is_some_and(|rest| {
        !rest
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

/// scripts.test 가 있고 기본 자리표시자가 아니며, node_modules 가 있거나(무엇이든) `node …` 스크립트인가.
fn has_npm_test(dir: &str) -> bool {
    let Some(text) = read_lossy(&node_path::join(&[dir, "package.json"])) else {
        return false;
    };
    let Ok(pkg) = serde_json::from_str::<Value>(&text) else {
        return false;
    };
    let script = pkg
        .get("scripts")
        .and_then(|s| s.get("test"))
        .and_then(Value::as_str)
        .unwrap_or("");
    !script.is_empty()
        && !script.contains("no test specified")
        && (exists(&node_path::join(&[dir, "node_modules"])) || starts_with_node_word(script))
}

/// `/^test_.*\.py$/` — `.` 는 줄 끝 문자 4종을 넘지 않는다.
fn is_test_py(name: &str) -> bool {
    name.strip_prefix("test_")
        .and_then(|rest| rest.strip_suffix(".py"))
        .is_some_and(|mid| !mid.contains(['\n', '\r', '\u{2028}', '\u{2029}']))
}

fn has_pytest_marker(dir: &str) -> bool {
    let at = |name: &str| node_path::join(&[dir, name]);
    if exists(&at("pytest.ini")) || exists(&at("conftest.py")) {
        return true;
    }
    let contains =
        |name: &str, needle: &str| read_lossy(&at(name)).is_some_and(|t| t.contains(needle));
    if contains("pyproject.toml", "tool.pytest") || contains("setup.cfg", "tool:pytest") {
        return true;
    }
    if fs::metadata(at("tests")).is_ok_and(|m| m.is_dir()) {
        return true;
    }
    fs::read_dir(dir).is_ok_and(|entries| {
        entries
            .flatten()
            .any(|e| is_test_py(&e.file_name().to_string_lossy()))
    })
}

struct Markers {
    npm: bool,
    pytest: bool,
    go_mod: bool,
}

fn markers(dir: &str) -> Markers {
    Markers {
        npm: has_npm_test(dir),
        pytest: has_pytest_marker(dir),
        go_mod: exists(&node_path::join(&[dir, "go.mod"])),
    }
}

/// `dir` 은 부르는 쪽이 스코프를 확정한 절대경로. 프로파일이 없는데(fail-closed) python3 를 띄워야 하면 거절한다.
pub async fn detect(dir: &str, tool: &ToolEnv, gate: &FsGate) -> Result<&'static str, String> {
    let d = dir.to_owned();
    let m = gate.run(LABEL, move || Ok(markers(&d))).await?;
    if m.npm {
        return Ok("npm");
    }
    if m.pytest {
        let finder = tool.clone();
        let python = gate
            .run(LABEL, move || Ok(finder.find_on_path("python3")))
            .await?;
        if let Some(py) = python {
            let args = ["-I", "-c", PYTEST_PROBE];
            let out = tool
                .run(&py, &args, dir, TEST_RUNNER_PROBE_TIMEOUT_MS)
                .await?;
            // Node `execFile` 의 `!err` — 종료 코드 0(1.3 의 M1 규칙).
            if out.end.exec_file_code() == 0 {
                return Ok("pytest");
            }
        }
    }
    if m.go_mod {
        let finder = tool.clone();
        if gate
            .run(LABEL, move || Ok(finder.find_on_path("go").is_some()))
            .await?
        {
            return Ok("go");
        }
    }
    Ok("none")
}

#[cfg(test)]
mod tests {
    use super::{is_test_py, starts_with_node_word};

    /// 기대값은 Node 24.22.2 `/^node\b/`·`/^test_.*\.py$/` 실측.
    #[test]
    fn fixed_patterns_match_node() {
        for (s, want) in [
            ("node", true),
            ("node x", true),
            ("node\t-e", true),
            ("node-gyp", true),
            ("node.js", true),
            ("nodemon", false),
            ("node_x", false),
            ("node1", false),
            (" node", false),
            ("Node", false),
            ("nodeé", true),
        ] {
            assert_eq!(starts_with_node_word(s), want, "{s:?}");
        }
        for (s, want) in [
            ("test_.py", true),
            ("test_x.py", true),
            ("test_a.b.py", true),
            ("test_x.pyc", false),
            ("xtest_a.py", false),
            ("Test_a.py", false),
            ("test_a.PY", false),
            ("test_a\nb.py", false),
            ("test_é.py", true),
        ] {
            assert_eq!(is_test_py(s), want, "{s:?}");
        }
    }
}
