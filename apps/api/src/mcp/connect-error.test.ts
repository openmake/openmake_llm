/**
 * MCP 연결 실패 분류기 테스트.
 *
 * 고정 케이스는 **2026-08-25 라이브에서 실제로 받은 응답**이다 — Linear·Asana·Slack 의
 * 원격 MCP 엔드포인트가 OAuth 없이 접근하면 401 을 준다. 이 셋이 `auth_required` 로
 * 분류되지 않으면 화면에 다시 원인 없는 "연결 안 됨"만 남는다.
 */
import { classifyConnectError, serializeConnectError, parseConnectError } from './connect-error';

describe('classifyConnectError', () => {
    it.each([
        ['{"error":"invalid_token","error_description":"Missing or invalid access token"}', 'auth_required'],
        ['{"error":"invalid_request","error_description":"Authorization header is required for MCP V2 access"}', 'auth_required'],
        ['{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"missing_token"}}', 'auth_required'],
        ['Error POSTing to endpoint (HTTP 401): Unauthorized', 'auth_required'],
        ['HTTP 403 Forbidden', 'auth_required'],
    ])('401/403 계열은 auth_required 로 분류한다: %s', (msg, expected) => {
        expect(classifyConnectError(new Error(msg)).code).toBe(expected);
    });

    it('SDK UnauthorizedError 는 메시지가 비어도 auth_required (authProvider REDIRECT 경로)', () => {
        const e = new Error(''); e.name = 'UnauthorizedError';
        const r = classifyConnectError(e);
        expect(r.code).toBe('auth_required');
        expect(r.message.length).toBeGreaterThan(0); // 원문이 비면 안내문으로 채운다
    });

    it('404 는 not_found', () => {
        expect(classifyConnectError(new Error('HTTP 404 Not Found')).code).toBe('not_found');
    });

    it('연결 거부/DNS 실패는 unreachable', () => {
        expect(classifyConnectError(new Error('connect ECONNREFUSED 127.0.0.1:9999')).code).toBe('unreachable');
        expect(classifyConnectError(new Error('getaddrinfo ENOTFOUND mcp.example.invalid')).code).toBe('unreachable');
    });

    it('타임아웃은 timeout — unreachable 보다 먼저 잡는다', () => {
        expect(classifyConnectError(new Error('Request timed out after 30000ms')).code).toBe('timeout');
    });

    it('분류 불가는 unknown 이되 원문을 버리지 않는다', () => {
        const r = classifyConnectError(new Error('something entirely unexpected'));
        expect(r.code).toBe('unknown');
        expect(r.message).toBe('something entirely unexpected');
    });

    it('Error 가 아닌 값도 처리한다', () => {
        expect(classifyConnectError('missing_token').code).toBe('auth_required');
        expect(classifyConnectError(null).code).toBe('unknown');
    });

    it('원문이 길어도 상한을 넘기지 않는다 (HTML 본문 통째 유출 방지)', () => {
        const r = classifyConnectError(new Error('x'.repeat(5000)));
        expect(r.message.length).toBe(300);
    });
});

describe('serialize/parse 라운드트립', () => {
    it('코드와 원문이 보존된다', () => {
        const original = classifyConnectError(new Error('HTTP 401 invalid_token'));
        const parsed = parseConnectError(serializeConnectError(original));
        expect(parsed).toEqual(original);
    });

    it('접두 코드가 없는 구 데이터는 unknown 으로 읽는다', () => {
        expect(parseConnectError('legacy raw message')).toEqual({ code: 'unknown', message: 'legacy raw message' });
    });

    it('빈 값은 null — "원인 없음"과 구분된다', () => {
        expect(parseConnectError(null)).toBeNull();
        expect(parseConnectError('')).toBeNull();
    });
});
