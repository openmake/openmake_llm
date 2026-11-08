/**
 * 사용자 MCP 풀 clientFactory 설정 변환 — 관리자 bridge 허용 값(sandbox_bridge_allowed)이 spawn 까지 전달되는지 고정한다.
 */
import { toUserPoolClientConfig } from '../runtime-boot';
import type { ServerSpawnConfig } from '../lifecycle-supervisor';

const base: ServerSpawnConfig = {
    id: 'srv-1',
    user_id: 'user-1',
    name: 'srv',
    transport_type: 'stdio',
    command: 'node',
    sandbox_network: 'full',
};

describe('toUserPoolClientConfig', () => {
    it('sandbox_bridge_allowed true 는 true 로 전달한다', () => {
        expect(toUserPoolClientConfig({ ...base, sandbox_bridge_allowed: true }).sandbox_bridge_allowed).toBe(true);
    });

    it('sandbox_bridge_allowed false 는 false 로 전달한다', () => {
        expect(toUserPoolClientConfig({ ...base, sandbox_bridge_allowed: false }).sandbox_bridge_allowed).toBe(false);
    });

    it('sandbox_bridge_allowed 가 없으면 false 로 둔다', () => {
        expect(toUserPoolClientConfig(base).sandbox_bridge_allowed).toBe(false);
    });
});
