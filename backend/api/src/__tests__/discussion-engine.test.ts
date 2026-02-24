/**
 * discussion-engine.test.ts
 * createDiscussionEngine 팩토리 함수 단위 테스트
 * 외부 의존성(agents/index, discussion-context, input-sanitizer)은 모두 mock으로 격리
 */

import type { Agent } from '../agents/index';

// ============================================================
// Mock 선언 (import 전 최상단)
// ============================================================

const mockGetRelatedAgentsForDiscussion = jest.fn();
const mockGetAgentById = jest.fn();
const mockRouteToAgent = jest.fn();

jest.mock('../agents/index', () => ({
    getRelatedAgentsForDiscussion: (...args: unknown[]) => mockGetRelatedAgentsForDiscussion(...args),
    getAgentById: (...args: unknown[]) => mockGetAgentById(...args),
    routeToAgent: (...args: unknown[]) => mockRouteToAgent(...args),
    AGENTS: {}
}));

const mockBuildFullContext = jest.fn().mockReturnValue('');
const mockGetImageContexts = jest.fn().mockReturnValue([]);

jest.mock('../agents/discussion-context', () => ({
    createContextBuilder: jest.fn().mockReturnValue({
        buildFullContext: () => mockBuildFullContext(),
        getImageContexts: () => mockGetImageContexts()
    })
}));

jest.mock('../utils/input-sanitizer', () => ({
    sanitizePromptInput: jest.fn((v: string) => v),
    validatePromptInput: jest.fn().mockReturnValue({ valid: true })
}));

// ============================================================
// Import after mocks
// ============================================================

import { createDiscussionEngine } from '../agents/discussion-engine';
import type { DiscussionConfig, DiscussionProgress } from '../agents/discussion-engine';

// ============================================================
// 공통 픽스처
// ============================================================

const mockAgents: Agent[] = [
    {
        id: 'agent-1',
        name: '에이전트A',
        emoji: '🤖',
        description: '전문가 A 설명',
        systemPrompt: '',
        isSpecialized: false,
        maxContextLength: 4096,
        temperature: 0.7,
        capabilities: [],
        tags: []
    } as unknown as Agent,
    {
        id: 'agent-2',
        name: '에이전트B',
        emoji: '💻',
        description: '전문가 B 설명',
        systemPrompt: '',
        isSpecialized: false,
        maxContextLength: 4096,
        temperature: 0.7,
        capabilities: [],
        tags: []
    } as unknown as Agent
];

/** generateResponse mock: 즉시 고정 문자열 반환 */
function makeGenerateResponse(response = '테스트 응답입니다.') {
    return jest.fn().mockResolvedValue(response);
}

/** generateResponse mock: 항상 throw */
function makeFailingGenerateResponse() {
    return jest.fn().mockRejectedValue(new Error('LLM 연결 실패'));
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGetRelatedAgentsForDiscussion.mockResolvedValue([...mockAgents]);
    mockGetAgentById.mockReturnValue(null);
    mockBuildFullContext.mockReturnValue('');
});

// ============================================================
// describe: selectExpertAgents()
// ============================================================

