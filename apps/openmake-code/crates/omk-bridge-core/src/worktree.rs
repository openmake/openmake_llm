//! worktree 격리 — TS `worktree.ts`. 에이전트가 사용자의 작업트리·브랜치를 직접 건드리지 않도록, 연결 폴더 **안**
//! (`.openmake/worktrees/<taskId>`)에 별도 worktree·브랜치를 만들어 그 안에서만 작업하게 한다(폴더 밖이면 샌드박스와
//! 스코프에 모두 막힌다). `.git/info/exclude` 에 등록해 사용자의 status·.gitignore 를 더럽히지 않는다.
//!
//! git 인자는 서버 문자열을 쓰지 않고 여기서 배열로 조립한다 — 서버 값은 형식 검사를 통과한 taskId 만 경로·브랜치
//! 이름에 들어간다. 그래서 사용자 확인 없이 돈다. 셸을 거치지 않는다. 파일 작업은 `FsGate`(라벨 `worktree`)를
//! 거친다(D-36 — TS 는 동기 호출이라 막힌 볼륨에서 멈췄다).

use std::io::Write;
use std::sync::LazyLock;

use crate::constants::{MAX_BUFFER, TASK_ID_RE, WORKTREE_BRANCH_PREFIX, WORKTREE_DIR};
use crate::exec::ExecState;
use crate::exec_env::build_exec_env;
use crate::exec_path::env_get;
use crate::js_text::{js_trim, utf16_prefix};
use crate::msg::{BridgeMsg, BridgeResult};
use crate::node_path;
use crate::proc::{self, ProcSpec, Stderr, Stdin};
use crate::timed_fs::FsGate;

const NO_HOST: &str = "exec 호스트가 설정되지 않았습니다";
const LABEL: &str = "worktree";

static TASK_ID: LazyLock<Option<regress::Regex>> =
    LazyLock::new(|| regress::Regex::new(TASK_ID_RE).ok());

/// TS `TASK_ID_RE.test` — 정규식은 TS 의 source 그대로(플래그 없음 — `$` 는 끝에서만).
fn task_id_ok(t: &str) -> bool {
    TASK_ID.as_ref().is_some_and(|re| re.find(t).is_some())
}

/// `existsSync` — 심링크를 따라가고, 어떤 오류든 "없음".
fn exists(p: &str) -> bool {
    std::fs::metadata(p).is_ok()
}

struct Git {
    ok: bool,
    stdout: String,
    stderr: String,
}

/// git 하나 — exec 와 같은 허용 목록 환경 + **프로세스** PATH(PATH 캐시가 아니다 — TS 그대로). `execFile` 이라 stdin 은
/// 열린 채, 시간 제한 `exec_timeout_ms`(기본 120초 — TS `EXEC_TIMEOUT_MS`), 출력 상한 1MiB(넘치면 실패). 끝난 뒤의
/// 시간 초과는 그 종료 코드로 판정한다(`execFile`).
async fn git(st: &ExecState, args: &[&str], cwd: &str) -> Git {
    let h = &st.host;
    let pairs = h.env.iter().map(|(k, v)| (k.as_str(), v.as_str()));
    let out = proc::run(ProcSpec {
        file: "git".to_owned(),
        args: args.iter().map(|a| (*a).to_owned()).collect(),
        cwd: Some(cwd.to_owned()),
        env: build_exec_env(
            pairs,
            env_get(&h.env, "PATH").unwrap_or(""),
            h.platform,
            &[],
        ),
        timeout_ms: h.exec_timeout_ms,
        max_buffer: MAX_BUFFER as usize,
        stdin: Stdin::HeldOpen,
        stderr: Stderr::Capture,
    })
    .await;
    Git {
        ok: out.end.exec_file_code() == 0,
        stdout: out.stdout,
        stderr: out.stderr,
    }
}

/// 파일 작업 묶음 하나를 관문으로 — 시간 초과는 `worktree 시간 초과 (15s) — …` 로 요청을 끝낸다.
async fn fs_op<T, F>(gate: &FsGate, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    gate.run(LABEL, move || Ok(f())).await
}

/// `.git/info/exclude` 에 `.openmake/` 등록 — 이미 있으면(앞뒤 공백 무시) 두지 않는다. 실패는 무시한다(치명적이지 않다).
fn exclude_worktree_dir(git_dir: &str) {
    let info = node_path::join(&[git_dir, "info"]);
    if std::fs::create_dir_all(&info).is_err() {
        return;
    }
    let p = node_path::join(&[&info, "exclude"]);
    let cur = if exists(&p) {
        match std::fs::read(&p) {
            Ok(b) => String::from_utf8_lossy(&b).into_owned(),
            Err(_) => return,
        }
    } else {
        String::new()
    };
    if cur.split('\n').any(|l| js_trim(l) == ".openmake/") {
        return;
    }
    let lead = if cur.is_empty() || cur.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    let file = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&p);
    if let Ok(mut f) = file {
        let _ = f.write_all(format!("{lead}.openmake/\n").as_bytes());
    }
}

