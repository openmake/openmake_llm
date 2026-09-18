/**
 * kakao-map 통합 — 지도 렌더 체인(도구 포함 → 첫 턴 강제 → 블록 분리·첨부)이 확장점을 통해서도 그대로 도는지.
 */
import { kakaoMapChatIntegration as kakao } from '../chat-integration';
import { __setChatTurnIntegrationsForTest, extractIntegrationBlocks, type IntegrationBlocks } from '../../../services/chat-service/turn-integrations';
import { selectTurnTools } from '../../../services/chat-service/chat-tool-selection';
import { buildExternalToolPlan, detectOrchestrationIntents } from '../../../services/chat-service/external-tool-plan';
import { appendDeterministicBlocks } from '../../../services/chat-service/external-deterministic-append';

const tool = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' as const, properties: {} } } });
const KAKAO_TOOLS = [tool('kakao::search-places'), tool('kakao::find-route'), tool('web_search')];
const BLOCK = '```kakaomap\n{"places":[{"name":"광화문","lat":37.57,"lng":126.97}]}\n```';

afterEach(() => __setChatTurnIntegrationsForTest(null));

describe('의도와 도구 강제', () => {
    it('지도 의도면 장소 검색을, 길찾기 의도면 경로 도구를 강제 포함한다', () => {
        expect(kakao.forceIncludeTools!('강남역 근처 카페 지도')).toEqual([{ nameIncludes: 'search-places', reason: '지도 의도' }]);
        expect(kakao.forceIncludeTools!('서울역까지 가는 길 알려줘').map(t => t.nameIncludes)).toContain('find-route');
        expect(kakao.forceIncludeTools!('파이썬 정렬 알고리즘 설명해줘')).toEqual([]);
    });

    it('첫 턴 강제는 길찾기가 지도보다 우선한다', () => {
        const names = KAKAO_TOOLS.map(t => t.function.name);
        expect(kakao.forcedFirstTurnTool!('서울역까지 가는 길 지도', names)).toBe('kakao::find-route');
        expect(kakao.forcedFirstTurnTool!('강남역 근처 맛집', names)).toBe('kakao::search-places');
        expect(kakao.forcedFirstTurnTool!('강남역 근처 맛집', ['web_search'])).toBeUndefined();
    });

    it('파이프라인: cap 에서 빠진 카카오 도구를 되살리고 첫 턴 tool_choice 로 강제한다', () => {
        __setChatTurnIntegrationsForTest([kakao]);
        const allowed = selectTurnTools({ allTools: KAKAO_TOOLS, merged: [], userMcpAutoOn: [], message: '강남역 근처 카페 지도로 보여줘' });
        expect(allowed.map(t => t.function.name)).toContain('kakao::search-places');
        const plan = buildExternalToolPlan({ allowedTools: allowed, req: { message: '강남역 근처 카페 지도로 보여줘' } as never, toolCalling: true, orchestration: detectOrchestrationIntents('') });
        expect(plan.forcedFirstTurnToolName).toBe('kakao::search-places');
    });

    it('통합이 꺼져 있으면(0개) 같은 질의에서 카카오 도구를 포함·강제하지 않는다', () => {
        __setChatTurnIntegrationsForTest([]);
        const allowed = selectTurnTools({ allTools: KAKAO_TOOLS, merged: [], userMcpAutoOn: [], message: '강남역 근처 카페 지도로 보여줘' });
        expect(allowed.map(t => t.function.name)).not.toContain('kakao::search-places');
    });
});

describe('블록 분리와 결정적 첨부', () => {
    it('도구 결과에서 블록을 떼어 중복 없이 모으고, 모델에게는 블록·표시용 안내를 뺀 텍스트만 준다', () => {
        __setChatTurnIntegrationsForTest([kakao]);
        const state: IntegrationBlocks = {};
        const result = `[지도 표시용 블록 — 그대로 두세요]\n${BLOCK}\n\n1. 광화문 — 서울 종로구`;
        const first = extractIntegrationBlocks(result, state);
        extractIntegrationBlocks(result, state);
        expect(state['kakao-map']).toEqual([BLOCK]);
        expect(first).not.toContain('kakaomap');
        expect(first).not.toContain('지도 표시용');
        expect(first).toContain('광화문 — 서울 종로구');
    });

    it('길이 상한에 잘리기 전에 원문에서 블록을 보존한다', () => {
        expect(kakao.preserveFromRawResult!(`${'x'.repeat(9000)}\n${BLOCK}`)).toBe(`${BLOCK}\n\n`);
        expect(kakao.preserveFromRawResult!('블록 없는 결과')).toBeUndefined();
    });

    it('모델이 블록을 옮기지 않았으면 정확히 1회 첨부하고, 이미 있으면 다시 붙이지 않는다', () => {
        __setChatTurnIntegrationsForTest([kakao]);
        const streamed: string[] = [];
        const base = { onToken: (t: string) => { streamed.push(t); }, generatedMediaMarkdowns: [], discussionSourceBlocks: [], req: { message: 'x' }, ctx: {} };
        const appended = appendDeterministicBlocks({ ...base, finalContent: '광화문은 종로구에 있습니다.', integrationBlocks: { 'kakao-map': [BLOCK] } } as never);
        expect(appended.split(BLOCK).length - 1).toBe(1);
        expect(streamed.join('')).toContain(BLOCK);
        const already = appendDeterministicBlocks({ ...base, finalContent: `요약\n\n${BLOCK}`, integrationBlocks: { 'kakao-map': [BLOCK] } } as never);
        expect(already.split(BLOCK).length - 1).toBe(1);
    });
});
