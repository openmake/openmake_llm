import { bulkDraftActionSchema } from '../../schemas/skills.schema';

describe('bulkDraftActionSchema (일괄 draft 처리)', () => {
    it('정상 입력', () => {
        const r = bulkDraftActionSchema.safeParse({ skillIds: ['a', 'b'], action: 'approve' });
        expect(r.success).toBe(true);
    });

    it('action 은 approve/reject 만', () => {
        expect(bulkDraftActionSchema.safeParse({ skillIds: ['a'], action: 'delete' }).success).toBe(false);
    });

    it('빈 목록 거부 (실수로 전체 처리되는 것 방지)', () => {
        expect(bulkDraftActionSchema.safeParse({ skillIds: [], action: 'reject' }).success).toBe(false);
    });

    it('상한 50개 초과 거부', () => {
        const ids = Array.from({ length: 51 }, (_, i) => `s${i}`);
        expect(bulkDraftActionSchema.safeParse({ skillIds: ids, action: 'approve' }).success).toBe(false);
        expect(bulkDraftActionSchema.safeParse({ skillIds: ids.slice(0, 50), action: 'approve' }).success).toBe(true);
    });

    it('id 타입/길이 검증', () => {
        expect(bulkDraftActionSchema.safeParse({ skillIds: [''], action: 'approve' }).success).toBe(false);
        expect(bulkDraftActionSchema.safeParse({ skillIds: [123], action: 'approve' }).success).toBe(false);
    });
});
