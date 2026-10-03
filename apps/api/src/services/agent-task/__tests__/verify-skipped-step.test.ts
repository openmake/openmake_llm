/**
 * 검증 건너뜀 스텝 — 재시도 상한을 넘겨 검증 없이 끝난 완료를 상세 화면에 남긴다(관측 전용, fail-open).
 */
const addAgentTaskStep = jest.fn();
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep }) }));

import { persistVerifySkippedStep, verifySkippedMessage } from '../task-steps';

beforeEach(() => { addAgentTaskStep.mockReset(); });

describe('persistVerifySkippedStep', () => {
    it('건너뛴 검증 이름을 담은 verify_skipped 스텝을 남기고 다음 스텝 번호를 돌려준다', async () => {
        addAgentTaskStep.mockResolvedValue(undefined);

        const next = await persistVerifySkippedStep('task-1', 7, ['deliverable', 'workspace_tests']);

        expect(next).toBe(8);
        expect(addAgentTaskStep).toHaveBeenCalledWith(expect.objectContaining({
            taskId: 'task-1', stepNumber: 7, stepType: 'verify_skipped',
        }));
        const content = addAgentTaskStep.mock.calls[0][0].content as string;
        expect(content).toContain('deliverable');
        expect(content).toContain('workspace_tests');
    });

    it('저장이 실패해도 던지지 않고 스텝 번호를 그대로 둔다(fail-open)', async () => {
        addAgentTaskStep.mockRejectedValue(new Error('db down'));

        await expect(persistVerifySkippedStep('task-1', 7, ['deliverable'])).resolves.toBe(7);
    });
});

describe('verifySkippedMessage', () => {
    it('미검증 완료임을 밝힌다', () => {
        expect(verifySkippedMessage(['deliverable'])).toContain('미검증 완료');
    });
});
