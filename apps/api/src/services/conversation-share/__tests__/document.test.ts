/**
 * 대화 공유 문서 조립 — allowlist·정화·한도. 원본 행을 spread 하지 않는다.
 */
import { buildConversationShareDocument, measureConversationShareDocument } from '../document';
import { CONVERSATION_SHARE } from '../../../config/conversation-share';

describe('buildConversationShareDocument', () => {
    it('role·content 만 담고 숨은 필드(thinking·sources·model·id 등)는 버린다', () => {
        const row = {
            id: 7, session_id: 'sess-1', role: 'assistant', content: '답변', model: 'secret-model', agent_id: 'a',
            thinking: '사고 과정', reasoning_summary: '요약', sources: [{ url: 'https://x' }], tokens: 3, metadata: { k: 1 },
        };
        const doc = buildConversationShareDocument('제목', [{ id: 6, role: 'user', content: '질문', thinking: 'x' }, row]);
        expect(doc).toEqual({
            schemaVersion: 1,
            title: '제목',
            messages: [{ role: 'user', content: '질문' }, { role: 'assistant', content: '답변' }],
        });
        const text = JSON.stringify(doc);
        for (const hidden of ['sess-1', 'secret-model', '사고 과정', '요약', 'https://x', 'metadata']) {
            expect(text).not.toContain(hidden);
        }
    });

    it('system 메시지와 빈 본문은 제외한다', () => {
        const doc = buildConversationShareDocument('t', [
            { role: 'system', content: '시스템 프롬프트' },
            { role: 'user', content: '   ' },
            { role: 'tool', content: 'tool 결과' },
            { role: 'assistant', content: 'ok' },
        ]);
        expect(doc.messages).toEqual([{ role: 'assistant', content: 'ok' }]);
    });

    it('제목·본문에 결정적 정화를 적용한다(자격증명·이메일·홈 경로)', () => {
        const doc = buildConversationShareDocument('me@example.com 의 대화', [
            { role: 'user', content: '키는 sk-abcdefghijklmnopqrstuvwx 이고 경로는 /Users/alice/project 야' },
        ]);
        expect(doc.title).toBe('<email> 의 대화');
        expect(doc.messages[0].content).toContain('<redacted:api-key>');
        expect(doc.messages[0].content).not.toContain('alice');
    });

    it('제목이 없으면 빈 문자열', () => {
        expect(buildConversationShareDocument(null, [{ role: 'user', content: 'a' }]).title).toBe('');
    });
});

describe('measureConversationShareDocument', () => {
    it('직렬화 UTF-8 바이트를 잰다(한글은 3바이트)', () => {
        const doc = buildConversationShareDocument('', [{ role: 'user', content: '가' }]);
        expect(measureConversationShareDocument(doc)).toBe(Buffer.byteLength(JSON.stringify(doc), 'utf8'));
    });

    it('설정 한도 — 500개·1MiB·15분', () => {
        expect(CONVERSATION_SHARE.MAX_MESSAGES).toBe(500);
        expect(CONVERSATION_SHARE.MAX_DOCUMENT_BYTES).toBe(1024 * 1024);
        expect(CONVERSATION_SHARE.PREVIEW_TTL_MS).toBe(15 * 60 * 1000);
    });
});
