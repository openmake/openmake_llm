/**
 * 웹검색 출처 링크 보강 테스트.
 * 회귀(2026-07-17): 모델이 **출처** 섹션을 직접 만들되 URL 없이 제목만 나열하면
 * 결정적 첨부가 중복 방지 가드에 걸려 skip — 클릭 불가한 출처 목록만 남았다.
 * 수정: 헤더는 있는데 링크가 없으면 인용 번호에 매칭된 URL 블록을 append.
 */
jest.mock('../utils/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));
jest.mock('../chat/prompt', () => ({ getExternalProviderSystemGuards: () => '[GUARD]' }));

import { streamFromExternalProvider } from '../services/chat-service/external-fallback';

const CTX = '## 검색결과\n[출처 1] 제목A\nURL: https://a.example.com/1\n[출처 2] 제목B\nURL: https://b.example.com/2\n[출처 3] 제목C\nURL: https://c.example.com/3';

function makeResolved(content: string) {
    return {
        providerId: 'local-llm', modelId: 'm', fullId: 'local-llm:m',
        provider: {
            getCapabilities: () => ({ vision: false, toolCalling: false }),
            streamChat: jest.fn().mockResolvedValue({ content, toolCalls: [], finishReason: 'stop' }),
        },
    } as never;
}

const deps = { currentUserContext: null, allowedTools: [] } as never;
const req = { message: '질문', userId: 'guest', history: [], webSearchContext: CTX } as never;
const ctx = { resolvedLanguage: 'ko' };

describe('External Provider — 출처 링크 보강', () => {
    it('모델이 URL 없는 출처 섹션을 만들면 인용 번호에 매칭된 링크 블록을 append', async () => {
        const result = await streamFromExternalProvider(
            deps, makeResolved('답변입니다.[출처 2]\n\n**출처**\n[출처 2] 제목B'), req, () => {}, ctx,
        );
        expect(result).toContain('🔗 **URL**');
        expect(result).toContain('[2] https://b.example.com/2');
        expect(result).not.toContain('https://a.example.com/1'); // 미인용 소스는 제외
    });

    it('모델 출처 섹션에 이미 링크가 있으면 보강하지 않음', async () => {
        const result = await streamFromExternalProvider(
            deps, makeResolved('답변.\n\n**출처**\n[출처 1] [제목A](https://a.example.com/1)'), req, () => {}, ctx,
        );
        expect(result).not.toContain('🔗 **URL**');
    });

    it('출처 섹션이 아예 없으면 기존처럼 전체 링크 목록 append (기존 동작 불변)', async () => {
        const result = await streamFromExternalProvider(deps, makeResolved('그냥 답변.'), req, () => {}, ctx);
        expect(result).toContain('**출처**');
        expect(result).toContain('(https://a.example.com/1)');
        expect(result).toContain('(https://c.example.com/3)');
    });
});
