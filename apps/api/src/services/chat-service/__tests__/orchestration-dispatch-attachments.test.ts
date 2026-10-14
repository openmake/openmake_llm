/**
 * delegate_agent_task — 채팅 턴 첨부를 위임 작업 입력으로 전달 (2026-10-15).
 *
 * 배경: 채팅 턴의 첨부는 fileContext 문자열로만 녹아, 백그라운드 작업 샌드박스 uploads/ 에는 파일이 없었다.
 * 이번 턴의 첨부(attachments)를 작업 생성(inputFiles·inputImages)과 실행(files·images)에 함께 넘긴다.
 */
const createAgentTask = jest.fn();
const findAgentTaskByCreateKey = jest.fn();
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ createAgentTask, findAgentTaskByCreateKey }),
}));
const execute = jest.fn();
jest.mock('../../AgentTaskService', () => ({
    AgentTaskService: jest.fn().mockImplementation(() => ({ execute })),
}));
jest.mock('../../agent-task/task-queue', () => ({
    dispatchAgentTask: jest.fn(async (entry: { run: () => Promise<unknown> }) => { await entry.run(); return 'started'; }),
}));
const resolveDefaultMaxTurns = jest.fn();
jest.mock('../../agent-task/task-inputs', () => ({
    resolveDefaultMaxTurns: (...args: unknown[]) => resolveDefaultMaxTurns(...args),
}));
const claimDelegatedTaskDurable = jest.fn();
jest.mock('../../agent-task/create-idempotency', () => ({
    claimDelegatedTaskDurable: (...args: unknown[]) => claimDelegatedTaskDurable(...args),
    releaseDelegatedTask: jest.fn(),
}));

import { runOrchestrationTool, buildDelegateAgentTaskTool } from '../orchestration-dispatch';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';
import type { ChatTurnAttachments } from '../../chat-service-types';

const userCtx = { userId: '3', role: 'user' } as never;

beforeEach(() => {
    jest.clearAllMocks();
    createAgentTask.mockResolvedValue(true);
    execute.mockResolvedValue(undefined);
    resolveDefaultMaxTurns.mockImplementation((_explicit: unknown, files?: unknown[]) => (files?.length ? 77 : AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS));
    claimDelegatedTaskDurable.mockResolvedValue({ priorTaskId: undefined, createKey: undefined });
});

describe('runOrchestrationTool(delegate_agent_task) — 이번 턴 첨부 전달', () => {
    const attachments: ChatTurnAttachments = {
        files: [{ name: 'sales.csv', type: 'text/csv', size: 12, content: 'a,b\n1,2' }],
        images: ['data:image/png;base64,iVBORw0KGgo='],
    };

    it('첨부를 작업 생성의 inputFiles·inputImages 와 실행의 files·images 로 넘긴다', async () => {
        await runOrchestrationTool({ name: 'delegate_agent_task', args: { goal: 'sales.csv 분석' }, userCtx, attachments });
        expect(createAgentTask).toHaveBeenCalledWith(expect.objectContaining({
            goal: 'sales.csv 분석', inputFiles: attachments.files, inputImages: attachments.images,
        }));
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({
            files: attachments.files, images: attachments.images,
        }));
    });

    it('첨부가 없으면 종전처럼 입력 없이 만든다', async () => {
        await runOrchestrationTool({ name: 'delegate_agent_task', args: { goal: '보고서' }, userCtx });
        const created = createAgentTask.mock.calls[0][0];
        expect(created.inputFiles).toBeUndefined();
        expect(created.inputImages).toBeUndefined();
        expect(created.maxTurns).toBe(AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS);
        const run = execute.mock.calls[0][0];
        expect(run.files).toBeUndefined();
        expect(run.images).toBeUndefined();
    });

    it('max_turns 가 없으면 첨부 기준 기본 턴(resolveDefaultMaxTurns — 대형 첨부 상향)을 쓴다', async () => {
        const scan: ChatTurnAttachments = { files: [{ name: 'scan.pdf', type: 'application/pdf', size: 10, data: 'JVBERi0=' }] };
        await runOrchestrationTool({ name: 'delegate_agent_task', args: { goal: 'scan.pdf 요약' }, userCtx, attachments: scan });
        expect(resolveDefaultMaxTurns).toHaveBeenCalledWith(undefined, scan.files);
        expect(createAgentTask.mock.calls[0][0].maxTurns).toBe(77);
        expect(execute.mock.calls[0][0].maxTurns).toBe(77);
    });

    it('max_turns 인자가 있으면 첨부와 상관없이 그 값을 쓴다', async () => {
        const scan: ChatTurnAttachments = { files: [{ name: 'scan.pdf', type: 'application/pdf', size: 10, data: 'JVBERi0=' }] };
        await runOrchestrationTool({ name: 'delegate_agent_task', args: { goal: 'g', max_turns: 3 }, userCtx, attachments: scan });
        expect(createAgentTask.mock.calls[0][0].maxTurns).toBe(3);
        expect(resolveDefaultMaxTurns).not.toHaveBeenCalled();
    });
});

describe('buildDelegateAgentTaskTool — 첨부 안내', () => {
    it('도구 설명에 이번 턴 첨부가 uploads/ 로 전달된다는 안내가 있다', () => {
        const desc = buildDelegateAgentTaskTool().function.description ?? '';
        expect(desc).toContain('uploads/');
        expect(desc).toContain('즉시 말로 답할 수 있는 질문에는 사용하지 마세요.');
    });
});
