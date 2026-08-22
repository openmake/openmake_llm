/**
 * agent-resolver 경량화 3단계 (캐시 → 키워드 선분류 → 短문장 직행 → LLM → 폴백) 검증.
 */

// env 파생 상수 고정 — 이 테스트는 임계 0.7 을 전제로 "중간 신뢰(0.5)면 LLM 발동"을
// 검증한다. 운영 .env 에서 OMK_AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE 를 0.35 로 낮추면
// 0.5 ≥ 0.35 라 키워드가 채택돼 테스트가 깨진다(2026-08-02 실제 발생).
// 임계값 자체의 튜닝과 경로 분기 로직 검증을 분리하기 위해 여기서 고정한다.
jest.mock('../../../config/routing-config', () => {
    const actual = jest.requireActual('../../../config/routing-config');
    return { ...actual, AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE: 0.7 };
});

import { resolveAgent } from '../agent-resolver';
import { routeWithLLM } from '../../../agents/llm-router';
import { routeToAgent } from '../../../agents';
import { getCacheSystem } from '../../../cache';

jest.mock('../../../agents/llm-router', () => ({
    routeWithLLM: jest.fn(),
    isValidAgentId: jest.fn((id: string) =>
        ['general', 'software-engineer', 'data-analyst', 'compliance-officer'].includes(id)),
}));

jest.mock('../../../agents', () => ({
    routeToAgent: jest.fn(),
    getAgentSystemMessage: jest.fn().mockResolvedValue({ prompt: 'SYS', skillNames: [] }),
    getAgentById: jest.fn((id: string) => ({ id, category: 'technology', name: id, emoji: '🤖' })),
    detectPhase: jest.fn(() => 'planning'),
    AGENTS: new Proxy({}, { get: (_t, id) => ({ id, name: String(id), emoji: '🤖' }) }),
}));

const mockRouteWithLLM = routeWithLLM as jest.Mock;
const mockRouteToAgent = routeToAgent as jest.Mock;

function keywordResult(agent: string, confidence: number) {
    return {
        primaryAgent: agent, category: 'technology', phase: 'planning',
        reason: '키워드 매칭', confidence, matchedKeywords: [],
    };
}