describe('selectExpertAgents()', () => {
    test('2명 이상 에이전트가 정상 반환됨', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse());
        const experts = await engine.selectExpertAgents('AI 기술 트렌드');

        expect(experts).toHaveLength(2);
        expect(experts[0].id).toBe('agent-1');
        expect(experts[1].id).toBe('agent-2');
    });

    test('getRelatedAgentsForDiscussion에 주제 전달됨', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse());
        await engine.selectExpertAgents('블록체인 미래');

        expect(mockGetRelatedAgentsForDiscussion).toHaveBeenCalledWith(
            '블록체인 미래',
            expect.any(Number),
            expect.any(String)
        );
    });

    test('에이전트 0명 반환 시 fallback 에이전트 추가 시도', async () => {
        // 0명 반환 시 getAgentById로 fallback 채우기 시도
        mockGetRelatedAgentsForDiscussion.mockResolvedValue([]);
        const fallbackAgent: Partial<Agent> = {
            id: 'general',
            name: '일반 전문가',
            emoji: '🌐',
            description: '일반 전문가'
        };
        // fallback 첫 시도(business-strategist) → null, 두 번째(data-analyst) → null,
        // 세 번째(project-manager) → null, 네 번째(general) → agent
        mockGetAgentById
            .mockReturnValueOnce(null)
            .mockReturnValueOnce(null)
            .mockReturnValueOnce(null)
            .mockReturnValueOnce(fallbackAgent as Agent);

        const engine = createDiscussionEngine(makeGenerateResponse());
        const experts = await engine.selectExpertAgents('테스트 주제');

        expect(mockGetAgentById).toHaveBeenCalled();
        // 최소 1명은 fallback으로 추가됨
        expect(experts.length).toBeGreaterThanOrEqual(1);
    });

    test('에이전트 1명 반환 시 2명 되도록 fallback 추가됨', async () => {
        mockGetRelatedAgentsForDiscussion.mockResolvedValue([mockAgents[0]]);
        const fallbackAgent: Partial<Agent> = {
            id: 'data-analyst',
            name: '데이터 분석가',
            emoji: '📊',
            description: '데이터 분석 전문가'
        };
        mockGetAgentById.mockReturnValueOnce(fallbackAgent as Agent);

        const engine = createDiscussionEngine(makeGenerateResponse());
        const experts = await engine.selectExpertAgents('테스트 주제');

        expect(experts.length).toBeGreaterThanOrEqual(2);
    });

    test('maxAgents=0 → agentLimit=20으로 설정됨', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse(), { maxAgents: 0 });
        await engine.selectExpertAgents('주제');

        expect(mockGetRelatedAgentsForDiscussion).toHaveBeenCalledWith(
            '주제',
            20,
            expect.any(String)
        );
    });

    test('컨텍스트가 있으면 buildFullContext 결과가 전달됨', async () => {
        mockBuildFullContext.mockReturnValue('문서 컨텍스트 내용');

        const engine = createDiscussionEngine(makeGenerateResponse(), {
            documentContext: '문서 컨텍스트 내용'
        });
        await engine.selectExpertAgents('주제');

        expect(mockGetRelatedAgentsForDiscussion).toHaveBeenCalledWith(
            '주제',
            expect.any(Number),
            '문서 컨텍스트 내용'
        );
    });
});

// ============================================================
// describe: startDiscussion() - 기본 플로우
// ============================================================

describe('startDiscussion() - 기본 플로우', () => {
    test('정상 플로우: opinions 수집 → crossReview → finalAnswer 반환', async () => {
        const generateResponse = makeGenerateResponse('전문가 의견');
        const engine = createDiscussionEngine(generateResponse, { maxRounds: 1 });

        const result = await engine.startDiscussion('AI의 미래');

        expect(result.finalAnswer).toBeDefined();
        expect(result.participants).toHaveLength(2);
        expect(result.opinions.length).toBeGreaterThan(0);
        expect(result.factChecked).toBe(false);
        expect(result.totalTime).toBeGreaterThanOrEqual(0);
    });

    test('opinions 수집됨: agentId/agentName/agentEmoji/confidence/timestamp 필드 포함', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse('의견 텍스트'), { maxRounds: 1 });
        const result = await engine.startDiscussion('주제');

        const opinion = result.opinions[0];
        expect(opinion.agentId).toBe('agent-1');
        expect(opinion.agentName).toBe('에이전트A');
        expect(opinion.agentEmoji).toBe('🤖');
        expect(opinion.confidence).toBe(0.8);
        expect(opinion.timestamp).toBeInstanceOf(Date);
    });

    test('discussionSummary에 에이전트 수와 라운드 수 포함됨', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse(), { maxRounds: 2 });
        const result = await engine.startDiscussion('주제');

        expect(result.discussionSummary).toContain('2');
    });

    test('2라운드: round>0 일 때 이전 opinions이 generateAgentOpinion에 전달됨', async () => {
        const generateResponse = makeGenerateResponse('의견');
        const engine = createDiscussionEngine(generateResponse, { maxRounds: 2 });

        const result = await engine.startDiscussion('주제');

        // 2라운드 × 2명 = 4개 opinion
        expect(result.opinions).toHaveLength(4);
        // round=1 시 generateResponse에 이전 의견들이 contextMessage에 포함됨
        // generateResponse 호출 수: 2(라운드1) + 2(라운드2) + 1(crossReview) + 1(finalAnswer) = 6
        expect(generateResponse).toHaveBeenCalledTimes(6);
    });
});

// ============================================================
// describe: startDiscussion() - 조기 종료 (opinions 0개)
// ============================================================

describe('startDiscussion() - opinions 0개 시 조기 종료', () => {
    test('모든 generateResponse 실패 시 빈 opinions + 실패 메시지 반환', async () => {
        const engine = createDiscussionEngine(makeFailingGenerateResponse(), { maxRounds: 1 });
        const result = await engine.startDiscussion('주제');

        expect(result.opinions).toHaveLength(0);
        expect(result.finalAnswer).toContain('AI 모델 서버');
        expect(result.factChecked).toBe(false);
        expect(result.participants).toHaveLength(2);
    });

    test('조기 종료 시 complete progress 콜백 호출됨', async () => {
        const progressEvents: DiscussionProgress[] = [];
        const engine = createDiscussionEngine(
            makeFailingGenerateResponse(),
            { maxRounds: 1 },
            (p) => progressEvents.push(p)
        );

        await engine.startDiscussion('주제');

        const completeEvent = progressEvents.find(e => e.phase === 'complete');
        expect(completeEvent).toBeDefined();
        expect(completeEvent?.progress).toBe(100);
    });
});

