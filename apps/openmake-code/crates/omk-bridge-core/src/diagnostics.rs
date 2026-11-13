//! 편집 후 진단(lsp_diagnostics) — TS `diagnostics.ts`.
//!
//! 언어 서버 없이 프로젝트에 이미 있는 도구만 쓴다: TS/JS 는 레포의 `node_modules/.bin/tsc --noEmit -p <가장 가까운 tsconfig>`
//! (tsconfig 마다 1회), Python 은 `python3 -I -m py_compile <파일>`(파일마다 1회). 도구가 없으면 실행하지 않는다.
//! 실행 파일·인자는 코어가 고정 조립한다(서버 문자열은 명령줄에 들어가지 않는다). 자식은 exec 와 같은 샌드박스·환경
//! 허용 목록 안에서 돈다(`tool_env`, D-65 — TS 는 밖에서 돈다). 파일 확인은 관문 안, 자식 실행은 관문 밖이다(D-64).

use std::fs;
use std::sync::LazyLock;

use serde_json::{Value, json};

use crate::constants::{DIAG_MAX_PER_FILE, DIAG_MAX_TOTAL, DIAG_MSG_MAX};
use crate::js_regex::{self, JsRegex};
use crate::js_text::{js_trim, utf16_prefix};
use crate::node_path;
use crate::timed_fs::FsGate;
use crate::tool_env::ToolEnv;

const LABEL: &str = "lsp_diagnostics";
const TS_EXT: [&str; 8] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const PY_EXT: &str = ".py";

/// `path/to/a.ts(12,5): error TS2322: msg` — TS `TSC_LINE.source` 와 같은 글자. 게으른 수량자·역추적에 기대는 패턴이라
/// 손으로 옮기지 않고 regress 로 컴파일한다(D-69).
pub const TSC_LINE: &str = r"^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+([A-Z]+\d+):\s+(.*)$";
static TSC_RE: LazyLock<Option<JsRegex>> = LazyLock::new(|| js_regex::compile(TSC_LINE, false).ok());

/// 진단 한 건 — TS `BridgeDiagnostic`. `code` 는 tsc 만 있다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub path: String,
    pub line: u64,
    pub col: u64,
    pub severity: &'static str,
    pub code: Option<String>,
    pub message: String,
    pub source: &'static str,
}

impl Diagnostic {
    pub fn to_json(&self) -> Value {
        let mut v = json!({
            "path": self.path, "line": self.line, "col": self.col, "severity": self.severity,
            "message": self.message, "source": self.source,
        });
        if let Some(code) = &self.code {
            v["code"] = json!(code);
        }
        v
    }
}

/// `collectDiagnostics` 의 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Collected {
    pub diagnostics: Vec<Diagnostic>,
    pub truncated: bool,
    pub server_kind: String,
}

fn exists(p: &str) -> bool {
    fs::metadata(p).is_ok()
}

/// 파일에서 위로 올라가며 `rel` 이 있는 첫 자리 — 그 폴더를 **검사한 뒤** base 또는 루트에서 멈춘다(TS 순서).
fn find_upward(file: &str, base: &str, rel: &str) -> Option<String> {
    let mut dir = node_path::dirname(file);
    loop {
        let candidate = node_path::join(&[&dir, rel]);
        if exists(&candidate) {
            return Some(candidate);
        }
        let parent = node_path::dirname(&dir);
        if dir == base || dir == parent {
            return None;
        }
        dir = parent;
    }
}

/// 실행 계획 — (tsconfig, tsc) 를 처음 본 순서로(같은 tsconfig 는 한 번), 그리고 .py 파일들.
struct Plan {
    projects: Vec<(String, String)>,
    py: Vec<String>,
}

fn plan(base: &str, abs_paths: &[String]) -> Plan {
    let mut projects: Vec<(String, String)> = Vec::new();
    for f in abs_paths {
        if !TS_EXT.contains(&node_path::extname(f).as_str()) {
            continue;
        }
        let cfg = find_upward(f, base, "tsconfig.json");
        let tsc = find_upward(f, base, "node_modules/.bin/tsc");
        if let (Some(cfg), Some(tsc)) = (cfg, tsc)
            && !projects.iter().any(|(c, _)| *c == cfg)
        {
            projects.push((cfg, tsc));
        }
    }
    let py = abs_paths
        .iter()
        .filter(|f| node_path::extname(f) == PY_EXT)
        .cloned()
        .collect();
    Plan { projects, py }
}

