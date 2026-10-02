/**
 * 외부 도구 실행 영수증·멱등 키 — 키는 작업·호출로 결정되고(다시 실행해도 같다), 저장 실패는 실행을 막지 않는다.
 */
const startToolReceipt = jest.fn(async () => undefined);
const finishToolReceipt = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn(() => ({ startToolReceipt, finishToolReceipt })),
}));

import { toolIdempotencyKey, needsReceipt, startReceipt, finishReceipt, receiptStatusOf } from '../tool-receipt';

beforeEach(() => jest.clearAllMocks());

describe('toolIdempotencyKey', () => {
    it('같은 작업·호출이면 같은 키, 호출이 다르면 다른 키', () => {
        expect(toolIdempotencyKey('t1', 'c1')).toBe(toolIdempotencyKey('t1', 'c1'));
        expect(toolIdempotencyKey('t1', 'c1')).not.toBe(toolIdempotencyKey('t1', 'c2'));
        expect(toolIdempotencyKey('t1', 'c1')).not.toBe(toolIdempotencyKey('t2', 'c1'));
        expect(toolIdempotencyKey('t1', 'c1')).toMatch(/^[a-f0-9]{32}$/);
    });
});

describe('needsReceipt', () => {
    it('외부 등급(표 밖 도구 = MCP·호스트 내장)만 대상이다', () => {
        expect(needsReceipt('od::create', {})).toBe(true);
        expect(needsReceipt('bash', { command: 'ls' })).toBe(false); // 샌드박스 안 실행
        expect(needsReceipt('mcp_read_resource', {})).toBe(false); // 읽기
        expect(needsReceipt('ask_human', {})).toBe(false); // 제어
    });
});

describe('receiptStatusOf', () => {
    it('Error: 로 시작하는 결과는 실패, 그 밖은 성공', () => {
        expect(receiptStatusOf('Error: boom')).toBe('failed');
        expect(receiptStatusOf('만들었습니다')).toBe('succeeded');
    });
});

describe('startReceipt · finishReceipt', () => {
    it('시작은 도구 이름·인자 해시·멱등 키와 함께, 종료는 상태와 함께 저장한다', async () => {
        const key = await startReceipt('t1', 'c1', 'od::create', { title: 'a' });
        expect(key).toBe(toolIdempotencyKey('t1', 'c1'));
        expect(startToolReceipt).toHaveBeenCalledWith(expect.objectContaining({
            taskId: 't1', toolCallId: 'c1', toolName: 'od::create', idempotencyKey: key, argsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }));
        await finishReceipt('t1', 'c1', 'succeeded');
        expect(finishToolReceipt).toHaveBeenCalledWith('t1', 'c1', 'succeeded');
    });

    it('저장이 실패해도 던지지 않고 키는 돌려준다', async () => {
        startToolReceipt.mockRejectedValueOnce(new Error('db down'));
        finishToolReceipt.mockRejectedValueOnce(new Error('db down'));
        await expect(startReceipt('t1', 'c1', 'od::create', {})).resolves.toBe(toolIdempotencyKey('t1', 'c1'));
        await expect(finishReceipt('t1', 'c1', 'failed')).resolves.toBeUndefined();
    });
});
