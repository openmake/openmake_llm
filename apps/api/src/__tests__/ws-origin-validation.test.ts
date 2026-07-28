import { validateWebSocketOrigin } from '../sockets/ws-auth';

describe('validateWebSocketOrigin', () => {
    const allowed = ['https://app.example.com', 'http://localhost:52416'];

    test('일치하는 origin 허용', () => {
        expect(validateWebSocketOrigin('https://app.example.com', allowed)).toBe(true);
    });

    test('다른 도메인 거부', () => {
        expect(validateWebSocketOrigin('https://evil.example.com', allowed)).toBe(false);
    });

    test('origin 헤더 없음 거부', () => {
        expect(validateWebSocketOrigin(undefined, allowed)).toBe(false);
    });

    test('빈 문자열 거부', () => {
        expect(validateWebSocketOrigin('', allowed)).toBe(false);
    });

    test('대소문자 엄격 비교 (WHATWG Origin 스펙)', () => {
        expect(validateWebSocketOrigin('https://APP.example.com', allowed)).toBe(false);
    });

    test('와일드카드 "*"는 단독으로 매치 불가 (보안 강화)', () => {
        expect(validateWebSocketOrigin('https://any.example.com', ['*'])).toBe(false);
    });

    test('"*" 포함 혼합 allowlist에서도 엄격 비교', () => {
        expect(validateWebSocketOrigin('https://any.example.com', ['*', 'https://app.example.com'])).toBe(false);
    });

    test('localhost:port 정확히 매치', () => {
        expect(validateWebSocketOrigin('http://localhost:52416', allowed)).toBe(true);
        expect(validateWebSocketOrigin('http://localhost:3000', allowed)).toBe(false);
    });
});
