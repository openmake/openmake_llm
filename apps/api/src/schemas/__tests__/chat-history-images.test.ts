/**
 * REST /api/chat 히스토리 메시지의 images 보존 — chatMessageSchema 에 키가 없으면 zod strip 으로
 * validate 가 조용히 지워 멀티턴 vision 이 REST 에서만 끊겼다(2026-09-06).
 */
import { chatRequestSchema } from '../chat.schema';
import { FILE_ATTACH_LIMITS } from '../../config/runtime-limits';

const img = 'data:image/png;base64,iVBORw0KGgo=';

describe('chatRequestSchema.history[].images', () => {
    it('히스토리 user 메시지의 images 가 파싱 결과에 남는다', () => {
        const r = chatRequestSchema.parse({ message: '이 그림은?', history: [{ role: 'user', content: '앞선 그림', images: [img] }] });
        expect((r.history?.[0] as unknown as { images?: string[] }).images).toEqual([img]);
    });
    it('개수 상한은 현재 턴 images 와 동일', () => {
        const many = Array.from({ length: FILE_ATTACH_LIMITS.MAX_IMAGES + 1 }, () => img);
        expect(() => chatRequestSchema.parse({ message: 'x', history: [{ role: 'user', content: '', images: many }] })).toThrow();
    });
});
