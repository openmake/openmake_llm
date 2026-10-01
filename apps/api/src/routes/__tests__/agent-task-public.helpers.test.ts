/**
 * toPublicTask — 응답에 실어 보내는 작업 정보. 내부 운영 컬럼(174: 생성 멱등 키·종료 알림 표식)은 내보내지 않는다.
 * (2026-10-02 라이브 검증에서 작업 조회 응답에 Idempotency-Key 가 그대로 실려 나가는 것을 확인.)
 */
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({}) }));
jest.mock('../../auth/ownership', () => ({ assertResourceOwnerOrAdmin: jest.fn() }));
jest.mock('../../services/local-bridge/registry', () => ({ getLocalBridgeRegistry: () => ({}) }));

import { toPublicTask } from '../agent-task.helpers';

const row = {
    id: 't1', user_id: 'u1', goal: 'g', status: 'failed',
    checkpoint: { conversation: [] }, input_files: [{ name: 'a.txt', type: 'text/plain', size: 3, content: '비밀', data: 'AAAA' }], input_images: ['data:image/png;base64,AAAA'],
    create_idempotency_key: '3f2b8c1e-0000-4000-8000-aaaaaaaaaaaa', terminal_notify_pending: true,
};

describe('toPublicTask', () => {
    it('생성 멱등 키와 종료 알림 표식을 내보내지 않는다', () => {
        const pub = toPublicTask(row) as Record<string, unknown>;
        expect(pub).not.toHaveProperty('create_idempotency_key');
        expect(pub).not.toHaveProperty('terminal_notify_pending');
        expect(JSON.stringify(pub)).not.toContain('3f2b8c1e');
    });

    it('종전 계약은 그대로 — 체크포인트·이미지·첨부 본문 제외, 첨부 메타와 resumable 포함', () => {
        const pub = toPublicTask(row) as Record<string, unknown>;
        expect(pub).not.toHaveProperty('checkpoint');
        expect(pub).not.toHaveProperty('input_images');
        expect(pub.input_files).toEqual([{ name: 'a.txt', type: 'text/plain', size: 3 }]);
        expect(pub.resumable).toBe(true);
        expect(pub).toMatchObject({ id: 't1', user_id: 'u1', goal: 'g', status: 'failed' });
    });
});
