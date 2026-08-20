/**
 * API Key 스코프 헬퍼 — apiKeyHasScope (2026-08-21 하드닝).
 * 와일드카드·빈 배열(하위호환)·정확 매칭·미보유 케이스를 검증한다.
 */
import { apiKeyHasScope, API_KEY_SCOPES, ALLOWED_API_KEY_SCOPES } from '../api-key-scopes';

describe('apiKeyHasScope', () => {
    test('와일드카드(*)는 모든 스코프를 허용', () => {
        expect(apiKeyHasScope(['*'], API_KEY_SCOPES.BRIDGE)).toBe(true);
        expect(apiKeyHasScope(['*'], API_KEY_SCOPES.CHAT)).toBe(true);
    });

    test('빈 배열·undefined 는 기존 전권 키로 간주해 허용(하위호환)', () => {
        expect(apiKeyHasScope([], API_KEY_SCOPES.BRIDGE)).toBe(true);
        expect(apiKeyHasScope(undefined, API_KEY_SCOPES.BRIDGE)).toBe(true);
        expect(apiKeyHasScope(null, API_KEY_SCOPES.CHAT)).toBe(true);
    });

    test('정확한 스코프 매칭', () => {
        expect(apiKeyHasScope(['bridge'], API_KEY_SCOPES.BRIDGE)).toBe(true);
        expect(apiKeyHasScope(['chat'], API_KEY_SCOPES.CHAT)).toBe(true);
    });

    test('미보유 스코프는 거부', () => {
        expect(apiKeyHasScope(['bridge'], API_KEY_SCOPES.CHAT)).toBe(false); // bridge 키는 추론 API 불가
        expect(apiKeyHasScope(['chat'], API_KEY_SCOPES.BRIDGE)).toBe(false); // chat 키는 브리지 불가
    });

    test('허용 스코프 화이트리스트', () => {
        expect(ALLOWED_API_KEY_SCOPES.has('*')).toBe(true);
        expect(ALLOWED_API_KEY_SCOPES.has('bridge')).toBe(true);
        expect(ALLOWED_API_KEY_SCOPES.has('chat')).toBe(true);
        expect(ALLOWED_API_KEY_SCOPES.has('admin')).toBe(false);
    });
});
