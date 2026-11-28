/**
 * 스타일 가드 캐시 순서 (opt-in CHAT_STYLE_GUARD_AFTER_STATIC, 2026-11-28).
 * OFF(기본) = 종전처럼 정적 prefix 맨 앞. ON = 공통 정적 블록 뒤·DYNAMIC BOUNDARY 앞 — default 요청과 공통 prefix 를 공유.
 */
import type { ChatMessageRequest } from '../../chat-service-types';
import type { ResolvedProvider } from '../../../providers/provider-router';

const resolved = { fullId: 'local-llm:qwen3.8-flash-next' } as ResolvedProvider;
const req = { message: '안녕' } as ChatMessageRequest;
const ctxFor = (style: string) => ({ resolvedLanguage: 'ko', style, artifactGuideBlock: 'ARTIFACT_GUIDE_BLOCK' }) as never;

function load(flag: string | undefined) {
    jest.resetModules();
    if (flag === undefined) delete process.env.CHAT_STYLE_GUARD_AFTER_STATIC; else process.env.CHAT_STYLE_GUARD_AFTER_STATIC = flag;
    return require('../external-system-prompt') as typeof import('../external-system-prompt');
}
const parts = (m: ReturnType<typeof load>, style: string) =>
    m.buildExternalSystemPromptParts({ req, resolved, ctx: ctxFor(style), orchestration: { contributedTools: [], taskDelegate: false } });

afterAll(() => { delete process.env.CHAT_STYLE_GUARD_AFTER_STATIC; });

describe('스타일 가드 위치', () => {
    it('OFF(기본): verbose 가드가 정적 prefix 맨 앞 — 종전 그대로', () => {
        const m = load(undefined);
        const { staticParts } = parts(m, 'verbose');
        expect(staticParts[0]).toContain('응답 스타일: 상세');
    });

    it('ON: 가드는 정적 블록 마지막, 앞부분은 default 요청과 바이트 단위로 같다', () => {
        const m = load('true');
        const v = parts(m, 'verbose');
        const d = parts(m, 'default');
        expect(v.staticParts[v.staticParts.length - 1]).toContain('응답 스타일: 상세');
        expect(v.staticParts.slice(0, -1)).toEqual(d.staticParts);
        expect(v.staticParts.join('\n\n').startsWith(d.staticParts.join('\n\n'))).toBe(true);
        expect(v.dynamicParts).toEqual(d.dynamicParts);
    });

    it('ON: default 는 가드가 없어 종전과 같다', () => {
        expect(parts(load('true'), 'default')).toEqual(parts(load(undefined), 'default'));
    });
});
