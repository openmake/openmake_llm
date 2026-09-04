/** checkNeedsMoreInfo 가 모듈 상수가 아니라 config.maxTotalSources 를 기준으로 삼는지 — 2026-09-05 */
const chatMock = jest.fn();
jest.mock('../chat-with-timeout', () => ({ chatWithAbortTimeout: (...a: unknown[]) => chatMock(...a) }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addResearchStep: jest.fn() }) }));

import { checkNeedsMoreInfo } from '../findings-synthesizer';
import { RESEARCH_DEFAULTS } from '../../../config/runtime-limits';
import type { ResearchConfig } from '../../deep-research-types';

const base = { client: {} as never, topic: 'T', currentFindings: [], throwIfAborted: () => undefined };

describe('checkNeedsMoreInfo — 판정 생략 임계는 config 기준', () => {
    beforeEach(() => chatMock.mockReset());

    it('maxTotalSources=10 이면 소스 6개부터 LLM 에 묻는다 (상수 50 기준이면 30 미만이라 묻지 않았음)', async () => {
        chatMock.mockResolvedValue({ content: 'no' });
        const config = { maxTotalSources: 10, language: 'ko' } as ResearchConfig;
        const r = await checkNeedsMoreInfo({ ...base, config, sourceCount: 6 });
        expect(chatMock).toHaveBeenCalledTimes(1);
        expect(r).toBe(false);
    });

    it('임계 미만이면 LLM 호출 없이 true', async () => {
        const config = { maxTotalSources: 10, language: 'ko' } as ResearchConfig;
        const below = Math.floor(10 * RESEARCH_DEFAULTS.NEED_MORE_SKIP_RATIO) - 1;
        const r = await checkNeedsMoreInfo({ ...base, config, sourceCount: below });
        expect(chatMock).not.toHaveBeenCalled();
        expect(r).toBe(true);
    });
});
