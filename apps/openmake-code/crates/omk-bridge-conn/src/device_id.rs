//! deviceId — 헬퍼 `helper.mjs` 의 `baseDeviceId`·`rootDeviceId` 와 Node 동기 `fs.realpathSync`.
//!
//! `rootDeviceId = <base id>-r-<sha256(루트 문자열) 16진 앞 12자>` 이고 루트 문자열은 Node `fs.realpathSync(folder)` 의
//! 결과다. Node 의 동기 realpath 는 JS 로 구현돼 심링크만 풀고 **입력의 글자(대소문자·유니코드 정규화 형태)를 그대로
//! 둔다.** `fs::canonicalize` 는 디스크의 글자로 바꾸므로, 그것으로 계산하면 같은 폴더가 서버에 새 기기로 등록된다(D-47).

use std::collections::{HashMap, HashSet};
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::path::Path;

use omk_bridge_core::{node_error, node_path};
use ring::digest;
use ring::rand::{SecureRandom, SystemRandom};

use crate::js_string;

/// 루트별 파생 deviceId — 재접속해도 같은 값. 36+3+12=51 은 서버 상한 64 안이다.
pub fn root_device_id(base: &str, root: &str) -> String {
    let d = digest::digest(&digest::SHA256, root.as_bytes());
    let hex: String = d.as_ref().iter().map(|b| format!("{b:02x}")).collect();
    format!("{base}-r-{}", &hex[..12])
}

/// 앞의 `/` 들 — Node `splitRoot`(POSIX).
fn split_root(p: &str) -> &str {
    let n = p.len() - p.trim_start_matches('/').len();
    &p[..n]
}

fn lossy(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Node 24 `fs.realpathSync`(JS 구현, POSIX)을 그대로 옮긴다: 절대화 → 앞에서부터 구간마다 `lstat` → 심링크면
/// `stat`(끊긴 링크·고리는 여기서 오류) → `readlink` → 이전 경로 기준으로 풀고 남은 구간을 붙여 처음부터 다시.
/// 마지막으로 푼 링크가 FIFO·소켓을 가리켰으면 이미 아는 구간을 만났을 때 멈춘다. 오류는 Node 문구다.
pub fn node_realpath_sync(path: &str) -> Result<String, String> {
    if path.contains('\0') {
        return Err(node_error::null_bytes(path));
    }
    let cwd = std::env::current_dir().map_err(|e| node_error::format(&e, "uv_cwd", None))?;
    let mut p = node_path::resolve(&lossy(&cwd), path);
    let mut seen_links: HashMap<(u64, u64), String> = HashMap::new();
    let mut known_hard: HashSet<String> = HashSet::new();
    let mut reached_pipe_or_socket = false;
    let mut current = split_root(&p).to_owned();
    let mut pos = current.len();
    while pos < p.len() {
        let previous = current.clone();
        let base = match p[pos..].find('/') {
            None => {
                let last = &p[pos..];
                current.push_str(last);
                pos = p.len();
                format!("{previous}{last}")
            }
            Some(i) => {
                let end = pos + i;
                current.push_str(&p[pos..=end]);
                let b = format!("{previous}{}", &p[pos..end]);
                pos = end + 1;
                b
            }
        };
        if known_hard.contains(&base) {
            if reached_pipe_or_socket {
                break;
            }
            continue;
        }
        let st = std::fs::symlink_metadata(&base)
            .map_err(|e| node_error::format(&e, "lstat", Some(&base)))?;
        if !st.file_type().is_symlink() {
            known_hard.insert(base);
            continue;
        }
        let id = (st.dev(), st.ino());
        let link_target = match seen_links.get(&id) {
            Some(t) => t.clone(),
            None => {
                let target = std::fs::metadata(&base)
                    .map_err(|e| node_error::format(&e, "stat", Some(&base)))?;
                let ft = target.file_type();
                reached_pipe_or_socket = ft.is_fifo() || ft.is_socket();
                let t = std::fs::read_link(&base)
                    .map_err(|e| node_error::format(&e, "readlink", Some(&base)))?;
                lossy(&t)
            }
        };
        let resolved_link = node_path::resolve(&previous, &link_target);
        seen_links.insert(id, link_target);
        p = node_path::resolve(&resolved_link, &p[pos..]);
        current = split_root(&p).to_owned();
        pos = current.len();
    }
    Ok(p)
}

/// UUID v4(소문자 16진) — Node `crypto.randomUUID()` 와 같은 꼴.
pub fn uuid_v4() -> Result<String, String> {
    let mut b = [0u8; 16];
    SystemRandom::new()
        .fill(&mut b)
        .map_err(|_| "난수를 만들지 못했습니다".to_owned())?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    ))
}

