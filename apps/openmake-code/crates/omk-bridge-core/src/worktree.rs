//! worktree 격리 — TS `worktree.ts`. 에이전트가 사용자의 작업트리·브랜치를 직접 건드리지 않도록, 연결 폴더 **안**
//! (`.openmake/worktrees/<taskId>`)에 별도 worktree·브랜치를 만들어 그 안에서만 작업하게 한다(폴더 밖이면 샌드박스와
//! 스코프에 모두 막힌다). `.git/info/exclude` 에 등록해 사용자의 status·.gitignore 를 더럽히지 않는다.
//!
//! git 인자는 서버 문자열을 쓰지 않고 여기서 배열로 조립한다 — 서버 값은 형식 검사를 통과한 taskId 만 경로·브랜치
//! 이름에 들어간다. 그래서 사용자 확인 없이 돈다. 셸을 거치지 않는다. 파일 작업은 `FsGate`(라벨 `worktree`)를
//! 거친다(D-36 — TS 는 동기 호출이라 막힌 볼륨에서 멈췄다).
//!
//! 그래도 git 은 연결 폴더 안의 파일(`.git/config`·`.gitattributes`·worktree 의 gitfile)을 설정으로 읽는다 — 폴더 안은
//! 에이전트가 쓸 수 있어 설정을 고치면 확인 없이 코드가 돌았다(설계 2026-11-14 E1·E1c). 그래서 ① 모든 git 을 도구 프로파일
//! 안에서 띄우고(폴더 밖 쓰기·네트워크 차단, 프로파일이 없으면 띄우지 않는다) ② `GIT_FIXED_ARGS` 로 fsmonitor·훅을 끄며
//! ③ 연산 직전 git 디렉터리가 연결 때 믿기로 한 값(`git_trust`)과 같은지 대조한다(다르면 띄우지 않는다). TS `worktree.ts` 와 같다.
//!
//! 경로는 글자로 이어 붙인 뒤 **파일 kind 와 같은 realpath 스코프**(`scope::safe_from`)로 검사한다 — `.openmake`·`worktrees`·
//! `<taskId>`(또는 worktree 안의 하위 폴더)를 폴더 밖 심링크로 바꿔 두면 add·remove 가 폴더 밖에 만들고 지울 수 있었다(2026-11-13).
//! 요청 첫머리와 `git worktree add`·`worktree remove` 바로 앞에서 두 번 검사한다 — 남는 틈(TOCTOU)은 검사 직후 git 호출 하나다.

use std::io::Write;
use std::sync::LazyLock;

use crate::constants::{
    GIT_DIR_MISMATCH_ERROR, GIT_FIXED_ARGS, MAX_BUFFER, TASK_ID_RE, WORKTREE_BRANCH_PREFIX,
    WORKTREE_DIR,
};
use crate::exec::ExecState;
use crate::git_trust::{GitPaths, read_regular_file};
use crate::js_text::{js_trim, utf16_prefix};
use crate::msg::{BridgeMsg, BridgeResult};
use crate::node_path;
use crate::scope;
use crate::timed_fs::FsGate;
use crate::tool_env::{ToolEnv, tool_failure};

const NO_HOST: &str = "exec 호스트가 설정되지 않았습니다";
const NOT_A_REPO: &str = "git 레포가 아닙니다";
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

/// 요청 하나의 git 실행 조건 — 호스트 환경 + **프로세스** PATH(PATH 캐시가 아니다 — TS 그대로), 도구 프로파일, 믿는 git 디렉터리.
struct Ctx<'a> {
    st: &'a ExecState,
    tool: ToolEnv,
    trusted: Option<GitPaths>,
    /// 연결 폴더 realpath — 폴더 선택으로 고른 중첩 레포는 git 디렉터리가 이 안일 때만 쓴다.
    root: String,
}

