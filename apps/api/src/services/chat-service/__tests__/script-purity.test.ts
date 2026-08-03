/**
 * 스크립트 순수성 교정 테스트 (2026-08-02).
 *
 * 검색·도구 결과 언어에 끌려 한글 문장에 한자·간체자가 섞이던 결함의 후단 교정.
 * 프롬프트 강화로는 혼입률이 45% 그대로였고(A/B 실측), 후단 교정은 6건 중 5건 성공.
 */
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const mockChat = jest.fn();
jest.mock('../../model-role-resolver', () => ({
    resolveRoleClientForUser: jest.fn().mockResolvedValue({
        client: { derive: () => ({ chat: (...a: unknown[]) => mockChat(...a) }) },
    }),
}));

import { hasScriptMixing, repairScriptMixing } from '../script-purity';

describe('hasScriptMixing', () => {
    it('한글에 붙은 한자를 혼입으로 판정한다', () => {
        expect(hasScriptMixing('재정支出을 확대하고')).toBe(true);
        expect(hasScriptMixing('8월 2일当天 종가')).toBe(true);
        expect(hasScriptMixing('하반期 성장')).toBe(true);
    });

    it('순수 한글은 혼입이 아니다', () => {
        expect(hasScriptMixing('재정 지출을 확대하고 있습니다.')).toBe(false);
    });

    it('코드 블록 안의 한자는 혼입으로 보지 않는다', () => {
        // 중국어 문자열 리터럴 등 의도된 한자를 교정하면 코드가 깨진다.
        expect(hasScriptMixing('설명입니다.\n```js\nconst s = "中国经济";\n```')).toBe(false);
    });

    it('독립된 한자 인용(제목 등)은 문장 내 혼입으로 보지 않는다', () => {
        expect(hasScriptMixing('출처: 李 대통령 발언 (네이버 뉴스)')).toBe(false);
    });
});

describe('repairScriptMixing', () => {
    beforeEach(() => mockChat.mockReset());

    it('혼입된 줄만 교정하고 나머지는 그대로 둔다', async () => {
        mockChat.mockResolvedValue({ content: '1. 재정 지출을 확대했습니다.' });
        const src = '요약입니다.\n재정支出을 확대했습니다.\n끝.';
        const out = await repairScriptMixing(src, 'ko', 'u1');
        expect(out).toBe('요약입니다.\n재정 지출을 확대했습니다.\n끝.');
    });

    it('혼입이 없으면 LLM 을 호출하지 않는다', async () => {
        expect(await repairScriptMixing('깨끗한 한국어 문장입니다.', 'ko', 'u1')).toBeNull();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('한국어가 아니면 교정하지 않는다', async () => {
        expect(await repairScriptMixing('재정支出', 'en', 'u1')).toBeNull();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('교정본에 혼입이 남아 있으면 그 줄은 원문을 지킨다', async () => {
        mockChat.mockResolvedValue({ content: '1. 전次会议 결과입니다.' });
        expect(await repairScriptMixing('前次会议 결과입니다.', 'ko', 'u1')).toBeNull();
    });

    it('교정본에 모델 특수 토큰이 섞이면 그 줄은 원문을 지킨다', async () => {
        // 라이브 1건 관측: 교정 응답 앞에 <|mask_start|> 가 붙어 본문에 노출됐다.
        mockChat.mockResolvedValue({ content: '1. <|mask_start|> 재정 지출을 확대했습니다.' });
        expect(await repairScriptMixing('재정支出을 확대했습니다.', 'ko', 'u1')).toBeNull();
    });

    it('교정본이 원문보다 크게 짧으면 내용 유실로 보고 버린다', async () => {
        mockChat.mockResolvedValue({ content: '1. 요약' });
        const src = '거품이 빠진 과정에서开发商들의 미분양 물량이 폭발했고 지방 재정에 부담을 줍니다.';
        expect(await repairScriptMixing(src, 'ko', 'u1')).toBeNull();
    });

    it('줄 수가 어긋나면 신뢰하지 않고 원문을 유지한다', async () => {
        // 혼입 2줄을 보냈는데 1줄만 되돌아온 경우 — 매핑을 신뢰할 수 없다.
        mockChat.mockResolvedValue({ content: '1. 재정 지출을 확대' });
        expect(await repairScriptMixing('재정支出을 확대\n8월 2일当天 종가', 'ko', 'u1')).toBeNull();
    });

    it('LLM 호출이 실패해도 예외를 던지지 않는다 (fail-open)', async () => {
        mockChat.mockRejectedValue(new Error('upstream down'));
        expect(await repairScriptMixing('재정支出을 확대', 'ko', 'u1')).toBeNull();
    });
});
