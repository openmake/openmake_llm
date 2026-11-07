/**
 * WS 'init' 메시지의 data 조립 — 클러스터 노드 목록은 관리자 연결에만 포함한다
 * (REST /api/cluster 와 같은 범위, 인증 보강 2026-11-07 점검). 비관리자는 nodes 키를 생략한다.
 */
import { isAdminRole } from '../data/user-manager';

interface InitPayloadCluster {
    readonly clusterName: string;
    getStats(): unknown;
    getNodes(): unknown;
}

export function buildInitPayload(cluster: InitPayloadCluster, userRole?: string): Record<string, unknown> {
    const data: Record<string, unknown> = { name: cluster.clusterName, stats: cluster.getStats() };
    if (isAdminRole(userRole)) data.nodes = cluster.getNodes();
    return data;
}
