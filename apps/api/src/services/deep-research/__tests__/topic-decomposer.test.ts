/**
 * 주제 분해 — 프롬프트 grounding(날짜·검색 연산자 금지) + 관용 채택(S4) 회귀 테스트.
 * 2026-09-05 gpt-researcher 대조 도입분.
 */
import { getDecomposePrompt } from '../../deep-research-prompts';

const chatMock = jest.fn();
const addStepMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../chat-with-timeout', () => ({ chatWithAbortTimeout: (...args: unknown[]) => chatMock(...args) }));
jest.mock('../research-context', () => ({ withSkillContext: (p: string) => p }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addResearchStep: addStepMock }) }));

import { decomposeTopics } from '../topic-decomposer';
import type { ResearchConfig } from '../../deep-research-types';

const LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'de', 'fr'];

describe('getDecomposePrompt — grounding', () => {
    it.each(LANGS)('%s: 현재 날짜와 검색 연산자 금지 규칙을 포함한다', (lang) => {
        const p = getDecomposePrompt(lang, '양자컴퓨팅', '2026-09-05');
        expect(p).toContain('2026-09-05');
        expect(p).toContain('site:');
        expect(p).toContain('filetype:');
        // JSON 출력 지시는 그대로 남아 있어야 한다(번호만 바뀜)
        expect(p).toMatch(/JSON/);
    });

    it('today 미지정 시 오늘 날짜(YYYY-MM-DD)를 넣는다', () => {
        const p = getDecomposePrompt('ko', 't');
        expect(p).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
});

describe('decomposeTopics — 유효 서브토픽 관용 채택', () => {
    const base = { config: { language: 'ko' } as ResearchConfig, topic: 'T', sessionId: 's1', throwIfAborted: () => undefined, client: {} as never };
    beforeEach(() => { chatMock.mockReset(); addStepMock.mockClear(); });

    it('8개 미만(3개)이어도 모델 결과를 채택한다 (종전엔 템플릿 8개로 교체)', async () => {
        chatMock.mockResolvedValue({ content: JSON.stringify([
            { title: 'A', searchQueries: ['a1'], importance: 5 },
            { title: 'B', searchQueries: ['b1', 'b2'], importance: 3 },
            { title: 'C', searchQueries: ['c1'], importance: 4 },
        ]) });
        const out = await decomposeTopics(base);
        expect(out.map(s => s.title)).toEqual(['A', 'C', 'B']);
        expect(out).toHaveLength(3);
    });

    it('유효 항목 0개(제목/검색어 결손)면 템플릿 폴백', async () => {
        chatMock.mockResolvedValue({ content: JSON.stringify([{ title: '', searchQueries: [] }, { searchQueries: ['x'] }]) });
        const out = await decomposeTopics(base);
        expect(out.length).toBeGreaterThanOrEqual(8);
    });

    it('파싱 실패면 템플릿 폴백', async () => {
        chatMock.mockResolvedValue({ content: '설명만 있고 배열 없음' });
        const out = await decomposeTopics(base);
        expect(out.length).toBeGreaterThanOrEqual(8);
    });
});
