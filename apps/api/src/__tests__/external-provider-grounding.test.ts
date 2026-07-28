/**
 * ============================================================
 * External Provider — 웹검색 grounding 지시 시스템 주입 테스트
 * ============================================================
 *
 * 회귀: enhancedMessage(검색 컨텍스트 포함)가 항상 set 인 message-pipeline 경로에서
 * 기존 `if (!ctx.enhancedMessage && webSearchContext)` 가드가 죽어, 반-환각 grounding
 * 지시가 모델에 전달되지 않았다. fast 모드 모델이 주입 컨텍스트를 무시하고 단정적
 * 오답을 내는 것을 완화하기 위해, webSearchContext 가 있으면 system 프롬프트에
 * grounding 지시를 보강한다 (enhancedMessage 시 지시만, 미설정 시 지시+컨텍스트).
 */

jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../chat/prompt', () => ({
    getExternalProviderSystemGuards: () => '[GUARD]',
}));

import { streamFromExternalProvider } from '../services/chat-service/external-fallback';

const GROUNDING_RE = /제공된 웹 검색 결과를 최우선 근거/;

/** system 메시지 content 를 캡처하는 fake provider */
function makeResolved(captured: { system?: string }) {
    return {
        providerId: 'gemini',
        modelId: 'gemini-2.5-flash',
        fullId: 'gemini:gemini-2.5-flash',
        provider: {
            getCapabilities: () => ({ vision: false, toolCalling: false }),
            streamChat: jest.fn().mockImplementation(async (opts: any) => {
                const sys = opts.messages.find((m: any) => m.role === 'system');
                captured.system = sys?.content;
                return { content: 'ok', toolCalls: [], finishReason: 'stop' };
            }),
        },
    } as any;
}

const deps = { currentUserContext: null, allowedTools: [] } as any;
const baseReq = { message: '한국 대통령이 누구야?', userId: 'guest', history: [] } as any;

describe('External Provider — 웹검색 grounding 시스템 주입', () => {
    it('webSearchContext + enhancedMessage(검색 포함): system 에 grounding 지시만 (컨텍스트 중복 없음)', async () => {
        const cap: { system?: string } = {};
        await streamFromExternalProvider(
            deps, makeResolved(cap),
            { ...baseReq, webSearchContext: '## 검색결과\n[출처1] 이재명 대통령...' },
            () => {},
            { enhancedMessage: '## 검색결과\n[출처1] 이재명 대통령...\n## USER QUESTION\n한국 대통령이 누구야?' },
        );
        expect(cap.system).toMatch(GROUNDING_RE);
        // 컨텍스트는 enhancedMessage(user turn)에 있으므로 system 에 중복 주입되면 안 됨
        expect((cap.system!.match(/출처1/g) || []).length).toBe(0);
    });

    it('webSearchContext + enhancedMessage 미설정(직접 경로): system 에 지시 + 컨텍스트', async () => {
        const cap: { system?: string } = {};
        await streamFromExternalProvider(
            deps, makeResolved(cap),
            { ...baseReq, webSearchContext: '## 검색결과\n[출처1] 이재명 대통령...' },
            () => {},
            {}, // enhancedMessage 없음
        );
        expect(cap.system).toMatch(GROUNDING_RE);
        expect(cap.system).toContain('출처1');
    });

    it('webSearchContext 없음: grounding 지시 미주입', async () => {
        const cap: { system?: string } = {};
        await streamFromExternalProvider(deps, makeResolved(cap), { ...baseReq }, () => {}, {});
        expect(cap.system ?? '').not.toMatch(GROUNDING_RE);
    });
});