/// git 하나 — `GIT_FIXED_ARGS` 를 붙이고 도구 프로파일로 감싼다. 프로파일이 없거나 sandbox-exec 자체가 실패하면(65·71)
/// fail-closed 문구로 `Err`(요청이 126 으로 끝난다). 시간 제한 `exec_timeout_ms`(TS `EXEC_TIMEOUT_MS`), 출력 상한 1MiB.
async fn git(cx: &Ctx<'_>, args: &[&str], cwd: &str) -> Result<Git, String> {
    let mut argv: Vec<&str> = GIT_FIXED_ARGS.to_vec();
    argv.extend_from_slice(args);
    let out = cx
        .tool
        .run("git", &argv, cwd, cx.st.host.exec_timeout_ms)
        .await?;
    Ok(Git {
        ok: out.end.exec_file_code() == 0,
        stdout: out.stdout,
        stderr: out.stderr,
    })
}

/// cwd 의 git dir·common dir(realpath) — git 이 아니거나 못 구하면 `None`. rev-parse 는 fsmonitor 를 돌리지 않는다(E1 실측).
async fn git_dirs_of(cx: &Ctx<'_>, cwd: &str, gate: &FsGate) -> Result<Option<GitPaths>, String> {
    let rev = [
        "rev-parse",
        "--absolute-git-dir",
        "--path-format=absolute",
        "--git-common-dir",
    ];
    let r = git(cx, &rev, cwd).await?;
    if !r.ok {
        return Ok(None);
    }
    let mut lines = r.stdout.split('\n');
    let (Some(g), Some(c)) = (lines.next(), lines.next()) else {
        return Ok(None);
    };
    if g.is_empty() || c.is_empty() {
        return Ok(None);
    }
    let (g, c) = (g.to_owned(), c.to_owned());
    let real = |p: &str| {
        std::fs::canonicalize(p)
            .ok()
            .map(|r| r.to_string_lossy().into_owned())
    };
    fs_op(gate, move || {
        Some(GitPaths {
            git_dir: real(&g)?,
            common_dir: real(&c)?,
        })
    })
    .await
}

fn within(p: &str, dir: &str) -> bool {
    p == dir
        || p.strip_prefix(dir)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// base 의 레포 — 연결 때 믿기로 한 것과 같으면 그것, 다르거나(폴더 선택으로 고른 중첩 레포) 보관한 git 이 없으면 base 의
/// git dir·common dir 가 **둘 다 연결 폴더 안**일 때만 그 값(design.md D-3 의 4번 배치 — 어차피 쓰기 가능한 곳이고, git 은
/// 도구 프로파일 안에서 돈다). 하나라도 폴더 밖이면 거절 문구(TS `repoFor` 와 같다).
async fn repo_for(
    cx: &Ctx<'_>,
    base: &str,
    add: bool,
    gate: &FsGate,
) -> Result<Result<GitPaths, &'static str>, String> {
    let d = git_dirs_of(cx, base, gate).await?;
    if let (Some(d), Some(t)) = (&d, &cx.trusted)
        && d == t
    {
        return Ok(Ok(t.clone()));
    }
    if let Some(d) = d
        .as_ref()
        .filter(|d| within(&d.git_dir, &cx.root) && within(&d.common_dir, &cx.root))
    {
        return Ok(Ok(d.clone()));
    }
    Ok(Err(if add && (cx.trusted.is_none() || d.is_none()) {
        NOT_A_REPO
    } else {
        GIT_DIR_MISMATCH_ERROR
    }))
}

/// worktree 안의 git dir 가 `<base 레포의 common>/worktrees/` 바로 아래인가 — worktree 의 gitfile 을 가짜로 바꿔 두면 아니다(E1c).
async fn worktree_trusted(
    cx: &Ctx<'_>,
    abs: &str,
    repo: &GitPaths,
    gate: &FsGate,
) -> Result<bool, String> {
    let d = git_dirs_of(cx, abs, gate).await?;
    let meta_parent = node_path::join(&[&repo.common_dir, "worktrees"]);
    Ok(d.is_some_and(|d| {
        d.common_dir == repo.common_dir && node_path::dirname(&d.git_dir) == meta_parent
    }))
}

