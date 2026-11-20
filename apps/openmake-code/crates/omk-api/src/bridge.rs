//! 브리지 상태·폴더 조회(REST — X-API-Key). 브리지 WS 연결은 omk-bridge-conn 몫이다.

use crate::client::ApiClient;
use crate::endpoints::{Operation, Prepared};
use crate::error::ApiError;
use crate::types::{BridgeStatus, FolderList};

impl ApiClient {
    pub async fn bridge_status(&self) -> Result<BridgeStatus, ApiError> {
        self.call(Prepared::new(Operation::BridgeStatus)).await
    }

    /// 연결 루트 하위 폴더 열거 — path 는 이전 응답의 rel 만(서버가 검증한다). 둘 다 없으면 최근 디바이스의 루트.
    pub async fn list_folders(
        &self,
        device_id: Option<&str>,
        path: Option<&str>,
    ) -> Result<FolderList, ApiError> {
        self.call(req_list_folders(device_id, path)).await
    }
}

pub(crate) fn req_list_folders(device_id: Option<&str>, path: Option<&str>) -> Prepared {
    Prepared::new(Operation::ListFolders)
        .query("deviceId", device_id)
        .query("path", path)
}
