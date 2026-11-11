//! exec 가드레일(보안 경계 아님, 우발·명백 유출 백스톱) — TS `denylist.ts` 이식. 걸리면 확인 없이 거부한다.
//!
//! 패턴은 ECMAScript 정규식 엔진(`regress`)으로 컴파일한다. Rust `regex` 는 `\s`·`\b`·대소문자 무시의 범위가
//! JS 와 달라 같은 명령에 다른 판정이 난다. 패턴 문자열은 TS `re.source`·`re.flags` 와 글자 단위로 같다(fixture 가 확인).
//! 알려진 차이: `regress` 는 `u` 없는 `i` 에서 U+017F→s, U+212A→k 로 접어 JS 보다 더 막는다
//! (`packages/local-bridge-core/conformance/README.md`).

use std::sync::LazyLock;

use regress::Regex;

/// 차단 규칙 한 줄 — TS `{ re, why }` 의 `re.source`·`re.flags` 와 사유.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DenyRule {
    pub source: &'static str,
    pub flags: &'static str,
    pub why: &'static str,
}

pub const EXEC_DENYLIST: &[DenyRule] = &[
    DenyRule {
        source: r#"(^|[;&|(]|\s)sudo\s"#,
        flags: "",
        why: "권한 상승(sudo)",
    },
    DenyRule {
        source: r#"(^|[;&|(]|\s)doas\s"#,
        flags: "",
        why: "권한 상승(doas)",
    },
    DenyRule {
        source: r#"(curl|wget)\s[^|]*\|\s*(sh|bash|zsh)\b"#,
        flags: "",
        why: "원격 스크립트 직접 실행(pipe-to-shell)",
    },
    DenyRule {
        source: r#"\|\s*(sh|bash|zsh)\b"#,
        flags: "",
        why: "파이프-투-셸 실행",
    },
    DenyRule {
        source: r#"\brm\s+-\w*\s+(\/|~|\$HOME|\$\{HOME\})(\s|$)"#,
        flags: "",
        why: "홈/루트 대량 삭제",
    },
    DenyRule {
        source: r#"\.ssh(\/|\b)"#,
        flags: "",
        why: "SSH 키 디렉토리 접근",
    },
    DenyRule {
        source: r#"id_rsa|id_ed25519|\.aws\/credentials|\.config\/gcloud"#,
        flags: "",
        why: "자격증명 파일 접근",
    },
    DenyRule {
        source: r#":\s*\(\s*\)\s*\{"#,
        flags: "",
        why: "fork bomb",
    },
    DenyRule {
        source: r#"\bdd\s+if=|\bmkfs\b|>\s*\/dev\/(disk|sd|rdisk)"#,
        flags: "",
        why: "디스크 파괴 연산",
    },
    // ── Windows(cmd·PowerShell) — 같은 부류의 명백한 파괴·권한 상승·유출 ──
    DenyRule {
        source: r#"\b(rd|rmdir)\s+(\/s\b[^&|]*\s)?(\/q\s+)?(\/s\s+)?["']?([a-z]:\\?|%(systemdrive|userprofile|homepath)%\\?)["']?(\s|$)"#,
        flags: "i",
        why: "드라이브·홈 대량 삭제(rd)",
    },
    DenyRule {
        source: r#"\bdel\s+[^&|]*\/s\b[^&|]*["']?([a-z]:\\\*?|%(systemdrive|userprofile)%\\?\*?)["']?(\s|$)"#,
        flags: "i",
        why: "드라이브·홈 대량 삭제(del)",
    },
    DenyRule {
        source: r#"\bremove-item\b[^;|]*-recurse\b[^;|]*\s["']?([a-z]:\\?|\$env:(userprofile|systemdrive)\\?|~\\?)["']?(\s|$)"#,
        flags: "i",
        why: "드라이브·홈 대량 삭제(Remove-Item)",
    },
    DenyRule {
        source: r#"\bformat(\.com)?\s+[a-z]:"#,
        flags: "i",
        why: "디스크 포맷",
    },
    DenyRule {
        source: r#"\b(diskpart|bcdedit|cipher\s+\/w)\b"#,
        flags: "i",
        why: "디스크·부팅 설정 변경",
    },
    DenyRule {
        source: r#"\breg(\.exe)?\s+(delete|add)\s+["']?hk(lm|ey_local_machine)\b"#,
        flags: "i",
        why: "시스템 레지스트리 변경",
    },
    DenyRule {
        source: r#"\b(runas|start-process\b[^;|]*-verb\s+runas)\b"#,
        flags: "i",
        why: "권한 상승(runas)",
    },
    DenyRule {
        source: r#"\b(iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\b[^|;]*\|\s*(iex|invoke-expression)\b"#,
        flags: "i",
        why: "원격 스크립트 직접 실행(iex)",
    },
    DenyRule {
        source: r#"\\\.ssh\\|\\\.aws\\credentials|\bntds\.dit\b|\\config\\sam\b"#,
        flags: "i",
        why: "자격증명 파일 접근",
    },
];