/// diff·remove 의 대조 — base 의 레포를 정하고 worktree 가 그 레포의 것인지 본다. 아니면 거절 문구.
async fn verify_worktree(
    cx: &Ctx<'_>,
    base: &str,
    abs: &str,
    gate: &FsGate,
) -> Result<Result<GitPaths, &'static str>, String> {
    let repo = match repo_for(cx, base, false, gate).await? {
        Ok(r) => r,
        Err(bad) => return Ok(Err(bad)),
    };
    if worktree_trusted(cx, abs, &repo, gate).await? {
        Ok(Ok(repo))
    } else {
        Ok(Err(GIT_DIR_MISMATCH_ERROR))
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

/// 심링크인가(따라가지 않는다) — 없거나 못 보면 아니다.
fn is_symlink(p: &str) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
}

/// 이 프로세스(샌드박스 밖)가 git 디렉터리 안에 파일을 쓴다 — 그 자리는 샌드박스 안의 자식(필터·exec)이 쓸 수 있어 심링크로
/// 바꿔 둘 수 있다. 따라가면 폴더 밖 파일을 덮어쓴다(리뷰 F5, M3). 그래서 **새 이름으로 만들고(`create_new` = O_CREAT|O_EXCL —
/// 심링크면 실패한다) rename 으로 바꿔 넣는다**(rename 은 대상 자리의 심링크를 따라가지 않고 그 항목을 바꾼다). TS `writeNoFollow`.
fn write_no_follow(dir: &str, name: &str, content: &[u8]) -> std::io::Result<()> {
    let tmp = node_path::join(&[dir, &format!("{name}.omk-{}", std::process::id())]);
    let _ = std::fs::remove_file(&tmp); // 남은 임시 이름(심링크여도 링크만 지운다)
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)?;
    f.write_all(content)?;
    drop(f);
    std::fs::rename(&tmp, node_path::join(&[dir, name])).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// `info/exclude` 에 `.openmake/` 등록 — 이미 있으면(앞뒤 공백 무시) 두지 않는다. 실패는 무시한다(치명적이지 않다).
