/** 외부 provider 오류 안내 — 요청 자체가 거절된 400 에는 "일시적·다시 시도" 문구를 쓰지 않는다. */
import { providerErrorMessage, WS_PROVIDER_ERROR_MESSAGES, WS_PROVIDER_REJECTED_MESSAGES } from '../ws-chat-locales';

describe('providerErrorMessage', () => {
    it('UPSTREAM_ERROR + status 400 은 거절 안내', () => {
        const m = providerErrorMessage('ko', 'UPSTREAM_ERROR', 400);
        expect(m).toBe(WS_PROVIDER_REJECTED_MESSAGES.ko);
        expect(m).not.toMatch(/일시적|잠시 후/);
        expect(m).toMatch(/다른 모델/);
    });
    it('status 가 없거나 5xx 면 종전의 일시적 오류 안내', () => {
        expect(providerErrorMessage('ko', 'UPSTREAM_ERROR')).toBe(WS_PROVIDER_ERROR_MESSAGES.ko.UPSTREAM_ERROR);
        expect(providerErrorMessage('ko', 'UPSTREAM_ERROR', 503)).toBe(WS_PROVIDER_ERROR_MESSAGES.ko.UPSTREAM_ERROR);
    });
    it('다른 코드는 status 와 무관하게 코드별 안내', () => {
        expect(providerErrorMessage('ko', 'NOT_SUPPORTED', 400)).toBe(WS_PROVIDER_ERROR_MESSAGES.ko.NOT_SUPPORTED);
    });
    it('코드별 안내가 있는 모든 언어에 거절 안내가 있다 · 미지원 언어는 en', () => {
        expect(Object.keys(WS_PROVIDER_REJECTED_MESSAGES).sort()).toEqual(Object.keys(WS_PROVIDER_ERROR_MESSAGES).sort());
        expect(providerErrorMessage('xx', 'UPSTREAM_ERROR', 400)).toBe(WS_PROVIDER_REJECTED_MESSAGES.en);
    });
});
