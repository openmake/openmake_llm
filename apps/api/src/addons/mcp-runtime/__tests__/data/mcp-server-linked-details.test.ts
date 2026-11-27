/**
 * MCP 구성요소 저장 연산 listLinkedDetails(M3 관리자 현황용) — 협상 관측 JOIN 과, 관측 표가 없는 DB 의 폴백.
 * 단위(가짜 db). 실제 Postgres 는 mcp-server-linked-details.db.test.ts.
 */
import { mcpServerComponentStore } from '../../data/mcp-server-component-store';
import type { StoreDb } from '../../../../runtime-ports/component-stores';

describe('listLinkedDetails — 단위', () => {
    it('빈 목록이면 쿼리하지 않는다', async () => {
        const query = jest.fn();
        expect(await mcpServerComponentStore({ query } as unknown as StoreDb).listLinkedDetails!([])).toEqual([]);
        expect(query).not.toHaveBeenCalled();
    });

    it('관측 표가 없으면(42P01) 협상 열 없이 다시 조회한다 — 연결 설정 값은 싣지 않는다', async () => {
        const query = jest.fn()
            .mockRejectedValueOnce(Object.assign(new Error('relation "mcp_negotiation_observations" does not exist'), { code: '42P01' }))
            .mockResolvedValueOnce({ rows: [{ id: 'm1', extension_id: 'e1', name: 's', status: 'active', enabled: true, transport_type: 'stdio', auth_method: null, protocol_era: null, protocol_version: null, sdk_generation: null, observed_at: null }] });
        const out = await mcpServerComponentStore({ query } as unknown as StoreDb).listLinkedDetails!(['e1']);
        expect(query).toHaveBeenCalledTimes(2);
        expect(query.mock.calls[1][0]).not.toContain('mcp_negotiation_observations');
        expect(out).toEqual([{ id: 'm1', extensionId: 'e1', name: 's', status: 'active', enabled: true, transport: 'stdio', negotiation: null }]);
        for (const sql of query.mock.calls.map((c) => String(c[0]))) {
            expect(sql).not.toMatch(/\b(command|env|url|args)\b/);
        }
    });

    it('다른 오류는 그대로 던진다', async () => {
        const query = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: '57P01' }));
        await expect(mcpServerComponentStore({ query } as unknown as StoreDb).listLinkedDetails!(['e1'])).rejects.toThrow('boom');
    });
});
