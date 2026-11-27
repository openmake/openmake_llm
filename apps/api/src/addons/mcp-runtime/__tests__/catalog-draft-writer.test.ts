/**
 * MCP 카탈로그 초안 작성기 + 포트 — 언제나 꺼진 초안, 관리자 생성과 같은 검증, 같은 id 는 덮어쓰지 않는다,
 * 작성기가 없으면(MCP 런타임 꺼짐) unavailable.
 */
jest.mock('../../../runtime-ports/db-access', () => ({ getPool: () => ({}) }));

import { createMcpCatalogDraft, registerMcpCatalogDraftWriter, resetMcpCatalogDraftWriterForTest } from '../../../runtime-ports/mcp-catalog-templates';
import { writeMcpCatalogDraft } from '../catalog-draft-writer';

function repo(existing: boolean, insertError?: Error) {
    return {
        getCatalogTemplateForAdmin: jest.fn().mockResolvedValue(existing ? { id: 'x' } : null),
        insertCatalogTemplate: jest.fn().mockImplementation(async (i: { id: string }) => {
            if (insertError) throw insertError;
            return { id: i.id };
        }),
    };
}

const remote = { id: 'mcp-reg-acme', displayName: 'Acme', transportType: 'streamable-http' as const, urlTemplate: 'https://mcp.acme.dev/mcp' };

describe('writeMcpCatalogDraft', () => {
    it('꺼진 상태로 만든다(is_enabled=false)', async () => {
        const r = repo(false);
        expect(await writeMcpCatalogDraft(remote, r as never)).toEqual({ status: 'created', id: 'mcp-reg-acme' });
        expect(r.insertCatalogTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: 'mcp-reg-acme', is_enabled: false, transport_type: 'streamable-http', url_template: 'https://mcp.acme.dev/mcp' }));
    });

    it('같은 id 가 있으면 덮어쓰지 않는다(경합 포함)', async () => {
        const r = repo(true);
        expect(await writeMcpCatalogDraft(remote, r as never)).toEqual({ status: 'exists', id: 'mcp-reg-acme' });
        expect(r.insertCatalogTemplate).not.toHaveBeenCalled();
        expect(await writeMcpCatalogDraft(remote, repo(false, new Error('duplicate key value')) as never)).toEqual({ status: 'exists', id: 'mcp-reg-acme' });
    });

    it('관리자 생성과 같은 검증 — id 형식·stdio 명령 필수', async () => {
        const r = repo(false);
        expect((await writeMcpCatalogDraft({ ...remote, id: 'Bad Id' }, r as never)).status).toBe('invalid');
        expect((await writeMcpCatalogDraft({ id: 'mcp-x', displayName: 'x', transportType: 'stdio' }, r as never)).status).toBe('invalid');
        expect(r.insertCatalogTemplate).not.toHaveBeenCalled();
    });
});

describe('mcp-catalog-templates 포트', () => {
    afterEach(() => resetMcpCatalogDraftWriterForTest());

    it('작성기가 없으면 unavailable, 등록하면 위임, 해제하면 다시 unavailable', async () => {
        expect(await createMcpCatalogDraft(remote)).toEqual({ status: 'unavailable' });
        const w = jest.fn().mockResolvedValue({ status: 'created', id: 'mcp-reg-acme' });
        const off = registerMcpCatalogDraftWriter(w);
        expect(await createMcpCatalogDraft(remote)).toEqual({ status: 'created', id: 'mcp-reg-acme' });
        off();
        expect(await createMcpCatalogDraft(remote)).toEqual({ status: 'unavailable' });
    });
});
