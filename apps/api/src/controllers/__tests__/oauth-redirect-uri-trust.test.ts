/**
 * 보안 점검 A5 — OAuth 동적 redirect_uri 는 신뢰 프록시에서 온 요청일 때만 x-forwarded-host/proto 를 쓴다.
 * 그 밖의 요청이 x-forwarded-host 를 꾸며 redirect_uri(=인가 코드가 돌아올 주소)를 바꾸지 못하게 한다.
 */
jest.mock('../../config/env', () => ({
    getConfig: () => ({ oauthRedirectUri: '' }),
}));
const mockLogInfo = jest.fn();
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: (...a: unknown[]) => mockLogInfo(...a), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import express from 'express';
import type { Request } from 'express';
import { buildRedirectUri } from '../auth-oauth-helpers';

const PORT = 52416;
const FORWARDED = { 'x-forwarded-host': 'chat.example.com', 'x-forwarded-proto': 'https' };

function makeReq(app: express.Express | undefined, remoteAddress: string, headers: Record<string, string>): Request {
    const all: Record<string, string> = { host: `localhost:${PORT}`, ...headers };
    return {
        app,
        socket: { remoteAddress },
        protocol: 'http',
        get: (name: string) => all[name.toLowerCase()],
    } as unknown as Request;
}

function appWithTrust(value?: unknown): express.Express {
    const app = express();
    if (value !== undefined) app.set('trust proxy', value);
    return app;
}

describe('buildRedirectUri — x-forwarded-* 는 trust proxy 일 때만', () => {
    test('trust proxy 가 loopback 이고 요청이 loopback 프록시에서 오면 forwarded host/proto 를 쓴다', () => {
        const req = makeReq(appWithTrust(['loopback']), '127.0.0.1', FORWARDED);
        expect(buildRedirectUri(req, 'google', PORT)).toBe('https://chat.example.com/api/auth/callback/google');
    });

    test('trust proxy 범위 밖 주소에서 온 요청의 forwarded 헤더는 무시한다', () => {
        const req = makeReq(appWithTrust(['loopback']), '203.0.113.7', FORWARDED);
        expect(buildRedirectUri(req, 'github', PORT)).toBe(`http://localhost:${PORT}/api/auth/callback/github`);
    });

    test('trust proxy 를 설정하지 않은 앱(Express 기본 false)은 forwarded 헤더를 무시한다', () => {
        const req = makeReq(appWithTrust(), '127.0.0.1', FORWARDED);
        expect(buildRedirectUri(req, 'kakao', PORT)).toBe(`http://localhost:${PORT}/api/auth/callback/kakao`);
    });

    test('trust proxy fn 이 없는 요청(app 미연결)도 forwarded 헤더를 무시한다', () => {
        const req = makeReq(undefined, '127.0.0.1', FORWARDED);
        expect(buildRedirectUri(req, 'google', PORT)).toBe(`http://localhost:${PORT}/api/auth/callback/google`);
    });

    test('host 해석 로그에 trusted 플래그를 남긴다(신뢰 프록시 true, 범위 밖 false)', () => {
        const hostLog = () => mockLogInfo.mock.calls.find((c) => String(c[0]).startsWith('[OAuth] host 해석'));
        mockLogInfo.mockClear();
        buildRedirectUri(makeReq(appWithTrust(['loopback']), '127.0.0.1', FORWARDED), 'google', PORT);
        expect(hostLog()?.[1]).toEqual({ trusted: true });
        mockLogInfo.mockClear();
        buildRedirectUri(makeReq(appWithTrust(['loopback']), '203.0.113.7', FORWARDED), 'google', PORT);
        expect(hostLog()?.[1]).toEqual({ trusted: false });
    });

    test('forwarded 헤더가 없으면 신뢰 여부와 무관하게 Host 와 req.protocol 을 쓴다', () => {
        const req = makeReq(appWithTrust(['loopback']), '127.0.0.1', {});
        expect(buildRedirectUri(req, 'google', PORT)).toBe(`http://localhost:${PORT}/api/auth/callback/google`);
    });
});
