/**
 * WS init 페이로드 — 클러스터 노드 목록은 관리자 연결에만 포함한다(인증 보강, 2026-11-07 점검).
 */
import { buildInitPayload } from '../init-payload';

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