/// worktree 메타 폴더(`.git/worktrees/<이름>`) — 작업트리 밖이라 diff·status 에 잡히지 않고 remove 때 함께 지워진다.
async fn meta_dir(st: &ExecState, wt: &str) -> Option<String> {
    let r = git(st, &["rev-parse", "--absolute-git-dir"], wt).await;
    r.ok.then(|| js_trim(&r.stdout).to_owned())
}

/// diff 기준점(생성 시점 커밋) 기록. 실패는 무시한다(HEAD 폴백).
async fn write_base_sha(st: &ExecState, wt: &str, gate: &FsGate) {
    let meta = meta_dir(st, wt).await;
    let head = git(st, &["rev-parse", "HEAD"], wt).await;
    if let (Some(meta), true) = (meta.filter(|m| !m.is_empty()), head.ok) {
        let sha = js_trim(&head.stdout).to_owned();
        let p = node_path::join(&[&meta, "omk-base"]);
        let _ = fs_op(gate, move || std::fs::write(p, sha)).await;
    }
}

/// 기준점 읽기 — 없거나 읽지 못하거나 형식(`[0-9a-f]{7,40}`)이 아니면 `HEAD`.
async fn read_base_sha(st: &ExecState, wt: &str, gate: &FsGate) -> String {
    const FALLBACK: &str = "HEAD";
    let Some(meta) = meta_dir(st, wt).await.filter(|m| !m.is_empty()) else {
        return FALLBACK.to_owned();
    };
    let p = node_path::join(&[&meta, "omk-base"]);
    let read = fs_op(gate, move || {
        if !exists(&p) {
            return None;
        }
        std::fs::read(&p)
            .ok()
            .map(|b| String::from_utf8_lossy(&b).into_owned())
    });
    let sha = read.await.ok().flatten().map(|s| js_trim(&s).to_owned());
    let is_sha = |s: &str| {
        (7..=40).contains(&s.len()) && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    };
    sha.filter(|s| is_sha(s))
        .unwrap_or_else(|| FALLBACK.to_owned())
}

fn ok_with(f: impl FnOnce(&mut BridgeResult)) -> BridgeResult {
    let mut r = BridgeResult::success();
    f(&mut r);
    r
}

/// worktree 요청 하나 — `op`: `add`·`diff`·`remove`. 폴더 선택 시 worktree 는 그 폴더(base) 아래에 만들고
/// `worktreeRel` 은 base 기준 상대경로다(서버는 folder + worktreeRel 을 그대로 합성한다).
/// 호스트가 없는 코어는 git 에 줄 환경 사본이 없어 띄우지 않는다(D-38 — TS 에 없는 상태).
pub(crate) async fn handle(
    state: Option<&ExecState>,
    base: &str,
    m: &BridgeMsg,
    gate: &FsGate,
) -> BridgeResult {
    let Some(st) = state else {
        return BridgeResult::failure(NO_HOST);
    };
    let task_id = m.task_id.as_deref().unwrap_or("");
    if !task_id_ok(task_id) {
        return BridgeResult::failure("잘못된 taskId 형식");
    }
    let rel = format!("{WORKTREE_DIR}/{task_id}");
    let abs = node_path::join(&[base, &rel]);
    let branch = format!("{WORKTREE_BRANCH_PREFIX}{}", utf16_prefix(task_id, 8));
    match m.op.as_deref() {
        Some("add") => add(st, base, &rel, &abs, branch, gate).await,
        Some("diff") => diff(st, &abs, branch, gate).await,
        Some("remove") => remove(st, base, &abs, branch, gate).await,
        _ => Ok(BridgeResult::failure(format!(
            "지원하지 않는 worktree op: {}",
            m.op_text
        ))),
    }
    .unwrap_or_else(BridgeResult::failure)
}

