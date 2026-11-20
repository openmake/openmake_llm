//! 브리지 상태·폴더 DTO.

use serde::Deserialize;
#[cfg(test)]
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub struct BridgeStatus {
    pub enabled: bool,
    pub connected: bool,
    pub devices: Vec<BridgeDevice>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct BridgeDevice {
    pub device_id: String,
    pub host_id: String,
    pub label: String,
    pub folder_name: String,
    /// epoch ms.
    pub connected_at: i64,
}

/// 폴더 열거 — `path` 는 요청 경로의 에코(루트면 빈 문자열).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct FolderList {
    pub device_id: String,
    pub path: String,
    pub folders: Vec<Folder>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub struct Folder {
    pub rel: String,
    pub name: String,
}
