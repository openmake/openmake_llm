/**
 * 실패 분류(errorCategory)의 전달 계약 검증.
 *
 * 계약: `ToolRouter.executeTool` 의 fail() 이 분류를 결과에 싣고 →
 *       `UnifiedMCPClient.executeToolWithContext` 가 감사에 넘긴 뒤 **응답에서 제거**한다.
 * 제거가 빠지면 내부 전용 필드가 도구 소비자(LLM 루프)에게 새고,
 * 전달이 빠지면 실패 원인이 다시 문자열 매칭으로 퇴행한다.
 */
const logAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit }) }));

import { ToolRouter } from '../tool-router';
import { UnifiedMCPClient } from '../unified-client';

describe('도구 실패 분류 전달·비노출', () => {
    beforeEach(() => logAudit.mockClear());

    it('ToolRouter.executeTool: fail() 이 errorCategory/retryable 을 결과에 싣는다', async () => {
        const router = new ToolRouter();
        const result = await router.executeTool('definitely_unknown_tool', {});
        expect(result.isError).toBe(true);
        expect(result.errorCategory).toBe('not_found');
        expect(result.retryable).toBe(false);
    });

    it('UnifiedMCPClient: 분류를 감사에 기록하고 응답에서는 제거한다', async () => {
        const client = new UnifiedMCPClient();
        const result = await client.executeToolWithContext(
            'definitely_unknown_tool',
            {},
            { userId: 'guest', role: 'user' } as never,
        );

        expect(result.isError).toBe(true);
        // 응답 비노출 — 필드 자체가 없어야 한다(undefined 로 남기면 직렬화에 키가 생길 수 있다).
        expect('errorCategory' in result).toBe(false);
        expect('retryable' in result).toBe(false);

        // 감사에는 실렸는가 (fire-and-forget 이라 마이크로태스크 한 바퀴 대기)
        await new Promise((r) => setImmediate(r));
        expect(logAudit).toHaveBeenCalledTimes(1);
        const details = logAudit.mock.calls[0][0].details;
        expect(details.isError).toBe(true);
        expect(details.errorCategory).toBe('not_found');
        expect(details.retryable).toBe(false);
    });

    it('성공 호출에는 분류 키가 붙지 않는다 (실패에만 카테고리가 생긴다)', async () => {
        const client = new UnifiedMCPClient();
        client.getToolRouter().registerExternalTools(
            'srv-ok',
            'okserver',
            [{ name: 'ping', description: 'test', inputSchema: { type: 'object', properties: {} } }],
            async () => ({ content: [{ type: 'text', text: 'pong' }] }),
        );

        const result = await client.executeToolWithContext(
            'okserver::ping',
            {},
            { userId: 'guest', role: 'user' } as never,
        );

        expect(result.isError).toBeFalsy();
        expect('errorCategory' in result).toBe(false);

        await new Promise((r) => setImmediate(r));
        const details = logAudit.mock.calls[0][0].details;
        expect(details.isError).toBe(false);
        expect(Object.keys(details)).not.toContain('errorCategory');
        expect(Object.keys(details)).not.toContain('retryable');
    });
});