// ============================================================
// describe: startDiscussion() - enableCrossReview
// ============================================================

describe('startDiscussion() - enableCrossReview 설정', () => {
    test('enableCrossReview=true (기본) → crossReview 단계 실행됨', async () => {
        const generateResponse = makeGenerateResponse('응답');
        const engine = createDiscussionEngine(generateResponse, {
            maxRounds: 1,
            enableCrossReview: true
        });

        await engine.startDiscussion('주제');

        // crossReview + finalAnswer 포함되어 generateResponse 추가 호출됨
        // 1라운드 × 2명 = 2 + crossReview=1 + finalAnswer=1 = 4
        expect(generateResponse).toHaveBeenCalledTimes(4);
    });

    test('enableCrossReview=false → crossReview 단계 스킵됨', async () => {
        const generateResponse = makeGenerateResponse('응답');
        const engine = createDiscussionEngine(generateResponse, {
            maxRounds: 1,
            enableCrossReview: false
        });

        await engine.startDiscussion('주제');

        // crossReview 없음: 1라운드 × 2명 = 2 + finalAnswer=1 = 3
        expect(generateResponse).toHaveBeenCalledTimes(3);
    });

    test('enableCrossReview=true + opinions 1개 → crossReview 스킵됨 (opinions > 1 조건)', async () => {
        // 에이전트 1명만 반환
        mockGetRelatedAgentsForDiscussion.mockResolvedValue([mockAgents[0]]);
        mockGetAgentById.mockReturnValue(null); // fallback 없음 → 1명으로 진행

        const generateResponse = makeGenerateResponse('응답');
        const engine = createDiscussionEngine(generateResponse, {
            maxRounds: 1,
            enableCrossReview: true
        });

        await engine.startDiscussion('주제');

        // 에이전트 1명 × 1라운드 = 1 + finalAnswer=1 = 2 (crossReview 없음)
        expect(generateResponse).toHaveBeenCalledTimes(2);
    });
});

// ============================================================
// describe: startDiscussion() - enableFactCheck
// ============================================================

describe('startDiscussion() - enableFactCheck 설정', () => {
    test('enableFactCheck=true + webSearchFn 제공 → factChecked=true', async () => {
        const webSearchFn = jest.fn().mockResolvedValue([{ title: '검색 결과', url: 'https://example.com' }]);

        const engine = createDiscussionEngine(makeGenerateResponse(), {
            maxRounds: 1,
            enableFactCheck: true
        });

        const result = await engine.startDiscussion('주제', webSearchFn);

        expect(webSearchFn).toHaveBeenCalledWith('주제');
        expect(result.factChecked).toBe(true);
    });

    test('enableFactCheck=true + webSearchFn 없음 → factChecked=false', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse(), {
            maxRounds: 1,
            enableFactCheck: true
        });

        const result = await engine.startDiscussion('주제');

        expect(result.factChecked).toBe(false);
    });

    test('enableFactCheck=false (기본) → webSearchFn 있어도 호출 안 됨', async () => {
        const webSearchFn = jest.fn().mockResolvedValue([]);

        const engine = createDiscussionEngine(makeGenerateResponse(), {
            maxRounds: 1,
            enableFactCheck: false
        });

        await engine.startDiscussion('주제', webSearchFn);

        expect(webSearchFn).not.toHaveBeenCalled();
    });

    test('webSearchFn 실패 시 factChecked=false + 에러 없이 계속 진행', async () => {
        const webSearchFn = jest.fn().mockRejectedValue(new Error('검색 실패'));

        const engine = createDiscussionEngine(makeGenerateResponse(), {
            maxRounds: 1,
            enableFactCheck: true
        });

        const result = await engine.startDiscussion('주제', webSearchFn);

        expect(result.factChecked).toBe(false);
        expect(result.finalAnswer).toBeDefined();
    });
});

// ============================================================
// describe: startDiscussion() - onProgress 콜백
// ============================================================