/// 이 PC 의 base id. 프로세스에서 한 번 정해 deviceId·hostId 에 함께 쓴다(TS 는 부를 때마다 파일을 읽는다 — D-49-7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceIdentity {
    base: String,
}

impl DeviceIdentity {
    /// `<지원 폴더>/device-id` 를 읽을 수 있으면 JS `trim` 한 내용을 **그대로** 쓴다(빈 문자열·UUID 가 아닌 값도 — TS 그대로).
    /// 못 읽으면 UUID v4 를 만들어 쓰고, 파일에 쓰다 실패하면 무시한다. 지원 폴더는 만들지 않는다(호스트 몫).
    pub fn load_or_create(support_dir: &Path) -> Result<DeviceIdentity, String> {
        let p = support_dir.join("device-id");
        if let Ok(bytes) = std::fs::read(&p) {
            // Node `readFileSync(p, 'utf8')` 처럼 깨진 UTF-8 은 U+FFFD 로 바꾼다.
            let text = String::from_utf8_lossy(&bytes);
            return Ok(DeviceIdentity {
                base: js_string::trim(&text).to_owned(),
            });
        }
        let base = uuid_v4()?;
        let _ = std::fs::write(&p, &base);
        Ok(DeviceIdentity { base })
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// 루트(`node_realpath_sync` 결과)의 deviceId.
    pub fn root_device_id(&self, root: &str) -> String {
        root_device_id(&self.base, root)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    #![allow(clippy::unwrap_used)]
    use super::{node_realpath_sync, root_device_id};

    struct Tmp(String);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(tag: &str) -> Tmp {
        let raw = std::env::temp_dir().join(format!("omk-devid-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&raw).unwrap();
        Tmp(std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned())
    }

    /// Node 24.22.2 실측(단계 0 ①): `/tmp`·`/var` 는 `/private/…` 로 풀리고, 그 해시가 아래 값이다.
    #[test]
    fn system_symlinks_match_node() {
        assert_eq!(node_realpath_sync("/tmp").unwrap(), "/private/tmp");
        assert_eq!(node_realpath_sync("/tmp/").unwrap(), "/private/tmp");
        assert_eq!(node_realpath_sync("/var").unwrap(), "/private/var");
        assert_eq!(root_device_id("b", "/private/tmp"), "b-r-11fe14a563f7");
        assert_eq!(root_device_id("b", "/private/var"), "b-r-6c43d0c2259a");
    }

    /// Node 실측: 대소문자가 다른 입력은 입력 글자 그대로 남는다(canonicalize 는 디스크 글자로 바꾼다).
    #[test]
    fn case_of_input_is_kept_like_node() {
        let t = tmp("case");
        std::fs::create_dir(format!("{}/CaseDir", t.0)).unwrap();
        let input = format!("{}/casedir/", t.0);
        let got = node_realpath_sync(&input).unwrap();
        assert_eq!(got, format!("{}/casedir", t.0));
        let disk = std::fs::canonicalize(&input).unwrap();
        assert_eq!(disk.to_string_lossy(), format!("{}/CaseDir", t.0));
        assert_ne!(
            root_device_id("b", &got),
            root_device_id("b", &disk.to_string_lossy())
        );
    }

    /// Node 실측: NFD 로 넣은 한글 이름은 NFD 그대로 남아, NFC 로 넣은 것과 해시가 다르다.
    #[test]
    fn unicode_normalization_of_input_is_kept_like_node() {
        let t = tmp("nfd");
        let nfc = "\u{D55C}\u{AE00}";
        let nfd = "\u{1112}\u{1161}\u{11AB}\u{1100}\u{1173}\u{11AF}";
        std::fs::create_dir(format!("{}/{nfc}", t.0)).unwrap();
        let a = node_realpath_sync(&format!("{}/{nfc}", t.0)).unwrap();
        let b = node_realpath_sync(&format!("{}/{nfd}", t.0)).unwrap();
        assert_eq!(a, format!("{}/{nfc}", t.0));
        assert_eq!(b, format!("{}/{nfd}", t.0));
        assert_ne!(root_device_id("b", &a), root_device_id("b", &b));
    }

    /// `/System/Volumes/Data/…` 로 넣으면 그 글자 그대로다(Node 실측).
    #[test]
    fn data_volume_prefix_is_kept() {
        let t = tmp("data");
        let input = format!("/System/Volumes/Data{}", t.0);
        assert_eq!(node_realpath_sync(&input).unwrap(), input);
    }

    #[test]
    fn nul_in_path_is_rejected_before_fs() {
        let e = node_realpath_sync("/work/a\0b").unwrap_err();
        // Node 24.22.2 의 realpathSync 문구 그대로(실측).
        assert_eq!(
            e,
            "The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received '/work/a\\x00b'"
        );
    }
}
