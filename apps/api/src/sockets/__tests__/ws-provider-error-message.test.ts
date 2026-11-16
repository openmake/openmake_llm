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

describe('API_KEY_DISABLED 안내', () => {
    it('모든 언어에 꺼진 키 안내가 있고 미등록(MISSING_API_KEY) 안내와 다르다', () => {
        for (const [lang, table] of Object.entries(WS_PROVIDER_ERROR_MESSAGES)) {
            expect(table.API_KEY_DISABLED).toBeTruthy();
            expect(table.API_KEY_DISABLED).not.toBe(table.MISSING_API_KEY);
            expect(providerErrorMessage(lang, 'API_KEY_DISABLED')).toBe(table.API_KEY_DISABLED);
        }
        expect(Object.keys(WS_PROVIDER_ERROR_MESSAGES)).toHaveLength(7);
    });
    it('ko 문구는 켜는 곳을 안내하고 관리자 문의를 말하지 않는다', () => {
        const m = WS_PROVIDER_ERROR_MESSAGES.ko.API_KEY_DISABLED;
        expect(m).toMatch(/꺼져 있습니다/);
        expect(m).toMatch(/설정 → 외부 API 키/);
        expect(m).not.toMatch(/관리자/);
    });
});
