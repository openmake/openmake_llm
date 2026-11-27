/** 구성요소 관측 포트(M1) — 등록 없음·실패는 빈 결과, 등록 해제 */
import {
    getMcpServerInsights,
    registerComponentInsightProvider,
    resetComponentInsightProvidersForTest,
    type McpServerInsight,
} from '../component-insights';

const insight: McpServerInsight = { serverId: 'a', transport: 'stdio', authMethod: 'none', protocolEra: 'modern', protocolVersion: 'v', declaredExtensionKinds: [] };

afterEach(() => resetComponentInsightProvidersForTest());

describe('component-insights port', () => {
    it('등록이 없으면 빈 Map(관측을 가진 add-on 이 꺼짐)', async () => {
        expect((await getMcpServerInsights(['a'])).size).toBe(0);
    });

    it('등록한 provider 에 중복 없는 id 로 묻는다', async () => {
        const provider = jest.fn(async () => new Map([['a', insight]]));
        registerComponentInsightProvider('mcpServers', provider);
        expect((await getMcpServerInsights(['a', 'a', 'b'])).get('a')).toEqual(insight);
        expect(provider).toHaveBeenCalledWith(['a', 'b']);
    });

    it('빈 id 목록은 provider 를 부르지 않고, 실패는 빈 Map', async () => {
        const provider = jest.fn(async () => { throw new Error('db'); });
        registerComponentInsightProvider('mcpServers', provider);
        expect((await getMcpServerInsights([])).size).toBe(0);
        expect(provider).not.toHaveBeenCalled();
        expect((await getMcpServerInsights(['a'])).size).toBe(0);
    });

    it('null 로 등록하면 해제', async () => {
        registerComponentInsightProvider('mcpServers', async () => new Map([['a', insight]]));
        registerComponentInsightProvider('mcpServers', null);
        expect((await getMcpServerInsights(['a'])).size).toBe(0);
    });
});