/// tsc 출력 해석 — 줄마다 `trim` 후 형식이 맞는 줄만. 경로는 `relative(base, resolve(cwd, m[1]))`(base 밖이면 `../` 그대로).
/// 줄·열 번호가 u64 를 넘으면 그 줄을 버린다(TS 는 실수로 싣는다 — tsc 는 그런 값을 내지 않는다, D-69).
fn parse_tsc(out: &str, base: &str, cwd: &str) -> Vec<Diagnostic> {
    let Some(re) = TSC_RE.as_ref() else {
        return Vec::new();
    };
    let mut diags = Vec::new();
    for raw in out.split('\n') {
        let Some(g) = re.exec(js_trim(raw)) else {
            continue;
        };
        let group = |i: usize| g.get(i).cloned().flatten().unwrap_or_default();
        let (Ok(line), Ok(col)) = (group(2).parse::<u64>(), group(3).parse::<u64>()) else {
            continue;
        };
        let abs = node_path::resolve(cwd, &group(1));
        let severity = if group(4) == "warning" { "warning" } else { "error" };
        diags.push(Diagnostic {
            path: node_path::relative(base, &abs),
            line,
            col,
            severity,
            code: Some(group(5)),
            message: utf16_prefix(&group(6), DIAG_MSG_MAX).to_owned(),
            source: "tsc",
        });
    }
    diags
}

/// `/line (\d+)/` 의 첫 일치 — `\d` 는 ASCII 숫자.
fn first_line_number(out: &str) -> Option<u64> {
    out.match_indices("line ").find_map(|(i, _)| {
        let digits: String = out[i + 5..].chars().take_while(char::is_ascii_digit).collect();
        (!digits.is_empty()).then(|| digits.parse().ok()).flatten()
    })
}

/// py_compile 출력 해석 — 줄 번호는 처음 나오는 `line N`(없으면 1), 메시지는 마지막 줄.
fn parse_py_compile(out: &str, base: &str, file: &str) -> Vec<Diagnostic> {
    let trimmed = js_trim(out);
    if trimmed.is_empty() {
        return Vec::new();
    }
    let last = trimmed.split('\n').rfind(|l| !l.is_empty()).unwrap_or(out);
    vec![Diagnostic {
        path: node_path::relative(base, file),
        line: first_line_number(out).unwrap_or(1),
        col: 1,
        severity: "error",
        code: None,
        message: utf16_prefix(js_trim(last), DIAG_MSG_MAX).to_owned(),
        source: "py_compile",
    }]
}

/// 파일당 상한 → 전체 상한 순으로 자른다. 파일당 초과는 건너뛰고(`continue`) 전체 초과는 멈춘다(`break`) — TS 그대로.
fn cap(all: Vec<Diagnostic>) -> (Vec<Diagnostic>, bool) {
    let mut per_file: Vec<(String, usize)> = Vec::new();
    let mut kept = Vec::new();
    let mut truncated = false;
    for d in all {
        let i = match per_file.iter().position(|(p, _)| *p == d.path) {
            Some(i) => i,
            None => {
                per_file.push((d.path.clone(), 0));
                per_file.len() - 1
            }
        };
        if per_file[i].1 >= DIAG_MAX_PER_FILE {
            truncated = true;
            continue;
        }
        if kept.len() >= DIAG_MAX_TOTAL {
            truncated = true;
            break;
        }
        per_file[i].1 += 1;
        kept.push(d);
    }
    (kept, truncated)
}

/// 끝난 이유와 무관하게 `stdout + "\n" + stderr`(띄우지 못하면 빈 출력). sandbox-exec 자체 실패는 거절(`ToolEnv::run`).
async fn run_tool(tool: &ToolEnv, file: &str, args: &[&str], cwd: &str, ms: u64) -> Result<String, String> {
    let out = tool.run(file, args, cwd, ms).await?;
    Ok(format!("{}\n{}", out.stdout, out.stderr))
}

