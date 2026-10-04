/**
 * 로컬 브리지 기기 목록을 PC 단위로 묶는다 (Companion P1) — Companion 은 폴더마다 연결을 따로 만들고
 * 서버가 같은 PC 임을 hostId 로 알려 준다. hostId 가 없으면(구버전 서버) 연결마다 한 묶음이다.
 */
export interface BridgeDeviceInfo {
  deviceId: string;
  hostId?: string;
  label: string;
  folderName: string;
  connectedAt: number;
}

export interface BridgeHostGroup<T extends BridgeDeviceInfo = BridgeDeviceInfo> {
  hostId: string;
  /** 표시 이름 — 라벨("PC이름 · 폴더")의 앞부분, 없으면 라벨 전체 */
  name: string;
  devices: T[];
}

const LABEL_SEPARATOR = " · ";

export function groupBridgeDevicesByHost<T extends BridgeDeviceInfo>(devices: readonly T[]): BridgeHostGroup<T>[] {
  const groups = new Map<string, BridgeHostGroup<T>>();
  for (const d of devices) {
    const hostId = d.hostId || d.deviceId;
    let g = groups.get(hostId);
    if (!g) {
      const cut = d.label.indexOf(LABEL_SEPARATOR);
      g = { hostId, name: cut > 0 ? d.label.slice(0, cut) : d.label, devices: [] };
      groups.set(hostId, g);
    }
    g.devices.push(d);
  }
  return [...groups.values()];
}
