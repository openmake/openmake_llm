/** MCP 관측 → 구성요소 관측 포트 값(M1) — 선언 확장을 분류해 종류만, 주소·명령은 싣지 않는다 */
import { mcpServerInsightProvider, toServerInsight } from '../component-insights';

const summary = {
    serverId: 'srv-1',
    transport: 'streamable-http' as const,
    authMethod: 'oauth-dynamic' as const,
    protocolEra: 'modern' as const,
    protocolVersion: '2026-07-28',
    extensions: [
        { id: 'io.modelcontextprotocol/ui' },
        { id: 'io.modelcontextprotocol/tasks' },
        { id: 'io.modelcontextprotocol/ui', version: '2' },
        { id: 'com.example/unknown-thing' },
    ],
};

describe('mcp-runtime component insights', () => {
    it('toServerInsight — 선언 확장은 분류 종류(중복 없음)로만', () => {
        const v = toServerInsight(summary as never);
        expect(v).toMatchObject({ serverId: 'srv-1', transport: 'streamable-http', authMethod: 'oauth-dynamic', protocolEra: 'modern', protocolVersion: '2026-07-28' });
        expect(v.declaredExtensionKinds).toEqual(['unknown', 'tasks', 'apps']);
        expect(Object.keys(v).sort()).toEqual(['authMethod', 'declaredExtensionKinds', 'protocolEra', 'protocolVersion', 'serverId', 'transport']);
    });

    it('provider 는 저장소 요약을 포트 값 Map 으로', async () => {
        const source = { summariesByServerIds: jest.fn(async () => new Map([['srv-1', summary as never]])) };
        const out = await mcpServerInsightProvider(source)(['srv-1']);
        expect(source.summariesByServerIds).toHaveBeenCalledWith(['srv-1']);
        expect(out.get('srv-1')?.serverId).toBe('srv-1');
    });
});
