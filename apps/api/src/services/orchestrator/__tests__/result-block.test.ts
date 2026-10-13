/** 작업 결과를 본 모델에 싣는 블록 — 내부 이름이 사용자 답으로 새지 않게 하는 지시를 고정한다 */
import { buildResultBlock } from '../orchestrate';

const results = [
    { taskId: 't1', capability: 'web.search', ok: true, status: 'completed', text: 'Query: x\n1. title', media: [] },
    { taskId: 't2', capability: 'text.reason', ok: true, status: 'completed', text: 'draft text', media: [] },
] as never;

describe('buildResultBlock', () => {
    it('내부 이름(작업 번호·오케스트레이터)을 사용자에게 말하지 말라고 싣는다 — 실측(2026-10-13): 답에 "오케스트레이터 초기 분석(t2)에서…"가 그대로 나왔다', () => {
        const ko = buildResultBlock(results, 'ko');
        expect(ko).toMatch(/작업 번호.*말하지 마세요/);
        expect(ko).toMatch(/오케스트레이터/);
        const en = buildResultBlock(results, 'en');
        expect(en).toMatch(/never mention/i);
        expect(/\p{Script=Hangul}/u.test(en)).toBe(false);
    });

    it('텍스트 작업의 결과는 초안이라 검색 결과와 다르면 검색 결과를 따르라고 싣는다', () => {
        expect(buildResultBlock(results, 'ko')).toMatch(/초안.*검색 결과를 따르/);
        expect(buildResultBlock(results, 'en')).toMatch(/draft/i);
    });
});
