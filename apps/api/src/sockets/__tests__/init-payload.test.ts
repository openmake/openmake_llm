/**
 * WS init 페이로드 — 클러스터 노드 목록은 관리자 연결에만 포함한다(인증 보강, 2026-11-07 점검).
 * update 페이로드·cluster_event 수신 대상도 같은 규칙(인증 보강, 2026-11-08 점검).
 */
import { buildInitPayload, buildUpdatePayload, selectAdminConnections } from '../init-payload';

const cluster = {
    clusterName: 'cluster-a',
    getStats: () => ({ totalNodes: 1, onlineNodes: 1 }),
    getNodes: () => [{ id: 'n1', name: 'node-1' }],
};

describe('buildInitPayload', () => {
    it('관리자면 nodes 를 포함한다', () => {
        const data = buildInitPayload(cluster, 'admin');
        expect(data).toEqual({ name: 'cluster-a', stats: { totalNodes: 1, onlineNodes: 1 }, nodes: [{ id: 'n1', name: 'node-1' }] });
    });

    it.each([['user'], [undefined]])('역할 %p 이면 nodes 키가 없고 name·stats 는 있다', (role) => {
        const data = buildInitPayload(cluster, role);
        expect(data).not.toHaveProperty('nodes');
        expect(data).toEqual({ name: 'cluster-a', stats: { totalNodes: 1, onlineNodes: 1 } });
    });
});

describe('buildUpdatePayload', () => {
    it('관리자면 stats 와 nodes 를 포함한다', () => {
        expect(buildUpdatePayload(cluster, 'admin')).toEqual({
            stats: { totalNodes: 1, onlineNodes: 1 },
            nodes: [{ id: 'n1', name: 'node-1' }],
        });
    });

    it.each([['user'], ['guest'], [undefined]])('역할 %p 이면 nodes 키가 없고 stats 는 있다', (role) => {
        const data = buildUpdatePayload(cluster, role);
        expect(data).not.toHaveProperty('nodes');
        expect(data).toEqual({ stats: { totalNodes: 1, onlineNodes: 1 } });
    });
});

describe('selectAdminConnections', () => {
    it('관리자 역할 연결만 고른다', () => {
        const admin1 = { _authenticatedUserRole: 'admin' };
        const user = { _authenticatedUserRole: 'user' };
        const guest = { _authenticatedUserRole: 'guest' };
        const unknown = {};
        const admin2 = { _authenticatedUserRole: 'admin' };
        expect(selectAdminConnections([admin1, user, guest, unknown, admin2])).toEqual([admin1, admin2]);
    });

    it('관리자가 없으면 빈 배열', () => {
        expect(selectAdminConnections([{ _authenticatedUserRole: 'user' }])).toEqual([]);
    });
});
