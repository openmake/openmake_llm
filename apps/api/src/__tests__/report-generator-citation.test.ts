/**
 * report-generator-citation.test.ts
 *
 * A3 런타임 통합 검증 — generateReport 의 인용검증 블록(step 1000 기록, ENFORCE 분기,
 * try/catch)을 mock LLM/db 로 **실제 구동**한다. verifyCitations 단위테스트(citation-verifier.test.ts)와
 * 달리, 이 테스트는 report-generator 통합 경로가 런타임에 동작함을 검증한다
 * ("타입체크만 됨 → end-to-end 미실행" 갭 종료).
 */

import { generateReport } from '../services/deep-research/report-generator';
import { DEEP_RESEARCH_CITATION } from '../config/runtime-limits';
import { LLM_TIMEOUTS } from '../config/timeouts';
import { getUnifiedDatabase } from '../data/models/unified-database';
import * as citationVerifier from '../services/deep-research/citation-verifier';
import { type LLMClient, createClient } from '../llm';
import type { SearchResult } from '../mcp/web-search';
import type { ResearchConfig, SubTopic } from '../services/deep-research-types';

jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: jest.fn(),
}));

// generateReport 는 보고서 생성에 전용 긴-타임아웃 클라이언트(createClient)를 만든다.
// 테스트에서는 createClient 를 mock 해 전달 client 와 동일 stub 을 반환시킨다.
jest.mock('../llm', () => ({
    createClient: jest.fn(),
}));

const mockGetUnifiedDatabase = getUnifiedDatabase as jest.MockedFunction<typeof getUnifiedDatabase>;
const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

// 5개 소스 → sourceCount=5, [출처 1]/[출처 2] 유효, [출처 9] 무효
const SOURCES: SearchResult[] = ['a', 'b', 'c', 'd', 'e'].map((k) => ({
    title: `소스 ${k}`,
    url: `https://${k}.com`,
    snippet: `${k} 스니펫`,
})) as unknown as SearchResult[];

const SUBTOPICS: SubTopic[] = [
    { title: '서브토픽', searchQueries: ['쿼리'], importance: 1 } as unknown as SubTopic,
];

const CONFIG = { language: 'ko' } as unknown as ResearchConfig;

/** 3개 주장 중 2개 인용(coverage 2/3), invalid 0 인 정상 보고서 */
const REPORT_OK = [
    '## 종합 요약',
    '',
    '원격 근무는 집중 업무에 유리하다 [출처 1]. 사무실 근무는 대면 협업에 강하다 [출처 2]. 많은 기업이 이를 도입하는 추세이다.',
    '',
    '## 참고 자료',
    '[1] 소스 a - https://a.com',
].join('\n');

function makeClient(content: string): LLMClient {
    const c = {
        model: 'test-model',
        chat: jest.fn().mockResolvedValue({ content }),
        // 보고서 생성 전용 긴-타임아웃 클라이언트는 client.derive() 파생 — 동일 stub 반환.
        derive: jest.fn(),
    } as unknown as LLMClient;
    (c.derive as jest.Mock).mockReturnValue(c);
    mockCreateClient.mockReturnValue(c);
    return c;
}

function makeDb(): { addResearchStep: jest.Mock } {
    const db = { addResearchStep: jest.fn().mockResolvedValue(undefined) };
    mockGetUnifiedDatabase.mockReturnValue(db as unknown as ReturnType<typeof getUnifiedDatabase>);
    return db;
}

/** addResearchStep 호출 중 step 1000(인용검증)만 추출 */
function citationStep(db: { addResearchStep: jest.Mock }): Record<string, unknown> | undefined {
    return db.addResearchStep.mock.calls
        .map(c => c[0] as Record<string, unknown>)
        .find(arg => arg.stepNumber === 1000);
}

const baseParams = (client: LLMClient) => ({
    client,
    config: CONFIG,
    topic: '원격 근무',
    findings: ['원격 근무 관련 핵심 합성 결과'],
    sources: SOURCES,
    subTopics: SUBTOPICS,
    sessionId: 'sess-test',
    throwIfAborted: () => { /* noop */ },
});

describe('generateReport — A3 인용검증 통합 (런타임)', () => {
    afterEach(() => {
        jest.clearAllMocks();
        (DEEP_RESEARCH_CITATION as { ENFORCE: boolean }).ENFORCE = false;
    });

    test('정상 보고서 → step 1000 기록 + payload 정확 + status completed', async () => {
        const db = makeDb();
        const client = makeClient(REPORT_OK);
        await generateReport(baseParams(client));

        // 타임아웃 수정 검증: 보고서 생성은 전역 LLM_TIMEOUT 이 아니라
        // REPORT_GENERATION_TIMEOUT_MS 전용 파생 클라이언트(client.derive — baseUrl/apiKey
        // 보존, role 해석 외부 endpoint 안전)로 호출돼야 함(값 튜닝과 무관하게 상수 참조).
        expect(client.derive).toHaveBeenCalledWith(
            expect.objectContaining({ timeout: LLM_TIMEOUTS.REPORT_GENERATION_TIMEOUT_MS }),
        );

        const step = citationStep(db);
        expect(step).toBeDefined();
        expect(step!.stepType).toBe('report');
        expect(step!.query).toBe('인용 검증');
        expect(step!.status).toBe('completed'); // ENFORCE=false 기본

        const payload = JSON.parse(step!.result as string);
        expect(payload.totalClaims).toBe(3);
        expect(payload.citedClaims).toBe(2);
        expect(payload.coverage).toBeCloseTo(2 / 3, 5);
        expect(payload.invalidCitations).toEqual([]);
        expect(payload.meetsTarget).toBe(false); // 0.667 < 0.95
        expect(payload.uncitedSamples).toContain('많은 기업이 이를 도입하는 추세이다.');
    });

    test('fallback/실패 메시지 보고서 → skipped → step 1000 미기록', async () => {
        const db = makeDb();
        // 합성결과는 의미있지만 LLM 보고서 본문이 실패 메시지 → verifyCitations.skipped
        await generateReport(baseParams(makeClient('리서치 실패: 연결 오류가 발생했습니다.')));

        expect(citationStep(db)).toBeUndefined();
    });

    test('ENFORCE=true + 목표 미달 → step 1000 status failed', async () => {
        const db = makeDb();
        (DEEP_RESEARCH_CITATION as { ENFORCE: boolean }).ENFORCE = true;

        await generateReport(baseParams(makeClient(REPORT_OK)));

        const step = citationStep(db);
        expect(step).toBeDefined();
        expect(step!.status).toBe('failed'); // belowTarget && ENFORCE
    });

    test('verifyCitations 예외 → try/catch 가 삼켜 보고서는 정상 반환, step 1000 미기록', async () => {
        const db = makeDb();
        const spy = jest.spyOn(citationVerifier, 'verifyCitations')
            .mockImplementation(() => { throw new Error('boom'); });

        const result = await generateReport(baseParams(makeClient(REPORT_OK)));

        expect(result.summary).toContain('원격 근무'); // 보고서 정상 반환
        expect(citationStep(db)).toBeUndefined();        // 인용 step 은 기록 안 됨
        spy.mockRestore();
    });
});
