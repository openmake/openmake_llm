/**
 * egress 프록시 포트 — add-on 이 services/task-sandbox 를 직접 import 하지 않고 프록시를 보장하는 문(2026-11-08).
 */
const mockEnsure = jest.fn();
jest.mock('../../services/task-sandbox/egress-proxy', () => ({ ensureEgressProxy: (...a: unknown[]) => mockEnsure(...a) }));

import { ensureEgressProxy } from '../egress-proxy-port';

describe('egress-proxy-port', () => {
    it('ensureEgressProxy 를 함수로 내보내고 Base 구현에 위임한다', async () => {
        expect(typeof ensureEgressProxy).toBe('function');
        mockEnsure.mockResolvedValue('http://omk-egress-proxy:8888');
        await expect(ensureEgressProxy({} as never)).resolves.toBe('http://omk-egress-proxy:8888');
        expect(mockEnsure).toHaveBeenCalledTimes(1);
    });
});
