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

/** WS 'update' 메시지의 data — init 과 같은 규칙으로 nodes 는 관리자에게만(인증 보강, 2026-11-08 점검). */
export function buildUpdatePayload(cluster: Omit<InitPayloadCluster, 'clusterName'>, userRole?: string): Record<string, unknown> {
    const data: Record<string, unknown> = { stats: cluster.getStats() };
    if (isAdminRole(userRole)) data.nodes = cluster.getNodes();
    return data;
}

/** 관리자 역할 연결만 고른다 — cluster_event 수신 대상(인증 보강, 2026-11-08 점검). */
export function selectAdminConnections<T extends { _authenticatedUserRole?: string }>(connections: Iterable<T>): T[] {
    const admins: T[] = [];
    for (const conn of connections) {
        if (isAdminRole(conn._authenticatedUserRole)) admins.push(conn);
    }
    return admins;
}
