/** 작업 결과를 본 모델에 싣는 블록 — 내부 이름이 사용자 답으로 새지 않게 하는 지시를 고정한다 */
import { buildResultBlock, orchestratorStreamFields } from '../orchestrate';
import { RESULT_BLOCK_LABELS } from '../../../config/orchestrator-result-block';
import { CAPABILITIES } from '../../../config/capabilities';

const results = [
    { taskId: 't1', capability: 'web.search', ok: true, status: 'completed', text: 'Query: x\n1. title', media: [] },
    { taskId: 't2', capability: 'text.reason', ok: true, status: 'completed', text: 'draft text', media: [] },
] as never;

describe('buildResultBlock', () => {
    it('블록이 어떻게 만들어졌는지 설명하지 말라고 싣는다 — 실측(2026-10-13) 답에 "오케스트레이터 초기 분석(t2)에서…"가 나온 사례는 아래 내부 이름 계약 테스트가 이어받는다', () => {
        const ko = buildResultBlock(results, 'ko').block;
        expect(ko).toMatch(/어떻게 만들어졌는지.*설명하지 말고/);
        const en = buildResultBlock(results, 'en').block;
        expect(en).toMatch(/do not describe how this block was produced/i);
        expect(/\p{Script=Hangul}/u.test(en)).toBe(false);
    });

    it('머리줄은 사람 라벨과 상태만 — 작업 번호·식별자 없음', () => {
        expect(buildResultBlock(results, 'ko').block).toContain('### 웹 검색 — 완료\nQuery: x');
        expect(buildResultBlock(results, 'en').block).toContain('### Web search — done\nQuery: x');
        expect(buildResultBlock(results, 'en').block).toContain('### Text reasoning and analysis — done\ndraft text');
    });

    it('텍스트 작업의 결과는 초안이라 검색 결과와 다르면 검색 결과를 따르라고 싣는다', () => {
        expect(buildResultBlock(results, 'ko').block).toMatch(/초안.*검색 결과를 따르/);
        expect(buildResultBlock(results, 'en').block).toMatch(/draft/i);
    });
});

describe('buildResultBlock — 검색 작업 출처를 턴 번호표에 싣는다', () => {
    const src = (k: string, count: number) => Array.from({ length: count }, (_, i) => ({ title: `${k}${i + 1}`, url: `https://${k}.x/${i + 1}`, snippet: 's' }));
    const search = (id: string, sources: unknown[] | undefined, status = 'completed') =>
        ({ taskId: id, capability: 'web.search', ok: status === 'completed', status, text: `검색어: q${id}\n1. old`, media: [], ...(sources ? { sources } : {}) });

    it('출처는 기준 뒤 번호로 라벨형으로 나오고, 돌려준 번호와 같다', () => {
        const { block, sources } = buildResultBlock([search('t1', src('a', 3))] as never, 'ko', 10);
        expect(block).toContain('검색어: qt1');
        expect(block).toContain('[출처 11] a1\n   URL: https://a.x/1');
        expect(block).toContain('[출처 13] a3');
        expect(block).not.toContain('1. old');
        expect(sources).toEqual([[11, 12, 13].map((n, i) => expect.objectContaining({ n, url: `https://a.x/${i + 1}` }))]);
    });

    it('검색 작업이 둘이면 작업 순서대로 이어서 번호를 매긴다 — 0건·실패 작업이 끼어도 빈틈없이', () => {
        const { block, sources } = buildResultBlock([
            search('t1', src('a', 2)), search('t2', undefined), search('t3', undefined, 'failed'), search('t4', src('b', 2)),
        ] as never, 'ko');
        expect(block).toContain('[출처 1] a1');
        expect(block).toContain('[출처 3] b1');
        expect(block).toContain('[출처 4] b2');
        expect(sources.map((l) => l.map((s) => s.n))).toEqual([[1, 2], [3, 4]]);
    });

    it('영어 턴은 [Source N] 라벨', () => {
        const { block } = buildResultBlock([search('t1', src('a', 1))] as never, 'en');
        expect(block).toContain('[Source 1] a1');
        expect(block).toContain('Content: s');
    });

    it('안내문은 블록 이름 상수로 시작하고, 출처가 있을 때만 인용 문장을 싣는다', () => {
        const withSrc = buildResultBlock([search('t1', src('a', 1))] as never, 'ko').block;
        expect(withSrc.startsWith(`[${RESULT_BLOCK_LABELS.ko} — `)).toBe(true);
        expect(withSrc).toMatch(/\[출처 3\].*그대로 붙이고/);
        const noSrc = buildResultBlock(results, 'ko');
        expect(noSrc.block).not.toMatch(/그대로 붙이고/);
        expect(noSrc.sources).toEqual([]);
        expect(noSrc.block).toContain('Query: x\n1. title');
        const en = buildResultBlock([search('t1', src('a', 1))] as never, 'en').block;
        expect(en.startsWith(`[${RESULT_BLOCK_LABELS.en} — `)).toBe(true);
        expect(en).toMatch(/\[Source 3\]/);
    });
});

