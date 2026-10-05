/**
 * 관리자 연결 기기 API 계약 (2026-10-05).
 * GET /api/admin/local-bridge/devices · POST /api/admin/local-bridge/devices/:deviceId/disconnect (body { userId }).
 * 응답은 공통 `{ success, data }` 봉투 안의 data 모양이다. 폴더 전체 경로·키 값은 싣지 않는다.
 */

export interface AdminBridgeDevice {
  deviceId: string;
  /** 같은 PC 의 폴더별 연결이 같은 값을 갖는다(구버전 기기는 deviceId). */
  hostId: string;
  label: string;
  /** 연결 폴더의 이름(마지막 경로 조각)만. */
  folderName: string;
  /** 연결 시각(epoch ms). */
  connectedAt: number;
  /** 기기가 지원하는 요청 종류(정렬됨). */
  capabilities: string[];
}

export interface AdminBridgeUserDevices {
  userId: string;
  email: string | null;
  devices: AdminBridgeDevice[];
}

export interface AdminBridgeDevicesResponse {
  /** 로컬 실행 기능(LOCAL_EXECUTOR_ENABLED) 켜짐 여부 — 꺼져 있으면 users 는 비어 있다. */
  enabled: boolean;
  users: AdminBridgeUserDevices[];
}

export interface AdminBridgeDisconnectResponse {
  disconnected: true;
}
