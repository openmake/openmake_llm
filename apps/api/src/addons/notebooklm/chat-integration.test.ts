/**
 * notebooklm 통합 — 고정한 노트북이 새 필드(contextRefs)와 구 필드(notebook) 양쪽으로 들어와도 같은 결과를 내는지.
 */
import { notebooklmChatIntegration as nb } from './chat-integration';
import { __setChatTurnIntegrationsForTest, collectContextRefs } from '../../services/chat-service/turn-integrations';

const REF = { id: 'nb-123', title: '분기 실적' };

afterEach(() => __setChatTurnIntegrationsForTest(null));

describe('collectContextRefs', () => {
    beforeEach(() => __setChatTurnIntegrationsForTest([nb]));

    it('새 필드 contextRefs 를 받는다', () => {
        expect(collectContextRefs({ contextRefs: { notebooklm: REF } })).toEqual({ notebooklm: REF });
    });

    it('구 클라이언트의 최상위 notebook 필드를 같은 참조로 옮겨 받는다 (iOS·캐시된 구 웹)', () => {
        expect(collectContextRefs({ notebook: REF })).toEqual({ notebooklm: REF });
    });

    it('둘 다 오면 새 필드가 우선한다', () => {
        expect(collectContextRefs({ contextRefs: { notebooklm: REF }, notebook: { id: 'old', title: 'x' } })).toEqual({ notebooklm: REF });
    });

    it('등록되지 않은 add-on id 와 형식이 어긋난 참조는 버린다', () => {
        expect(collectContextRefs({ contextRefs: { 'unknown-addon': REF } })).toBeUndefined();
        expect(collectContextRefs({ contextRefs: { notebooklm: { id: '  ', title: 'x' } } })).toBeUndefined();
        expect(collectContextRefs({ notebook: 'not-an-object' })).toBeUndefined();
        expect(collectContextRefs({})).toBeUndefined();
    });

    it('id 는 잘라서 받는다 (프롬프트 주입 길이 제한)', () => {
        const out = collectContextRefs({ contextRefs: { notebooklm: { id: 'x'.repeat(200), title: 't' } } });
        expect(out?.notebooklm.id).toHaveLength(64);
    });

    it('통합이 꺼져 있으면(0개) 구 필드도 무시된다', () => {
        __setChatTurnIntegrationsForTest([]);
        expect(collectContextRefs({ notebook: REF, contextRefs: { notebooklm: REF } })).toBeUndefined();
    });
});

describe('접두·도구 노출 힌트', () => {
    it('참조가 있으면 LLM 전용 접두와 서버 참조 힌트를 낸다', () => {
        const req = { message: '요약해줘', contextRefs: { notebooklm: REF } };
        expect(nb.enhancedMessagePrefix!(req, 'ko')).toContain('분기 실적');
        expect(nb.enhancedMessagePrefix!(req, 'ko')).toContain('nb-123');
        expect(nb.enhancedMessagePrefix!(req, 'en')).toContain('Notebook "분기 실적"');
        expect(nb.mcpSelectionHint!(req)).toBe('notebooklm');
    });

    it('참조가 없으면 아무것도 하지 않는다', () => {
        expect(nb.enhancedMessagePrefix!({ message: 'x' }, 'ko')).toBeUndefined();
        expect(nb.mcpSelectionHint!({ message: 'x' })).toBeUndefined();
    });
});
