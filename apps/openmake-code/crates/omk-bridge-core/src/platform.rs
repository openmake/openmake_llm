//! OS 별 차이 — 셸·PATH 구분자·폴더 이름. TS `platform.ts` 이식.
//! 플랫폼을 인자로 받는다 — macOS 개발 장비에서 Windows 분기를 검증해야 하므로 `cfg!(target_os)` 로 가르지 않는다.

/// Node 의 `process.platform` 중 코어가 구분하는 값.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Darwin,
    Linux,
    Win32,
}

/// 셸 명령을 실행할 실행 파일과 인자.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellInvocation {
    pub file: String,
    pub args: Vec<String>,
}

/// Windows 는 cmd.exe, 그 밖은 bash. `com_spec` 이 비어 있으면 TS(`comSpec || 'cmd.exe'`)처럼 기본값을 쓴다.
pub fn shell_invocation(command: &str, platform: Platform, com_spec: Option<&str>) -> ShellInvocation {
    if platform == Platform::Win32 {
        let file = com_spec.filter(|s| !s.is_empty()).unwrap_or("cmd.exe");
        return ShellInvocation {
            file: file.to_owned(),
            args: ["/d", "/s", "/c", command].map(String::from).to_vec(),
        };
    }
    ShellInvocation {
        file: "/bin/bash".to_owned(),
        args: ["-c", command].map(String::from).to_vec(),
    }
}

/// PATH 환경변수의 구분자.
pub fn path_list_separator(platform: Platform) -> &'static str {
    if platform == Platform::Win32 { ";" } else { ":" }
}

/// 경로의 마지막 구간 — 두 구분자를 모두 본다. 구간이 없으면(루트·빈 문자열) 경로 그대로.
pub fn folder_name_of(root: &str) -> &str {
    root.split(['\\', '/']).filter(|s| !s.is_empty()).next_back().unwrap_or(root)
}

/// 일괄 승인을 받을 수 있는가 — 명령을 OS 샌드박스로 가두지 못하는 Windows 에서는 받지 않는다.
pub fn bulk_approval_allowed(platform: Platform) -> bool {
    platform != Platform::Win32
}