/// 제외 목록은 common dir 에 있다(linked worktree 도 `$GIT_COMMON_DIR/info/exclude` 를 읽는다). `info`·`info/exclude` 는
/// 에이전트가 바꿀 수 있다 — 폴더 밖 심링크는 물론 git 디렉터리 안쪽 심링크(→ config 등, M3)도 따라가면 그 파일 끝에 줄이
/// 붙으므로 심링크면 등록하지 않고, 쓰기는 따라가지 않는 바꿔 넣기로 한다(TS 같음).
fn exclude_worktree_dir(git_dir: &str) {
    if scope::safe_from(git_dir, Some("info/exclude")).is_err() {
        return;
    }
    let info = node_path::join(&[git_dir, "info"]);
    let p = node_path::join(&[&info, "exclude"]);
    if is_symlink(&info) || is_symlink(&p) {
        return;
    }
    if std::fs::create_dir_all(&info).is_err() {
        return;
    }
    // 일반 파일만·MAX_BUFFER 이하만 읽는다 — FIFO·소켓·장치면 읽기가 멈췄다(리뷰 N3), 큰 파일도 그만큼 잡는다(리뷰 R4).
    // 그때는 등록을 건너뛴다(TS 같음).
    let cur = if std::fs::symlink_metadata(&p).is_ok() {
        match read_regular_file(&p, MAX_BUFFER) {
            Some(t) => t,
            None => return,
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
    let _ = write_no_follow(
        &info,
        "exclude",
        format!("{cur}{lead}.openmake/\n").as_bytes(),
    );
}

/// worktree 메타 폴더(`.git/worktrees/<이름>`) — 작업트리 밖이라 diff·status 에 잡히지 않고 remove 때 함께 지워진다.
/// 그 레포의 `<common>/worktrees/` 바로 아래일 때만 쓴다(git 이 답한 값을 대조 없이 쓰지 않는다, 리뷰 F5).
async fn meta_dir(
    cx: &Ctx<'_>,
    wt: &str,
    repo: &GitPaths,
    gate: &FsGate,
) -> Result<Option<String>, String> {
    let r = git(cx, &["rev-parse", "--absolute-git-dir"], wt).await?;
    if !r.ok {
        return Ok(None);
    }
    let raw = js_trim(&r.stdout).to_owned();
    let parent = node_path::join(&[&repo.common_dir, "worktrees"]);
    let real = fs_op(gate, move || std::fs::canonicalize(raw).ok()).await?;
    Ok(real
        .map(|m| m.to_string_lossy().into_owned())
        .filter(|m| node_path::dirname(m) == parent))
}

/// diff 기준점(생성 시점 커밋) 기록 — 심링크를 따라가지 않는다. 실패는 무시한다(HEAD 폴백) — 프로파일 없음만 올려 보낸다.
async fn write_base_sha(
    cx: &Ctx<'_>,
    wt: &str,
    repo: &GitPaths,
    gate: &FsGate,
) -> Result<(), String> {
    let meta = meta_dir(cx, wt, repo, gate).await?;
    let head = git(cx, &["rev-parse", "HEAD"], wt).await?;
    if let (Some(meta), true) = (meta, head.ok) {
        let sha = js_trim(&head.stdout).to_owned();
        let _ = fs_op(gate, move || {
            write_no_follow(&meta, "omk-base", sha.as_bytes())
        })
        .await;
    }
    Ok(())
}

/// 기준점 읽기 — 없거나 심링크거나(일반 파일만 읽는다) 읽지 못하거나 형식(`[0-9a-f]{7,40}`)이 아니면 `HEAD`.
async fn read_base_sha(
    cx: &Ctx<'_>,
    wt: &str,
    repo: &GitPaths,
    gate: &FsGate,
) -> Result<String, String> {
    const FALLBACK: &str = "HEAD";
    let Some(meta) = meta_dir(cx, wt, repo, gate).await? else {
        return Ok(FALLBACK.to_owned());
    };
    let p = node_path::join(&[&meta, "omk-base"]);
    let read = fs_op(gate, move || {
        if !std::fs::symlink_metadata(&p).is_ok_and(|m| m.is_file()) {
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
    Ok(sha
        .filter(|s| is_sha(s))
        .unwrap_or_else(|| FALLBACK.to_owned()))
}

/// worktree 루트와 대상이 연결 폴더 realpath 안인지 — TS 의 `safeFromAsync` 두 번(루트 → 대상)과 같다. 안쪽 심링크는 허용한다.
async fn check_scope(base: &str, rel: &str, gate: &FsGate) -> Result<(), String> {
    let (b, r) = (base.to_owned(), rel.to_owned());
    fs_op(gate, move || {
        scope::safe_from(&b, Some(WORKTREE_DIR))?;
        scope::safe_from(&b, Some(&r)).map(drop)
    })
    .await?
}

fn ok_with(f: impl FnOnce(&mut BridgeResult)) -> BridgeResult {
    let mut r = BridgeResult::success();
    f(&mut r);
    r
}

/// worktree 요청 하나 — `op`: `add`·`diff`·`remove`. 폴더 선택 시 worktree 는 그 폴더(base) 아래에 만들고
/// `worktreeRel` 은 base 기준 상대경로다(서버는 folder + worktreeRel 을 그대로 합성한다).
/// 호스트가 없는 코어는 git 에 줄 환경 사본이 없어 띄우지 않는다(D-38 — TS 에 없는 상태).
/// 도구 프로파일이 없어 git 을 띄우지 않았으면 도구와 같은 126 거절이다.
pub(crate) async fn handle(
    state: Option<&ExecState>,
    root: &str,
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
    if matches!(m.op.as_deref(), Some("add" | "diff" | "remove"))
        && let Err(e) = check_scope(base, &rel, gate).await
    {
        return BridgeResult::failure(e);
    }
    let h = &st.host;
    let cx = Ctx {
        st,
        // exec_path 를 비워 두면 자식 PATH 는 호스트 환경의 PATH 다(TS `process.env.PATH`).
        tool: ToolEnv {
            env: h.env.clone(),
            platform: h.platform,
            exec_path: String::new(),
            sandbox: st.tool_sandbox(),
        },
        trusted: st.git_paths(),
        root: root.to_owned(),
    };
    match m.op.as_deref() {
        Some("add") => add(&cx, base, &rel, &abs, branch, gate).await,
        Some("diff") => diff(&cx, base, &abs, branch, gate).await,
        Some("remove") => remove(&cx, base, &rel, &abs, branch, gate).await,
        _ => Ok(BridgeResult::failure(format!(
            "지원하지 않는 worktree op: {}",
            m.op_text
        ))),
    }
    .unwrap_or_else(tool_failure)
}

/// 실패한 `worktree add` 가 남긴 것을 치운다 — 폴더가 남으면 다음 요청이 "재개"로 오인하고, 등록(메타)이 남으면 같은 자리의
/// 다음 add 가 "missing but already registered" 로, 브랜치가 남으면 "이미 있다"로 실패한다. **이 worktree 만** 치운다 —
/// `git worktree prune` 은 레포 전체의 폴더 없는 등록(분리된 볼륨의 worktree 등)을 즉시 지웠다(리뷰 F8). `worktree remove
/// --force` 는 폴더가 없는 등록도 지운다(실측). 브랜치는 이번 add 가 만든 것만 지운다. TS `cleanupFailedAdd` 와 같다.
async fn cleanup_failed_add(
    cx: &Ctx<'_>,
    (base, rel, abs): (&str, &str, &str),
    branch: &str,
    had_branch: bool,
    gate: &FsGate,
) -> Result<(), String> {
    git(cx, &["worktree", "remove", "--force", abs], base).await?;
    let left = abs.to_owned();
    if fs_op(gate, move || exists(&left)).await? && check_scope(base, rel, gate).await.is_ok() {
        let left = abs.to_owned();
        fs_op(gate, move || std::fs::remove_dir_all(left))
            .await?
            .ok();
    }
    if !had_branch {
        git(cx, &["branch", "-D", branch], base).await?;
    }
    Ok(())
}

/// 순서(TS 그대로): 믿는 git 확인 → git 디렉터리 대조 → 레포 확인 → show-prefix → exclude 등록(이미 있어도 등록부터) →
/// 있으면 재사용 → 브랜치가 이미 있었나 → 재검사 → worktree add(실패하면 정리) → 기준 커밋 기록 → 하위 폴더 보장.
async fn add(
    cx: &Ctx<'_>,
    base: &str,
    rel: &str,
    abs: &str,
    branch: String,
    gate: &FsGate,
) -> Result<BridgeResult, String> {
    let found = match repo_for(cx, base, true, gate).await? {
        Ok(r) => r,
        Err(bad) => return Ok(BridgeResult::failure(bad)),
    };
    let repo = git(cx, &["rev-parse", "--is-inside-work-tree"], base).await?;
    if !(repo.ok && js_trim(&repo.stdout) == "true") {
        return Ok(BridgeResult::failure(NOT_A_REPO));
    }
    // worktree 는 레포 전체를 체크아웃한다 — 연결 폴더가 레포 하위면 show-prefix 만큼 더 내려가야 같은 자리다.
    let prefix = git(cx, &["rev-parse", "--show-prefix"], base).await?;
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
    // worktree 안은 에이전트가 쓸 수 있다 — 하위 경로가 폴더 밖 심링크면 만들지 않는다(스코프 거부도 exec 가 드러낸다).
    let sub_rel = (!sub.is_empty()).then(|| (base.to_owned(), work_rel.clone()));
    let ensure_sub = move || {
        if let Some(p) = sub_rel.and_then(|(b, r)| scope::safe_from(&b, Some(&r)).ok()) {
            let _ = std::fs::create_dir_all(p);
        }
    };
    let common = found.common_dir.clone();
    fs_op(gate, move || exclude_worktree_dir(&common)).await?;
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
    let head_ref = format!("refs/heads/{branch}");
    let had_branch = git(cx, &["rev-parse", "--verify", "--quiet", &head_ref], base)
        .await?
        .ok;
    // 첫 검사 뒤 git 여러 번·exclude 쓰기가 끼었다 — 바로 앞에서 다시 본다(TS 같음).
    check_scope(base, rel, gate).await?;
    let r = git(cx, &["worktree", "add", abs, "-b", &branch], base).await?;
    if !r.ok {
        cleanup_failed_add(cx, (base, rel, abs), &branch, had_branch, gate).await?;
        let why = if r.stderr.is_empty() {
            &r.stdout
        } else {
            &r.stderr
        };
        let why = utf16_prefix(js_trim(why), 300);
        return Ok(BridgeResult::failure(format!("worktree 생성 실패: {why}")));
    }
    write_base_sha(cx, abs, &found, gate).await?;
    fs_op(gate, ensure_sub).await?;
    Ok(done(work_rel, branch))
}

/// 기준은 생성 시점 커밋 — HEAD 를 쓰면 에이전트가 중간에 커밋한 변경이 diff 에서 사라진다.
async fn diff(
    cx: &Ctx<'_>,
    base: &str,
    abs: &str,
    branch: String,
    gate: &FsGate,
) -> Result<BridgeResult, String> {
    let wt = abs.to_owned();
    if !fs_op(gate, move || exists(&wt)).await? {
        return Ok(BridgeResult::failure("worktree 없음"));
    }
    let repo = match verify_worktree(cx, base, abs, gate).await? {
        Ok(r) => r,
        Err(bad) => return Ok(BridgeResult::failure(bad)),
    };
    // -N: 새 파일을 '의도만' 등록해 diff 에 넣는다(스테이징·커밋은 하지 않는다). 실패는 무시한다(TS 그대로).
    git(cx, &["add", "-A", "-N", "."], abs).await?;
    let base_sha = read_base_sha(cx, abs, &repo, gate).await?;
    let r = git(cx, &["diff", &base_sha], abs).await?;
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
    cx: &Ctx<'_>,
    base: &str,
    rel: &str,
    abs: &str,
    branch: String,
    gate: &FsGate,
) -> Result<BridgeResult, String> {
    let wt = abs.to_owned();
    if !fs_op(gate, move || exists(&wt)).await? {
        return Ok(ok_with(|o| o.kept = Some(false)));
    }
    let repo = match verify_worktree(cx, base, abs, gate).await? {
        Ok(r) => r,
        Err(bad) => return Ok(BridgeResult::failure(bad)),
    };
    let kept = |branch: String| {
        ok_with(|o| {
            o.kept = Some(true);
            o.branch = Some(branch);
        })
    };
    let status = git(cx, &["status", "--porcelain"], abs).await?;
    let head = git(cx, &["rev-parse", "HEAD"], abs).await?;
    let moved = head.ok && js_trim(&head.stdout) != read_base_sha(cx, abs, &repo, gate).await?;
    if (status.ok && !js_trim(&status.stdout).is_empty()) || moved {
        return Ok(kept(branch));
    }
    check_scope(base, rel, gate).await?; // 첫 검사 뒤 git 여러 번이 끼었다 — 바로 앞에서 다시 본다(TS 같음).
    let r = git(cx, &["worktree", "remove", "--force", abs], base).await?;
    if !r.ok {
        // 제거 실패도 보존으로 본다.
        return Ok(kept(branch));
    }
    // 변경 없는 빈 브랜치 정리(실패 무시).
    git(cx, &["branch", "-D", &branch], base).await?;
    Ok(ok_with(|o| {
        o.kept = Some(false);
        o.branch = Some(branch);
    }))
}