/// 순서(TS 그대로): 레포 확인 → show-prefix → exclude 등록(이미 있어도 등록부터) → 있으면 재사용 → worktree add →
/// 기준 커밋 기록 → 하위 폴더 보장.
async fn add(
    st: &ExecState,
    base: &str,
    rel: &str,
    abs: &str,
    branch: String,
    gate: &FsGate,
) -> Result<BridgeResult, String> {
    let repo = git(st, &["rev-parse", "--is-inside-work-tree"], base).await;
    if !(repo.ok && js_trim(&repo.stdout) == "true") {
        return Ok(BridgeResult::failure("git 레포가 아닙니다"));
    }
    // worktree 는 레포 전체를 체크아웃한다 — 연결 폴더가 레포 하위면 show-prefix 만큼 더 내려가야 같은 자리다.
    let prefix = git(st, &["rev-parse", "--show-prefix"], base).await;
    let sub = if prefix.ok {
        js_trim(&prefix.stdout).trim_end_matches('/').to_owned()
    } else {
        String::new()
    };
    let work_rel = if sub.is_empty() {
        rel.to_owned()
    } else {
        format!("{rel}/{sub}")
    };
    // untracked 하위 폴더는 체크아웃에 없다 — exec cwd 가 없어 실패하지 않게 빈 폴더로 보장한다(실패는 exec 가 드러낸다).
    let sub_abs = (!sub.is_empty()).then(|| node_path::join(&[abs, &sub]));
    let ensure_sub = move || {
        if let Some(p) = sub_abs {
            let _ = std::fs::create_dir_all(p);
        }
    };
    let git_dir = git(st, &["rev-parse", "--absolute-git-dir"], base).await;
    if git_dir.ok {
        let g = js_trim(&git_dir.stdout).to_owned();
        fs_op(gate, move || exclude_worktree_dir(&g)).await?;
    }
    let done = |work_rel: String, branch: String| {
        ok_with(|r| {
            r.worktree_rel = Some(work_rel);
            r.branch = Some(branch);
        })
    };
    let existing = abs.to_owned();
    if fs_op(gate, move || exists(&existing)).await? {
        fs_op(gate, ensure_sub).await?;
        return Ok(done(work_rel, branch));
    }
    let r = git(st, &["worktree", "add", abs, "-b", &branch], base).await;
    if !r.ok {
        let why = if r.stderr.is_empty() {
            &r.stdout
        } else {
            &r.stderr
        };
        let why = utf16_prefix(js_trim(why), 300);
        return Ok(BridgeResult::failure(format!("worktree 생성 실패: {why}")));
    }
    write_base_sha(st, abs, gate).await;
    fs_op(gate, ensure_sub).await?;
    Ok(done(work_rel, branch))
}

/// 기준은 생성 시점 커밋 — HEAD 를 쓰면 에이전트가 중간에 커밋한 변경이 diff 에서 사라진다.
async fn diff(
    st: &ExecState,
    abs: &str,
    branch: String,
    gate: &FsGate,
) -> Result<BridgeResult, String> {
    let wt = abs.to_owned();
    if !fs_op(gate, move || exists(&wt)).await? {
        return Ok(BridgeResult::failure("worktree 없음"));
    }
    // -N: 새 파일을 '의도만' 등록해 diff 에 넣는다(스테이징·커밋은 하지 않는다). 실패는 무시한다(TS 그대로).
    git(st, &["add", "-A", "-N", "."], abs).await;
    let base_sha = read_base_sha(st, abs, gate).await;
    let r = git(st, &["diff", &base_sha], abs).await;
    if !r.ok {
        let why = utf16_prefix(js_trim(&r.stderr), 200);
        return Ok(BridgeResult::failure(format!("diff 실패: {why}")));
    }
    Ok(ok_with(|o| {
        o.stdout = Some(r.stdout);
        o.branch = Some(branch);
    }))
}

/// 변경(미커밋 또는 에이전트 커밋)이 남아 있으면 지우지 않는다 — 사용자 디스크의 작업 결과를 임의로 지우지 않는다.
async fn remove(
    st: &ExecState,
    base: &str,
    abs: &str,
    branch: String,
    gate: &FsGate,
) -> Result<BridgeResult, String> {
    let wt = abs.to_owned();
    if !fs_op(gate, move || exists(&wt)).await? {
        return Ok(ok_with(|o| o.kept = Some(false)));
    }
    let kept = |branch: String| {
        ok_with(|o| {
            o.kept = Some(true);
            o.branch = Some(branch);
        })
    };
    let status = git(st, &["status", "--porcelain"], abs).await;
    let head = git(st, &["rev-parse", "HEAD"], abs).await;
    let moved = head.ok && js_trim(&head.stdout) != read_base_sha(st, abs, gate).await;
    if (status.ok && !js_trim(&status.stdout).is_empty()) || moved {
        return Ok(kept(branch));
    }
    let r = git(st, &["worktree", "remove", "--force", abs], base).await;
    if !r.ok {
        // 제거 실패도 보존으로 본다.
        return Ok(kept(branch));
    }
    // 변경 없는 빈 브랜치 정리(실패 무시).
    git(st, &["branch", "-D", &branch], base).await;
    Ok(ok_with(|o| {
        o.kept = Some(false);
        o.branch = Some(branch);
    }))
}
