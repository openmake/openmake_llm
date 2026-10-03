/** slotKindReason — 구 역할·기능 배정 경로도 쓰는 슬롯-모델 종류 대조 */
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../config/local-models', () => ({
    ...jest.requireActual('../../config/local-models'),
    findLocalModel: (id: string) => ({ 'retired-chat-model': { id, role: 'chat' }, 'bge-m3': { id, role: 'embedding' }, 'jev-decision': { id, role: 'capability' } } as Record<string, unknown>)[id],
}));

import { slotKindReason } from '../model-assignments-service';

describe('slotKindReason', () => {
    it('대화형 역할(planner)에 임베딩·기능 전용 모델은 거절', () => {
        expect(slotKindReason('planner', 'local-llm:bge-m3')).toContain('임베딩');
        expect(slotKindReason('planner', 'local-llm:jev-decision')).toContain('기능 전용');
    });
    it('대화형 역할에 채팅 모델은 통과', () => {
        expect(slotKindReason('planner', 'local-llm:retired-chat-model')).toBeNull();
    });
    it('생성 기능 슬롯에 채팅 모델은 거절', () => {
        expect(slotKindReason('image.generate', 'local-llm:retired-chat-model')).toContain('채팅 모델');
    });
    it('외부 모델·모르는 슬롯은 판단하지 않는다(null)', () => {
        expect(slotKindReason('planner', 'hasa:nemotron-super-120b')).toBeNull();
        expect(slotKindReason('no-such-slot', 'local-llm:bge-m3')).toBeNull();
    });
});