describe('buildResultBlock — 내부 이름 계약(생각 패널로 새지 않게 모델 입력에 싣지 않는다)', () => {
    const FORBIDDEN = /orchestrat|오케스트레이터|하위 작업|sub-?task/i;
    const statuses = ['completed', 'pending', 'skipped', 'failed'] as const;

    it.each(['ko', 'en'])('모든 capability × 모든 상태(%s) 블록에 내부 이름·작업 번호·식별자가 없다', (lang) => {
        const all = CAPABILITIES.flatMap((capability, i) => statuses.map((status, j) =>
            ({ taskId: `t${i * statuses.length + j + 1}`, capability, ok: status === 'completed', status, text: 'neutral body', media: [] })));
        const { block } = buildResultBlock(all as never, lang);
        expect(block).not.toMatch(FORBIDDEN);
        expect(block).not.toMatch(/\bt\d+\b/);
        for (const c of CAPABILITIES) expect(block).not.toContain(c);
    });

    it.each([['ko', '웹 검색'], ['en', 'Web search']])('완료가 아닌 작업 본문의 자기 식별자는 라벨로 바뀌고(%s), 완료 작업 본문은 그대로', (lang, label) => {
        const { block } = buildResultBlock([
            { taskId: 't1', capability: 'web.search', ok: false, status: 'failed', text: 'web.search: 검색어가 없습니다 (web.search)', media: [] },
            { taskId: 't2', capability: 'text.reason', ok: true, status: 'completed', text: 'web.search 는 그대로', media: [] },
        ] as never, lang);
        expect(block).toContain(`${label}: 검색어가 없습니다 (${label})`);
        expect(block).toContain('web.search 는 그대로');
        expect(block.replace('web.search 는 그대로', '')).not.toContain('web.search');
    });
});

describe('orchestratorStreamFields — 스트림 ctx 배선', () => {
    const sources = [[{ n: 11, title: 'a', url: 'https://a.x', snippet: '' }, { n: 12, title: 'b', url: 'https://b.x', snippet: '' }]];

    it('executed 면 출처·블록 주입 표시를 싣고, 출처 수만큼 턴 번호 기준을 민다(같은 턴 web_search 는 그 뒤 번호)', () => {
        const userContext = { sourceNumberBase: 10 };
        expect(orchestratorStreamFields({ mode: 'executed', sources }, userContext)).toEqual({ orchestratorSources: sources, orchestratorBlockInjected: true });
        expect(userContext.sourceNumberBase).toBe(12);
    });

    it('executed 가 아니면 아무것도 싣지 않고 기준도 그대로', () => {
        const userContext = { sourceNumberBase: 10 };
        expect(orchestratorStreamFields({ mode: 'fallback' }, userContext)).toEqual({});
        expect(userContext.sourceNumberBase).toBe(10);
    });
});