describe('startDiscussion() - onProgress 콜백', () => {
    test('selecting → discussing → reviewing → synthesizing → complete 순서로 호출됨', async () => {
        const progressEvents: DiscussionProgress[] = [];
        const engine = createDiscussionEngine(
            makeGenerateResponse(),
            { maxRounds: 1, enableCrossReview: true },
            (p) => progressEvents.push(p)
        );

        await engine.startDiscussion('주제');

        const phases = progressEvents.map(e => e.phase);
        expect(phases[0]).toBe('selecting');
        expect(phases).toContain('discussing');
        expect(phases).toContain('reviewing');
        expect(phases).toContain('synthesizing');
        expect(phases[phases.length - 1]).toBe('complete');
    });

    test('complete 이벤트의 progress=100', async () => {
        const progressEvents: DiscussionProgress[] = [];
        const engine = createDiscussionEngine(
            makeGenerateResponse(),
            { maxRounds: 1 },
            (p) => progressEvents.push(p)
        );

        await engine.startDiscussion('주제');

        const completeEvent = progressEvents.find(e => e.phase === 'complete');
        expect(completeEvent?.progress).toBe(100);
    });

    test('discussing 이벤트에 currentAgent와 agentEmoji 포함됨', async () => {
        const progressEvents: DiscussionProgress[] = [];
        const engine = createDiscussionEngine(
            makeGenerateResponse(),
            { maxRounds: 1 },
            (p) => progressEvents.push(p)
        );

        await engine.startDiscussion('주제');

        const discussingEvent = progressEvents.find(e => e.phase === 'discussing');
        expect(discussingEvent?.currentAgent).toBe('에이전트A');
        expect(discussingEvent?.agentEmoji).toBe('🤖');
    });

    test('discussing 이벤트에 roundNumber, totalRounds 포함됨', async () => {
        const progressEvents: DiscussionProgress[] = [];
        const engine = createDiscussionEngine(
            makeGenerateResponse(),
            { maxRounds: 2 },
            (p) => progressEvents.push(p)
        );

        await engine.startDiscussion('주제');

        const discussingEvent = progressEvents.find(e => e.phase === 'discussing');
        expect(discussingEvent?.roundNumber).toBe(1);
        expect(discussingEvent?.totalRounds).toBe(2);
    });

    test('onProgress 미제공 시 에러 없이 실행됨', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse(), { maxRounds: 1 });
        await expect(engine.startDiscussion('주제')).resolves.toBeDefined();
    });
});

// ============================================================
// describe: DiscussionResult 구조 검증
// ============================================================

describe('DiscussionResult 구조', () => {
    test('모든 필수 필드가 포함된 결과 반환됨', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse('최종 답변'), { maxRounds: 1 });
        const result = await engine.startDiscussion('주제');

        expect(result).toMatchObject({
            discussionSummary: expect.any(String),
            finalAnswer: expect.any(String),
            participants: expect.arrayContaining([expect.any(String)]),
            opinions: expect.any(Array),
            totalTime: expect.any(Number),
        });
    });

    test('participants는 에이전트 이름 배열', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse(), { maxRounds: 1 });
        const result = await engine.startDiscussion('주제');

        expect(result.participants).toContain('에이전트A');
        expect(result.participants).toContain('에이전트B');
    });

    test('totalTime은 0 이상의 숫자', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse(), { maxRounds: 1 });
        const result = await engine.startDiscussion('주제');

        expect(result.totalTime).toBeGreaterThanOrEqual(0);
    });
});

// ============================================================
// describe: createDiscussionEngine config 기본값
// ============================================================

describe('createDiscussionEngine config 기본값', () => {
    test('config 미제공 시 기본값으로 동작', async () => {
        const engine = createDiscussionEngine(makeGenerateResponse());
        const result = await engine.startDiscussion('기본값 테스트');

        expect(result.finalAnswer).toBeDefined();
        // maxAgents 기본값 10 → getRelatedAgentsForDiscussion에 10 전달
        expect(mockGetRelatedAgentsForDiscussion).toHaveBeenCalledWith(
            '기본값 테스트',
            10,
            expect.any(String)
        );
    });

    test('enableDeepThinking=true (기본) → generateResponse 시스템 프롬프트에 Deep Thinking 지침 포함', async () => {
        const generateResponse = makeGenerateResponse('응답');
        const engine = createDiscussionEngine(generateResponse, {
            maxRounds: 1,
            enableDeepThinking: true
        });

        await engine.startDiscussion('주제');

        const [systemPrompt] = generateResponse.mock.calls[0];
        expect(systemPrompt).toContain('Deep Thinking');
    });

    test('enableDeepThinking=false → 시스템 프롬프트에 Deep Thinking 없음', async () => {
        const generateResponse = makeGenerateResponse('응답');
        const engine = createDiscussionEngine(generateResponse, {
            maxRounds: 1,
            enableDeepThinking: false
        });

        await engine.startDiscussion('주제');

        const [systemPrompt] = generateResponse.mock.calls[0];
        expect(systemPrompt).not.toContain('Deep Thinking');
    });
});
