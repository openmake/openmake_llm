//! 띄우는 자식에 fd 3 이상을 넘기지 않는다(PR-3.2 D-241(r3) ①, T0-a 실측: 비-CLOEXEC fd 가 exec·Chrome 자식에 넘어갔다).
//! 앱(AppKit·Foundation)이 연 fd 가 샌드박스 명령에 새지 않게, 코어 `proc::spawn` 의 전역 훅으로 `pre_exec` 에서 fd 3..한도에
//! `FD_CLOEXEC` 를 **건다**. 닫지 않는 이유: 닫으면 std 가 exec 실패를 알리는 내부 CLOEXEC 파이프도 닫혀, 없는 실행 파일이
//! 성공으로 보고된다. 거는 것은 그 파이프에 이미 걸린 플래그를 다시 거는 것이라 무해하고, fd 는 exec 가 성공할 때만 닫힌다.
//!
//! 이 모듈은 크레이트 뿌리의 unsafe 허용을 물려받는 두 자리 중 하나다(D-224 (r3)). `pre_exec` 가 있으면 std 는 fork+exec 를
//! 쓴다 — 자식(fork 뒤 exec 전)에서는 async-signal-safe 인 `fcntl` 만 부른다(할당·잠금·Objective-C 호출 없음).
//! 한도(`getdtablesize`)는 부모에서 계산한다. 한도가 크면(터미널에서 띄운 개발 실행 61440, Finder 로 연 앱 256) 자식 쪽 루프가
//! 그만큼 돈다 — 실측은 T0-results.md·DONE 기록.

use std::os::unix::process::CommandExt;
use std::sync::{Arc, Once};

/// 프로세스에서 한 번 — 첫 `BridgeHost::start` 가 부른다. 헬퍼(사이드카)는 부르지 않는다.
pub(crate) fn install() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _ = omk_bridge_core::proc::set_spawn_hook(Arc::new(hook));
    });
}

fn hook(cmd: &mut std::process::Command) {
    // SAFETY: 인자 없는 libc 조회 — 부모에서 부른다(async-signal-safe 목록 밖이라 자식에서는 부르지 않는다).
    let max = unsafe { libc::getdtablesize() };
    // SAFETY: 클로저는 fork 뒤 exec 전 자식에서 돈다 — async-signal-safe 인 fcntl 만 부르고, 할당·잠금·패닉 경로가 없다.
    // 빈 번호(EBADF)는 음수로 돌아와 건너뛴다. 0~2 는 std 가 stdio 를 dup2 한 결과라 건드리지 않는다.
    unsafe {
        cmd.pre_exec(move || {
            for fd in 3..max {
                let flags = libc::fcntl(fd, libc::F_GETFD);
                if flags >= 0 && flags & libc::FD_CLOEXEC == 0 {
                    libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC);
                }
            }
            Ok(())
        });
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use std::collections::BTreeMap;
    use std::time::Instant;

    use omk_bridge_core::proc::{ProcEnd, ProcSpec, Stderr, Stdin, run};

    const CHILD: &str = "OMK_FFI_CLOEXEC_CHILD";

    fn spec(file: &str, args: &[&str]) -> ProcSpec {
        ProcSpec {
            file: file.to_owned(),
            args: args.iter().map(|a| (*a).to_owned()).collect(),
            cwd: None,
            env: BTreeMap::from([("PATH".to_owned(), "/usr/bin:/bin".to_owned())]),
            timeout_ms: 10_000,
            max_buffer: 1 << 20,
            stdin: Stdin::Null,
            stderr: Stderr::Capture,
        }
    }

    /// T-C1(PR-3.2 D-241(r3), 검토 r3 Low-1 — 모듈 안 시험) — 비-CLOEXEC fd 9 를 물려받은 프로세스(이 테스트 바이너리를
    /// `/bin/sh` 로 다시 띄움)에서 훅을 단 뒤: 자식 `/bin/ls /dev/fd` 에 9 없음, 없는 실행 파일은 여전히 `SpawnFailed`(std 오류
    /// 파이프 보존), fork 경로에서도 자식 SIGPIPE 는 기본값(T0-c 재확인).
    #[test]
    fn hook_keeps_fds_from_children() {
        if std::env::var_os(CHILD).is_none() {
            let exe = std::env::current_exe().unwrap();
            let out = std::process::Command::new("/bin/sh")
                .args(["-c", "exec 9</dev/null; exec \"$0\" \"$@\""])
                .arg(&exe)
                .args([
                    "--exact",
                    "cloexec::tests::hook_keeps_fds_from_children",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env(CHILD, "1")
                .output()
                .unwrap();
            let text = String::from_utf8_lossy(&out.stdout).into_owned();
            assert!(out.status.success() && text.contains("1 passed"), "{text}");
            for l in text
                .lines()
                .filter_map(|l| l.find("T-C1 ").map(|i| &l[i..]))
            {
                println!("{l}");
            }
            return;
        }
        // 전제 — 이 프로세스에는 9 가 열려 있다(거짓 통과 방지).
        assert!(std::fs::metadata("/dev/fd/9").is_ok(), "부모에 fd 9 없음");
        super::install();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let ls = run(spec("/bin/ls", &["/dev/fd"])).await;
            assert!(matches!(ls.end, ProcEnd::Exited(0)), "{:?}", ls.end);
            assert!(!ls.stdout.lines().any(|l| l.trim() == "9"), "{}", ls.stdout);
            let missing = run(spec("/nonexistent/omk-x", &[])).await;
            assert!(
                matches!(missing.end, ProcEnd::SpawnFailed(_)),
                "{:?}",
                missing.end
            );
            let pipe = run(spec(
                "/bin/sh",
                &[
                    "-c",
                    "(/usr/bin/yes; echo \"yes=$?\" >&2) | /usr/bin/head -c1 >/dev/null",
                ],
            ))
            .await;
            assert_eq!(pipe.stderr.trim(), "yes=141");
            // 검토 r3 Low-3 — 이 프로세스의 한도와 자식 하나 띄우는 시간(관찰용 기록).
            let t = Instant::now();
            let _ = run(spec("/usr/bin/true", &[])).await;
            // SAFETY: 인자 없는 libc 조회.
            let max = unsafe { libc::getdtablesize() };
            println!(
                "T-C1 getdtablesize={max} spawn_true_ms={}",
                t.elapsed().as_millis()
            );
        });
    }
}
