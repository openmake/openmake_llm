/**
 * 오케스트레이터 검색 출처 — 턴 번호표 등록 + 최종 본문의 내부 표식 정리.
 *
 * 배경(2026-11-16 라이브): 사전 주입 검색(1~10)과 오케스트레이터 web.search 결과(번호표 밖)가 한 턴에 함께 들어가,
 * 모델이 `[오케스트레이터 작업 결과 t1, 결과 6, 8]` 을 본문에 쓰고 인용 수집이 그 안의 1·6·7·8 을 사전 주입 번호로 읽어
 * 날씨와 무관한 출처 4건을 붙였다.
 */
import { appendDeterministicBlocks } from '../external-deterministic-append';
import type { ChatMessageRequest } from '../../chat-service-types';
import type { StreamFromExternalContext } from '../external-provider';
import type { SearchSourceRef } from '../../../tools/web-search/types';

function injectedContext(count: number): string {
    return Array.from({ length: count }, (_, i) => `[출처 ${i + 1}] 사전 ${i + 1}\n   URL: https://pre.example/${i + 1}\n   내용: 요약`).join('\n\n');
}

function orchSearch(from: number, count: number): SearchSourceRef[] {
    return Array.from({ length: count }, (_, i) => ({ n: from + i, title: `날씨 ${from + i}`, url: `https://orch.example/${from + i}`, snippet: 's' }));
}

function run(finalContent: string, opts: { ctx?: Partial<StreamFromExternalContext>; toolSources?: SearchSourceRef[][]; webSearchContext?: string }): string {
    return appendDeterministicBlocks({
        finalContent,
        onToken: () => undefined,
        generatedMediaMarkdowns: [],
        integrationBlocks: {},
        ...(opts.toolSources ? { toolSources: opts.toolSources } : {}),
        req: { message: 'm', userId: '3', userLanguagePreference: 'ko', webSearchContext: opts.webSearchContext } as unknown as ChatMessageRequest,
        ctx: { resolvedLanguage: 'ko', ...opts.ctx } as StreamFromExternalContext,
    });
}

function listedNums(out: string): number[] {
    const block = out.split('**출처**')[1] ?? '';
    return [...block.matchAll(/^- \*\*(\d+)\.\*\* \[/gm)].map((m) => Number(m[1]));
}

/** message-pipeline 이 넘기는 꼴 — 번호표 원문은 블록을 붙이기 전 문자열, enhancedMessage 는 블록까지 붙은 것 */
function pipelineCtx(preInjected: number, orchFrom: number): Partial<StreamFromExternalContext> {
    const pre = preInjected > 0 ? `질문\n\n${injectedContext(preInjected)}` : '질문';
    const block = `[오케스트레이터 작업 결과 — …]\n\n### t1 · web.search\n검색어: 날씨\n${orchSearch(orchFrom, 8).map((s) => `[출처 ${s.n}] ${s.title}\n   URL: ${s.url}`).join('\n')}`;
    return { sourceContextText: pre, enhancedMessage: `${pre}\n\n${block}`, orchestratorBlockInjected: true };
}

describe('appendDeterministicBlocks — 오케스트레이터 출처', () => {
    it('라이브 회귀: 사전 주입 10 + 오케스트레이터 11~18 — 표식은 [출처 16, 18] 로 고쳐 쓰고 목록은 16·18 만', () => {
        const out = run('서울은 맑고 5도입니다 [오케스트레이터 작업 결과 t1, 출처 16, 18].', {
            ctx: pipelineCtx(10, 11), toolSources: [orchSearch(11, 8)],
        });
        expect(out).toContain('서울은 맑고 5도입니다 [출처 16, 18].');
        expect(out).not.toContain('오케스트레이터');
        expect(listedNums(out)).toEqual([16, 18]);
        expect(out).toContain('(https://orch.example/16)');
        expect(out).not.toContain('https://pre.example/1)');
    });

    it('표식 안의 번호표 번호는 인용으로 고쳐 쓰고, 작업 번호 t1 의 1 은 인용으로 읽지 않는다', () => {
        const out = run('맑음 [오케스트레이터 작업 결과 t1, 결과 6, 8]. 기온 [출처 12].', {
            ctx: pipelineCtx(10, 11), toolSources: [orchSearch(11, 8)],
        });
        // 6·8 은 사전 주입 번호표에 있으므로 고쳐 쓴다 — 단 t1 의 1 은 인용으로 읽지 않는다
        expect(out).toContain('맑음 [출처 6, 8].');
        expect(listedNums(out)).toEqual([6, 8, 12]);
    });

    it('오케스트레이터 검색만 돈 턴: 블록 안 [출처 N] 줄로 번호표를 만들지 않는다 — 라벨 없는 [1] 은 인용 아님, 인용 없으면 목록 없음', () => {
        const ctx = pipelineCtx(0, 1);
        expect(run('각주 [1] 와 arr[3].', { ctx, toolSources: [orchSearch(1, 8)] })).toBe('각주 [1] 와 arr[3].');
        const cited = run('맑음 [출처 2].', { ctx, toolSources: [orchSearch(1, 8)] });
        expect(listedNums(cited)).toEqual([2]);
    });

    it('sourceContextText 가 빈 문자열이어도 enhancedMessage 로 되돌아가지 않는다', () => {
        const ctx = { ...pipelineCtx(0, 1), sourceContextText: '' };
        expect(run('각주 [1].', { ctx, toolSources: [orchSearch(1, 8)] })).toBe('각주 [1].');
    });

    it('블록이 주입되지 않은 턴은 표식 정리를 하지 않는다', () => {
        const s = '참고 [오케스트레이터 작업 결과] 문구';
        expect(run(s, { ctx: { sourceContextText: '질문', enhancedMessage: '질문' } })).toBe(s);
    });

    it('검색 없는 블록 주입 턴(미디어)도 표식은 지운다', () => {
        expect(run('그림입니다 [t1 · image.generate].', { ctx: { sourceContextText: '질문', enhancedMessage: '질문 [블록]', orchestratorBlockInjected: true } }))
            .toBe('그림입니다.');
    });
});