/// 정적 패턴 컴파일 — 패턴은 상수라 실패는 코드 결함이다(테스트가 잡는다).
#[allow(clippy::expect_used)]
fn compile(source: &str, flags: &str) -> Regex {
    Regex::with_flags(source, flags).expect("정적 정규식 컴파일")
}

/// 규칙 정규식 — 처음 쓸 때 한 번만 컴파일한다.
static COMPILED_RULES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    EXEC_DENYLIST
        .iter()
        .map(|d| compile(d.source, d.flags))
        .collect()
});

/// ANSI 이스케이프(CSI) — 제어 문자만 지우면 `[0m` 같은 꼬리가 남아 토큰 경계를 가린다.
static ANSI_CSI_RE: LazyLock<Regex> = LazyLock::new(|| compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]", ""));
/// 공백(탭·개행·CR)을 뺀 제어 문자.
static CONTROL_CHARS_RE: LazyLock<Regex> =
    LazyLock::new(|| compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", ""));
/// 줄 이음 — 셸은 백슬래시+개행을 지우고 앞뒤를 붙여 읽는다.
static LINE_CONTINUATION_RE: LazyLock<Regex> = LazyLock::new(|| compile(r"\\\r?\n", ""));
/// `$IFS`·`${IFS}`·`${IFS:0:1}` — 기본값이 공백이라 토큰 사이 공백 대신 쓸 수 있다.
static IFS_RE: LazyLock<Regex> = LazyLock::new(|| compile(r"\$\{IFS\b[^}]*\}|\$IFS\b", ""));
/// 빈 따옴표 — `su''do` 는 `sudo` 로 실행된다.
static EMPTY_QUOTES_RE: LazyLock<Regex> = LazyLock::new(|| compile(r#"''|"""#, ""));

/// JS `String.prototype.replace(/…/g, rep)` 와 같다(교체 문자열에 `$` 특수 표기는 쓰지 않는다).
fn replace_all(re: &Regex, text: &str, rep: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for m in re.find_iter(text) {
        out.push_str(&text[last..m.start()]);
        out.push_str(rep);
        last = m.end();
    }
    out.push_str(&text[last..]);
    out
}

/// 차단 목록에 대기 전 정리 — 셸이 같은 명령으로 읽는 표기를 하나로 모은다. 순서는 TS 와 같다.
/// 휴리스틱이다(보안 경계 아님): 백슬래시 이스케이프·내용 있는 따옴표·변수 조립은 그대로 지나간다.
pub fn normalize_for_denylist(cmd: &str) -> String {
    let s = replace_all(&LINE_CONTINUATION_RE, cmd, "");
    let s = replace_all(&ANSI_CSI_RE, &s, "");
    let s = replace_all(&CONTROL_CHARS_RE, &s, "");
    let s = replace_all(&IFS_RE, &s, " ");
    replace_all(&EMPTY_QUOTES_RE, &s, "")
}

/// 원문을 먼저, 정리본을 다음에 댄다 — 정리가 기존 차단을 풀지 못하게 원문 판정을 그대로 둔다.
/// 처음 걸린 규칙의 사유를 돌려준다.
pub fn match_denylist(cmd: &str) -> Option<&'static str> {
    let normalized = normalize_for_denylist(cmd);
    let candidates: &[&str] = if normalized == cmd {
        &[cmd]
    } else {
        &[cmd, &normalized]
    };
    candidates.iter().find_map(|c| {
        COMPILED_RULES
            .iter()
            .zip(EXEC_DENYLIST)
            .find(|(re, _)| re.find(c).is_some())
            .map(|(_, d)| d.why)
    })
}

#[cfg(test)]
mod tests {
    use super::{COMPILED_RULES, EXEC_DENYLIST, match_denylist};

    #[test]
    fn rules_compile_once_and_all_compile() {
        let first: *const Vec<_> = &*COMPILED_RULES;
        assert!(match_denylist("sudo ls").is_some());
        let second: *const Vec<_> = &*COMPILED_RULES;
        assert!(std::ptr::eq(first, second));
        assert_eq!(COMPILED_RULES.len(), EXEC_DENYLIST.len());
    }
}
