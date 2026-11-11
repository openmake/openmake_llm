//! exec 자식 환경 조립 — TS `exec-env.ts` 이식. 허용 목록 키만 복사하고 PATH 는 인자 값으로 둔다.

use std::collections::BTreeMap;

use crate::constants::{
    EXEC_ENV_ALLOWLIST_POSIX, EXEC_ENV_ALLOWLIST_PREFIX_POSIX, EXEC_ENV_ALLOWLIST_WIN32,
};
use crate::platform::Platform;

/// Windows 는 env 키가 대소문자를 가리지 않아 허용 목록과 대소문자 무시로 맞추되 원래 표기를 유지한다.
/// `extra_posix_keys` 는 셸 경로 탐색 자식에만 더 넘기는 키다(exec 에는 쓰지 않는다). Windows 에서는 보지 않는다.
/// 소문자 변환은 JS `toLowerCase` 와 같은 유니코드 규칙(`str::to_lowercase`)을 쓴다.
pub fn build_exec_env<K, V>(
    source: impl IntoIterator<Item = (K, V)>,
    exec_path: &str,
    platform: Platform,
    extra_posix_keys: &[&str],
) -> BTreeMap<String, String>
where
    K: AsRef<str>,
    V: AsRef<str>,
{
    let mut out = BTreeMap::new();
    for (k, v) in source {
        let k = k.as_ref();
        let keep = if platform == Platform::Win32 {
            let lower = k.to_lowercase();
            EXEC_ENV_ALLOWLIST_WIN32
                .iter()
                .any(|w| w.to_lowercase() == lower)
        } else {
            EXEC_ENV_ALLOWLIST_POSIX.contains(&k)
                || EXEC_ENV_ALLOWLIST_PREFIX_POSIX
                    .iter()
                    .any(|p| k.starts_with(p))
                || extra_posix_keys.contains(&k)
        };
        if keep {
            out.insert(k.to_owned(), v.as_ref().to_owned());
        }
    }
    // source 에 PATH 가 있어도 인자 값이 이긴다.
    out.insert("PATH".to_owned(), exec_path.to_owned());
    out
}