/// 지정한 파일들(스코프 확인을 마친 절대경로)의 진단. 실행할 도구가 없으면 빈 결과 + `serverKind: "none"`.
/// 프로파일이 없는데(fail-closed) 자식을 띄워야 하면 그 요청을 거절한다.
pub async fn collect(
    base: &str,
    abs_paths: &[String],
    tool: &ToolEnv,
    timeout_ms: u64,
    gate: &FsGate,
) -> Result<Collected, String> {
    let (b, paths) = (base.to_owned(), abs_paths.to_vec());
    let plan = gate.run(LABEL, move || Ok(plan(&b, &paths))).await?;
    let mut all = Vec::new();
    let mut kinds: Vec<&str> = Vec::new();
    for (cfg, tsc) in &plan.projects {
        let cwd = node_path::dirname(cfg);
        let args = ["--noEmit", "--pretty", "false", "-p", cfg.as_str()];
        let out = run_tool(tool, tsc, &args, &cwd, timeout_ms).await?;
        all.extend(parse_tsc(&out, base, &cwd));
        kinds.push("tsc");
    }
    if !plan.py.is_empty() {
        // python3 는 감싸기 전에 PATH 에서 직접 찾는다 — 없으면 띄우지 않는다(sandbox-exec 의 실패 문구가 해석에 섞이지 않게).
        let finder = tool.clone();
        let python = gate.run(LABEL, move || Ok(finder.find_on_path("python3"))).await?;
        for f in &plan.py {
            let out = match &python {
                Some(py) => {
                    let args = ["-I", "-m", "py_compile", f.as_str()];
                    run_tool(tool, py, &args, base, timeout_ms).await?
                }
                None => "\n".to_owned(),
            };
            if out.contains("Error") || out.contains("error") {
                all.extend(parse_py_compile(&out, base, f));
            }
            kinds.push("py_compile");
        }
    }
    let (diagnostics, truncated) = cap(all);
    let mut seen: Vec<&str> = Vec::new();
    for k in kinds {
        if !seen.contains(&k) {
            seen.push(k);
        }
    }
    let server_kind = if seen.is_empty() { "none".to_owned() } else { seen.join("+") };
    Ok(Collected {
        diagnostics,
        truncated,
        server_kind,
    })
}

#[cfg(test)]
mod tests {
    use super::{TSC_RE, first_line_number, parse_tsc};

    /// TS `TSC_LINE.exec(줄)` — Node 24.22.2 실측 캡처(경로·줄·열·심각도·코드·메시지).
    #[test]
    fn tsc_line_matches_node_captures() {
        let re = TSC_RE.as_ref();
        let cap = |s: &str| re.and_then(|r| r.exec(s)).map(|g| g[1..].iter().map(|x| x.clone().unwrap_or_default()).collect::<Vec<_>>());
        assert_eq!(
            cap("a(1).ts(3,1): error TS1: p").as_deref(),
            Some(["a(1).ts", "3", "1", "error", "TS1", "p"].map(str::to_owned).as_slice())
        );
        assert_eq!(
            cap("c.ts(5,6)(7,8): error TS3: r").map(|g| g[0].clone()).as_deref(),
            Some("c.ts(5,6)")
        );
        assert_eq!(cap("a.ts(1,1): error ts1: x"), None);
        assert_eq!(cap("a.ts(1,1): error TS1:"), None);
        assert_eq!(cap("a.ts(1,1): info TS1: x"), None);
    }

    /// 줄·열이 u64 를 넘는 줄은 버린다(D-69).
    #[test]
    fn huge_numbers_drop_the_line() {
        let out = "a.ts(99999999999999999999,1): error TS1: x\na.ts(2,3): error TS1: y\n";
        let d = parse_tsc(out, "/work", "/work");
        assert_eq!(d.len(), 1);
        assert_eq!((d[0].line, d[0].col), (2, 3));
    }

    #[test]
    fn first_line_number_follows_regex() {
        assert_eq!(first_line_number("line x line 12 line 3"), Some(12));
        assert_eq!(first_line_number("inline 4"), Some(4));
        assert_eq!(first_line_number("Line 4"), None);
        assert_eq!(first_line_number("line \u{0663}"), None);
    }
}