describe('agent-resolver 경량화 라우팅', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getCacheSystem().clear?.();
    });

    it('키워드 고신뢰(≥0.7): LLM 라우팅 미호출, 키워드 결과 채택', async () => {
        mockRouteToAgent.mockResolvedValue(keywordResult('software-engineer', 0.8));
        const r = await resolveAgent('파이썬 데코레이터 패턴을 리팩터링하는 모범 사례', 'u1', 'ko');
        expect(r.agentSelection.primaryAgent).toBe('software-engineer');
        expect(r.agentSelection.reason).toMatch(/^\[Keyword\]/);
        expect(mockRouteWithLLM).not.toHaveBeenCalled();
    });

    it('短문장 + 무키워드: general 직행, LLM 미호출', async () => {
        mockRouteToAgent.mockResolvedValue(keywordResult('general', 0.3));
        const r = await resolveAgent('1+1은? 한 단어로만 답해.', 'u1', 'ko');
        expect(r.agentSelection.primaryAgent).toBe('general');
        expect(r.agentSelection.reason).toMatch(/^\[Short-query\]/);
        expect(mockRouteWithLLM).not.toHaveBeenCalled();
    });

    it('중간 신뢰 + 긴 문장: LLM 라우팅 호출, 성공 결과 채택 + 캐시 저장', async () => {
        mockRouteToAgent.mockResolvedValue(keywordResult('general', 0.4));
        mockRouteWithLLM.mockResolvedValue({
            agentId: 'data-analyst', confidence: 0.9, reasoning: '데이터 분석 질문', alternativeAgents: [],
        });
        const longMsg = '우리 회사 분기별 매출 데이터를 기반으로 이상치를 탐지하고 다음 분기 추세를 예측하는 방법을 알려줘.';
        const r = await resolveAgent(longMsg, 'u1', 'ko');
        expect(r.agentSelection.primaryAgent).toBe('data-analyst');
        expect(r.agentSelection.reason).toMatch(/^\[LLM\]/);
        expect(mockRouteWithLLM).toHaveBeenCalledTimes(1);

        // 동일 질문 재요청 → 캐시 히트, LLM/키워드 재호출 없음
        mockRouteWithLLM.mockClear();
        mockRouteToAgent.mockClear();
        const r2 = await resolveAgent(longMsg, 'u1', 'ko');
        expect(r2.agentSelection.primaryAgent).toBe('data-analyst');
        expect(r2.agentSelection.reason).toMatch(/^\[Cache\]/);
        expect(mockRouteWithLLM).not.toHaveBeenCalled();
        expect(mockRouteToAgent).not.toHaveBeenCalled();
    });

    it('LLM 라우팅 실패: 키워드 결과 폴백 (키워드 라우터 재호출 없이 1회)', async () => {
        mockRouteToAgent.mockResolvedValue(keywordResult('general', 0.4));
        mockRouteWithLLM.mockResolvedValue(null);
        const r = await resolveAgent('이 주제에 대해 어떻게 생각하는지 아주 길게 자유롭게 설명해줘. 특별한 도메인 없음.', 'u1', 'ko');
        expect(r.agentSelection.primaryAgent).toBe('general');
        expect(mockRouteToAgent).toHaveBeenCalledTimes(1);
    });

    it('캐시의 무효 agentId 는 무시하고 정상 경로 진행', async () => {
        const cache = getCacheSystem();
        const msg = '알 수 없는 에이전트 캐시 항목 시나리오를 검증하는 충분히 긴 질문입니다.';
        cache.setRoutingResult(msg, 'deleted-agent', 0.9);
        mockRouteToAgent.mockResolvedValue(keywordResult('software-engineer', 0.9));
        const r = await resolveAgent(msg, 'u1', 'ko');
        expect(r.agentSelection.primaryAgent).toBe('software-engineer');
    });

    describe('URL 단독 질의 스킵 (2026-08-22)', () => {
        it('본문 없는 일반 URL: general 직행, LLM 미호출', async () => {
            mockRouteToAgent.mockResolvedValue(keywordResult('general', 0.3));
            const r = await resolveAgent('https://brunch.co.kr/@aideveloper/158', 'u1', 'ko');
            expect(r.agentSelection.primaryAgent).toBe('general');
            expect(r.agentSelection.reason).toMatch(/^\[URL-only\]/);
            expect(mockRouteWithLLM).not.toHaveBeenCalled();
        });

        it('도메인 힌트 매칭: 결정적 승격, LLM 미호출', async () => {
            mockRouteToAgent.mockResolvedValue(keywordResult('general', 0.3));
            const r = await resolveAgent('https://www.law.go.kr/lsInfoP.do?lsiSeq=1', 'u1', 'ko');
            expect(r.agentSelection.primaryAgent).toBe('compliance-officer');
            expect(r.agentSelection.reason).toMatch(/도메인 힌트/);
            expect(mockRouteWithLLM).not.toHaveBeenCalled();
        });

        it('서브도메인도 힌트 접미사 매칭', async () => {
            mockRouteToAgent.mockResolvedValue(keywordResult('general', 0.3));
            const r = await resolveAgent('https://open.law.go.kr/x', 'u1', 'ko');
            expect(r.agentSelection.primaryAgent).toBe('compliance-officer');
        });

        it('URL + 설명이 붙으면 스킵 대상이 아니다 (LLM 경로 유지)', async () => {
            mockRouteToAgent.mockResolvedValue(keywordResult('general', 0.3));
            mockRouteWithLLM.mockResolvedValue({ agentId: 'data-analyst', confidence: 0.9, reasoning: 'r' });
            const r = await resolveAgent('https://brunch.co.kr/@x/1 이 글 요약해줘', 'u1', 'ko');
            expect(mockRouteWithLLM).toHaveBeenCalled();
            expect(r.agentSelection.primaryAgent).toBe('data-analyst');
        });
    });
});
