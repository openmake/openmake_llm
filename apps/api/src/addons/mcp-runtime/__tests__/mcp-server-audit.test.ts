/**
 * MCP 서버 감사 헬퍼(routes/mcp-server-audit) — 라우트의 등록·삭제·거부·URL 차단 지점이 부르는 1줄 래퍼.
 * 각 함수는 auditSecurityEvent 를 한 번, 올바른 action·resourceType·userId 로 부르고 await 하지 않는다.
 * env·url 전체는 details 에 싣지 않는다.
 */
const audit = jest.fn(async (_input: Record<string, unknown>) => undefined);
jest.mock('../../../security/security-audit', () => ({
    auditSecurityEvent: (input: Record<string, unknown>) => audit(input),
}));

import type { Request } from 'express';
import {
    auditMcpServerCreated, auditMcpServerDeleted, auditMcpDeleteDenied,
    auditMcpRegisterDenied, auditMcpUrlBlocked, urlHost,
} from '../routes/mcp-server-audit';

function req(user?: { id: string | number; role?: string }): Request {
    return {
        user, ip: '10.1.2.3',
        get: (h: string) => (h.toLowerCase() === 'user-agent' ? 'jest-ua' : undefined),
    } as unknown as Request;
}

const only = (): Record<string, unknown> => {
    expect(audit).toHaveBeenCalledTimes(1);
    return audit.mock.calls[0][0];
};

beforeEach(() => audit.mockClear());

describe('mcp-server-audit', () => {
    it('등록 성공 → mcp_server.create, 서버 id·이름·출처만', () => {
        auditMcpServerCreated(req({ id: 'u-1' }), { id: 'mcp_1', name: 'files', source: 'catalog' });
        expect(only()).toEqual({
            action: 'mcp_server.create', userId: 'u-1', resourceType: 'mcp_server', resourceId: 'mcp_1',
            details: { name: 'files', source: 'catalog' }, ipAddress: '10.1.2.3', userAgent: 'jest-ua',
        });
    });

    it('삭제 성공 → mcp_server.delete', () => {
        auditMcpServerDeleted(req({ id: 7 }), { id: 'mcp_2', name: 'git' });
        expect(only()).toMatchObject({
            action: 'mcp_server.delete', userId: 7, resourceType: 'mcp_server', resourceId: 'mcp_2', details: { name: 'git' },
        });
    });

    it('삭제 403 → security.authz_denied, resourceType mcp_server', () => {
        auditMcpDeleteDenied(req({ id: 'u-2' }), 'mcp_3');
        expect(only()).toMatchObject({
            action: 'security.authz_denied', userId: 'u-2', resourceType: 'mcp_server', resourceId: 'mcp_3',
        });
    });

    it('등록 403 → mcp_server.register_denied, 사유와 추가 details', () => {
        auditMcpRegisterDenied(req({ id: 'u-3' }), 'org_policy', { templateId: 't-1' });
        expect(only()).toMatchObject({
            action: 'mcp_server.register_denied', userId: 'u-3', resourceType: 'mcp_server',
            details: { reason: 'org_policy', templateId: 't-1' },
        });
    });

    it('URL 차단 → security.ssrf_blocked, resourceId 는 host 만', () => {
        auditMcpUrlBlocked(req({ id: 'u-4' }), 'internal.example:8080', 'SSRF blocked: resolved to blocked IP range: 10.0.0.1');
        expect(only()).toEqual({
            action: 'security.ssrf_blocked', userId: 'u-4', resourceType: 'url', resourceId: 'internal.example:8080',
            details: { target: 'mcp_server', reason: 'SSRF blocked: resolved to blocked IP range: 10.0.0.1' },
            ipAddress: '10.1.2.3', userAgent: 'jest-ua',
        });
    });

    it('비로그인 요청이면 userId 는 undefined(헬퍼가 guest 로 남긴다)', () => {
        auditMcpRegisterDenied(req(), 'x');
        expect(only().userId).toBeUndefined();
    });

    it('urlHost — 경로·쿼리·계정은 버리고 host 만, 깨진 주소는 invalid', () => {
        expect(urlHost('https://u:p@internal.example:8080/a?token=s')).toBe('internal.example:8080');
        expect(urlHost('not a url')).toBe('invalid');
    });
});
